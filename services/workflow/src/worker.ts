import { randomUUID } from "node:crypto";
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  fieldsSchema,
  evaluationSchema,
  API_VERSION,
  decisionResponseSchema,
  referencesSchema,
  extractionResponseSchema,
  requiresSourceVerification,
} from "../../../packages/contracts/src/index.js";
import { config } from "./config.js";
import { pool, transaction } from "./db.js";
import { storage, validateUpload } from "./storage.js";
import { call, WorkflowError } from "./clients.js";
import { log } from "./http.js";
class StaleLeaseError extends WorkflowError {
  constructor(message: string) {
    super(409, message);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stopping = false;
for (const s of ["SIGINT", "SIGTERM"] as const)
  process.on(s, () => {
    stopping = true;
  });
async function update(
  job: any,
  fn: (row: any) => void,
  options: {
    event?: { type: string; data: unknown };
    completeJob?: boolean;
    failJob?: string;
  } = {},
) {
  return transaction(async (c) => {
    const terminal = options.completeJob || options.failJob;
    if (terminal) {
      const owned = await c.query(
        "SELECT 1 FROM workflow_jobs WHERE id=$1 AND status='running' AND lease_token=$2 AND generation=$3 AND lease_until>now() FOR UPDATE",
        [job.id, job.lease_token, job.generation],
      );
      if (!owned.rowCount) return false;
    }
    const q = await c.query("SELECT * FROM invoices WHERE id=$1 FOR UPDATE", [
      job.invoice_id,
    ]);
    if (!q.rowCount) return false;
    const row = q.rows[0];
    const owned = terminal
      ? { rowCount: 1 }
      : await c.query(
          "SELECT 1 FROM workflow_jobs WHERE id=$1 AND status='running' AND lease_token=$2 AND generation=$3 AND lease_until>now()",
          [job.id, job.lease_token, job.generation],
        );
    if (
      !owned.rowCount ||
      Number(row.generation) !== Number(job.generation) ||
      row.state.review !== "pending"
    )
      return false;
    fn(row);
    await c.query(
      "UPDATE invoices SET status=$2,state=$3,updated_at=now() WHERE id=$1",
      [row.id, row.status, JSON.stringify(row.state)],
    );
    if (options.completeJob || options.failJob) {
      const completedJob = await c.query(
        "UPDATE workflow_jobs SET status=$3,error=$4,lease_token=NULL,lease_until=NULL WHERE id=$1 AND status='running' AND lease_token=$2 AND generation=$5 AND lease_until>now()",
        [
          job.id,
          job.lease_token,
          options.completeJob ? "completed" : "failed",
          options.failJob ?? null,
          job.generation,
        ],
      );
      if (!completedJob.rowCount)
        throw new StaleLeaseError("Expired workflow lease cannot finalize job");
    }
    if (options.event)
      await c.query(
        "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,$2,$3,$4)",
        [
          job.invoice_id,
          options.event.type,
          JSON.stringify(options.event.data),
          job.correlation_id,
        ],
      );
    return true;
  });
}
async function stage(job: any, index: number, status: any, message: string) {
  const at = new Date().toISOString();
  const saved = await update(
    job,
    (row) => {
      const item = row.state.stages[index];
      if (!item) return;
      item.status = status;
      item.message = message;
      if (status === "running") item.startedAt = at;
      else item.endedAt = at;
    },
    {
      event: {
        type: "stage",
        data: { index, status, message, at },
      },
    },
  );
  if (!saved)
    throw new StaleLeaseError("Expired workflow lease cannot record stage");
}
async function fail(job: any, message: string) {
  const saved = await update(
    job,
    (row) => {
      row.status = "failed";
      row.state.error = message;
      for (const s of row.state.stages) {
        if (s.status === "running") {
          s.status = "failed";
          s.endedAt = new Date().toISOString();
          s.message = message;
        } else if (s.status === "queued") s.status = "skipped";
      }
    },
    {
      failJob: message,
      event: { type: "failure", data: { message, generation: job.generation } },
    },
  );
  if (!saved) return;
}
async function runJob(job: any) {
  const corr = job.correlation_id;
  try {
    const q = await pool.query("SELECT * FROM invoices WHERE id=$1", [
      job.invoice_id,
    ]);
    if (!q.rowCount) return;
    const row = q.rows[0];
    if (
      job.kind === "review" &&
      (job.payload.action === "approve" || job.payload.action === "reject")
    ) {
      const action = job.payload.action;
      const out = decisionResponseSchema.parse(
        await call("decision", "/v1/commands", {
          method: "POST",
          correlationId: corr,
          idempotencyKey: `${job.invoice_id}:${job.generation}:${action}`,
          json: {
            apiVersion: API_VERSION,
            invoiceId: job.invoice_id,
            generation: Number(job.generation),
            expectedGeneration: Number(job.payload.expectedGeneration),
            action,
            reason: job.payload.reason,
            ...(typeof job.payload.actorId === "string"
              ? { actorId: job.payload.actorId }
              : {}),
          },
        }),
      );
      const saved = await transaction(async (c) => {
        const lease = await c.query(
          "SELECT 1 FROM workflow_jobs WHERE id=$1 AND status='running' AND lease_token=$2 AND generation=$3 AND lease_until>now() FOR UPDATE",
          [job.id, job.lease_token, job.generation],
        );
        const invoice = await c.query(
          "SELECT * FROM invoices WHERE id=$1 FOR UPDATE",
          [job.invoice_id],
        );
        if (
          !invoice.rowCount ||
          !lease.rowCount ||
          Number(invoice.rows[0].generation) !== Number(job.generation) ||
          invoice.rows[0].state.review !== "pending"
        )
          return false;
        const state = invoice.rows[0].state;
        state.review = out.review;
        state.history.push({
          at: new Date().toISOString(),
          action,
          reason: job.payload.reason,
          actor:
            job.payload.actor ?? "Historical reviewer (identity unavailable)",
          ...(typeof job.payload.actorId === "string"
            ? { actorId: job.payload.actorId }
            : {}),
          revision: state.revision,
          generation: Number(job.generation),
          correlationId: corr,
        });
        await c.query(
          "UPDATE invoices SET status='completed',state=$2,updated_at=now() WHERE id=$1",
          [job.invoice_id, JSON.stringify(state)],
        );
        await c.query(
          "UPDATE workflow_jobs SET status='completed',lease_token=NULL,lease_until=NULL WHERE id=$1",
          [job.id],
        );
        await c.query(
          "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,'review',$2,$3)",
          [
            job.invoice_id,
            JSON.stringify({
              action,
              review: out.review,
              generation: job.generation,
              ...(typeof job.payload.actorId === "string"
                ? { actorId: job.payload.actorId }
                : {}),
            }),
            corr,
          ],
        );
        return true;
      });
      if (!saved)
        throw new StaleLeaseError(
          "Expired workflow lease cannot finalize review",
        );
      return;
    }
    await call("decision", "/v1/registrations", {
      method: "POST",
      correlationId: corr,
      idempotencyKey: `register:${row.id}`,
      json: {
        invoiceId: row.id,
        hash: row.hash,
        createdAt: row.created_at.toISOString(),
      },
    });
    let extraction = row.state.extraction;
    if (!extraction) {
      await stage(
        job,
        1,
        "running",
        "Checking private document signature and size.",
      );
      const bytes = await storage.get(row.storage_key);
      validateUpload(row.filename, bytes);
      await stage(
        job,
        1,
        "completed",
        `PDF signature verified; ${bytes.length.toLocaleString()} bytes.`,
      );
      await stage(
        job,
        2,
        "running",
        "Extracting text; OCR is used for scanned pages.",
      );
      extraction = extractionResponseSchema.parse(
        await call("extraction", "/v1/extractions", {
          method: "POST",
          correlationId: corr,
          idempotencyKey: `${row.id}:${job.generation}:extract`,
          hash: row.hash,
          bytes,
          filename: row.filename,
        }),
      ).extraction;
      const saved = await update(job, (r) => {
        r.state.extraction = extraction;
        r.state.fields = extraction.fields;
      });
      if (!saved)
        throw new StaleLeaseError(
          "Expired workflow lease cannot save extraction",
        );
      await stage(
        job,
        2,
        "completed",
        `${extraction.provider}; ${extraction.pageCount} page(s). ${extraction.warnings.length} extraction warning(s).`,
      );
    } else {
      await stage(job, 1, "skipped", "Previously validated original document.");
      await stage(
        job,
        2,
        "skipped",
        "Using persisted extraction and evidence.",
      );
    }
    await stage(job, 3, "running", "Validating extracted fields and amounts.");
    fieldsSchema.parse(row.state.fields ?? extraction.fields);
    await stage(job, 3, "completed", "Structured field validation completed.");
    await stage(
      job,
      4,
      "running",
      "Loading supplier and purchase order records.",
    );
    const refs = referencesSchema.parse(
      await call("decision", "/v1/references", {
        method: "GET",
        correlationId: corr,
      }),
    );
    await stage(
      job,
      4,
      "completed",
      `${refs.vendors.length} suppliers and ${refs.pos.length} orders available for deterministic matching.`,
    );
    await stage(
      job,
      5,
      "running",
      "Checking duplicates and reserving PO balance in one transaction.",
    );
    const decisionResult = decisionResponseSchema.parse(
      await call("decision", "/v1/evaluations", {
        method: "POST",
        correlationId: corr,
        idempotencyKey: `${row.id}:${job.generation}:evaluate`,
        json: {
          apiVersion: API_VERSION,
          invoiceId: row.id,
          hash: row.hash,
          createdAt: row.created_at.toISOString(),
          generation: Number(job.generation),
          fields: row.state.fields ?? extraction.fields,
          extractionReviewRequired:
            requiresSourceVerification(
              extraction,
              config.APP_ENV === "production",
            ) && !row.state.extractionVerified,
          ...(row.state.selectedPo ? { selectedPo: row.state.selectedPo } : {}),
        },
      }),
    );
    if (!decisionResult.evaluation)
      throw new WorkflowError(502, "Decision service returned no evaluation");
    const evaluation = evaluationSchema.parse(decisionResult.evaluation);
    await stage(
      job,
      5,
      "completed",
      `${evaluation.findings.length} checks recorded. ${evaluation.decision === "READY_FOR_APPROVAL" ? "Funds reserved atomically." : "No funds reserved."}`,
    );
    await stage(
      job,
      6,
      "running",
      "Saving recommendation, evidence and audit history.",
    );
    const saved = await update(
      job,
      (r) => {
        r.state.evaluation = evaluation;
        r.state.error = undefined;
        const finalStage = r.state.stages[6];
        if (finalStage) {
          finalStage.status = "completed";
          finalStage.message = `Recommendation saved: ${evaluation.decision}.`;
          finalStage.endedAt = new Date().toISOString();
        }
        r.state.history.push({
          at: evaluation.at,
          action: "evaluated",
          reason: `${evaluation.decision}; policy ${evaluation.policyVersion}`,
          actor: "rules engine",
          revision: r.state.revision,
          fields: r.state.fields,
          evaluation,
        });
        r.status = "completed";
      },
      {
        completeJob: true,
        event: { type: "evaluation", data: evaluation },
      },
    );
    if (!saved)
      throw new StaleLeaseError(
        "Expired workflow lease cannot finalize recommendation",
      );
    log("job_completed", corr, {
      invoiceId: job.invoice_id,
      generation: job.generation,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Workflow processing failed";
    if (e instanceof StaleLeaseError) {
      log("stale_worker_write_refused", corr, {
        invoiceId: job.invoice_id,
        generation: job.generation,
      });
      return;
    }
    await fail(job, message);
    log("job_failed", corr, {
      invoiceId: job.invoice_id,
      generation: job.generation,
    });
  }
}
async function tick() {
  await pool.query(
    "INSERT INTO workflow_heartbeat(id,at) VALUES('workflow',now()) ON CONFLICT(id) DO UPDATE SET at=excluded.at",
  );
  await transaction(async (c) => {
    const exp = await c.query(
      "SELECT j.*,i.state,i.id AS invoice_id FROM workflow_jobs j JOIN invoices i ON i.id=j.invoice_id WHERE j.status='running' AND j.lease_until<now() FOR UPDATE OF j SKIP LOCKED",
    );
    for (const job of exp.rows) {
      if (job.attempts >= 8) {
        await c.query(
          "UPDATE workflow_jobs SET status='failed',error='Retry limit reached',lease_token=NULL WHERE id=$1",
          [job.id],
        );
        const s = job.state;
        s.error =
          "Workflow interrupted repeatedly. Check service readiness, then retry.";
        for (const stage of s.stages) {
          if (stage.status === "running") {
            stage.status = "failed";
            stage.endedAt = new Date().toISOString();
            stage.message = s.error;
          } else if (stage.status === "queued") stage.status = "skipped";
        }
        await c.query(
          "UPDATE invoices SET status='failed',state=$2,updated_at=now() WHERE id=$1",
          [job.invoice_id, JSON.stringify(s)],
        );
        await c.query(
          "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,'recovery',$2,$3)",
          [
            job.invoice_id,
            JSON.stringify({ retry: false }),
            job.correlation_id,
          ],
        );
      } else {
        const s = job.state;
        for (const stage of s.stages)
          if (stage.status === "running") {
            stage.status = "queued";
            stage.endedAt = undefined;
          }
        await c.query(
          "UPDATE workflow_jobs SET status='queued',lease_token=NULL,lease_until=NULL WHERE id=$1",
          [job.id],
        );
        await c.query(
          "UPDATE invoices SET status='queued',state=$2 WHERE id=$1",
          [job.invoice_id, JSON.stringify(s)],
        );
        await c.query(
          "INSERT INTO stage_events(invoice_id,type,data,correlation_id) VALUES($1,'recovery',$2,$3)",
          [
            job.invoice_id,
            JSON.stringify({ retry: true, attempt: job.attempts }),
            job.correlation_id,
          ],
        );
      }
    }
  });
  const claim = await transaction(async (c) => {
    const q = await c.query(
      "SELECT * FROM workflow_jobs WHERE status='queued' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!q.rowCount) return null;
    const j = q.rows[0],
      token = randomUUID();
    const n = await c.query(
      "UPDATE workflow_jobs SET status='running',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '150 seconds' WHERE id=$1 RETURNING *",
      [j.id, token],
    );
    const owned = await c.query(
      "UPDATE invoices SET status='running',updated_at=now() WHERE id=$1 AND generation=$2 AND state->>'review'='pending' RETURNING id",
      [j.invoice_id, j.generation],
    );
    if (!owned.rowCount) {
      await c.query("UPDATE workflow_jobs SET status='failed' WHERE id=$1", [
        j.id,
      ]);
      return null;
    }
    return n.rows[0];
  });
  if (!claim) return;
  const timer = setInterval(
    () =>
      void pool
        .query(
          "UPDATE workflow_jobs SET lease_until=now()+interval '150 seconds' WHERE id=$1 AND status='running' AND lease_token=$2 AND lease_until>now()",
          [claim.id, claim.lease_token],
        )
        .catch(() => {}),
    10000,
  );
  try {
    await runJob(claim);
  } finally {
    clearInterval(timer);
  }
}
export async function runWorker() {
  const heartbeat = setInterval(
    () =>
      void pool
        .query(
          "INSERT INTO workflow_heartbeat(id,at) VALUES('workflow',now()) ON CONFLICT(id) DO UPDATE SET at=excluded.at",
        )
        .catch(() => {}),
    10000,
  );
  heartbeat.unref();
  try {
    while (!stopping) {
      try {
        await tick();
      } catch (e) {
        log("worker_loop_error", "worker", {
          error: e instanceof Error ? e.message : "unknown",
        });
        await sleep(1000);
      }
      await sleep(100);
    }
  } finally {
    clearInterval(heartbeat);
  }
}
