import "dotenv/config";
import { Pool } from "pg";
import { spawn, execFileSync } from "node:child_process";
if (process.env.APP_ENV === "production")
  throw Error("E2E reset is disabled in production environments.");
const base = new URL(process.env.DATABASE_URL!);
base.pathname = "/invoicelens_e2e";
const admin = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await admin.query("CREATE DATABASE invoicelens_e2e");
} catch (e) {
  if ((e as { code: string }).code !== "42P04") throw e;
}
await admin.end();
const p = new Pool({ connectionString: base.toString() });
await p.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
await p.end();
const env = {
  ...process.env,
  DATABASE_URL: base.toString(),
  APP_URL: "http://127.0.0.1:3001",
  APP_ENV: "test",
  AUTH_MODE: "local",
  STORAGE_DIR: ".data/e2e-files",
};
for (const file of ["scripts/migrate.ts", "scripts/seed.ts"])
  execFileSync(process.execPath, ["--import", "tsx", file], {
    env,
    stdio: "inherit",
  });
const app = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3001",
    ],
    { env, stdio: "inherit" },
  ),
  worker = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts"], {
    env,
    stdio: "inherit",
  });
function stop() {
  app.kill("SIGTERM");
  worker.kill("SIGTERM");
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
