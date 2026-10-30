import "dotenv/config";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
const user = "verification",
  password = randomUUID(),
  url = "http://127.0.0.1:3002";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3002",
  ],
  {
    env: {
      ...process.env,
      APP_URL: url,
      APP_ENV: "production",
      AUTH_MODE: "basic",
      WORKSPACE_USER: user,
      WORKSPACE_PASSWORD: password,
    },
    stdio: "ignore",
  },
);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url + "/api/health");
      if (r.status === 401) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw Error("Authentication verification server did not start");
  const headers = {
    Authorization:
      "Basic " + Buffer.from(user + ":" + password).toString("base64"),
  };
  const home = await fetch(url);
  if (home.status !== 401) throw Error("Page is not protected");
  const list = await fetch(url + "/api/invoices", { headers });
  if (!list.ok) throw Error("Valid workspace credential rejected");
  const invoices = await list.json();
  if (!invoices.length) throw Error("Upload a demo invoice before auth check");
  const document = url + "/api/invoices/" + invoices[0].id + "/document";
  if ((await fetch(document)).status !== 401)
    throw Error("Unauthorized original PDF was exposed");
  if ((await fetch(document, { headers })).status !== 200)
    throw Error("Authorized PDF unavailable");
  const cross = await fetch(
    url + "/api/invoices/" + invoices[0].id + "/review",
    {
      method: "POST",
      headers: {
        ...headers,
        Origin: "http://evil.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "reject",
        reason: "This cross-origin request must be denied",
      }),
    },
  );
  if (cross.status !== 403) throw Error("Cross-origin mutation accepted");
  console.log(
    "PASS: page and document authorization; valid credential access; cross-origin mutation denied.",
  );
} finally {
  child.kill("SIGTERM");
}
