import "dotenv/config";
import { Pool } from "pg";
import { auth, authDb } from "../src/lib/better-auth.js";
import { randomUUID } from "node:crypto";

if (process.env.AUTH_BOOTSTRAP !== "true")
  throw new Error("Set AUTH_BOOTSTRAP=true for this one-time command only");
if (!process.env.AUTH_DATABASE_URL || !process.env.AUTH_SECRET)
  throw new Error("AUTH_DATABASE_URL and AUTH_SECRET are required");
const [email, name] = process.argv.slice(2),
  password = process.env.AUTH_BOOTSTRAP_PASSWORD;
if (
  !email ||
  !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
  !name ||
  !password ||
  password.length < 14 ||
  password.length > 128
)
  throw new Error(
    "Usage: AUTH_BOOTSTRAP_PASSWORD=<secret> npm run auth:bootstrap -- <email> <display name> (password must have 14+ characters)",
  );
const pool = new Pool({
  connectionString: process.env.AUTH_DATABASE_URL,
  max: 1,
});
const gate = await pool.connect();
try {
  const context = await auth.$context;
  const hashed = await context.password.hash(password);
  await gate.query("BEGIN");
  await gate.query("SELECT pg_advisory_xact_lock(716213)");
  const count = await gate.query('SELECT count(*)::int AS count FROM "user"');
  if (count.rows[0].count !== 0)
    throw new Error(
      "Initial setup is allowed only when the identity database has no users",
    );
  const userId = randomUUID();
  await gate.query(
    "INSERT INTO \"user\"(id,name,email,role) VALUES($1,$2,$3,'admin')",
    [userId, name, email.toLowerCase()],
  );
  await gate.query(
    'INSERT INTO account(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$2,$3)',
    [randomUUID(), userId, hashed],
  );
  await gate.query(
    "INSERT INTO identity_audit(actor_id,target_user_id,action,data) VALUES(NULL,$1,'initial_administrator_created',$2)",
    [userId, JSON.stringify({ email: email.toLowerCase() })],
  );
  await gate.query("COMMIT");
  console.log(`Initial administrator created: ${email.toLowerCase()}`);
} catch (error) {
  await gate.query("ROLLBACK");
  throw error;
} finally {
  gate.release();
  await Promise.all([pool.end(), authDb.end()]);
}
