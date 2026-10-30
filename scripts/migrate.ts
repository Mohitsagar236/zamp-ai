import { pool } from "../src/lib/db";
import { readFile } from "node:fs/promises";
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
  );
  const version = "0001_initial";
  const r = await c.query(
    "SELECT version FROM schema_migrations WHERE version=$1",
    [version],
  );
  if (!r.rowCount) {
    await c.query(await readFile(`migrations/${version}.sql`, "utf8"));
    await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [
      version,
    ]);
  }
  await c.query("COMMIT");
  console.log("Migrations applied");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
