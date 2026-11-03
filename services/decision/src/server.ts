/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  API_VERSION,
  INVOICE_COMMAND_MAX_BYTES,
  evaluateRequestSchema,
  decisionCommandSchema,
  referencesSchema,
  decisionResponseSchema,
  evaluationSchema,
  identitySchema,
} from "../../../packages/contracts/src/index.js";
import { normalize, minor } from "./money.js";
import { evaluate } from "./rules.js";
import { policy } from "./config.js";
import { pool, transaction } from "./db.js";
import { jsonBody, HttpError, send, serve } from "./http.js";
import { importReferences } from "./reference-import.js";
const response = (row: any) =>
  decisionResponseSchema.parse({
    apiVersion: API_VERSION,
    generation: Number(row.generation),
    review: row.review,
    evaluation: row.evaluation ?? null,
  });
serve(
  async ({ req, res, path }) => {
    if (req.method === "GET" && path === "/v1/admin/operations") {
      const records = await pool.query(
        `SELECT r.invoice_id AS "invoiceId",r.content_hash AS hash,r.generation,r.review,r.evaluation,
                r.updated_at AS "updatedAt",c.invoice_id IS NOT NULL AS "hasCommitment",
                c.po_id AS "poId",c.vendor_id AS "vendorId",c.amount_minor::text AS "amountMinor",
                c.kind,c.business_key AS "businessKey",
                o.idempotency_key AS "operationId",o.request,o.request_hash AS "requestHash",
                o.operation_type AS "operationType",o.actor_id AS "actorId",o.status AS "operationStatus",o.created_at AS "committedAt"
         FROM decision_records r LEFT JOIN commitments c ON c.invoice_id=r.invoice_id
         LEFT JOIN LATERAL (SELECT * FROM decision_operations x WHERE x.invoice_id=r.invoice_id ORDER BY x.created_at DESC LIMIT 1) o ON true
         ORDER BY r.updated_at`,
      );
      send(res, { records: records.rows });
      return;
    }
    if (req.method === "GET" && path === "/v1/references") {
      const [v, p, c] = await Promise.all([
        pool.query(
          "SELECT id,name,identifier,aliases,approved FROM vendors ORDER BY name",
        ),
        pool.query(
          'SELECT id,vendor_id AS "vendorId",currency,status,limit_minor::text AS "limitMinor",description FROM purchase_orders ORDER BY id',
        ),
        pool.query(
          'SELECT invoice_id AS "invoiceId",po_id AS "poId",vendor_id AS "vendorId",business_key AS "businessKey",amount_minor::text AS "amountMinor",label,kind FROM commitments ORDER BY created_at',
        ),
      ]);
      send(
        res,
        referencesSchema.parse({
          vendors: v.rows,
          pos: p.rows,
          commitments: c.rows,
        }),
      );
      return;
    }
    if (req.method === "POST" && path === "/v1/admin/references/import") {
      const input = await jsonBody(req, 2_100_000);
      if (
        !input ||
        !["preview", "commit"].includes(input.mode) ||
        typeof input.previewId !== "string" ||
        typeof input.csv !== "string" ||
        typeof input.actorId !== "string"
      )
        throw new HttpError(400, "Import request is invalid");
      const result = await importReferences(
        input as {
          mode: "preview" | "commit";
          previewId: string;
          csv: string;
          actorId: string;
        },
      );
      send(res, result.body, result.status);
      return;
    }
    if (req.method === "POST" && path === "/v1/registrations") {
      const input = identitySchema.parse(await jsonBody(req));
      const operationKey = String(req.headers["idempotency-key"] ?? "");
      if (!operationKey || operationKey.length > 180)
        throw new HttpError(400, "Idempotency-Key is required");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      await transaction(async (c) => {
        const prior = await c.query(
          "SELECT request_hash FROM decision_operations WHERE idempotency_key=$1 FOR UPDATE",
          [operationKey],
        );
        if (prior.rowCount && prior.rows[0].request_hash !== fingerprint)
          throw new HttpError(409, "Registration operation key was reused");
        await c.query(
          "INSERT INTO decision_records(invoice_id,content_hash,created_at) VALUES($1,$2,$3) ON CONFLICT(invoice_id) DO NOTHING",
          [input.invoiceId, input.hash, input.createdAt],
        );
        const rec = await c.query(
          "SELECT content_hash,created_at FROM decision_records WHERE invoice_id=$1",
          [input.invoiceId],
        );
        if (rec.rows[0].content_hash !== input.hash)
          throw new HttpError(409, "Invoice identity changed");
        await c.query(
          `INSERT INTO decision_operations(idempotency_key,request_hash,response,operation_type,invoice_id,generation,request,status)
           VALUES($1,$2,'{"registered":true}'::jsonb,'registration',$3,0,$4,'committed') ON CONFLICT(idempotency_key) DO NOTHING`,
          [operationKey, fingerprint, input.invoiceId, JSON.stringify(input)],
        );
      });
      send(res, { apiVersion: API_VERSION, registered: true });
      return;
    }
    if (req.method === "POST" && path === "/v1/generations/fence") {
      const input = identitySchema
        .extend({
          apiVersion: z.literal("1"),
          generation: z.number().int().positive(),
        })
        .strict()
        .parse(await jsonBody(req));
      const operationKey = String(req.headers["idempotency-key"] ?? "");
      if (!operationKey || operationKey.length > 180)
        throw new HttpError(400, "Idempotency-Key is required");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const result = await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(715031)");
        const prior = await c.query(
          "SELECT request_hash,response FROM decision_operations WHERE idempotency_key=$1 FOR UPDATE",
          [operationKey],
        );
        if (prior.rowCount) {
          if (prior.rows[0].request_hash !== fingerprint)
            throw new HttpError(409, "Generation fence key was reused");
          return prior.rows[0].response;
        }
        await c.query(
          "INSERT INTO decision_records(invoice_id,content_hash,created_at) VALUES($1,$2,$3) ON CONFLICT(invoice_id) DO NOTHING",
          [input.invoiceId, input.hash, input.createdAt],
        );
        const found = await c.query(
          "SELECT * FROM decision_records WHERE invoice_id=$1 FOR UPDATE",
          [input.invoiceId],
        );
        const row = found.rows[0];
        if (
          row.content_hash !== input.hash ||
          new Date(row.created_at).toISOString() !== input.createdAt
        )
          throw new HttpError(409, "Registered invoice identity mismatch");
        if (row.review !== "pending")
          throw new HttpError(409, "Finalized decision cannot be corrected");
        if (Number(row.generation) > input.generation)
          throw new HttpError(409, "Generation fence is stale");
        if (Number(row.generation) < input.generation) {
          await c.query(
            "DELETE FROM commitments WHERE invoice_id=$1 AND kind='reservation'",
            [input.invoiceId],
          );
          await c.query("DELETE FROM business_claims WHERE invoice_id=$1", [
            input.invoiceId,
          ]);
          await c.query(
            "UPDATE decision_records SET generation=$2,fields=NULL,selected_po=NULL,evaluation=NULL,updated_at=now() WHERE invoice_id=$1",
            [input.invoiceId, input.generation],
          );
        }
        const body = {
          apiVersion: API_VERSION,
          invoiceId: input.invoiceId,
          generation: input.generation,
          fenced: true,
        };
        await c.query(
          `INSERT INTO decision_operations(idempotency_key,request_hash,response,operation_type,invoice_id,generation,request,status) VALUES($1,$2,$3,'generation-fence',$4,$5,$6,'committed')`,
          [
            operationKey,
            fingerprint,
            JSON.stringify(body),
            input.invoiceId,
            input.generation,
            JSON.stringify(input),
          ],
        );
        return body;
      });
      send(res, result);
      return;
    }
    if (req.method === "POST" && path === "/v1/evaluations") {
      const input = evaluateRequestSchema.parse(
        await jsonBody(req, INVOICE_COMMAND_MAX_BYTES),
      );
      const operationKey = String(req.headers["idempotency-key"] ?? "");
      if (!operationKey || operationKey.length > 180)
        throw new HttpError(400, "Idempotency-Key is required");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const result = await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(715031)");
        const prior = await c.query(
          "SELECT request_hash,response FROM decision_operations WHERE idempotency_key=$1 FOR UPDATE",
          [operationKey],
        );
        if (prior.rowCount) {
          if (prior.rows[0].request_hash !== fingerprint)
            throw new HttpError(409, "Evaluation operation key was reused");
          return prior.rows[0].response;
        }
        const current = await c.query(
          "SELECT * FROM decision_records WHERE invoice_id=$1 FOR UPDATE",
          [input.invoiceId],
        );
        if (!current.rowCount)
          throw new HttpError(404, "Invoice is not registered");
        const row = current.rows[0];
        if (
          row.content_hash !== input.hash ||
          new Date(row.created_at).toISOString() !== input.createdAt
        )
          throw new HttpError(409, "Registered invoice identity mismatch");
        if (row.review !== "pending")
          throw new HttpError(409, "Finalized decision cannot be reevaluated");
        if (Number(row.generation) > input.generation)
          throw new HttpError(409, "Stale evaluation generation");
        if (Number(row.generation) === input.generation && row.evaluation) {
          const existing = response(row);
          await c.query(
            `INSERT INTO decision_operations(idempotency_key,request_hash,response,operation_type,invoice_id,generation,request,status)
             VALUES($1,$2,$3,'evaluation',$4,$5,$6,'committed')`,
            [
              operationKey,
              fingerprint,
              JSON.stringify(existing),
              input.invoiceId,
              input.generation,
              JSON.stringify(input),
            ],
          );
          return existing;
        }
        const [v, p] = await Promise.all([
          c.query("SELECT id,name,identifier,aliases,approved FROM vendors"),
          c.query(
            'SELECT id,vendor_id AS "vendorId",currency,status,limit_minor::text AS "limitMinor",description FROM purchase_orders',
          ),
        ]);
        let duplicate: string | null = null;
        const exact = await c.query(
          "SELECT invoice_id FROM decision_records WHERE content_hash=$1 AND invoice_id<>$2 AND (created_at<$3 OR (created_at=$3 AND invoice_id<$2)) ORDER BY created_at,invoice_id LIMIT 1",
          [input.hash, input.invoiceId, input.createdAt],
        );
        if (exact.rowCount) duplicate = exact.rows[0].invoice_id;
        const vendor = input.fields.supplierId
          ? v.rows.find(
              (x) =>
                normalize(x.identifier) === normalize(input.fields.supplierId!),
            )
          : v.rows.find((x) =>
              (x.aliases as string[]).some(
                (a) =>
                  normalize(a) === normalize(input.fields.supplierName ?? ""),
              ),
            );
        const businessKey =
          vendor && input.fields.invoiceNumber
            ? vendor.id + ":" + normalize(input.fields.invoiceNumber)
            : null;
        if (!duplicate && businessKey) {
          const claim = await c.query(
            "SELECT invoice_id FROM business_claims WHERE business_key=$1 AND invoice_id<>$2",
            [businessKey, input.invoiceId],
          );
          if (claim.rowCount) duplicate = claim.rows[0].invoice_id;
        }
        await c.query(
          "DELETE FROM commitments WHERE invoice_id=$1 AND kind='reservation'",
          [input.invoiceId],
        );
        await c.query("DELETE FROM business_claims WHERE invoice_id=$1", [
          input.invoiceId,
        ]);
        const committed = await c.query(
          'SELECT invoice_id AS "invoiceId",po_id AS "poId",business_key AS "businessKey",amount_minor::text AS "amountMinor",label FROM commitments',
        );
        const evaluation = evaluationSchema.parse(
          evaluate(input.fields, {
            vendors: v.rows,
            pos: p.rows,
            commitments: committed.rows,
            duplicateOf: duplicate,
            selectedPo: input.selectedPo,
            extractionReviewRequired: input.extractionReviewRequired,
            roundingMinor: policy.roundingMinor,
            policyVersion: policy.version,
          }),
        );
        if (businessKey && !duplicate) {
          await c.query(
            "INSERT INTO business_claims(business_key,invoice_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [businessKey, input.invoiceId, input.createdAt],
          );
          const claimed = await c.query(
            "SELECT invoice_id FROM business_claims WHERE business_key=$1",
            [businessKey],
          );
          if (claimed.rows[0].invoice_id !== input.invoiceId) {
            const recheck = evaluationSchema.parse(
              evaluate(input.fields, {
                vendors: v.rows,
                pos: p.rows,
                commitments: committed.rows,
                duplicateOf: claimed.rows[0].invoice_id,
                selectedPo: input.selectedPo,
                extractionReviewRequired: input.extractionReviewRequired,
                roundingMinor: policy.roundingMinor,
                policyVersion: policy.version,
              }),
            );
            Object.assign(evaluation, recheck);
          }
        }
        if (
          evaluation.decision === "READY_FOR_APPROVAL" &&
          evaluation.poId &&
          evaluation.vendorId
        ) {
          const order = p.rows.find((x) => x.id === evaluation.poId);
          const total = minor(input.fields.total!, input.fields.currency!);
          const sum = await c.query(
            "SELECT coalesce(sum(amount_minor),0)::text AS used FROM commitments WHERE po_id=$1",
            [evaluation.poId],
          );
          if (
            !order ||
            order.status !== "open" ||
            BigInt(sum.rows[0].used) + total > BigInt(order.limitMinor)
          ) {
            const e = evaluation.findings.find((x) => x.code === "PO_BALANCE");
            if (e) {
              e.status = "blocked";
              e.message =
                "The available PO balance changed. This invoice cannot be reserved.";
            }
            evaluation.decision = "BLOCKED";
          } else {
            await c.query(
              "INSERT INTO commitments(invoice_id,po_id,vendor_id,business_key,amount_minor,label,kind) VALUES($1,$2,$3,$4,$5,$6,'reservation')",
              [
                input.invoiceId,
                evaluation.poId,
                evaluation.vendorId,
                businessKey ?? evaluation.vendorId + ":" + input.invoiceId,
                total.toString(),
                input.fields.invoiceNumber ?? input.invoiceId,
              ],
            );
          }
        }
        const saved = await c.query(
          "UPDATE decision_records SET generation=$2,fields=$3,selected_po=$4,evaluation=$5,updated_at=now() WHERE invoice_id=$1 RETURNING *",
          [
            input.invoiceId,
            input.generation,
            JSON.stringify(input.fields),
            input.selectedPo ?? null,
            JSON.stringify(evaluation),
          ],
        );
        await c.query(
          `INSERT INTO decision_operations(idempotency_key,request_hash,response,operation_type,invoice_id,generation,request,status)
           VALUES($1,$2,$3,'evaluation',$4,$5,$6,'committed')`,
          [
            operationKey,
            fingerprint,
            JSON.stringify(response(saved.rows[0])),
            input.invoiceId,
            input.generation,
            JSON.stringify(input),
          ],
        );
        return response(saved.rows[0]);
      });
      send(res, result);
      return;
    }
    if (req.method === "POST" && path === "/v1/commands") {
      const input = decisionCommandSchema.parse(await jsonBody(req));
      const operationKey = String(req.headers["idempotency-key"] ?? "");
      if (operationKey.length < 1 || operationKey.length > 180)
        throw new HttpError(400, "Idempotency-Key is required");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const out = await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(715031)");
        const prior = await c.query(
          "SELECT request_hash,response FROM decision_operations WHERE idempotency_key=$1",
          [operationKey],
        );
        if (prior.rowCount) {
          if (prior.rows[0].request_hash !== fingerprint)
            throw new HttpError(
              409,
              "Idempotency key reused for a different financial command",
            );
          return prior.rows[0].response;
        }
        const found = await c.query(
          "SELECT * FROM decision_records WHERE invoice_id=$1 FOR UPDATE",
          [input.invoiceId],
        );
        if (!found.rowCount)
          throw new HttpError(404, "Invoice is not registered");
        const row = found.rows[0];
        if (
          Number(row.generation) !== input.expectedGeneration ||
          !row.evaluation
        )
          throw new HttpError(
            409,
            "Recommendation changed. Refresh before acting.",
          );
        if (input.generation <= row.generation)
          throw new HttpError(409, "Decision generation must increase");
        if (row.review !== "pending")
          throw new HttpError(409, "Finalized review is immutable");
        if (input.action === "approve") {
          if (row.evaluation.decision !== "READY_FOR_APPROVAL")
            throw new HttpError(
              409,
              "Financial controls do not permit approval",
            );
          const reservation = await c.query(
            "SELECT * FROM commitments WHERE invoice_id=$1 AND kind='reservation' FOR UPDATE",
            [input.invoiceId],
          );
          if (!reservation.rowCount)
            throw new HttpError(
              409,
              "Reservation missing; reevaluate before approval",
            );
          const sum = await c.query(
            "SELECT coalesce(sum(amount_minor),0)::text AS used FROM commitments WHERE po_id=$1",
            [reservation.rows[0].po_id],
          );
          const order = await c.query(
            "SELECT status,limit_minor::text FROM purchase_orders WHERE id=$1 FOR UPDATE",
            [reservation.rows[0].po_id],
          );
          if (
            !order.rowCount ||
            order.rows[0].status !== "open" ||
            BigInt(sum.rows[0].used) > BigInt(order.rows[0].limit_minor)
          )
            throw new HttpError(
              409,
              "Purchase order is no longer eligible or has insufficient balance",
            );
          await c.query(
            "UPDATE commitments SET kind='approval' WHERE invoice_id=$1",
            [input.invoiceId],
          );
        } else
          await c.query(
            "DELETE FROM commitments WHERE invoice_id=$1 AND kind='reservation'",
            [input.invoiceId],
          );
        const saved = await c.query(
          "UPDATE decision_records SET review=$2,generation=$3,updated_at=now() WHERE invoice_id=$1 RETURNING *",
          [
            input.invoiceId,
            input.action === "approve" ? "approved" : "rejected",
            input.generation,
          ],
        );
        const value = response(saved.rows[0]);
        await c.query(
          `INSERT INTO decision_operations(idempotency_key,request_hash,response,operation_type,invoice_id,generation,actor_id,request,status)
           VALUES($1,$2,$3,'review',$4,$5,$6,$7,'committed')`,
          [
            operationKey,
            fingerprint,
            JSON.stringify(value),
            input.invoiceId,
            input.generation,
            input.actorId ?? null,
            JSON.stringify(input),
          ],
        );
        return value;
      });
      send(res, out);
      return;
    }
    throw new HttpError(404, "Endpoint not found");
  },
  async () => ({ policy }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => void pool.end().finally(() => process.exit(0)));
