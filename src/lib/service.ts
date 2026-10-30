import { randomUUID, createHash } from "node:crypto";
import { eq, desc, sql, and, ne } from "drizzle-orm";
import { db } from "./db";
import { invoices, jobs, events, vendors, pos, commitments } from "./schema";
import {
  stageNames,
  type InvoiceState,
  type Fields,
  fieldsSchema,
} from "./types";
import { storage, validateUpload, InputError } from "./storage";
import { evaluate } from "./rules";
import { policy } from "./config";
import { minor, normalize } from "./money";
export async function upload(filename: string, bytes: Uint8Array) {
  validateUpload(filename, bytes);
  const id = randomUUID(),
    key = await storage.put(bytes);
  const now = new Date().toISOString();
  const state: InvoiceState = {
    stages: stageNames.map((name, i) => ({
      name,
      status: i === 0 ? "completed" : "queued",
      ...(i === 0
        ? {
            startedAt: now,
            endedAt: now,
            message: "Original document stored privately.",
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
        actor: "workspace reviewer",
        revision: 1,
      },
    ],
  };
  try {
    await db.transaction(async (tx) => {
      await tx.insert(invoices).values({
        id,
        filename: filename.replace(/[\x00-\x1f]/g, "").slice(0, 180),
        hash: createHash("sha256").update(bytes).digest("hex"),
        storageKey: key,
        status: "queued",
        state,
      });
      await tx
        .insert(jobs)
        .values({ id: randomUUID(), invoiceId: id, status: "queued" });
      await tx.insert(events).values({
        invoiceId: id,
        type: "uploaded",
        data: { message: "Document registered" },
      });
    });
  } catch (e) {
    await storage.remove(key);
    throw e;
  }
  return id;
}
export async function getInvoice(id: string) {
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) throw new InputError("Invoice not found.", 404);
  return row;
}
export async function listInvoices() {
  return db.select().from(invoices).orderBy(desc(invoices.createdAt));
}
export async function references() {
  const [v, p, c] = await Promise.all([
    db.select().from(vendors),
    db.select().from(pos),
    db.select().from(commitments),
  ]);
  return {
    vendors: v,
    pos: p.map((x) => ({ ...x, limitMinor: x.limitMinor.toString() })),
    commitments: c.map((x) => ({
      ...x,
      amountMinor: x.amountMinor.toString(),
    })),
  };
}
export async function updateStage(
  id: string,
  index: number,
  status: InvoiceState["stages"][number]["status"],
  message: string,
) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .for("update");
    if (!row) return;
    const s = row.state;
    const now = new Date().toISOString();
    const stage = s.stages[index];
    stage.status = status;
    stage.message = message;
    if (status === "running") stage.startedAt = now;
    else stage.endedAt = now;
    await tx
      .update(invoices)
      .set({ state: s, updatedAt: new Date() })
      .where(eq(invoices.id, id));
    await tx
      .insert(events)
      .values({ invoiceId: id, type: "stage", data: { index, ...stage } });
  });
}
// One workspace-wide transaction lock gives duplicate identity and PO reservations a
// single ordering. Ready recommendations reserve; retries replace the same PK.
export async function evaluateAndReserve(id: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(715031)`);
    const [row] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .for("update");
    if (!row || !row.state.fields) throw Error("No extracted data to evaluate");
    const s = row.state;
    const fields = s.fields!;
    if (s.review === "rejected") return;
    await tx.delete(commitments).where(eq(commitments.invoiceId, id));
    const vs = await tx.select().from(vendors);
    const ps = await tx.select().from(pos);
    const cs = await tx.select().from(commitments);
    const earlier = await tx.select().from(invoices).where(ne(invoices.id, id));
    const vendor = fields.supplierId
      ? vs.find(
          (v) => normalize(v.identifier) === normalize(fields.supplierId!),
        )
      : vs.find((v) =>
          v.aliases.some(
            (a) => normalize(a) === normalize(fields.supplierName ?? ""),
          ),
        );
    const duplicate = earlier
      .filter(
        (x) =>
          x.createdAt < row.createdAt ||
          (x.createdAt.getTime() === row.createdAt.getTime() && x.id < row.id),
      )
      .find(
        (x) =>
          x.hash === row.hash ||
          (vendor &&
            x.state.evaluation?.vendorId === vendor.id &&
            fields.invoiceNumber &&
            normalize(x.state.fields?.invoiceNumber ?? "") ===
              normalize(fields.invoiceNumber)),
      );
    const result = evaluate(fields, {
      vendors: vs,
      pos: ps.map((p) => ({ ...p, limitMinor: p.limitMinor.toString() })),
      commitments: cs.map((c) => ({
        ...c,
        amountMinor: c.amountMinor.toString(),
      })),
      duplicateOf: duplicate?.id,
      selectedPo: s.selectedPo,
      roundingMinor: policy.roundingMinor,
      policyVersion: policy.version,
    });
    if (
      result.decision === "READY_FOR_APPROVAL" &&
      result.poId &&
      result.vendorId
    ) {
      await tx.insert(commitments).values({
        invoiceId: id,
        poId: result.poId,
        vendorId: result.vendorId,
        businessKey: result.vendorId + ":" + normalize(fields.invoiceNumber!),
        amountMinor: minor(fields.total!, fields.currency!),
        label: fields.invoiceNumber!,
      });
    }
    s.evaluation = result;
    s.history.push({
      at: new Date().toISOString(),
      action: "evaluated",
      reason: `${result.decision}; policy ${policy.version}`,
      actor: "rules engine",
      revision: s.revision,
      fields: s.fields,
      evaluation: result,
    });
    await tx
      .update(invoices)
      .set({ state: s, updatedAt: new Date() })
      .where(eq(invoices.id, id));
    await tx
      .insert(events)
      .values({ invoiceId: id, type: "evaluation", data: result });
    return result;
  });
}
export async function review(
  id: string,
  action: string,
  reason: string,
  fields?: Fields,
  selectedPo?: string,
) {
  if (
    !["approve", "reject", "correct", "select-po", "rerun", "retry"].includes(
      action,
    )
  )
    throw new InputError("Unknown review action");
  if (reason.trim().length < 5)
    throw new InputError("Enter a reason of at least 5 characters.");
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(715031)`);
    const [row] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .for("update");
    if (!row) throw new InputError("Invoice not found", 404);
    if (["running", "queued"].includes(row.status))
      throw new InputError(
        "Processing is still active. Wait for the run to finish.",
        409,
      );
    const s = row.state;
    if (action === "approve") {
      if (s.review === "approved") return;
      if (
        s.review === "rejected" ||
        s.evaluation?.decision !== "READY_FOR_APPROVAL"
      )
        throw new InputError(
          "Resolve all review findings and hard controls before approval.",
          409,
        );
      const [reservation] = await tx
        .select()
        .from(commitments)
        .where(eq(commitments.invoiceId, id));
      if (!reservation)
        throw new InputError(
          "Reservation is missing. Re-run checks first.",
          409,
        );
      const [order] = await tx
        .select()
        .from(pos)
        .where(eq(pos.id, reservation.poId));
      const allocated = await tx
        .select()
        .from(commitments)
        .where(eq(commitments.poId, reservation.poId));
      if (
        !order ||
        order.status !== "open" ||
        allocated.reduce((sum, c) => sum + c.amountMinor, 0n) > order.limitMinor
      )
        throw new InputError(
          "Purchase order eligibility or balance changed. Approval is blocked.",
          409,
        );
      s.review = "approved";
    } else if (action === "reject") {
      if (s.review === "rejected") return;
      s.review = "rejected";
      await tx.delete(commitments).where(eq(commitments.invoiceId, id));
    } else {
      if (s.review === "approved" || s.review === "rejected")
        throw new InputError(
          "Finalized reviews are immutable. Create a new invoice revision through an administrator.",
          409,
        );
      if (action === "correct") {
        s.fields = fieldsSchema.parse(fields);
        s.revision++;
      }
      if (action === "select-po") {
        if (!selectedPo) throw new InputError("Choose a purchase order.");
        s.selectedPo = selectedPo;
        s.revision++;
      }
      await tx.delete(commitments).where(eq(commitments.invoiceId, id));
      delete s.evaluation;
      delete s.error;
      s.stages = stageNames.map((name, index) => ({
        name,
        status:
          index === 0
            ? "completed"
            : s.extraction && index < 3
              ? "completed"
              : "queued",
      }));
      await tx
        .insert(jobs)
        .values({ id: randomUUID(), invoiceId: id, status: "queued" });
    }
    s.history.push({
      at: new Date().toISOString(),
      action,
      reason: reason.trim().slice(0, 2000),
      actor: "workspace reviewer",
      revision: s.revision,
      ...(action === "correct" ? { fields: s.fields } : {}),
    });
    await tx
      .update(invoices)
      .set({
        state: s,
        status: ["approve", "reject"].includes(action) ? row.status : "queued",
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id));
    await tx.insert(events).values({
      invoiceId: id,
      type: "review",
      data: { action, reason, revision: s.revision },
    });
  });
  return getInvoice(id);
}
export async function recoverJobs() {
  await db.transaction(async (tx) => {
    const stale = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "running"), sql`${jobs.leaseUntil}<now()`))
      .for("update");
    for (const j of stale) {
      const [row] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, j.invoiceId))
        .for("update");
      if (!row) continue;
      if (row.status === "completed") {
        await tx
          .update(jobs)
          .set({ status: "completed", leaseUntil: null })
          .where(eq(jobs.id, j.id));
        continue;
      }
      const retry = j.attempts < 3;
      const state = row.state;
      state.history.push({
        at: new Date().toISOString(),
        action: "recovered",
        reason: retry
          ? "Interrupted job requeued; saved extraction will be reused."
          : "Retry limit reached after interrupted execution.",
        actor: "worker",
        revision: state.revision,
      });
      if (!retry)
        state.error =
          "Worker interrupted repeatedly. Review the worker setup and retry.";
      await tx
        .update(jobs)
        .set({ status: retry ? "queued" : "failed", leaseUntil: null })
        .where(eq(jobs.id, j.id));
      await tx
        .update(invoices)
        .set({
          status: retry ? "queued" : "failed",
          state,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, row.id));
      await tx
        .insert(events)
        .values({ invoiceId: row.id, type: "recovery", data: { retry } });
    }
  });
}
export async function claimJob() {
  return db.transaction(async (tx) => {
    const [j] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.status, "queued"))
      .orderBy(jobs.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!j) return null;
    await tx
      .update(jobs)
      .set({
        status: "running",
        attempts: j.attempts + 1,
        leaseUntil: sql`now()+interval '180 seconds'`,
      })
      .where(eq(jobs.id, j.id));
    await tx
      .update(invoices)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(invoices.id, j.invoiceId));
    return j;
  });
}
export async function failJob(
  jobId: string,
  invoiceId: string,
  message: string,
) {
  await db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for("update");
    const s = r.state;
    s.error = message;
    for (const stage of s.stages) {
      if (stage.status === "running") {
        stage.status = "failed";
        stage.endedAt = new Date().toISOString();
        stage.message = message;
      } else if (stage.status === "queued") stage.status = "skipped";
    }
    await tx
      .update(invoices)
      .set({ state: s, status: "failed", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await tx
      .update(jobs)
      .set({ status: "failed", error: message, leaseUntil: null })
      .where(eq(jobs.id, jobId));
    await tx
      .insert(events)
      .values({ invoiceId, type: "failed", data: { message } });
  });
}
export async function finishJob(jobId: string, invoiceId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId));
    await tx
      .update(jobs)
      .set({ status: "completed", leaseUntil: null })
      .where(eq(jobs.id, jobId));
  });
}
export async function saveExtraction(
  id: string,
  extraction: NonNullable<InvoiceState["extraction"]>,
) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .for("update");
    const state = row.state;
    state.extraction = extraction;
    state.fields = extraction.fields;
    await tx
      .update(invoices)
      .set({ state, updatedAt: new Date() })
      .where(eq(invoices.id, id));
  });
}
export async function invoiceEvents(id: string) {
  await getInvoice(id);
  return db
    .select()
    .from(events)
    .where(eq(events.invoiceId, id))
    .orderBy(events.id);
}
