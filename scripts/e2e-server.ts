import EmbeddedPostgres from "embedded-postgres";
import { verifyPassword } from "better-auth/crypto";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { signWorkspaceIdentity } from "../packages/contracts/src/identity.js";

const directory = await mkdtemp(join(tmpdir(), "invoicelens-e2e-"));
const port = 55000 + (process.pid % 9000);
const children: ChildProcess[] = [];
const readiness = createServer((_req, res) => {
  res.writeHead(200);
  res.end("ready");
});
let workflowChild: ChildProcess | undefined;
let adminWorkflowChild: ChildProcess | undefined;
let stopping = false;
const token = () => randomBytes(32).toString("hex");
const tokens = {
  gateway: token(),
  extraction: token(),
  decision: token(),
};
const passwords = {
  workflow: token(),
  extraction: token(),
  decision: token(),
};
const identityPassword = token(),
  authSecret = token(),
  identitySecret = token();
const identityUrl = `postgresql://identity_svc:${identityPassword}@127.0.0.1:${port + 1}/invoicelens_identity`;
const urls = Object.fromEntries(
  Object.entries(passwords).map(
    ([name, password]) =>
      [
        name,
        `postgresql://${name}_svc:${password}@127.0.0.1:${port + 1}/invoicelens_${name}`,
      ] as const,
  ),
) as Record<keyof typeof passwords, string>;
const common = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  NODE_ENV: "development" as const,
  APP_ENV: "test" as const,
  MAX_FILE_MB: "10",
  MAX_PAGES: "10",
};
const envs: Record<string, NodeJS.ProcessEnv> = {
  extraction: {
    ...common,
    SERVICE: "extraction",
    PORT: "4520",
    HOST: "127.0.0.1",
    DATABASE_URL: urls.extraction,
    SERVICE_TOKEN: tokens.extraction,
    OCR_PROVIDER: "tesseract",
    OCR_CACHE_DIR: join(directory, "ocr-cache"),
  },
  decision: {
    ...common,
    SERVICE: "decision",
    PORT: "4530",
    HOST: "127.0.0.1",
    DATABASE_URL: urls.decision,
    SERVICE_TOKEN: tokens.decision,
    ROUNDING_TOLERANCE_MINOR: "1",
  },
  workflow: {
    ...common,
    SERVICE: "workflow",
    PORT: "4510",
    HOST: "127.0.0.1",
    DATABASE_URL: urls.workflow,
    WORKFLOW_TOKEN: tokens.gateway,
    EXTRACTION_URL: "http://127.0.0.1:4520",
    EXTRACTION_TOKEN: tokens.extraction,
    DECISION_URL: "http://127.0.0.1:4530",
    DECISION_TOKEN: tokens.decision,
    WORKSPACE_URL: "http://127.0.0.1:3001",
    WORKSPACE_AUTH_MODE: "local" as const,
    WORKSPACE_USER: "reviewer",
    WORKSPACE_PASSWORD: "",
    STORAGE_DIR: join(directory, "documents"),
    WORKER_ENABLED: "false",
  },
};

function spawnService(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...common, ...env },
    stdio: "inherit",
  });
  children.push(child);
  return child;
}

async function waitFor(url: string, headers: Record<string, string> = {}) {
  let last = "no response";
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
      last = `${response.status} ${await response.text()}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`);
}

// Keep the administrator credential alongside the server configuration.
const adminPassword = randomBytes(24).toString("hex");
const server = new EmbeddedPostgres({
  databaseDir: join(directory, "postgres-data"),
  user: "e2e_admin",
  password: adminPassword,
  port: port + 1,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});

async function bootstrap() {
  await server.initialise();
  await server.start();
  const admin = new Pool({
    connectionString: `postgresql://e2e_admin:${adminPassword}@127.0.0.1:${port + 1}/postgres`,
  });
  try {
    for (const name of ["workflow", "extraction", "decision"] as const) {
      await admin.query(
        `CREATE ROLE ${name}_svc LOGIN PASSWORD '${passwords[name]}'`,
      );
      await admin.query(
        `CREATE DATABASE invoicelens_${name} OWNER ${name}_svc`,
      );
    }
    await admin.query(
      `CREATE ROLE identity_svc LOGIN PASSWORD '${identityPassword}'`,
    );
    await admin.query(
      "CREATE DATABASE invoicelens_identity OWNER identity_svc",
    );
  } finally {
    await admin.end();
  }
  const identityMigration = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/auth-migrate.ts"],
    {
      cwd: process.cwd(),
      env: { ...common, AUTH_DATABASE_URL: identityUrl },
      stdio: "inherit",
    },
  );
  if (identityMigration.status !== 0)
    throw new Error("Identity migration failed");
  const bootstrapPassword = randomBytes(24).toString("hex");
  const identityBootstrap = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/auth-bootstrap.ts",
      "admin@example.test",
      "E2E Administrator",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...common,
        AUTH_DATABASE_URL: identityUrl,
        AUTH_SECRET: authSecret,
        APP_URL: "http://127.0.0.1:3001",
        AUTH_BOOTSTRAP: "true",
        AUTH_BOOTSTRAP_PASSWORD: bootstrapPassword,
      },
      stdio: "inherit",
    },
  );
  if (identityBootstrap.status !== 0)
    throw new Error("Initial administrator setup failed");
  for (const name of ["workflow", "extraction", "decision"] as const) {
    if (name === "workflow") {
      const migrations = [1, 2].map(() =>
        spawnService(
          ["--import", "tsx", `services/${name}/src/migrate.ts`],
          envs[name],
        ),
      );
      const exits = await Promise.all(
        migrations.map((child) => once(child, "exit")),
      );
      if (exits.some(([code]) => code !== 0))
        throw new Error("Concurrent workflow migrations failed");
      console.log("Concurrent workflow migrations passed.");
      continue;
    }
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", `services/${name}/src/migrate.ts`],
      { cwd: process.cwd(), env: envs[name], stdio: "inherit" },
    );
    if (result.status !== 0) throw new Error(`${name} migrations failed`);
  }
  const seeded = spawnSync(
    process.execPath,
    ["--import", "tsx", "services/decision/src/seed.ts"],
    { cwd: process.cwd(), env: envs.decision, stdio: "inherit" },
  );
  if (seeded.status !== 0) throw new Error("Decision fixture seed failed");
  for (const name of ["extraction", "decision", "workflow"] as const) {
    const child = spawnService(
      ["--import", "tsx", `services/${name}/src/server.ts`],
      envs[name],
    );
    if (name === "workflow") workflowChild = child;
  }
  for (const [name, servicePort, serviceToken] of [
    ["extraction", 4520, tokens.extraction],
    ["decision", 4530, tokens.decision],
    ["workflow", 4510, tokens.gateway],
  ] as const) {
    await waitFor(
      `http://127.0.0.1:${servicePort}/health/${name === "workflow" ? "live" : "ready"}`,
      {
        Authorization: `Bearer ${serviceToken}`,
      },
    );
    if (name === "workflow") {
      const readiness = await fetch(
        `http://127.0.0.1:${servicePort}/health/ready`,
        {
          headers: { Authorization: `Bearer ${serviceToken}` },
        },
      );
      if (readiness.status !== 503)
        throw new Error("Disabled worker must fail readiness");
      console.log("Workflow readiness correctly reports a disabled worker.");
    }
    console.log(`${name} service ready`);
  }
  await verifyAtomicReservations();
  await verifyWorkflowLeaseRecovery();
  spawnService(
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3001",
    ],
    {
      ...common,
      NODE_ENV: "production",
      INVOICELENS_DIST_DIR: ".next-tests",
      APP_URL: "http://127.0.0.1:3001",
      APP_ENV: "test" as const,
      AUTH_MODE: "local" as const,
      AUTH_DATABASE_URL: identityUrl,
      AUTH_SECRET: authSecret,
      WORKFLOW_IDENTITY_SECRET: identitySecret,
      WORKFLOW_URL: "http://127.0.0.1:4510",
      WORKFLOW_TOKEN: tokens.gateway,
      MAX_FILE_MB: "10",
    },
  );
  await waitFor("http://127.0.0.1:3001/api/health");
  const deniedMetrics = await fetch("http://127.0.0.1:4510/v1/metrics");
  if (deniedMetrics.status !== 401)
    throw new Error("Metrics exposed without authentication");
  const metricsResponse = await fetch("http://127.0.0.1:4510/v1/metrics", {
    headers: { Authorization: `Bearer ${tokens.gateway}` },
  });
  if (
    !metricsResponse.ok ||
    !(await metricsResponse.text()).includes("invoicelens_jobs")
  )
    throw new Error("Authenticated queue metrics unavailable");
  await verifyIdentityAccounts(bootstrapPassword, identitySecret);
  console.log("InvoiceLens isolated E2E stack ready on port 3001");
}

