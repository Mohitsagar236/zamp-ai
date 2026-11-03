import { copyFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { transaction, pool } from "./db.js";
import { config } from "./config.js";
import { storagePath } from "./storage.js";

if (
  config.APP_ENV !== "test" ||
  process.env.INVOICELENS_RECOVERY_DRILL !== "synthetic-isolated-only"
)
  throw new Error(
    "Recovery drill fixtures are restricted to explicitly isolated synthetic tests",
  );
const id = randomUUID();
const key = randomUUID() + ".pdf";
let copied = false;
try {
  await transaction(async (db) => {
    if (
      (
        await db.query(
          "SELECT 1 FROM workflow_jobs WHERE status='running' LIMIT 1",
        )
      ).rowCount
    )
      throw new Error(
        "Stop the test worker before creating a backup recovery fixture",
      );
    const source = await db.query(
      "SELECT * FROM invoices WHERE filename='happy-path.pdf' AND state->>'review'='approved' ORDER BY created_at LIMIT 1",
    );
    if (!source.rowCount)
      throw new Error("Run the isolated synthetic Compose smoke first");
    const invoice = source.rows[0];
    await copyFile(storagePath(invoice.storage_key), storagePath(key));
    copied = true;
    const state = {
      revision: 1,
      review: "pending",
      history: [],
      stages: invoice.state.stages.map((stage: { name: string }) => ({
        name: stage.name,
        status: "queued",
      })),
    };
    await db.query(
      "INSERT INTO invoices(id,filename,hash,storage_key,status,created_at,updated_at,state,generation,upload_fingerprint) VALUES($1,'restore-recovery-drill.pdf',$2,$3,'queued',now(),now(),$4,1,$5)",
      [id, invoice.hash, key, JSON.stringify(state), `restore-drill:${id}`],
    );
    await db.query(
      "INSERT INTO workflow_jobs(id,invoice_id,generation,kind,payload,status,correlation_id) VALUES($1,$2,1,'process','{}','queued',$3)",
      [randomUUID(), id, `restore-drill:${id}`],
    );
  });
  console.log(
    JSON.stringify({
      invoiceId: id,
      expectedDecision: "BLOCKED",
      expectedCommitments: 0,
    }),
  );
} catch (error) {
  if (copied) await unlink(storagePath(key)).catch(() => {});
  throw error;
} finally {
  await pool.end();
}
