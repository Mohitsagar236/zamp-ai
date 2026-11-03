import "dotenv/config";
import { parse as parseDotenv } from "dotenv";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve, join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { normalize } from "../services/decision/src/money.js";

const sourceArg = process.argv
  .find((arg) => arg.startsWith("--source="))
  ?.slice(9);
const sourceEnvArg = process.argv
  .find((arg) => arg.startsWith("--source-env="))
  ?.slice("--source-env=".length);
const apply = process.argv.includes("--apply");
if (Boolean(sourceArg) === Boolean(sourceEnvArg))
  throw new Error(
    "Pass exactly one legacy source: --source=postgresql://… or --source-env=.env",
  );
const sourceUrl =
  sourceArg ??
  parseDotenv(await readFile(resolve(sourceEnvArg!)))["DATABASE_URL"];
if (!sourceUrl) throw new Error("The source env file has no DATABASE_URL");
const source = new Pool({ connectionString: sourceUrl, max: 1 });
const directory =
  process.env.INVOICELENS_SERVICES_DIR ?? ".data/invoicelens-services";
const targetEnvs = Object.fromEntries(
  await Promise.all(
    (["workflow", "decision"] as const).map(async (name) => {
      const values = parseEnv(
        await readFile(join(directory, `${name}.env`), "utf8"),
      );
      if (!values.DATABASE_URL)
        throw new Error(`${name} destination is missing DATABASE_URL`);
      if (values.DATABASE_URL === sourceUrl)
        throw new Error(
          "The legacy source cannot also be a destination database",
        );
      return [name, values];
    }),
  ),
) as Record<"workflow" | "decision", Record<string, string>>;
const workflow = new Pool({
  connectionString: targetEnvs.workflow.DATABASE_URL,
  max: 1,
});
const decision = new Pool({
  connectionString: targetEnvs.decision.DATABASE_URL,
  max: 1,
});
if (
  apply &&
  (targetEnvs.workflow.APP_ENV === "production" ||
    targetEnvs.decision.APP_ENV === "production")
)
  throw new Error(
    "Legacy apply is not supported for production destinations. Use the audited reference-data importer; preserve the legacy workspace separately. Rehearse and reconcile a dedicated data migration before enabling a production copy.",
  );
const legacyRoot = resolve(process.env.LEGACY_STORAGE_DIR ?? ".data/files");
const documentRoot = resolve(
  targetEnvs.workflow.STORAGE_DIR ??
    ".data/invoicelens-services/workflow-files",
);

function parseEnv(text: string) {
  return parseDotenv(text);
}

