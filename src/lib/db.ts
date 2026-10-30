import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
import * as schema from "./schema";
const globalDb = globalThis as unknown as { invoicePool?: Pool };
export const pool =
  globalDb.invoicePool ??
  new Pool({ connectionString: config.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalDb.invoicePool = pool;
export const db = drizzle(pool, { schema });
