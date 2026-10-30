import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/lib/db";
import {
  vendors,
  pos,
  invoices,
  commitments,
  jobs,
  events,
} from "../src/lib/schema";
import {
  evaluateAndReserve,
  review,
  getInvoice,
  recoverJobs,
} from "../src/lib/service";
import { stageNames, type Fields, type InvoiceState } from "../src/lib/types";
const prefix = "test-" + randomUUID().slice(0, 8),
  vendorId = prefix,
  poId = prefix + "-po";
const ids: string[] = [];
const fields = (number: string, total = "60.00"): Fields => ({
  supplierName: "Integration Test Supplier",
  supplierId: prefix,
  invoiceNumber: number,
  invoiceDate: "2026-10-25",
  poReference: poId,
  currency: "INR",
  subtotal: total,
  tax: "0.00",
  total,
  lineItems: [],
});
async function create(f: Fields, hash = randomUUID()) {
  const id = prefix + "-" + randomUUID();
  ids.push(id);
  const state: InvoiceState = {
    stages: stageNames.map((name) => ({ name, status: "completed" })),
    fields: f,
    review: "pending",
    revision: 1,
    history: [],
  };
  await db.insert(invoices).values({
    id,
    filename: "integration.pdf",
    hash,
    storageKey: randomUUID() + ".pdf",
    status: "completed",
    state,
  });
  return id;
}
beforeAll(async () => {
  await db.insert(vendors).values({
    id: vendorId,
    name: "Integration Test Supplier",
    identifier: prefix,
    aliases: ["Integration Test Supplier"],
    approved: true,
  });
  await db.insert(pos).values({
    id: poId,
    vendorId,
    currency: "INR",
    status: "open",
    limitMinor: 10000n,
    description: "Integration concurrency test",
  });
});
afterAll(async () => {
  for (const id of ids) {
    await db.delete(events).where(eq(events.invoiceId, id));
    await db.delete(jobs).where(eq(jobs.invoiceId, id));
    await db.delete(commitments).where(eq(commitments.invoiceId, id));
    await db.delete(invoices).where(eq(invoices.id, id));
  }
  await db.delete(pos).where(eq(pos.id, poId));
  await db.delete(vendors).where(eq(vendors.id, vendorId));
  await pool.end();
});
describe("real PostgreSQL financial transactions", () => {
  it("concurrent reservations cannot exceed a PO; approval is idempotent", async () => {
    const a = await create(fields("CONCURRENT-A")),
      b = await create(fields("CONCURRENT-B"));
    const results = await Promise.all([
      evaluateAndReserve(a),
      evaluateAndReserve(b),
    ]);
    expect(results.map((r) => r?.decision).sort()).toEqual([
      "BLOCKED",
      "READY_FOR_APPROVAL",
    ]);
    const ready = results[0]?.decision === "READY_FOR_APPROVAL" ? a : b;
    const blocked = ready === a ? b : a;
    await expect(
      review(blocked, "approve", "Attempt prohibited approval"),
    ).rejects.toThrow();
    await Promise.all([
      review(ready, "approve", "Verified original document"),
      review(ready, "approve", "Repeated verified click"),
    ]);
    const reservations = await db
      .select()
      .from(commitments)
      .where(eq(commitments.poId, poId));
    expect(reservations).toHaveLength(1);
    expect(reservations[0].amountMinor).toBe(6000n);
  });
  it("reevaluation replaces reservation and reject releases it", async () => {
    const id = await create(fields("RETRY", "10.00"));
    await evaluateAndReserve(id);
    await evaluateAndReserve(id);
    const reserved = await db
      .select()
      .from(commitments)
      .where(eq(commitments.invoiceId, id));
    expect(reserved).toHaveLength(1);
    await review(id, "reject", "Supplier cancelled this invoice");
    expect(
      await db.select().from(commitments).where(eq(commitments.invoiceId, id)),
    ).toHaveLength(0);
  });
  it("detects exact hash despite changed invoice number and business key despite changed bytes", async () => {
    const hash = randomUUID();
    const original = await create(fields("IDENTITY", "5.00"), hash);
    await evaluateAndReserve(original);
    const renamed = await create(fields("DIFFERENT-NUMBER", "5.00"), hash);
    expect((await evaluateAndReserve(renamed))?.duplicateOf).toBe(original);
    const newbytes = await create(fields("identity", "5.00"));
    expect((await evaluateAndReserve(newbytes))?.duplicateOf).toBe(original);
    expect(
      await db
        .select()
        .from(commitments)
        .where(eq(commitments.invoiceId, newbytes)),
    ).toHaveLength(0);
  });
  it("correction retains earlier evidence and reruns dependent checks", async () => {
    const originalFields = { ...fields("CORRECT", "5.00"), total: null };
    const id = await create(originalFields);
    expect((await evaluateAndReserve(id))?.decision).toBe("NEEDS_REVIEW");
    await review(
      id,
      "correct",
      "Verified supplier copy total",
      fields("CORRECT", "5.00"),
    );
    const queued = await getInvoice(id);
    expect(queued.state.revision).toBe(2);
    expect(
      queued.state.history.find((x) => x.action === "evaluated")?.evaluation
        ?.inputs.total,
    ).toBeNull();
    expect((await evaluateAndReserve(id))?.decision).toBe("READY_FOR_APPROVAL");
  });
  it("recovers an expired lease and bounds repeated interruptions", async () => {
    const id = await create(fields("RECOVERY", "1.00"));
    const jobId = randomUUID();
    await db
      .update(invoices)
      .set({ status: "running" })
      .where(eq(invoices.id, id));
    await db.insert(jobs).values({
      id: jobId,
      invoiceId: id,
      status: "running",
      attempts: 1,
      leaseUntil: new Date(0),
    });
    await recoverJobs();
    expect((await getInvoice(id)).status).toBe("queued");
    await db
      .update(jobs)
      .set({ status: "running", attempts: 3, leaseUntil: new Date(0) })
      .where(eq(jobs.id, jobId));
    await recoverJobs();
    expect((await getInvoice(id)).status).toBe("failed");
  });
});
