import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/lib/db";
import { heartbeat } from "../src/lib/schema";
import {
  claimJob,
  recoverJobs,
  updateStage,
  getInvoice,
  saveExtraction,
  evaluateAndReserve,
  failJob,
  finishJob,
  references,
} from "../src/lib/service";
import { storagePath, storage, validateUpload } from "../src/lib/storage";
import { fieldsSchema, type Extraction } from "../src/lib/types";
const exec = promisify(execFile);
let stop = false;
process.on("SIGINT", () => {
  stop = true;
});
process.on("SIGTERM", () => {
  stop = true;
});
await mkdir(".data/ocr", { recursive: true, mode: 0o700 });
async function beat() {
  await db
    .insert(heartbeat)
    .values({ id: "primary", at: new Date() })
    .onConflictDoUpdate({ target: heartbeat.id, set: { at: new Date() } });
}
console.log(JSON.stringify({ event: "worker_started" }));
while (!stop) {
  try {
    await beat();
    await recoverJobs();
    const job = await claimJob();
    if (!job) {
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }
    const id = job.invoiceId;
    let active = 1;
    const timer = setInterval(() => {
      void db
        .execute(
          sql`UPDATE jobs SET lease_until=now()+interval '180 seconds' WHERE id=${job.id} AND status='running'`,
        )
        .catch(() => {});
      void beat().catch(() => {});
    }, 10000);
    try {
      let row = await getInvoice(id);
      if (!row.state.extraction) {
        await updateStage(
          id,
          1,
          "running",
          "Checking stored file signature and resource limits.",
        );
        const bytes = await storage.get(row.storageKey);
        validateUpload(row.filename, bytes);
        await updateStage(
          id,
          1,
          "completed",
          `PDF signature verified; ${bytes.length.toLocaleString()} bytes.`,
        );
        active = 2;
        await updateStage(
          id,
          2,
          "running",
          "Reading document text; OCR will run when a page has insufficient text.",
        );
        const out = resolve(".data", `extraction-${job.id}.json`);
        for (let providerAttempt = 1; providerAttempt <= 2; providerAttempt++) {
          try {
            await exec(
              process.execPath,
              [
                "--import",
                "tsx",
                "scripts/extract.ts",
                storagePath(row.storageKey),
                out,
              ],
              {
                timeout: 120000,
                maxBuffer: 1024 * 1024,
                env: {
                  NODE_ENV: "test",
                  WORKSPACE_PASSWORD: "",
                  WORKSPACE_USER: "",
                  PATH: process.env.PATH,
                  HOME: process.env.HOME,
                  TMPDIR: process.env.TMPDIR,
                  DATABASE_URL: "postgresql://unused:unused@127.0.0.1/unused",
                  APP_ENV: "test",
                  AUTH_MODE: "local",
                  APP_URL: "http://127.0.0.1:3000",
                  OCR_PROVIDER: process.env.OCR_PROVIDER ?? "tesseract",
                  MAX_PAGES: process.env.MAX_PAGES ?? "10",
                  MAX_FILE_MB: process.env.MAX_FILE_MB ?? "10",
                },
              },
            );
            break;
          } catch {
            let message =
              "Document extraction timed out or the provider failed. Verify OCR readiness and retry.";
            try {
              const failure = JSON.parse(await readFile(out, "utf8"));
              if (failure.error) message = failure.error;
            } catch {}
            await unlink(out).catch(() => {});
            const invalidInput =
              /Encrypted|corrupt|page limit|dimensions|needs OCR|ZodError/i.test(
                message,
              );
            if (providerAttempt === 2 || invalidInput) throw Error(message);
            await updateStage(
              id,
              2,
              "running",
              "Extraction provider interrupted. Retrying actual extraction (attempt 2 of 2).",
            );
          }
        }
        try {
          const extraction = JSON.parse(
            await readFile(out, "utf8"),
          ) as Extraction;
          fieldsSchema.parse(extraction.fields);
          await saveExtraction(id, extraction);
          await updateStage(
            id,
            2,
            "completed",
            `${extraction.provider}; ${extraction.pageCount} page(s). ${extraction.warnings.length} extraction warning(s).`,
          );
        } finally {
          await unlink(out).catch(() => {});
        }
      } else {
        await updateStage(
          id,
          1,
          "skipped",
          "Previously inspected document; original file retained.",
        );
        await updateStage(
          id,
          2,
          "skipped",
          "Using persisted extraction. No repeated OCR request.",
        );
      }
      active = 3;
      await updateStage(
        id,
        3,
        "running",
        "Validating structured data and monetary precision.",
      );
      row = await getInvoice(id);
      fieldsSchema.parse(row.state.fields);
      await updateStage(
        id,
        3,
        "completed",
        "Structured field validation completed; financial discrepancies are reported below.",
      );
      active = 4;
      await updateStage(
        id,
        4,
        "running",
        "Loading approved suppliers, registered aliases and purchase orders.",
      );
      const records = await references();
      await updateStage(
        id,
        4,
        "completed",
        `${records.vendors.length} supplier records and ${records.pos.length} purchase orders loaded for deterministic matching.`,
      );
      active = 5;
      await updateStage(
        id,
        5,
        "running",
        "Checking identity, currency and cumulative commitments in a locked transaction.",
      );
      const result = await evaluateAndReserve(id);
      await updateStage(
        id,
        5,
        "completed",
        `${result?.findings.length ?? 0} policy checks recorded. ${result?.decision === "READY_FOR_APPROVAL" ? "Funds reserved atomically." : "No funds reserved."}`,
      );
      active = 6;
      await updateStage(
        id,
        6,
        "running",
        "Persisting recommendation and audit evidence.",
      );
      await getInvoice(id);
      await updateStage(
        id,
        6,
        "completed",
        `Recommendation saved: ${result?.decision ?? "rejected"}.`,
      );
      await finishJob(job.id, id);
      console.log(JSON.stringify({ event: "job_completed", runId: id }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Processing failed";
      await updateStage(id, active, "failed", message);
      await failJob(job.id, id, message);
      console.log(JSON.stringify({ event: "job_failed", runId: id }));
    } finally {
      clearInterval(timer);
    }
  } catch {
    console.error(JSON.stringify({ event: "worker_database_error" }));
    await new Promise((r) => setTimeout(r, 2000));
  }
}
await pool.end();