async function inTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrate() {
  const snapshot = await source.connect();
  try {
    await snapshot.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const required = [
      "vendors",
      "purchase_orders",
      "invoices",
      "commitments",
      "events",
    ];
    const found = await snapshot.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1)",
      [required],
    );
    const missing = required.filter(
      (table) => !found.rows.some((row) => row.table_name === table),
    );
    if (missing.length)
      throw new Error(
        `Legacy database is missing expected tables: ${missing.join(", ")}`,
      );
    const vendors = await snapshot.query(
      "SELECT id,name,identifier,aliases,approved FROM vendors ORDER BY id",
    );
    const orders = await snapshot.query(
      "SELECT id,vendor_id,currency,status,limit_minor,description FROM purchase_orders ORDER BY id",
    );
    const invoices = await snapshot.query(
      "SELECT id,filename,hash,storage_key,status,created_at,updated_at,state FROM invoices ORDER BY created_at,id",
    );
    const commitments = await snapshot.query(
      "SELECT invoice_id,po_id,vendor_id,business_key,amount_minor,label FROM commitments ORDER BY created_at,invoice_id",
    );
    const events = await snapshot.query(
      "SELECT id,invoice_id,at,type,data FROM events ORDER BY id",
    );
    console.log(
      `Read-only source snapshot: ${invoices.rowCount} invoices, ${vendors.rowCount} vendors, ${orders.rowCount} purchase orders, ${commitments.rowCount} commitments, ${events.rowCount} audit events.`,
    );
    const verifiedDocuments = new Map<string, Buffer>();
    for (const invoice of invoices.rows) {
      if (!/^[0-9a-f-]{36}\.pdf$/i.test(invoice.storage_key))
        throw new Error(
          `Invoice ${invoice.id} has an unsafe legacy document key`,
        );
      const bytes = await readFile(
        join(legacyRoot, basename(invoice.storage_key)),
      );
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== String(invoice.hash).toLowerCase())
        throw new Error(
          `Original document hash mismatch for invoice ${invoice.id}`,
        );
      if (bytes.subarray(0, 5).toString() !== "%PDF-")
        throw new Error(
          `Original document for invoice ${invoice.id} is not a PDF`,
        );
      verifiedDocuments.set(invoice.id, bytes);
    }
    console.log(
      `Verified ${verifiedDocuments.size} stored PDF documents by safe key, PDF signature, and SHA-256.`,
    );
    if (!apply) {
      console.log(
        "Dry run only. Add --apply to copy this snapshot into the isolated service databases.",
      );
      await snapshot.query("ROLLBACK");
      return;
    }

    await inTransaction(decision, async (db) => {
      for (const vendor of vendors.rows)
        await db.query(
          "INSERT INTO vendors(id,name,identifier,aliases,approved) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
          [
            vendor.id,
            vendor.name,
            vendor.identifier,
            JSON.stringify(vendor.aliases),
            vendor.approved,
          ],
        );
      for (const po of orders.rows)
        await db.query(
          "INSERT INTO purchase_orders(id,vendor_id,currency,status,limit_minor,description) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",
          [
            po.id,
            po.vendor_id,
            po.currency,
            po.status,
            po.limit_minor,
            po.description,
          ],
        );
      for (const invoice of invoices.rows) {
        const state = normalizeState(invoice.state);
        const generation = Math.max(1, Number(state.revision ?? 1));
        await db.query(
          "INSERT INTO decision_records(invoice_id,content_hash,created_at,generation,fields,selected_po,review,evaluation) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(invoice_id) DO NOTHING",
          [
            invoice.id,
            String(invoice.hash).toLowerCase(),
            invoice.created_at,
            generation,
            JSON.stringify(state.fields ?? null),
            state.selectedPo ?? null,
            state.review ?? "pending",
            JSON.stringify(state.evaluation ?? null),
          ],
        );
        const fields = state.fields;
        const supplierId = fields?.supplierId;
        const supplier = vendors.rows.find((row) =>
          supplierId
            ? normalize(row.identifier) === normalize(supplierId)
            : (row.aliases as string[]).some(
                (alias) =>
                  normalize(alias) === normalize(fields?.supplierName ?? ""),
              ),
        );
        const number = fields?.invoiceNumber;
        if (supplier && number)
          await db.query(
            "INSERT INTO business_claims(business_key,invoice_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [
              `${supplier.id}:${normalize(number)}`,
              invoice.id,
              invoice.created_at,
            ],
          );
      }
      for (const item of commitments.rows) {
        if (!invoices.rows.some((row) => row.id === item.invoice_id))
          await db.query(
            "INSERT INTO decision_records(invoice_id,content_hash,created_at,generation,fields,review) VALUES($1,$2,now(),1,'{}','approved') ON CONFLICT(invoice_id) DO NOTHING",
            [
              item.invoice_id,
              createHash("sha256").update(item.invoice_id).digest("hex"),
            ],
          );
        await db.query(
          "INSERT INTO commitments(invoice_id,po_id,vendor_id,business_key,amount_minor,label,kind) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(invoice_id) DO NOTHING",
          [
            item.invoice_id,
            item.po_id,
            item.vendor_id,
            item.business_key,
            item.amount_minor,
            item.label,
            invoices.rows.find((row) => row.id === item.invoice_id)?.state
              ?.review === "approved"
              ? "approval"
              : "reservation",
          ],
        );
      }
    });

    await mkdir(documentRoot, { recursive: true, mode: 0o700 });
    await inTransaction(workflow, async (db) => {
      for (const invoice of invoices.rows) {
        const imported = await db.query(
          "SELECT 1 FROM legacy_imports WHERE source_invoice_id=$1",
          [invoice.id],
        );
        if (imported.rowCount) continue;
        const bytes = verifiedDocuments.get(invoice.id)!;
        const digest = createHash("sha256").update(bytes).digest("hex");
        const target = join(documentRoot, invoice.storage_key);
        try {
          await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          const existing = await readFile(target);
          if (createHash("sha256").update(existing).digest("hex") !== digest)
            throw new Error(
              `Destination document collision for invoice ${invoice.id}`,
            );
        }
        const state = normalizeState(invoice.state);
        for (const stage of state.stages ?? [])
          if (stage.status === "running") stage.status = "queued";
        const generation = Math.max(1, Number(state.revision ?? 1));
        const resumable = ["queued", "running"].includes(invoice.status);
        await db.query(
          "INSERT INTO invoices(id,filename,hash,storage_key,status,created_at,updated_at,state,generation,upload_key,upload_fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10) ON CONFLICT(id) DO NOTHING",
          [
            invoice.id,
            invoice.filename,
            digest,
            invoice.storage_key,
            resumable ? "queued" : invoice.status,
            invoice.created_at,
            invoice.updated_at,
            JSON.stringify(state),
            generation,
            `legacy:${invoice.id}`,
          ],
        );
        if (resumable)
          await db.query(
            "INSERT INTO workflow_jobs(id,invoice_id,generation,kind,payload,status,correlation_id) VALUES(gen_random_uuid(),$1,$2,'process','{}','queued',$3) ON CONFLICT(invoice_id,generation) DO NOTHING",
            [invoice.id, generation, `legacy:${invoice.id}`],
          );
        for (const event of events.rows.filter(
          (row) => row.invoice_id === invoice.id,
        ))
          await db.query(
            "INSERT INTO stage_events(invoice_id,at,type,data,correlation_id) VALUES($1,$2,$3,$4,$5)",
            [
              invoice.id,
              event.at,
              event.type,
              JSON.stringify(event.data),
              `legacy:${invoice.id}`,
            ],
          );
        await db.query(
          "INSERT INTO legacy_imports(source_invoice_id) VALUES($1) ON CONFLICT DO NOTHING",
          [invoice.id],
        );
      }
    });
    await snapshot.query("ROLLBACK");
    console.log(
      "Migration copy complete. The legacy source transaction was read-only and remains unchanged.",
    );
  } finally {
    snapshot.release();
  }
}

type LegacyState = {
  revision?: number;
  fields?: {
    supplierId?: string | null;
    supplierName?: string | null;
    invoiceNumber?: string | null;
  };
  selectedPo?: string;
  review?: "pending" | "approved" | "rejected";
  evaluation?: unknown;
  stages?: { status: string }[];
  [key: string]: unknown;
};

function normalizeState(value: unknown): LegacyState {
  if (typeof value === "string") return JSON.parse(value);
  return structuredClone(value ?? {}) as LegacyState;
}

try {
  await migrate();
} finally {
  await Promise.all([source.end(), workflow.end(), decision.end()]);
}
