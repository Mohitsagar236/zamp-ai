import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
const test = process.argv.includes("--test");
const production = process.argv.includes("--production");
if (test && production) throw new Error("Choose test or production, not both");
const port = production ? 54343 : test ? 54342 : 54341,
  dir = production
    ? ".data/invoicelens-production/postgres"
    : `.data/invoicelens-services${test ? "-test" : ""}`,
  out = production ? ".data/invoicelens-production" : dir;
await mkdir(out, { recursive: true, mode: 0o700 });
const previous = Object.fromEntries(
  await Promise.all(
    ["workflow", "extraction", "decision", "identity", "gateway"].map(
      async (name) => [
        name,
        existsSync(`${out}/${name}.env`)
          ? parse(await readFile(`${out}/${name}.env`, "utf8"))
          : {},
      ],
    ),
  ),
) as Record<string, Record<string, string>>;
const adminFile = `${out}/cluster-admin.env`;
let adminPassword = "local-service-admin-only";
if (production) {
  if (existsSync(adminFile))
    adminPassword = parse(await readFile(adminFile, "utf8")).ADMIN_PASSWORD;
  else {
    adminPassword = randomBytes(32).toString("hex");
    await writeFile(adminFile, `ADMIN_PASSWORD=${adminPassword}\n`, {
      mode: 0o600,
      flag: "wx",
    });
  }
}
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "services_admin",
  password: adminPassword,
  port,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(dir + "/PG_VERSION")) await pg.initialise();
await pg.start();
const admin = new Pool({
  connectionString: `postgresql://services_admin:${adminPassword}@127.0.0.1:${port}/postgres`,
});
const names = ["workflow", "extraction", "decision"] as const,
  passwords = Object.fromEntries(
    names.map((x) => [
      x,
      previous[x].DATABASE_PASSWORD ??
        (previous[x].DATABASE_URL
          ? new URL(previous[x].DATABASE_URL).password
          : randomBytes(24).toString("hex")),
    ]),
  );
for (const name of names) {
  const role = `${name}_svc`,
    db = `invoicelens_${name}`;
  await admin.query(
    `DO $x$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${role} LOGIN PASSWORD '${passwords[name]}'; END IF; END $x$`,
  );
  await admin
    .query(
      `SELECT 'CREATE DATABASE ${db} OWNER ${role}' WHERE NOT EXISTS(SELECT FROM pg_database WHERE datname='${db}')`,
    )
    .then(async (r) => {
      if (r.rowCount) await admin.query(`CREATE DATABASE ${db} OWNER ${role}`);
    });
}
const identityPassword =
  previous.identity.DATABASE_PASSWORD ?? randomBytes(24).toString("hex");
await admin.query(
  `DO $x$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='identity_svc') THEN CREATE ROLE identity_svc LOGIN PASSWORD '${identityPassword}'; END IF; END $x$`,
);
const identityDb = await admin.query(
  "SELECT 1 FROM pg_database WHERE datname='invoicelens_identity'",
);
if (!identityDb.rowCount)
  await admin.query("CREATE DATABASE invoicelens_identity OWNER identity_svc");
await admin.end();
const common = `APP_ENV=${production ? "production" : test ? "test" : "demo"}\nMAX_FILE_MB=10\nMAX_PAGES=10\nWORKER_ENABLED=true\n`;
const tok = () => randomBytes(32).toString("hex"),
  tokens = {
    gateway: previous.gateway.WORKFLOW_TOKEN ?? tok(),
    extraction: previous.extraction.SERVICE_TOKEN ?? tok(),
    decision: previous.decision.SERVICE_TOKEN ?? tok(),
  };
const identitySecret = previous.gateway.WORKFLOW_IDENTITY_SECRET ?? tok(),
  authSecret = previous.gateway.AUTH_SECRET ?? tok();
const urls = Object.fromEntries(
  names.map((n) => [
    n,
    `postgresql://${n}_svc:${passwords[n]}@127.0.0.1:${port}/invoicelens_${n}`,
  ]),
);
const rootEnv = (await import("dotenv")).config().parsed ?? {};
const authMode = production ? "individual" : (rootEnv.AUTH_MODE ?? "local"),
  wsPassword = rootEnv.WORKSPACE_PASSWORD ?? "";
if (authMode === "basic" && wsPassword.length < 16)
  throw Error(
    "A strong workspace password is required for basic authentication",
  );
