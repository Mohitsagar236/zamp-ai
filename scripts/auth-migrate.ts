import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
const url = process.env.AUTH_DATABASE_URL;
if (!url) throw new Error("AUTH_DATABASE_URL is required");
const pool = new Pool({ connectionString: url, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(716211)");
  await client.query(
    "CREATE TABLE IF NOT EXISTS invoicelens_identity_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const filename of (await readdir("migrations/identity"))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()) {
    const version = filename.split(/[_.]/)[0];
    const applied = await client.query(
      "SELECT 1 FROM invoicelens_identity_migrations WHERE version=$1",
      [version],
    );
    if (applied.rowCount) continue;
    await client.query(
      await readFile(`migrations/identity/${filename}`, "utf8"),
    );
    await client.query(
      "INSERT INTO invoicelens_identity_migrations(version) VALUES($1)",
      [version],
    );
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
console.log("Identity database migrations are current.");
