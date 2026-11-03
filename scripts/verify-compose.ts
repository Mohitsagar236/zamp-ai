import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const base = (process.argv[2] ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const email = process.env.INVOICELENS_ADMIN_EMAIL;
const password = process.env.INVOICELENS_ADMIN_PASSWORD;
if (!email || !password)
  throw new Error("Set INVOICELENS_ADMIN_EMAIL and INVOICELENS_ADMIN_PASSWORD");
const origin = base;

async function signIn() {
  const response = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok)
    throw new Error(
      `Sign-in failed: ${response.status} ${await response.text()}`,
    );
  const cookies = response.headers.getSetCookie?.() ?? [];
  const cookie = cookies.map((item) => item.split(";")[0]).join("; ");
  if (!cookie) throw new Error("Sign-in did not issue a session cookie");
  return cookie;
}

async function json(path: string, cookie: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  return { response, value: await response.json().catch(() => ({})) };
}

async function waitForInvoice(id: string, cookie: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const { response, value } = await json(`/api/invoices/${id}`, cookie);
    if (!response.ok)
      throw new Error(`Invoice read failed: ${response.status}`);
    if (value.status === "completed" || value.status === "failed") return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Invoice ${id} did not finish within 150 seconds`);
}

async function uploadSample(filename: string, cookie: string) {
  const bytes = await readFile(resolve("public/samples", filename));
  const form = new FormData();
  form.set("file", new Blob([bytes]), filename);
  const response = await fetch(`${base}/api/invoices`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Idempotency-Key": `compose-smoke:${filename}:${createHash("sha256").update(bytes).digest("hex")}`,
    },
    body: form,
  });
  if (!response.ok)
    throw new Error(
      `Upload ${filename} failed: ${response.status} ${await response.text()}`,
    );
  return { id: (await response.json()).id as string, bytes };
}

async function approve(id: string, cookie: string, reason: string) {
  const { response, value } = await json(`/api/invoices/${id}/review`, cookie, {
    method: "POST",
    body: JSON.stringify({ action: "approve", reason }),
  });
  return { response, value };
}

async function assertPrivateDocument(
  id: string,
  hash: string,
  cookie: string,
  expected?: Uint8Array,
) {
  const response = await fetch(`${base}/api/invoices/${id}/document`, {
    headers: { Cookie: cookie },
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/pdf") ||
    !response.headers.get("cache-control")?.includes("no-store")
  )
    throw new Error(
      `Private document response was not safely served: ${response.status}`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== hash)
    throw new Error("Stored document hash differs from the invoice record");
  if (
    expected &&
    createHash("sha256").update(bytes).digest("hex") !==
      createHash("sha256").update(expected).digest("hex")
  )
    throw new Error("Stored document bytes differ from uploaded source");
}

const cookie = await signIn();
if (process.env.INVOICELENS_VERIFY_RECOVERY_ID) {
  const recovered = await waitForInvoice(
    process.env.INVOICELENS_VERIFY_RECOVERY_ID,
    cookie,
  );
  if (
    recovered.status !== "completed" ||
    recovered.state.evaluation?.decision !== "BLOCKED" ||
    !recovered.state.evaluation?.duplicateOf
  )
    throw new Error(
      "Restored queued job failed to recover as the expected blocked duplicate",
    );
  await assertPrivateDocument(recovered.id, recovered.hash, cookie);
}
const health = await fetch(`${base}/api/health`, {
  headers: { Cookie: cookie },
});
if (!health.ok) throw new Error(`Gateway readiness failed: ${health.status}`);
const readiness = await health.json();

const resumeIds = (process.env.INVOICELENS_VERIFY_INVOICE_IDS ?? "")
  .split(",")
  .filter(Boolean);
if (resumeIds.length) {
  for (const id of resumeIds) {
    const invoice = await waitForInvoice(id, cookie);
    if (invoice.state.review !== "approved")
      throw new Error(`Invoice ${id} did not retain approval after restart`);
    if (
      !invoice.state.history.some(
        (item: { reason?: string }) =>
          item.reason === "Compose readiness smoke approval" ||
          item.reason === "Compose OCR smoke approval",
      )
    )
      throw new Error(`Invoice ${id} lost reviewer history after restart`);
    await assertPrivateDocument(id, invoice.hash, cookie);
  }
  console.log(
    JSON.stringify({ persistence: "verified", invoices: resumeIds.length }),
  );
} else {
  const ids: string[] = [];
  const text = await uploadSample("happy-path.pdf", cookie);
  let textInvoice = await waitForInvoice(text.id, cookie);
  if (readiness.sourceVerificationRequired) {
    const held = await approve(
      text.id,
      cookie,
      "Unverified digital invoice must be held",
    );
    if (held.response.status !== 409)
      throw new Error("Production accepted an unverified digital invoice");
    const checked = await json(`/api/invoices/${text.id}/review`, cookie, {
      method: "POST",
      body: JSON.stringify({
        action: "correct",
        reason:
          "Checked invoice values, item details and tax against the original synthetic PDF",
        fields: textInvoice.state.fields,
        verifiedExtraction: true,
      }),
    });
    if (checked.response.status !== 202)
      throw new Error("Digital source verification was not accepted");
    textInvoice = await waitForInvoice(text.id, cookie);
  }
  if (
    textInvoice.status !== "completed" ||
    textInvoice.state.evaluation?.decision !== "READY_FOR_APPROVAL" ||
    textInvoice.state.extraction?.provider !== "PDF.js text"
  )
    throw new Error(
      "PDF.js processing did not produce the expected synthetic recommendation",
    );
  await assertPrivateDocument(text.id, textInvoice.hash, cookie, text.bytes);
  const textReview = await approve(
    text.id,
    cookie,
    "Compose readiness smoke approval",
  );
  if (textReview.response.status !== 202)
    throw new Error(
      `Synthetic text invoice review was not queued: ${textReview.response.status}`,
    );
  const textFinal = await waitForInvoice(text.id, cookie);
  if (textFinal.state.review !== "approved")
    throw new Error("Synthetic text invoice was not approved");
  ids.push(text.id);

  const scan = await uploadSample("scan-missing-total.pdf", cookie);
  const scanInvoice = await waitForInvoice(scan.id, cookie);
  if (
    scanInvoice.status !== "completed" ||
    !scanInvoice.state.extraction?.provider.includes("Tesseract") ||
    scanInvoice.state.fields.total !== null ||
    scanInvoice.state.evaluation?.decision !== "NEEDS_REVIEW"
  )
    throw new Error("Scanned PDF did not exercise the OCR review gate");
  const denied = await approve(
    scan.id,
    cookie,
    "Attempt approval before checking OCR values",
  );
  if (denied.response.status !== 409)
    throw new Error("Unverified OCR invoice was not held for review");
  const corrected = await json(`/api/invoices/${scan.id}/review`, cookie, {
    method: "POST",
    body: JSON.stringify({
      action: "correct",
      reason: "Verified scanned total against the source document",
      fields: { ...scanInvoice.state.fields, total: "11800.00" },
      verifiedExtraction: true,
    }),
  });
  if (corrected.response.status !== 202)
    throw new Error(
      `OCR correction was not accepted: ${corrected.response.status}`,
    );
  const revised = await waitForInvoice(scan.id, cookie);
  if (
    revised.state.evaluation?.decision !== "READY_FOR_APPROVAL" ||
    revised.state.fields.total !== "11800.00"
  )
    throw new Error(
      "OCR correction did not produce a current ready recommendation",
    );
  const scanReview = await approve(
    scan.id,
    cookie,
    "Compose OCR smoke approval",
  );
  if (scanReview.response.status !== 202)
    throw new Error(
      `Verified OCR review was not queued: ${scanReview.response.status}`,
    );
  const scanFinal = await waitForInvoice(scan.id, cookie);
  if (
    scanFinal.state.review !== "approved" ||
    !scanFinal.state.history.some(
      (item: { reason?: string }) =>
        item.reason === "Verified scanned total against the source document",
    )
  )
    throw new Error("OCR approval or correction audit did not persist");
  await assertPrivateDocument(scan.id, scanFinal.hash, cookie, scan.bytes);
  ids.push(scan.id);
  console.log(
    JSON.stringify({
      invoices: ids,
      textExtraction: "PDF.js text",
      scannedExtraction: "Tesseract OCR",
      reviewGate: "verified",
      privateDocuments: "hash matched",
    }),
  );
}