const envs = {
  workflow:
    common +
    `SERVICE=workflow\nPORT=${production ? 4610 : test ? 4410 : 4100}\nHOST=127.0.0.1\nDATABASE_URL=${urls.workflow}\nDATABASE_PASSWORD=${passwords.workflow}\nWORKFLOW_TOKEN=${tokens.gateway}\nEXTRACTION_URL=http://127.0.0.1:${production ? 4620 : test ? 4420 : 4200}\nEXTRACTION_TOKEN=${tokens.extraction}\nDECISION_URL=http://127.0.0.1:${production ? 4630 : test ? 4430 : 4300}\nDECISION_TOKEN=${tokens.decision}\nWORKSPACE_URL=${production ? "http://127.0.0.1:3003" : (rootEnv.APP_URL ?? "http://127.0.0.1:3000")}\nWORKSPACE_AUTH_MODE=${authMode}\nWORKSPACE_USER=${rootEnv.WORKSPACE_USER ?? "reviewer"}\nWORKSPACE_PASSWORD=${wsPassword}\nSTORAGE_DIR=${out}/workflow-files\n`,
  extraction:
    common +
    `SERVICE=extraction\nPORT=${production ? 4620 : test ? 4420 : 4200}\nHOST=127.0.0.1\nDATABASE_URL=${urls.extraction}\nDATABASE_PASSWORD=${passwords.extraction}\nSERVICE_TOKEN=${tokens.extraction}\nOCR_PROVIDER=${rootEnv.OCR_PROVIDER ?? "tesseract"}\nOCR_CACHE_DIR=${out}/extraction-ocr\n`,
  decision:
    common +
    `SERVICE=decision\nPORT=${production ? 4630 : test ? 4430 : 4300}\nHOST=127.0.0.1\nDATABASE_URL=${urls.decision}\nDATABASE_PASSWORD=${passwords.decision}\nSERVICE_TOKEN=${tokens.decision}\nROUNDING_TOLERANCE_MINOR=${rootEnv.ROUNDING_TOLERANCE_MINOR ?? 1}\n`,
  identity: `DATABASE_PASSWORD=${identityPassword}\n`,
  gateway: `APP_ENV=${production ? "production" : test ? "test" : "demo"}\nAUTH_MODE=${authMode}\nAPP_URL=${production ? "http://127.0.0.1:3003" : (rootEnv.APP_URL ?? "http://127.0.0.1:3000")}\nWORKFLOW_URL=http://127.0.0.1:${production ? 4610 : test ? 4410 : 4100}\nWORKFLOW_TOKEN=${tokens.gateway}\nAUTH_DATABASE_URL=postgresql://identity_svc:${identityPassword}@127.0.0.1:${port}/invoicelens_identity\nAUTH_SECRET=${authSecret}\nWORKFLOW_IDENTITY_SECRET=${identitySecret}\n`,
};
envs.workflow += `WORKFLOW_IDENTITY_SECRET=${identitySecret}\n`;
for (const name of [...names, "identity", "gateway"] as const)
  await writeFile(`${out}/${name}.env`, envs[name], { mode: 0o600 });
async function run(cmd: string, args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env });
    p.on("exit", (n) =>
      n === 0 ? resolve() : reject(Error(`${cmd} exited ${n}`)),
    );
  });
}
for (const name of names)
  await run(
    process.execPath,
    ["--import", "tsx", `services/${name}/src/migrate.ts`],
    { ...process.env, ...parse(envs[name]) },
  );
await run(process.execPath, ["--import", "tsx", "scripts/auth-migrate.ts"], {
  ...process.env,
  AUTH_DATABASE_URL: `postgresql://identity_svc:${identityPassword}@127.0.0.1:${port}/invoicelens_identity`,
});
await run(
  process.execPath,
  ["--import", "tsx", "services/decision/src/seed.ts"],
  { ...process.env, ...parse(envs.decision) },
);
console.log(
  `Independent service databases ready on 127.0.0.1:${port}. Credentials saved under ${out} with mode 0600.`,
);
if (!test) {
  process.on("SIGINT", async () => {
    await pg.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await pg.stop();
    process.exit(0);
  });
  setInterval(() => {}, 30000);
} else await pg.stop();
function parse(str: string) {
  return Object.fromEntries(
    str
      .trim()
      .split(/\r?\n/)
      .filter((x) => x && !x.startsWith("#"))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}
