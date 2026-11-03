import "dotenv/config";
import { Pool } from "pg";
import { auth, authDb } from "../src/lib/better-auth.js";

// Offline emergency recovery for a deployment operator who already has access
// to the identity DB credentials. This cannot create a user or grant a role.
const [email] = process.argv.slice(2);
const password = process.env.AUTH_RECOVERY_PASSWORD;
const operator = process.env.AUTH_RECOVERY_OPERATOR?.trim();
const reason = process.env.AUTH_RECOVERY_REASON?.trim();
if (
  !process.env.AUTH_DATABASE_URL ||
  !email ||
  !password ||
  password.length < 14 ||
  password.length > 128 ||
  !operator ||
  !reason ||
  reason.length < 20
)
  throw new Error(
    "Set AUTH_DATABASE_URL, AUTH_RECOVERY_PASSWORD (14–128 chars), AUTH_RECOVERY_OPERATOR and AUTH_RECOVERY_REASON (20+ chars); run npm run auth:recover-admin -- <existing-admin-email>",
  );
const pool = new Pool({
  connectionString: process.env.AUTH_DATABASE_URL,
  max: 1,
});
const client = await pool.connect();
try {
  const context = await auth.$context;
  const hashed = await context.password.hash(password);
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(716212)");
  const account = await client.query(
    "SELECT id FROM \"user\" WHERE lower(email)=lower($1) AND role='admin' AND banned=false FOR UPDATE",
    [email],
  );
  if (account.rowCount !== 1)
    throw new Error(
      "An existing active administrator is required; no account was changed",
    );
  const id = account.rows[0].id;
  const updated = await client.query(
    'UPDATE account SET password=$2,"updatedAt"=now() WHERE "userId"=$1 AND "providerId"=\'credential\' RETURNING id',
    [id, hashed],
  );
  if (updated.rowCount !== 1)
    throw new Error(
      "Administrator credential is missing; recovery was rolled back",
    );
  await client.query('DELETE FROM session WHERE "userId"=$1', [id]);
  await client.query(
    "INSERT INTO identity_audit(actor_id,target_user_id,action,data) VALUES(NULL,$1,'operator_admin_recovery',$2)",
    [id, JSON.stringify({ operator, reason })],
  );
  await client.query("COMMIT");
  console.log(
    "Existing administrator password replaced, sessions revoked, and operator recovery recorded.",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await Promise.all([pool.end(), authDb.end()]);
}