async function verifyIdentityAccounts(password: string, secret: string) {
  const base = "http://127.0.0.1:3001";
  const login = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email: "admin@example.test", password }),
  });
  if (!login.ok) throw new Error("Individual account sign-in failed");
  const cookie = (login.headers.get("set-cookie") ?? "")
    .split(/,(?=[^;,]+=)/)
    .map((item) => item.split(";")[0])
    .filter(Boolean)
    .join("; ");
  if (!cookie) throw new Error("Sign-in did not issue a session cookie");
  const sessionResponse = await fetch(`${base}/api/auth/get-session`, {
    headers: { Cookie: cookie },
  });
  const session = await sessionResponse.json();
  if (
    session?.user?.email !== "admin@example.test" ||
    session.user.role !== "admin"
  )
    throw new Error("Authenticated administrator session was not recovered");
  const reviewerPassword = randomBytes(24).toString("hex");
  const created = await fetch(`${base}/api/admin/users`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Origin: base,
    },
    body: JSON.stringify({
      action: "create",
      name: "E2E Reviewer",
      email: "reviewer@example.test",
      password: reviewerPassword,
      role: "reviewer",
    }),
  });
  if (created.status !== 201)
    throw new Error("Administrator account provisioning failed");
  const users = await (
    await fetch(`${base}/api/admin/users`, { headers: { Cookie: cookie } })
  ).json();
  const reviewer = users.find(
    (user: { email: string }) => user.email === "reviewer@example.test",
  );
  if (!reviewer || reviewer.role !== "reviewer")
    throw new Error("Reviewer role was not persisted");
  const auditPool = new Pool({ connectionString: identityUrl, max: 1 });
  try {
    const audit = await auditPool.query(
      "SELECT actor_id FROM identity_audit WHERE action='account_create_completed' ORDER BY id DESC LIMIT 1",
    );
    if (audit.rows[0]?.actor_id !== session.user.id)
      throw new Error(
        "Administrative change audit omitted authenticated actor ID",
      );
  } finally {
    await auditPool.end();
  }
  const reviewerLogin = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email: reviewer.email, password: reviewerPassword }),
  });
  if (!reviewerLogin.ok)
    throw new Error("Reviewer login failed before recovery test");
  const reviewerCookie = reviewerLogin.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const recoveredPassword = randomBytes(24).toString("hex");
  const reset = await fetch(`${base}/api/admin/users`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: "password",
      userId: reviewer.id,
      password: recoveredPassword,
      reason: "Identity confirmed by isolated integration test",
    }),
  });
  if (!reset.ok) throw new Error(`Account recovery failed: ${reset.status}`);
  const revoked = await fetch(`${base}/api/auth/get-session`, {
    headers: { Cookie: reviewerCookie },
  });
  if ((await revoked.json()) !== null)
    throw new Error("Recovered account retained its old session");
  const oldPasswordLogin = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ email: reviewer.email, password: reviewerPassword }),
  });
  if (oldPasswordLogin.ok)
    throw new Error("Old password still worked after recovery");
  let recoveredLogin = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: reviewer.email,
      password: recoveredPassword,
    }),
  });
  if (recoveredLogin.status === 429) {
    const seconds = Math.min(
      11,
      Number(recoveredLogin.headers.get("retry-after") ?? 10),
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000 + 100));
    recoveredLogin = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: reviewer.email,
        password: recoveredPassword,
      }),
    });
  }
  if (!recoveredLogin.ok)
    throw new Error(
      `Recovered password did not authenticate: ${recoveredLogin.status}`,
    );
  const signed = signWorkspaceIdentity(
    {
      sub: reviewer.id,
      email: reviewer.email,
      name: reviewer.name,
      role: "viewer",
    },
    secret,
  );
  adminWorkflowChild = spawnService(
    ["--import", "tsx", "services/workflow/src/server.ts"],
    {
      ...envs.workflow,
      PORT: "4540",
      APP_ENV: "production",
      WORKSPACE_URL: "http://127.0.0.1:3002",
      WORKSPACE_AUTH_MODE: "individual",
      WORKFLOW_IDENTITY_SECRET: secret,
      WORKER_ENABLED: "false",
    },
  );
  await waitFor("http://127.0.0.1:4540/health/live");
  const forged = await fetch("http://127.0.0.1:4540/v1/invoices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.gateway}`,
      "X-Workspace-Identity": signed,
      "X-Workspace-Origin": "http://127.0.0.1:3002",
      "X-Workspace-Host": "127.0.0.1:3002",
      "Content-Type": "application/pdf",
    },
    body: "%PDF-1.4",
  });
  if (forged.status !== 403)
    throw new Error("Workflow did not deny viewer mutation");
  const missingIdentity = await fetch("http://127.0.0.1:4540/v1/invoices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.gateway}`,
      "X-Workspace-Origin": "http://127.0.0.1:3002",
      "X-Workspace-Host": "127.0.0.1:3002",
      "Content-Type": "application/pdf",
    },
    body: "%PDF-1.4",
  });
  if (missingIdentity.status !== 401)
    throw new Error("Workflow accepted a request without a signed identity");
  spawnService(
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3002",
    ],
    {
      ...common,
      NODE_ENV: "production",
      INVOICELENS_DIST_DIR: ".next-tests",
      APP_URL: "http://127.0.0.1:3002",
      APP_ENV: "production",
      AUTH_MODE: "individual",
      AUTH_DATABASE_URL: identityUrl,
      AUTH_SECRET: authSecret,
      WORKFLOW_IDENTITY_SECRET: secret,
      WORKFLOW_URL: "http://127.0.0.1:4540",
      WORKFLOW_TOKEN: tokens.gateway,
      MAX_FILE_MB: "10",
    },
  );
  await waitFor("http://127.0.0.1:3002/api/live");
  for (const path of [
    "/api/samples/happy-path.pdf",
    "/samples/happy-path.pdf",
    "/%73amples/happy-path.pdf",
    "/Samples/happy-path.pdf",
  ]) {
    const sampleResponse = await fetch("http://127.0.0.1:3002" + path, {
      headers: { Cookie: cookie },
    });
    if (sampleResponse.status !== 404)
      throw new Error("Production sample route is exposed: " + path);
  }

  const referenceId = randomBytes(8).toString("hex");
  const csvHeaders = [
    "record_type",
    "id",
    "name",
    "identifier",
    "aliases",
    "approved",
    "vendor_id",
    "currency",
    "limit_minor",
    "status",
    "description",
    "invoice_number",
    "po_id",
    "amount_minor",
    "label",
  ];
  const csvRow = (entry: Record<string, string>) =>
    csvHeaders
      .map((key) => `"${(entry[key] ?? "").replaceAll('"', '""')}"`)
      .join(",");
  const csv = [
    csvHeaders.map((x) => `"${x}"`).join(","),
    csvRow({
      record_type: "vendor",
      id: `V-${referenceId}`,
      name: "E2E Reference Vendor",
      identifier: `TAX-${referenceId}`,
      aliases: "E2E Ref",
      approved: "true",
    }),
    csvRow({
      record_type: "po",
      id: `PO-${referenceId}`,
      vendor_id: `V-${referenceId}`,
      currency: "INR",
      limit_minor: "500000",
      status: "open",
      description: "E2E reference import",
    }),
    csvRow({
      record_type: "opening_commitment",
      id: `OPEN-${referenceId}`,
      vendor_id: `V-${referenceId}`,
      po_id: `PO-${referenceId}`,
      invoice_number: `PRIOR-${referenceId}`,
      amount_minor: "10000",
      label: "Opening balance",
    }),
  ].join("\r\n");
  for (const [kind, header] of [
    ["extra", "__proto__"],
    ["duplicate", "record_type"],
  ]) {
    const invalidCsv = csv
      .split("\r\n")
      .map((line, i) => `${line},${i === 0 ? header : "ignored"}`)
      .join("\r\n");
    const invalid = await fetch("http://127.0.0.1:3002/api/references/import", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://127.0.0.1:3002",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "preview",
        previewId: `${kind}-${referenceId}`,
        csv: invalidCsv,
      }),
    });
    if (
      invalid.status !== 422 ||
      !(await invalid.json()).errors.some(
        (error: { code: string }) => error.code === "invalid_csv",
      )
    )
      throw new Error(`Unsafe ${kind} CSV headers were not rejected`);
  }
  const referencePreviewId = `ref-${referenceId}`;
  const preview = await fetch("http://127.0.0.1:3002/api/references/import", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://127.0.0.1:3002",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "preview",
      previewId: referencePreviewId,
      csv,
    }),
  });
  if (!preview.ok)
    throw new Error(
      `Reference preview failed: ${preview.status} ${await preview.text()}`,
    );
  const commit = await fetch("http://127.0.0.1:3002/api/references/import", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://127.0.0.1:3002",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "commit",
      previewId: referencePreviewId,
      csv,
    }),
  });
  if (!commit.ok)
    throw new Error(
      `Reference commit failed: ${commit.status} ${await commit.text()}`,
    );
  const referenceCommit = await commit.json();
  const replayCommit = await fetch(
    "http://127.0.0.1:3002/api/references/import",
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "http://127.0.0.1:3002",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "commit",
        previewId: referencePreviewId,
        csv,
      }),
    },
  );
  if (
    !replayCommit.ok ||
    (await replayCommit.json()).imported !== referenceCommit.imported
  )
    throw new Error("Reference import replay was not idempotent");
  const references = await (
    await fetch("http://127.0.0.1:3002/api/references", {
      headers: { Cookie: cookie },
    })
  ).json();
  if (
    !references.vendors.some(
      (v: { id: string }) => v.id === `V-${referenceId}`,
    ) ||
    !references.commitments.some(
      (c: { invoiceId: string; kind: string }) =>
        c.invoiceId === `opening:OPEN-${referenceId}` && c.kind === "opening",
    )
  )
    throw new Error(
      "Opening commitment was not reflected in Decision references",
    );
  const invalidCsv = [
    csvHeaders.map((x) => `"${x}"`).join(","),
    csvRow({
      record_type: "vendor",
      id: `V-BAD-${referenceId}`,
      name: "Must Roll Back",
      identifier: `TAX-BAD-${referenceId}`,
      approved: "true",
    }),
    csvRow({
      record_type: "po",
      id: `PO-BAD-${referenceId}`,
      vendor_id: `MISSING-${referenceId}`,
      currency: "INR",
      limit_minor: "500000",
      status: "open",
      description: "Invalid batch",
    }),
  ].join("\r\n");
  const invalidId = `bad-${referenceId}`;
  await fetch("http://127.0.0.1:3002/api/references/import", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://127.0.0.1:3002",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "preview",
      previewId: invalidId,
      csv: invalidCsv,
    }),
  });
  const rejected = await fetch("http://127.0.0.1:3002/api/references/import", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://127.0.0.1:3002",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "commit",
      previewId: invalidId,
      csv: invalidCsv,
    }),
  });
  if (rejected.status !== 422)
    throw new Error("Invalid reference batch was not rejected atomically");
  const referenceDb = new Pool({ connectionString: urls.decision, max: 1 });
  try {
    const checkRollback = await referenceDb.query(
      "SELECT 1 FROM vendors WHERE id=$1",
      [`V-BAD-${referenceId}`],
    );
    if (checkRollback.rowCount)
      throw new Error("Invalid reference import partially wrote a vendor");
    const referenceAudit = await referenceDb.query(
      "SELECT actor_id FROM reference_audit WHERE action='import_committed' AND subject=$1",
      [referencePreviewId],
    );
    if (referenceAudit.rows[0]?.actor_id !== session.user.id)
      throw new Error("Reference import audit omitted administrator ID");
  } finally {
    await referenceDb.end();
  }
  console.log(
    "Reference import passed: admin preview, row validation, atomic commit, opening balance, audit actor and idempotent replay.",
  );
  const invoiceId = randomUUID();
  const adminGateway = "http://127.0.0.1:3002";
  const createdAt = new Date().toISOString();
  const originalPdf = await PDFDocument.create();
  originalPdf.addPage().drawText("Reconciliation test " + invoiceId);
  const originalBytes = Buffer.from(await originalPdf.save());
  const hash = createHash("sha256").update(originalBytes).digest("hex");
  const decisionHeaders = {
    Authorization: `Bearer ${tokens.decision}`,
    "Content-Type": "application/json",
    "X-Correlation-ID": `reconcile-${invoiceId}`,
  };
  const registration = await fetch("http://127.0.0.1:4530/v1/registrations", {
    method: "POST",
    headers: { ...decisionHeaders, "Idempotency-Key": `register:${invoiceId}` },
    body: JSON.stringify({ invoiceId, hash, createdAt }),
  });
  if (!registration.ok)
    throw new Error("Reconciliation fixture registration failed");
  const fields = {
    supplierName: "Northstar Office Supplies",
    supplierId: "GST-NORTHSTAR-01",
    invoiceNumber: `RECON-${invoiceId}`,
    invoiceDate: "2026-10-31",
    poReference: "PO-2026-101",
    currency: "INR",
    subtotal: "100.00",
    tax: "18.00",
    total: "118.00",
    lineItems: [],
  };
  const evaluation = await fetch("http://127.0.0.1:4530/v1/evaluations", {
    method: "POST",
    headers: {
      ...decisionHeaders,
      "Idempotency-Key": `${invoiceId}:1:evaluate`,
    },
    body: JSON.stringify({
      apiVersion: "1",
      invoiceId,
      hash,
      createdAt,
      generation: 1,
      fields,
      selectedPo: "PO-2026-101",
    }),
  });
  const evaluated = await evaluation.json();
  if (!evaluation.ok || evaluated.review !== "pending")
    throw new Error("Reconciliation fixture evaluation did not remain pending");
  const approved = await fetch("http://127.0.0.1:4530/v1/commands", {
    method: "POST",
    headers: {
      ...decisionHeaders,
      "Idempotency-Key": `${invoiceId}:2:approve`,
    },
    body: JSON.stringify({
      apiVersion: "1",
      invoiceId,
      generation: 2,
      expectedGeneration: 1,
      action: "approve",
      reason: "Failure injection reconciliation approval",
      actorId: session.user.id,
    }),
  });
  if (!approved.ok)
    throw new Error(
      `Reconciliation fixture approval failed: ${approved.status}`,
    );
  const workflowDb = new Pool({ connectionString: urls.workflow, max: 1 });
  const decisionDb = new Pool({ connectionString: urls.decision, max: 1 });
  try {
    await mkdir(envs.workflow.STORAGE_DIR!, { recursive: true });
    await writeFile(
      join(envs.workflow.STORAGE_DIR!, `${invoiceId}.pdf`),
      originalBytes,
    );
    const state = {
      review: "pending",
      revision: 1,
      history: [],
      stages: [],
      fields,
      selectedPo: "PO-2026-101",
      evaluation: evaluated.evaluation,
    };
    await workflowDb.query(
      "INSERT INTO invoices(id,filename,hash,storage_key,status,created_at,updated_at,state,generation,upload_fingerprint) VALUES($1,'reconciliation-injection.pdf',$2,$3,'failed',$4,$4,$5,2,$2)",
      [invoiceId, hash, `${invoiceId}.pdf`, createdAt, JSON.stringify(state)],
    );
    await workflowDb.query(
      "INSERT INTO workflow_jobs(id,invoice_id,generation,kind,payload,status,error,correlation_id) VALUES($1,$2,2,'review',$3,'failed','Injected lost response',$4)",
      [
        randomUUID(),
        invoiceId,
        JSON.stringify({ action: "approve" }),
        `reconcile-${invoiceId}`,
      ],
    );
    await workflowDb.query(
      "UPDATE invoices SET status='completed' WHERE id=$1",
      [invoiceId],
    );
    const unverifiedApproval = await fetch(
      `${adminGateway}/api/invoices/${invoiceId}/review`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: adminGateway,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "approve",
          reason: "This unverified attempt must not succeed",
        }),
      },
    );
    if (
      unverifiedApproval.status !== 409 ||
      !(await unverifiedApproval.json()).error.includes("Verify invoice values")
    )
      throw new Error("Production permitted an unverified invoice approval");
    await workflowDb.query("UPDATE invoices SET status='failed' WHERE id=$1", [
      invoiceId,
    ]);
    const countCommitments = async () =>
      (
        await decisionDb.query(
          "SELECT count(*)::int AS n FROM commitments WHERE invoice_id=$1",
          [invoiceId],
        )
      ).rows[0].n;
    if ((await countCommitments()) !== 1)
      throw new Error(
        "Decision approval did not create exactly one commitment",
      );
    const scan = await fetch(`${adminGateway}/api/reconciliation`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: adminGateway,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "scan" }),
    });
    const scanResult = await scan.json();
    if (
      !scan.ok ||
      !scanResult.openCases.some(
        (item: { invoiceId: string }) => item.invoiceId === invoiceId,
      )
    )
      throw new Error(
        `Reconciliation scan did not identify the stale final review: ${scan.status} ${JSON.stringify(scanResult)}`,
      );
    if (!adminWorkflowChild)
      throw new Error("Reconciliation Workflow service did not start");
    const scanRestartExit = once(adminWorkflowChild, "exit");
    adminWorkflowChild.kill("SIGTERM");
    await scanRestartExit;
    adminWorkflowChild = spawnService(
      ["--import", "tsx", "services/workflow/src/server.ts"],
      {
        ...envs.workflow,
        PORT: "4540",
        APP_ENV: "production",
        WORKSPACE_URL: "http://127.0.0.1:3002",
        WORKSPACE_AUTH_MODE: "individual",
        WORKFLOW_IDENTITY_SECRET: secret,
        WORKER_ENABLED: "false",
      },
    );
    await waitFor("http://127.0.0.1:4540/health/live");
    const persistedCase = await workflowDb.query(
      "SELECT status FROM reconciliation_cases WHERE invoice_id=$1 AND status='open'",
      [invoiceId],
    );
    if (persistedCase.rowCount !== 1)
      throw new Error(
        "Open reconciliation case did not persist across Workflow restart",
      );
    const repair = await fetch(`${adminGateway}/api/reconciliation`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: adminGateway,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "repair" }),
    });
    const repairResult = await repair.json();
    if (!repair.ok || repairResult.repaired !== 1)
      throw new Error(
        "Reconciliation repair did not update stale Workflow state",
      );
    const repaired = await workflowDb.query(
      "SELECT state,status FROM invoices WHERE id=$1",
      [invoiceId],
    );
    if (
      repaired.rows[0].state.review !== "approved" ||
      repaired.rows[0].status !== "completed" ||
      !repaired.rows[0].state.history.some(
        (entry: { reason?: string }) =>
          entry.reason === "Failure injection reconciliation approval",
      )
    )
      throw new Error(
        "Reconciliation repair did not persist authoritative review state",
      );
    if ((await countCommitments()) !== 1)
      throw new Error(
        "Reconciliation repair changed or duplicated a commitment",
      );
    await writeFile(
      join(envs.workflow.STORAGE_DIR!, `${invoiceId}.pdf`),
      Buffer.from("corrupted original"),
    );
    const integrityScan = async () => {
      const response = await fetch(`${adminGateway}/api/reconciliation`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: adminGateway,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "scan" }),
      });
      if (!response.ok) throw new Error("Document integrity scan failed");
      return response.json();
    };
    const corrupted = await integrityScan();
    if (
      !corrupted.openCases.some(
        (item: { caseKey: string }) =>
          item.caseKey === `${invoiceId}:integrity:document-hash`,
      )
    )
      throw new Error("Corrupt document was not detected");
    await writeFile(
      join(envs.workflow.STORAGE_DIR!, `${invoiceId}.pdf`),
      originalBytes,
    );
    const restored = await integrityScan();
    if (
      restored.openCases.some(
        (item: { caseKey: string }) =>
          item.caseKey === `${invoiceId}:integrity:document-hash`,
      )
    )
      throw new Error("Restored original left an unresolved document case");
    const replay = await fetch(`${adminGateway}/api/reconciliation`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: adminGateway,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode: "repair" }),
    });
    if (
      !replay.ok ||
      (await replay.json()).repaired !== 0 ||
      (await countCommitments()) !== 1
    )
      throw new Error("Repeated reconciliation was not idempotent");
  } finally {
    await Promise.all([workflowDb.end(), decisionDb.end()]);
  }
  console.log(
    "Reconciliation failure injection passed: Decision approval survived a lost Workflow response, admin repair recovered it, repeat scan made no duplicate commitment.",
  );
  const signedOut = await fetch(`${base}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!signedOut.ok)
    throw new Error(
      `Session sign-out failed: ${signedOut.status} ${await signedOut.text()}`,
    );
  const after = await fetch(`${base}/api/auth/get-session`, {
    headers: { Cookie: cookie },
  });
  if ((await after.json()) !== null)
    throw new Error("Signed-out session remained active");
  const openSignup = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({
      name: "Unexpected",
      email: "open@example.test",
      password: randomBytes(24).toString("hex"),
    }),
  });
  if (openSignup.ok)
    throw new Error("Public self-registration was unexpectedly enabled");
  const recoveryPassword = randomBytes(24).toString("hex");
  const recoveryPool = new Pool({ connectionString: identityUrl, max: 1 });
  try {
    await recoveryPool.query(
      'INSERT INTO session(id,token,"expiresAt","userId") VALUES($1,$2,now()+interval \'1 hour\',$3)',
      [randomUUID(), randomBytes(32).toString("hex"), session.user.id],
    );
    const recovered = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/auth-recover-admin.ts",
        "admin@example.test",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...common,
          APP_ENV: "test",
          AUTH_DATABASE_URL: identityUrl,
          AUTH_SECRET: authSecret,
          AUTH_RECOVERY_PASSWORD: recoveryPassword,
          AUTH_RECOVERY_OPERATOR: "Isolated test operator",
          AUTH_RECOVERY_REASON:
            "Emergency recovery exercised only against disposable integration data",
        },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    if (recovered.status !== 0)
      throw new Error(`Operator recovery failed: ${recovered.stderr}`);
    const credentials = await recoveryPool.query(
      'SELECT password FROM account WHERE "userId"=$1 AND "providerId"=\'credential\'',
      [session.user.id],
    );
    if (
      !(await verifyPassword({
        hash: credentials.rows[0].password,
        password: recoveryPassword,
      }))
    )
      throw new Error(
        "Operator recovery did not save the configured authentication hash",
      );
    const remaining = await recoveryPool.query(
      'SELECT count(*)::int AS n FROM session WHERE "userId"=$1',
      [session.user.id],
    );
    if (remaining.rows[0].n !== 0)
      throw new Error("Operator recovery retained an existing session");
    const audit = await recoveryPool.query(
      "SELECT data FROM identity_audit WHERE action='operator_admin_recovery' AND target_user_id=$1",
      [session.user.id],
    );
    if (audit.rows[0]?.data.operator !== "Isolated test operator")
      throw new Error("Operator recovery omitted its audit context");
  } finally {
    await recoveryPool.end();
  }
  console.log(
    "Individual authentication passed: administrator bootstrap, login, role provisioning, actor audit, viewer denial, sign-out revocation and closed public signup.",
  );
}

async function verifyAtomicReservations() {
  const base = "http://127.0.0.1:4530";
  const createdAt = new Date().toISOString();
  const items = [
    randomBytes(16).toString("hex"),
    randomBytes(16).toString("hex"),
  ].map((suffix) => ({
    invoiceId: `concurrency-${suffix}`,
    hash: randomBytes(32).toString("hex"),
    createdAt,
    apiVersion: "1",
    generation: 1,
    selectedPo: "PO-2026-301",
    fields: {
      supplierName: "Studio Meridian",
      supplierId: "GST-MERIDIAN-02",
      invoiceNumber: `CONCURRENT-${suffix}`,
      invoiceDate: "2026-10-31",
      poReference: "PO-2026-301",
      currency: "INR",
      subtotal: "50000.00",
      tax: "10000.00",
      total: "60000.00",
      lineItems: [],
    },
  }));
  for (const item of items) {
    const response = await fetch(`${base}/v1/registrations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.decision}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `register:${item.invoiceId}`,
      },
      body: JSON.stringify({
        invoiceId: item.invoiceId,
        hash: item.hash,
        createdAt: item.createdAt,
      }),
    });
    if (!response.ok)
      throw new Error("Decision registration invariant setup failed");
  }
  const results = await Promise.all(
    items.map(async (item) => {
      const response = await fetch(`${base}/v1/evaluations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.decision}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${item.invoiceId}:evaluate`,
        },
        body: JSON.stringify(item),
      });
      if (!response.ok)
        throw new Error(
          `Concurrent decision evaluation failed: ${response.status}`,
        );
      return (await response.json()).evaluation.decision as string;
    }),
  );
  if (
    results.filter((decision) => decision === "READY_FOR_APPROVAL").length !==
      1 ||
    results.filter((decision) => decision === "BLOCKED").length !== 1
  )
    throw new Error(
      `PO reservation concurrency invariant failed: ${results.join(", ")}`,
    );
  console.log(
    "Decision concurrency check passed: one reservation succeeded; the over-limit invoice was blocked.",
  );

  const stale = {
    ...items[0],
    invoiceId: `stale-${randomBytes(12).toString("hex")}`,
    hash: randomBytes(32).toString("hex"),
    fields: {
      ...items[0].fields,
      invoiceNumber: `STALE-${randomBytes(6).toString("hex")}`,
      subtotal: "1000.00",
      tax: "0.00",
      total: "1000.00",
    },
  };
  const request = async (path: string, key: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.decision}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json().catch(() => ({})) };
  };
  const registered = await request(
    "/v1/registrations",
    `register:${stale.invoiceId}`,
    stale,
  );
  if (!registered.response.ok)
    throw new Error("Stale evaluation test registration failed");
  const original = await request(
    "/v1/evaluations",
    `${stale.invoiceId}:1:evaluate`,
    stale,
  );
  if (
    !original.response.ok ||
    original.body.evaluation?.decision !== "READY_FOR_APPROVAL"
  )
    throw new Error(
      "Stale evaluation test did not create its initial reservation",
    );
  const fence = {
    apiVersion: "1",
    invoiceId: stale.invoiceId,
    hash: stale.hash,
    createdAt: stale.createdAt,
    generation: 2,
  };
  const fenced = await request(
    "/v1/generations/fence",
    `${stale.invoiceId}:2:fence`,
    fence,
  );
  const fenceReplay = await request(
    "/v1/generations/fence",
    `${stale.invoiceId}:2:fence`,
    fence,
  );
  if (
    !fenced.response.ok ||
    !fenceReplay.response.ok ||
    fenceReplay.body.generation !== 2
  )
    throw new Error("Generation fence replay failed");
  const staleAttempt = await request(
    "/v1/evaluations",
    `${stale.invoiceId}:1:late-evaluate`,
    stale,
  );
  if (staleAttempt.response.status !== 409)
    throw new Error("Late stale evaluation was not rejected");
  // A retry of the original idempotency key may replay its response, but must not
  // recreate the reservation that the generation fence removed.
  const oldReplay = await request(
    "/v1/evaluations",
    `${stale.invoiceId}:1:evaluate`,
    stale,
  );
  if (!oldReplay.response.ok)
    throw new Error("Original evaluation replay was not idempotent");
  const correctedFields = {
    ...stale.fields,
    invoiceNumber: `${stale.fields.invoiceNumber}-FIXED`,
    subtotal: "2000.00",
    total: "2000.00",
  };
  const corrected = await request(
    "/v1/evaluations",
    `${stale.invoiceId}:2:evaluate`,
    { ...stale, generation: 2, fields: correctedFields },
  );
  if (
    !corrected.response.ok ||
    corrected.body.evaluation?.inputs?.invoiceNumber !==
      correctedFields.invoiceNumber
  )
    throw new Error(
      "Current-generation evaluation did not replace stale result",
    );
  const commitments = await (
    await fetch(`${base}/v1/references`, {
      headers: { Authorization: `Bearer ${tokens.decision}` },
    })
  ).json();
  const reservations = commitments.commitments.filter(
    (x: { invoiceId: string; kind: string }) =>
      x.invoiceId === stale.invoiceId && x.kind === "reservation",
  );
  if (reservations.length !== 1 || reservations[0].amountMinor !== "200000")
    throw new Error(
      "Stale evaluation replay duplicated or restored obsolete reservation",
    );
  console.log(
    "Generation-fence check passed: late evaluations rejected, prior response replay did not restore reservation, corrected inputs reserved once.",
  );
}

