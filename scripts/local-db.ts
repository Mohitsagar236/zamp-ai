import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const path = resolve(".data/postgres");
const pg = new EmbeddedPostgres({
  databaseDir: path,
  user: "invoicelens",
  password: "local-demo-only",
  port: 54329,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(path + "/PG_VERSION")) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("invoicelens_demo");
} catch {}
console.log(
  "PostgreSQL ready at 127.0.0.1:54329 (persistent local demo database)",
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 60000);
