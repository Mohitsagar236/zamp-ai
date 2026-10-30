import { config } from "../src/lib/config";
import { db, pool } from "../src/lib/db";
import { sql } from "drizzle-orm";
import { seed } from "./seed";
const name = new URL(config.DATABASE_URL).pathname;
if (
  config.APP_ENV !== "demo" ||
  !name.endsWith("/invoicelens_demo") ||
  process.argv[2] !== "--confirm-demo-reset"
)
  throw Error(
    "Reset requires APP_ENV=demo, database invoicelens_demo, and --confirm-demo-reset. Stop the worker first.",
  );
const active = await db.execute(
  sql`SELECT id FROM worker_heartbeat WHERE at>now()-interval '20 seconds'`,
);
if (active.rows.length)
  throw Error(
    "Worker is still active. Stop it and wait 20 seconds before resetting.",
  );
await db.execute(
  sql`TRUNCATE events,jobs,commitments,invoices,purchase_orders,vendors,worker_heartbeat RESTART IDENTITY CASCADE`,
);
await seed();
console.log(
  "Demo database reset. Stored files are retained; remove .data/files manually if desired.",
);
await pool.end();
