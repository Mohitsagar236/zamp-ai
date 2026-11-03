import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import {
  API_VERSION,
  INVOICE_COMMAND_MAX_BYTES,
  fieldsSchema,
  reviewRequestSchema,
  invoiceSchema,
  invoiceStateSchema,
  stageNames,
  policySchema,
  requiresSourceVerification,
} from "../../../packages/contracts/src/index.js";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { body, jsonBody, HttpError, send, serve } from "./http.js";
import { storage, validateUpload } from "./storage.js";
import { runWorker } from "./worker.js";
import { metrics } from "./metrics.js";
import { call, WorkflowError } from "./clients.js";
import {
  inspectConsistency,
  sameFields,
  type FinancialSnapshot,
} from "./reconciliation.js";
import {
  verifyWorkspaceIdentity,
  type WorkspacePrincipal,
} from "../../../packages/contracts/src/identity.js";
function authorize(req: IncomingMessage): WorkspacePrincipal | null {
  const host =
      String(req.headers["x-workspace-host"] ?? "")
        .replace(/^\[([^\]]+)\].*$/, "$1")
        .split(":")[0] ?? "",
    origin = String(req.headers["x-workspace-origin"] ?? "");
  let principal: WorkspacePrincipal | null = null;
  if (config.WORKSPACE_AUTH_MODE === "individual") {
    const assertion = String(req.headers["x-workspace-identity"] ?? "");
    principal = verifyWorkspaceIdentity(
      assertion,
      config.WORKFLOW_IDENTITY_SECRET,
    );
    if (!principal)
      throw new HttpError(401, "Authenticated workspace identity required");
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      principal.role === "viewer"
    )
      throw new HttpError(403, "Viewer accounts cannot change invoices");
  } else if (config.WORKSPACE_AUTH_MODE === "basic") {
    const a = Buffer.from(
        String(req.headers["x-workspace-authorization"] ?? ""),
      ),
      b = Buffer.from(
        "Basic " +
          Buffer.from(
            config.WORKSPACE_USER + ":" + config.WORKSPACE_PASSWORD,
          ).toString("base64"),
      );
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new HttpError(401, "Workspace sign-in required");
  } else if (!["127.0.0.1", "localhost", "::1"].includes(host))
    throw new HttpError(403, "Local workspace access only");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method ?? "") &&
    (origin !== new URL(config.WORKSPACE_URL).origin ||
      host !== new URL(config.WORKSPACE_URL).hostname)
  )
    throw new HttpError(403, "Request origin is not allowed");
  return principal;
}
function reviewerIdentity(principal: WorkspacePrincipal | null) {
  if (principal) return `${principal.name} (${principal.email})`;
  return config.WORKSPACE_AUTH_MODE === "basic"
    ? config.WORKSPACE_USER + " (shared workspace credential)"
    : "Local demo reviewer (individual identity unavailable)";
}
type InvoiceRow = {
  id: string;
  filename: string;
  hash: string;
  storage_key: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  state: unknown;
};
function dto(x: InvoiceRow) {
  return invoiceSchema.parse({
    id: x.id,
    filename: x.filename,
    hash: x.hash,
    storageKey: x.storage_key,
    status: x.status,
    createdAt: x.created_at,
    updatedAt: x.updated_at,
    state: invoiceStateSchema.parse(x.state),
  });
}
type FinancialOperation = FinancialSnapshot & {
  invoiceId: string;
  generation: number;
  review: string;
  operationId?: string | null;
  request?: { reason?: string } | null;
  actorId?: string | null;
  committedAt?: string | null;
  hasCommitment: boolean;
  poId?: string | null;
  amountMinor?: string | null;
  kind?: string | null;
};
serve(
  async ({ req, res, path, correlationId }) => {
    // The HTTP server has already checked the internal bearer credential.
    if (req.method === "GET" && path === "/v1/metrics") {
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4",
        "Cache-Control": "no-store",
      });
      res.end(await metrics());
      return;
    }
    const principal = authorize(req);
    if (path === "/v1/admin/reconciliation" && req.method === "POST") {
      if (!principal || principal.role !== "admin")
        throw new HttpError(403, "Administrator access is required");
      const input = await jsonBody(req, 4096);
      const repair = input?.mode === "repair";
      if (!repair && input?.mode !== "scan")
        throw new HttpError(400, "Choose scan or repair mode");
      const snapshot = (await call("decision", "/v1/admin/operations", {
        method: "GET",
        correlationId,
      })) as { records?: FinancialOperation[] };
      if (!Array.isArray(snapshot.records))
        throw new WorkflowError(502, "Decision operation snapshot is invalid");
      const authoritative = new Map(
        snapshot.records.map((record) => [record.invoiceId, record]),
      );
      const local = await pool.query(
        "SELECT * FROM invoices ORDER BY created_at",
      );
      const reported: Record<string, unknown>[] = [];
      let repairedCount = 0;
      async function recordIssue(
        invoiceId: string,
        code: string,
        explanation: string,
        details: unknown,
      ) {
        const key = `${invoiceId}:integrity:${code}`;
        await pool.query(
          "INSERT INTO reconciliation_cases(case_key,invoice_id,operation_id,status,explanation,details) VALUES($1,$2,$3,'open',$4,$5) ON CONFLICT(case_key) DO UPDATE SET status='open',explanation=excluded.explanation,details=excluded.details,last_seen=now(),resolved_at=NULL,resolved_by=NULL",
          [key, invoiceId, correlationId, explanation, JSON.stringify(details)],
        );
        reported.push({ caseKey: key, invoiceId, explanation });
      }
      for (const invoice of local.rows) {
        const financial = authoritative.get(invoice.id);
        const jobs = await pool.query(
          "SELECT 1 FROM workflow_jobs WHERE invoice_id=$1 AND status IN ('queued','running') LIMIT 1",
          [invoice.id],
        );
        const activeJob = Boolean(jobs.rowCount);
        const integrityCodes: string[] = [];
        for (const issue of inspectConsistency(invoice, financial, activeJob)) {
          // Final review mismatches already have the existing repair protocol.
          if (
            issue.code === "review-mismatch" &&
            financial &&
            ["approved", "rejected"].includes(financial.review) &&
            invoice.state.review === "pending"
          )
            continue;
          integrityCodes.push(issue.code);
          await recordIssue(invoice.id, issue.code, issue.explanation, {
            generation: invoice.generation,
            financialGeneration: financial?.generation,
          });
        }
        try {
          const bytes = await storage.get(invoice.storage_key);
          if (
            createHash("sha256").update(bytes).digest("hex") !== invoice.hash
          ) {
            integrityCodes.push("document-hash");
            await recordIssue(
              invoice.id,
              "document-hash",
              "Private document bytes do not match the registered SHA-256. Restore a verified backup; approval is blocked.",
              {},
            );
          }
        } catch {
          integrityCodes.push("document-missing");
          await recordIssue(
            invoice.id,
            "document-missing",
            "The private document cannot be read. Restore the verified original before review.",
            {},
          );
        }
        if (!activeJob)
          await pool.query(
            "UPDATE reconciliation_cases SET status='resolved',resolved_at=now(),resolved_by=$2,last_seen=now() WHERE invoice_id=$1 AND case_key LIKE $3 AND status='open' AND NOT (case_key = ANY($4::text[]))",
            [
              invoice.id,
              principal.sub,
              `${invoice.id}:integrity:%`,
              integrityCodes.map((code) => `${invoice.id}:integrity:${code}`),
            ],
          );
        const workflowReview = invoice.state.review;
        const decisionReview = financial?.review ?? "missing";
        const staleFinal =
          financial &&
          ["approved", "rejected"].includes(decisionReview) &&
          workflowReview === "pending";
        const operationId =
          financial?.operationId ??
          `registration:${invoice.id}:${invoice.generation}`;
        const caseKey = `${invoice.id}:${financial?.generation ?? 0}:${workflowReview}:${decisionReview}`;
        let repaired = false;
        if (repair && staleFinal) {
          await transaction(async (c) => {
            const locked = await c.query(
              "SELECT * FROM invoices WHERE id=$1 FOR UPDATE",
              [invoice.id],
            );
            if (!locked.rowCount || locked.rows[0].state.review !== "pending")
              return;
            const state = locked.rows[0].state;
            const request = financial.request ?? {};
            state.review = financial.review;
            state.history.push({
              at: financial.committedAt ?? new Date().toISOString(),
              action: financial.review,
              reason:
                request.reason ??
                "Recovered from the authoritative Decision record.",
              actor: financial.actorId
                ? "Authenticated reviewer (display unavailable)"
                : "Historical reviewer (identity unavailable)",
              ...(financial.actorId ? { actorId: financial.actorId } : {}),
              revision: state.revision,
              generation: Number(financial.generation),
              correlationId,
              reconciliationOperationId: operationId,
            });
            await c.query(
              "UPDATE invoices SET status='completed',state=$2,updated_at=now() WHERE id=$1",
              [invoice.id, JSON.stringify(state)],
            );
            await c.query(
              "UPDATE workflow_jobs SET status='completed',error=NULL,lease_token=NULL,lease_until=NULL WHERE invoice_id=$1 AND generation=$2 AND kind='review' AND status IN ('failed','running','queued')",
              [invoice.id, financial.generation],
            );
            await c.query(
              "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,'reconciled',$2,$3)",
              [
                invoice.id,
                JSON.stringify({
                  mode: "authoritative-decision-repair",
                  decisionReview: financial.review,
                  operationId,
                  actorId: principal.sub,
                  commitment: financial.hasCommitment
                    ? {
                        poId: financial.poId,
                        amountMinor: financial.amountMinor,
                        kind: financial.kind,
                      }
                    : null,
                }),
                correlationId,
              ],
            );
            await c.query(
              "INSERT INTO reconciliation_cases(case_key,invoice_id,operation_id,status,explanation,details,resolved_at,resolved_by) VALUES($1,$2,$3,'resolved',$4,$5,now(),$6) ON CONFLICT(case_key) DO UPDATE SET status='resolved',explanation=excluded.explanation,details=excluded.details,last_seen=now(),resolved_at=now(),resolved_by=excluded.resolved_by",
              [
                caseKey,
                invoice.id,
                operationId,
                "Workflow was repaired from Decision's committed final review; commitments were not changed.",
                JSON.stringify({ workflowReview, decisionReview }),
                principal.sub,
              ],
            );
            repaired = true;
          });
          if (repaired) repairedCount++;
        }
        if (staleFinal && !repaired) {
          await pool.query(
            "INSERT INTO reconciliation_cases(case_key,invoice_id,operation_id,status,explanation,details) VALUES($1,$2,$3,'open',$4,$5) ON CONFLICT(case_key) DO UPDATE SET status='open',explanation=excluded.explanation,details=excluded.details,last_seen=now(),resolved_at=NULL,resolved_by=NULL",
            [
              caseKey,
              invoice.id,
              operationId,
              "Decision has a final financial review while Workflow still shows pending. Repair will copy authoritative review state and will not change commitments.",
              JSON.stringify({
                workflowReview,
                decisionReview,
                operationId,
                commitment: financial.hasCommitment
                  ? {
                      poId: financial.poId,
                      amountMinor: financial.amountMinor,
                      kind: financial.kind,
                    }
                  : null,
              }),
            ],
          );
          reported.push({
            caseKey,
            invoiceId: invoice.id,
            status: "open",
            explanation:
              "Decision has a final financial review while Workflow still shows pending.",
            operationId,
          });
        }
      }
      const workflowIds = new Set(local.rows.map((invoice) => invoice.id));
      for (const financial of snapshot.records) {
        if (
          !workflowIds.has(financial.invoiceId) &&
          financial.kind !== "opening" &&
          financial.hash !== "0".repeat(64)
        )
          await recordIssue(
            financial.invoiceId,
            "workflow-missing",
            "Decision has a non-opening invoice with no Workflow document/history. Restore or investigate the missing record; commitments are unchanged.",
            { generation: financial.generation, review: financial.review },
          );
      }
      const cases = await pool.query(
        'SELECT case_key AS "caseKey",invoice_id AS "invoiceId",operation_id AS "operationId",status,explanation,details,first_seen AS "firstSeen",last_seen AS "lastSeen",resolved_at AS "resolvedAt" FROM reconciliation_cases WHERE status=\'open\' ORDER BY first_seen',
      );
      send(res, {
        mode: input.mode,
        scanned: local.rowCount,
        repaired: repairedCount,
        openCases: cases.rows,
        casesObserved: reported.length,
      });
      return;
    }
    if (req.method === "POST" && path === "/v1/admin/references/import") {
      if (!principal || principal.role !== "admin")
        throw new HttpError(403, "Administrator access is required");
      const input = await jsonBody(req, 2_100_000);
      if (
        !input ||
        !["preview", "commit"].includes(input.mode) ||
        typeof input.previewId !== "string" ||
        typeof input.csv !== "string"
      )
        throw new HttpError(400, "Import request is invalid");
      let result: unknown;
      try {
        result = await call("decision", "/v1/admin/references/import", {
          method: "POST",
          correlationId,
          json: {
            mode: input.mode,
            previewId: input.previewId,
            csv: input.csv,
            actorId: principal.sub,
          },
        });
      } catch (error) {
        if (error instanceof WorkflowError) {
          send(res, error.response ?? { error: error.message }, error.status);
          return;
        }
        throw error;
      }
      send(res, result);
      return;
    }
    const root = "/v1/invoices";
    if (req.method === "POST" && path === root) {
      const bytes = await body(req, config.MAX_FILE_MB * 1024 * 1024);
      const filename = String(req.headers["x-filename"] ?? "invoice.pdf")
        .replace(/[\x00-\x1f\\/]/g, "")
        .slice(0, 180);
      validateUpload(filename, bytes);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (req.headers["x-content-sha256"] !== hash)
        throw new HttpError(400, "Document digest mismatch");
      const key = String(req.headers["idempotency-key"] ?? "");
      if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(key))
        throw new HttpError(400, "Idempotency-Key required");
      const old = await pool.query(
        "SELECT * FROM invoices WHERE upload_key=$1",
        [key],
      );
      if (old.rowCount) {
        if (old.rows[0].upload_fingerprint !== hash)
          throw new HttpError(
            409,
            "Idempotency key reused for another invoice",
          );
        send(res, { id: old.rows[0].id });
        return;
      }
      const id = randomUUID(),
        storageKey = await storage.put(bytes),
        now = new Date().toISOString();
      const state = {
        stages: stageNames.map((name, i) => ({
          name,
          status: i === 0 ? "completed" : "queued",
          ...(i === 0
            ? {
                startedAt: now,
                endedAt: now,
                message:
                  "Original document stored in the private workflow service.",
              }
            : {}),
        })),
        revision: 1,
        review: "pending",
        history: [
          {
            at: now,
            action: "uploaded",
            reason: "Document registered",
            actor: reviewerIdentity(principal),
            ...(principal ? { actorId: principal.sub } : {}),
            revision: 1,
          },
        ],
      };
      try {
        await transaction(async (c) => {
          await c.query(
            "INSERT INTO invoices(id,filename,hash,storage_key,status,created_at,updated_at,state,generation,upload_key,upload_fingerprint) VALUES($1,$2,$3,$4,'queued',$5,$5,$6,1,$7,$8)",
            [
              id,
              filename,
              hash,
              storageKey,
              now,
              JSON.stringify(state),
              key,
              hash,
            ],
          );
          await c.query(
            "INSERT INTO workflow_jobs(id,invoice_id,generation,kind,payload,status,correlation_id) VALUES($1,$2,1,'process','{}','queued',$3)",
            [randomUUID(), id, correlationId],
          );
          await c.query(
            "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,'uploaded',$2,$3)",
            [
              id,
              JSON.stringify({ message: "Document registered" }),
              correlationId,
            ],
          );
        });
      } catch (e) {
        await storage.remove(storageKey).catch(() => {});
        throw e;
      }
      send(res, { id }, 201);
      return;
    }
    if (req.method === "GET" && path === root) {
      const q = await pool.query(
        "SELECT * FROM invoices ORDER BY created_at DESC",
      );
      send(res, q.rows.map(dto));
      return;
    }
    if (req.method === "GET" && path === "/v1/references") {
      send(
        res,
        await call("decision", "/v1/references", {
          method: "GET",
          correlationId,
        }),
      );
      return;
    }
    if (req.method === "GET" && path.startsWith(root + "/")) {
      const rest = path.slice(root.length + 1).split("/"),
        id = rest[0],
        q = await pool.query("SELECT * FROM invoices WHERE id=$1", [id]);
      if (!q.rowCount) throw new HttpError(404, "Invoice not found");
      const row = q.rows[0];
      if (rest.length === 1) {
        send(res, dto(row));
        return;
      }
      if (rest[1] === "events") {
        send(
          res,
          (
            await pool.query(
              'SELECT id,invoice_id AS "invoiceId",at,type,data FROM stage_events WHERE invoice_id=$1 ORDER BY id',
              [id],
            )
          ).rows,
        );
        return;
      }
      if (rest[1] === "document") {
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="invoice-' + id + '.pdf"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox",
        });
        res.end(await storage.get(row.storage_key));
        return;
      }
    }
    if (
      req.method === "POST" &&
      path.startsWith(root + "/") &&
      path.endsWith("/reviews")
    ) {
      const id = path.slice(root.length + 1, -8);
      const command = reviewRequestSchema.parse(
        await jsonBody(req, INVOICE_COMMAND_MAX_BYTES),
      );
      const result = await transaction(async (c) => {
        const q = await c.query(
          "SELECT * FROM invoices WHERE id=$1 FOR UPDATE",
          [id],
        );
        if (!q.rowCount) throw new HttpError(404, "Invoice not found");
        const row = q.rows[0],
          state = row.state;
        if (state.review !== "pending")
          throw new HttpError(409, "Finalized review is immutable");
        if (["running", "queued"].includes(row.status))
          throw new HttpError(
            409,
            "Wait for the current workflow job to finish",
          );
        if (
          ["approve", "reject"].includes(command.action) &&
          (!state.evaluation || row.status !== "completed")
        )
          throw new HttpError(
            409,
            "Invoice does not have a completed recommendation",
          );
        if (
          command.action === "approve" &&
          state.evaluation.decision !== "READY_FOR_APPROVAL"
        )
          throw new HttpError(409, "Financial controls do not permit approval");
        if (
          command.action === "approve" &&
          requiresSourceVerification(
            state.extraction,
            config.APP_ENV === "production",
          ) &&
          !state.extractionVerified
        )
          throw new HttpError(
            409,
            "Verify invoice values and item details against the original before approval",
          );
        if (command.action === "approve") {
          let bytes: Buffer;
          try {
            bytes = await storage.get(row.storage_key);
          } catch {
            throw new HttpError(
              409,
              "Original document is unavailable; restore it before approval",
            );
          }
          if (
            createHash("sha256").update(bytes).digest("hex") !== row.hash ||
            !sameFields(state.fields, state.evaluation.inputs)
          )
            throw new HttpError(
              409,
              "Document or evaluation integrity check failed; reconcile before approval",
            );
          const open = await c.query(
            "SELECT 1 FROM reconciliation_cases WHERE invoice_id=$1 AND status='open' LIMIT 1",
            [id],
          );
          if (open.rowCount)
            throw new HttpError(
              409,
              "Resolve this invoice's reconciliation cases before approval",
            );
        }
        const previous = Number(row.generation),
          generation = previous + 1;
        const actor = reviewerIdentity(principal);
        if (command.action === "retry" && row.status === "failed") {
          const failedReview = await c.query(
            "SELECT id FROM workflow_jobs WHERE invoice_id=$1 AND generation=$2 AND kind='review' AND status='failed' FOR UPDATE",
            [id, previous],
          );
          if (failedReview.rowCount) {
            const retryEntry = {
              at: new Date().toISOString(),
              action: "retry",
              reason: command.reason,
              actor,
              ...(principal ? { actorId: principal.sub } : {}),
              revision: state.revision,
              generation: previous,
              correlationId,
            };
            state.history.push(retryEntry);
            delete state.error;
            await c.query(
              "UPDATE invoices SET status='queued',state=$2,updated_at=now() WHERE id=$1",
              [id, JSON.stringify(state)],
            );
            await c.query(
              "UPDATE workflow_jobs SET status='queued',attempts=0,error=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1",
              [failedReview.rows[0].id],
            );
            await c.query(
              "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,'review_requested',$2,$3)",
              [id, JSON.stringify(retryEntry), correlationId],
            );
            return dto(
              (await c.query("SELECT * FROM invoices WHERE id=$1", [id]))
                .rows[0],
            );
          }
        }
        if (
          ["correct", "select-po", "rerun", "retry"].includes(command.action)
        ) {
          await call("decision", "/v1/generations/fence", {
            method: "POST",
            correlationId,
            idempotencyKey: `${id}:${generation}:fence`,
            json: {
              apiVersion: API_VERSION,
              invoiceId: id,
              hash: row.hash,
              createdAt: row.created_at.toISOString(),
              generation,
            },
          });
        }
        const previousFields = state.fields
          ? structuredClone(state.fields)
          : null;
        const previousPo = state.selectedPo ?? null;
        if (command.action === "correct") {
          state.fields = fieldsSchema.parse(command.fields);
          state.extractionVerified = command.verifiedExtraction === true;
          state.revision++;
        }
        if (command.action === "select-po") {
          state.selectedPo = command.selectedPo;
          state.revision++;
        }
        const entry = {
          at: new Date().toISOString(),
          action: ["approve", "reject"].includes(command.action)
            ? `${command.action}-requested`
            : command.action,
          reason: command.reason,
          actor,
          ...(principal ? { actorId: principal.sub } : {}),
          revision: state.revision,
          generation,
          correlationId,
          ...(command.action === "correct"
            ? {
                previousFields,
                correctedFields: structuredClone(state.fields),
                extractionVerified: state.extractionVerified,
              }
            : {}),
          ...(command.action === "select-po"
            ? {
                previousPo,
                selectedPo: state.selectedPo ?? null,
              }
            : {}),
        };
        state.history.push(entry);
        if (
          ["correct", "select-po", "rerun", "retry"].includes(command.action)
        ) {
          delete state.evaluation;
          delete state.error;
          state.stages = stageNames.map((name, i) => ({
            name,
            status:
              i === 0
                ? "completed"
                : state.extraction && i < 3
                  ? "completed"
                  : "queued",
          }));
        }
        row.generation = generation;
        await c.query(
          "UPDATE invoices SET generation=$2,status='queued',state=$3,updated_at=now() WHERE id=$1",
          [id, generation, JSON.stringify(state)],
        );
        const payload = {
          ...command,
          expectedGeneration: previous,
          actor,
          ...(principal ? { actorId: principal.sub } : {}),
        };
        await c.query(
          "INSERT INTO workflow_jobs(id,invoice_id,generation,kind,payload,status,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            id,
            generation,
            ["approve", "reject"].includes(command.action)
              ? "review"
              : "process",
            JSON.stringify(payload),
            "queued",
            correlationId,
          ],
        );
        await c.query(
          "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,'review_requested',$2,$3)",
          [id, JSON.stringify(entry), correlationId],
        );
        return dto(
          (await c.query("SELECT * FROM invoices WHERE id=$1", [id])).rows[0],
        );
      });
      send(res, result, 202);
      return;
    }
    if (req.method === "GET" && path === "/health/ready") {
      const [d, e] = await Promise.all([
        call("decision", "/health/ready", { method: "GET", correlationId }),
        call("extraction", "/health/ready", { method: "GET", correlationId }),
      ]);
      const decisionHealth = d as { policy: unknown; status: string };
      const extractionHealth = e as { ocr: string; status: string };
      const h = await pool.query(
        "SELECT at FROM workflow_heartbeat WHERE at>now()-interval '30 seconds'",
      );
      send(res, {
        database: "ready",
        worker: h.rowCount ? "ready" : "offline",
        ocr: extractionHealth.ocr,
        limits: { maxMB: config.MAX_FILE_MB, maxPages: config.MAX_PAGES },
        policy: policySchema.parse(decisionHealth.policy),
        authMode: config.WORKSPACE_AUTH_MODE,
        environment: config.APP_ENV,
        sourceVerificationRequired: config.APP_ENV === "production",
        services: {
          extraction: extractionHealth.status,
          decision: decisionHealth.status,
        },
      });
      return;
    }
    throw new HttpError(404, "Endpoint not found");
  },
  async () => {
    const q = await pool.query(
      "SELECT at FROM workflow_heartbeat WHERE at>now()-interval '30 seconds'",
    );
    const [d, e] = await Promise.all([
      call("decision", "/health/ready", {
        method: "GET",
        correlationId: "health",
      }),
      call("extraction", "/health/ready", {
        method: "GET",
        correlationId: "health",
      }),
    ]);
    const decisionHealth = d as { policy: unknown; status: string };
    const extractionHealth = e as { ocr: string; status: string };
    return {
      database: "ready",
      worker: q.rowCount ? "ready" : "offline",
      ocr: extractionHealth.ocr,
      limits: { maxMB: config.MAX_FILE_MB, maxPages: config.MAX_PAGES },
      policy: policySchema.parse(decisionHealth.policy),
      authMode: config.WORKSPACE_AUTH_MODE,
      environment: config.APP_ENV,
      sourceVerificationRequired: config.APP_ENV === "production",
      services: {
        decision: decisionHealth.status,
        extraction: extractionHealth.status,
      },
    };
  },
);
if (config.WORKER_ENABLED === "true") void runWorker();
for (const s of ["SIGINT", "SIGTERM"] as const)
  process.on(s, () => void pool.end().finally(() => process.exit(0)));