async function verifyWorkflowLeaseRecovery() {
  if (!workflowChild) throw new Error("Workflow service did not start");
  const origin = "http://127.0.0.1:3001";
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const number = `RESUME-${randomBytes(5).toString("hex")}`;
  const lines = [
    "INVOICE",
    "Supplier: Northstar Office Supplies",
    "Supplier ID: GST-NORTHSTAR-01",
    `Invoice number: ${number}`,
    "Invoice date: 2026-10-31",
    "Currency: INR",
    "PO reference: PO-2026-101",
    "Subtotal: 100.00",
    "Tax: 18.00",
    "Total: 118.00",
  ];
  lines.forEach((line, index) =>
    page.drawText(line, { x: 48, y: 740 - index * 34, size: 15, font }),
  );
  const bytes = new Uint8Array(await pdf.save());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const uploaded = await fetch("http://127.0.0.1:4510/v1/invoices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.gateway}`,
      "Content-Type": "application/pdf",
      "X-Filename": "lease-recovery.pdf",
      "X-Content-SHA256": hash,
      "Idempotency-Key": `recovery:${number}`,
      "X-Workspace-Origin": origin,
      "X-Workspace-Host": "127.0.0.1:3001",
    },
    body: bytes,
  });
  if (!uploaded.ok)
    throw new Error(`Recovery test upload failed: ${uploaded.status}`);
  const { id } = await uploaded.json();

  const db = new Pool({ connectionString: urls.workflow, max: 1 });
  try {
    await db.query(
      "UPDATE workflow_jobs SET status='running',attempts=1,lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE invoice_id=$1 AND status='queued'",
      [id],
    );
    await db.query(
      "UPDATE invoices SET status='running',state=jsonb_set(state,'{stages,1,status}','\"running\"'::jsonb) WHERE id=$1",
      [id],
    );
  } finally {
    await db.end();
  }
  const beforeSendDecision = new Pool({
    connectionString: urls.decision,
    max: 1,
  });
  try {
    const absent = await beforeSendDecision.query(
      "SELECT 1 FROM decision_records WHERE invoice_id=$1",
      [id],
    );
    if (absent.rowCount)
      throw new Error("Pre-send crash fixture unexpectedly reached Decision");
  } finally {
    await beforeSendDecision.end();
  }

  const oldExit = once(workflowChild, "exit");
  workflowChild.kill("SIGTERM");
  await oldExit;
  const resumed = spawnService(
    ["--import", "tsx", "services/workflow/src/server.ts"],
    { ...envs.workflow, WORKER_ENABLED: "true" },
  );
  workflowChild = resumed;
  await waitFor("http://127.0.0.1:4510/health/ready", {
    Authorization: `Bearer ${tokens.gateway}`,
  });

  const headers = {
    Authorization: `Bearer ${tokens.gateway}`,
    "X-Workspace-Origin": origin,
    "X-Workspace-Host": "127.0.0.1:3001",
  };
  let invoice: { status: string; state: { error?: string } } | undefined;
  for (let attempt = 0; attempt < 240; attempt++) {
    const response = await fetch(`http://127.0.0.1:4510/v1/invoices/${id}`, {
      headers,
    });
    invoice = (await response.json()) as {
      status: string;
      state: { error?: string };
    };
    if (invoice.status === "completed" || invoice.status === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!invoice || invoice.status !== "completed")
    throw new Error(
      `Expired workflow lease did not recover: ${invoice?.state.error ?? invoice?.status ?? "invoice not found"}`,
    );
  const eventResponse = await fetch(
    `http://127.0.0.1:4510/v1/invoices/${id}/events`,
    { headers },
  );
  const events = (await eventResponse.json()) as {
    type: string;
    data: { retry?: boolean };
  }[];
  if (!events.some((event) => event.type === "recovery" && event.data.retry))
    throw new Error("Workflow did not record lease recovery evidence");
  if (
    !events.some((event) => event.type === "evaluation") ||
    !events.some((event) => event.type === "stage")
  )
    throw new Error(
      "Workflow did not persist stage and evaluation events with processing state",
    );
  console.log(
    "Workflow restart check passed: expired lease recovered with atomic stage/evaluation event history.",
  );

  const initial = await (
    await fetch(`http://127.0.0.1:4510/v1/invoices/${id}`, { headers })
  ).json();
  const correctionReason = "Synthetic verification before restart";
  const corrected = await fetch(
    `http://127.0.0.1:4510/v1/invoices/${id}/reviews`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "correct",
        reason: correctionReason,
        fields: {
          ...initial.state.fields,
          invoiceNumber: `${number}-CORRECTED`,
        },
      }),
    },
  );
  if (corrected.status !== 202)
    throw new Error("Restart audit correction was not queued");
  for (let attempt = 0; attempt < 240; attempt++) {
    const current = await (
      await fetch(`http://127.0.0.1:4510/v1/invoices/${id}`, { headers })
    ).json();
    if (current.status === "completed") break;
    if (current.status === "failed" || attempt === 239)
      throw new Error("Restart audit correction did not complete");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // Model a lost response after Decision commits but before Workflow handles it.
  const resumedExit = once(resumed, "exit");
  resumed.kill("SIGTERM");
  await resumedExit;
  const pausedWorkflow = spawnService(
    ["--import", "tsx", "services/workflow/src/server.ts"],
    { ...envs.workflow, WORKER_ENABLED: "false" },
  );
  workflowChild = pausedWorkflow;
  await waitFor("http://127.0.0.1:4510/health/live");
  const afterRestart = await (
    await fetch(`http://127.0.0.1:4510/v1/invoices/${id}`, { headers })
  ).json();
  const history = afterRestart.state.history.find(
    (entry: { action: string }) => entry.action === "correct",
  );
  const restartEvents = await (
    await fetch(`http://127.0.0.1:4510/v1/invoices/${id}/events`, { headers })
  ).json();
  if (
    history?.reason !== correctionReason ||
    history.previousFields?.invoiceNumber !== number ||
    history.correctedFields?.invoiceNumber !== `${number}-CORRECTED` ||
    !restartEvents.some(
      (event: { data: { reason?: string } }) =>
        event.data.reason === correctionReason,
    )
  )
    throw new Error("Correction audit history did not survive restart");
  console.log(
    "Correction reason and before/after values survived workflow restart.",
  );
  const reason = "Synthetic review after lost response";
  const queued = await fetch(
    `http://127.0.0.1:4510/v1/invoices/${id}/reviews`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", reason }),
    },
  );
  if (queued.status !== 202)
    throw new Error(`Review enqueue failed: ${queued.status}`);
  const pausedExit = once(pausedWorkflow, "exit");
  pausedWorkflow.kill("SIGTERM");
  await pausedExit;
  const command = await fetch("http://127.0.0.1:4530/v1/commands", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.decision}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `${id}:3:approve`,
    },
    body: JSON.stringify({
      apiVersion: "1",
      invoiceId: id,
      generation: 3,
      expectedGeneration: 2,
      action: "approve",
      reason,
    }),
  });
  if (!command.ok)
    throw new Error(`Decision commit setup failed: ${command.status}`);
  const failedDb = new Pool({ connectionString: urls.workflow, max: 1 });
  try {
    await failedDb.query(
      "UPDATE workflow_jobs SET status='failed',error='Simulated lost response' WHERE invoice_id=$1 AND generation=3",
      [id],
    );
    await failedDb.query("UPDATE invoices SET status='failed' WHERE id=$1", [
      id,
    ]);
  } finally {
    await failedDb.end();
  }
  const replay = spawnService(
    ["--import", "tsx", "services/workflow/src/server.ts"],
    { ...envs.workflow, WORKER_ENABLED: "true" },
  );
  workflowChild = replay;
  await waitFor("http://127.0.0.1:4510/health/ready", {
    Authorization: `Bearer ${tokens.gateway}`,
  });
  const retry = await fetch(`http://127.0.0.1:4510/v1/invoices/${id}/reviews`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "retry",
      reason: "Recover uncertain review result",
    }),
  });
  if (retry.status !== 202)
    throw new Error(`Failed review retry was not accepted: ${retry.status}`);
  let finalReview = "pending";
  for (let attempt = 0; attempt < 240; attempt++) {
    const current = await (
      await fetch(`http://127.0.0.1:4510/v1/invoices/${id}`, { headers })
    ).json();
    finalReview = current.state.review;
    if (finalReview === "approved") break;
    if (current.status === "failed")
      throw new Error("Lost-response replay failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (finalReview !== "approved")
    throw new Error("Lost-response replay timed out");
  const refs = await (
    await fetch("http://127.0.0.1:4530/v1/references", {
      headers: { Authorization: `Bearer ${tokens.decision}` },
    })
  ).json();
  if (
    refs.commitments.filter(
      (item: { invoiceId: string }) => item.invoiceId === id,
    ).length !== 1
  )
    throw new Error("Lost-response replay duplicated or lost the commitment");
  console.log(
    "Lost-response recovery check passed: failed review retried after restart with one commitment.",
  );

  const racePdf = await PDFDocument.create();
  const racePage = racePdf.addPage([612, 792]);
  const raceFont = await racePdf.embedFont(StandardFonts.Helvetica);
  const raceNumber = `RACE-${randomBytes(5).toString("hex")}`;
  [
    "INVOICE",
    "Supplier: Northstar Office Supplies",
    "Supplier ID: GST-NORTHSTAR-01",
    `Invoice number: ${raceNumber}`,
    "Invoice date: 2026-10-31",
    "Currency: INR",
    "PO reference: PO-2026-101",
    "Subtotal: 100.00",
    "Tax: 18.00",
    "Total: 118.00",
  ].forEach((line, index) =>
    racePage.drawText(line, {
      x: 48,
      y: 740 - index * 34,
      size: 15,
      font: raceFont,
    }),
  );
  const raceBytes = new Uint8Array(await racePdf.save());
  const raceHash = createHash("sha256").update(raceBytes).digest("hex");
  const raceUpload = await fetch("http://127.0.0.1:4510/v1/invoices", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.gateway}`,
      "Content-Type": "application/pdf",
      "X-Filename": "correction-approval-race.pdf",
      "X-Content-SHA256": raceHash,
      "Idempotency-Key": `race:${raceNumber}`,
      "X-Workspace-Origin": origin,
      "X-Workspace-Host": "127.0.0.1:3001",
    },
    body: raceBytes,
  });
  if (!raceUpload.ok) throw new Error("Correction/approval race upload failed");
  const raceId = (await raceUpload.json()).id as string;
  type RaceInvoice = {
    status: string;
    hash: string;
    state: {
      review: string;
      fields: Record<string, unknown>;
      history: { reason?: string }[];
      evaluation?: { decision: string; inputs?: { invoiceNumber: string } };
    };
  };
  let raceInvoice: RaceInvoice | undefined;
  for (let attempt = 0; attempt < 240; attempt++) {
    const currentRace = (await (
      await fetch(`http://127.0.0.1:4510/v1/invoices/${raceId}`, { headers })
    ).json()) as RaceInvoice;
    raceInvoice = currentRace;
    if (currentRace.status === "completed") break;
    if (currentRace.status === "failed")
      throw new Error("Correction/approval race fixture failed to process");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (
    !raceInvoice ||
    raceInvoice.status !== "completed" ||
    raceInvoice.state.evaluation?.decision !== "READY_FOR_APPROVAL"
  )
    throw new Error("Correction/approval race fixture was not approvable");
  const correctionRequest = fetch(
    `http://127.0.0.1:4510/v1/invoices/${raceId}/reviews`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "correct",
        reason: "Concurrent correction must invalidate approval inputs",
        fields: {
          ...raceInvoice.state.fields,
          invoiceNumber: `${raceNumber}-CORRECTED`,
        },
      }),
    },
  );
  const approvalRequest = fetch(
    `http://127.0.0.1:4510/v1/invoices/${raceId}/reviews`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "approve",
        reason: "Concurrent approval must use current invoice revision",
      }),
    },
  );
  const raceResponses = await Promise.all([correctionRequest, approvalRequest]);
  if (
    raceResponses.filter((x) => x.status === 202).length !== 1 ||
    raceResponses.filter((x) => x.status === 409).length !== 1
  )
    throw new Error(
      `Concurrent correction and approval were not serialized: ${raceResponses.map((x) => x.status).join(",")}`,
    );
  const acceptedAction =
    raceResponses[0].status === 202 ? "correct" : "approve";
  let finalRace: RaceInvoice | undefined;
  for (let attempt = 0; attempt < 240; attempt++) {
    const currentRace = (await (
      await fetch(`http://127.0.0.1:4510/v1/invoices/${raceId}`, { headers })
    ).json()) as RaceInvoice;
    finalRace = currentRace;
    if (
      acceptedAction === "correct"
        ? currentRace.status === "completed"
        : currentRace.state.review === "approved"
    )
      break;
    if (currentRace.status === "failed")
      throw new Error("Winning correction/approval operation failed");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (acceptedAction === "correct") {
    if (!finalRace)
      throw new Error("Concurrent correction result did not persist");
    if (
      finalRace.state.review !== "pending" ||
      finalRace.state.fields.invoiceNumber !== `${raceNumber}-CORRECTED` ||
      finalRace.state.evaluation?.inputs?.invoiceNumber !==
        `${raceNumber}-CORRECTED`
    )
      throw new Error(
        "Concurrent approval used obsolete fields after correction won",
      );
  } else if (finalRace?.state.review !== "approved") {
    throw new Error(
      "Concurrent approval did not reach its authoritative final state",
    );
  }
  const raceDb = new Pool({
    connectionString: urls.decision,
    max: 1,
  });
  try {
    const raceCommitmentCount = await raceDb.query(
      "SELECT count(*)::int AS n FROM commitments WHERE invoice_id=$1 AND kind IN ('reservation','approval')",
      [raceId],
    );
    if (raceCommitmentCount.rows[0].n !== 1)
      throw new Error(
        "Concurrent correction/approval left a missing or duplicate commitment",
      );
  } finally {
    await raceDb.end();
  }
  console.log(
    `Correction/approval race passed: ${acceptedAction} won the serialized revision transition and one matching commitment remains.`,
  );
}

async function stop(exitCode?: number) {
  if (stopping) return;
  stopping = true;
  readiness.close();
  const exits = children.map((child) =>
    child.exitCode === null ? once(child, "exit") : Promise.resolve(),
  );
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(exits);
  await server.stop().catch(() => {});
  await rm(directory, { recursive: true, force: true });
  if (exitCode !== undefined) process.exitCode = exitCode;
}
process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));
process.on("uncaughtException", (error) => {
  console.error(error);
  void stop(1);
});
try {
  await bootstrap();
  await new Promise<void>((resolve) =>
    readiness.listen(4499, "127.0.0.1", resolve),
  );
  await new Promise<void>(() => {
    for (const child of children)
      child.on("exit", (code) => {
        if (!stopping) {
          console.error(`E2E child exited unexpectedly: ${code}`);
          void stop(code ?? 1);
        }
      });
  });
} catch (error) {
  console.error(error);
  await stop(1);
}
