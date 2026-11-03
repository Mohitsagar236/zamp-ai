import { Pool, type PoolClient } from "pg";
import { config } from "./config.js";
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
});
export async function transaction<T>(
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
