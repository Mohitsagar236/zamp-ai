/** Populate only an empty disposable loopback verification stack with authored fixtures. */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3180");
if (
  process.env.INVOICELENS_VALIDATION_DATA !== "synthetic-isolated-only" ||
  !["127.0.0.1", "localhost"].includes(base.hostname) ||
  !["3180", "3181"].includes(base.port) ||
  base.protocol !== "http:"
)
  throw new Error(
    "Requires INVOICELENS_VALIDATION_DATA=synthetic-isolated-only and a disposable loopback stack on port 3180 or 3181",
  );
const email = process.env.INVOICELENS_ADMIN_EMAIL,
  password = process.env.INVOICELENS_ADMIN_PASSWORD;
if (!email || !password)
  throw new Error(
    "Set validation administrator credentials in environment variables",
  );
const signed = await fetch(new URL("/api/auth/sign-in/email", base), {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base.origin },
  body: JSON.stringify({ email, password }),
});
if (!signed.ok) throw new Error(`Validation sign-in failed: ${signed.status}`);
const cookie = signed.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
const request = async (path: string, body?: unknown) => {
  const response = await fetch(new URL(path, base), {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: base.origin,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `Validation request ${path} failed: ${response.status} ${JSON.stringify(result)}`,
    );
  return result;
};
const invoices = await request("/api/invoices");
const references = await request("/api/references");
if (
  !Array.isArray(invoices) ||
  invoices.length ||
  references.vendors.length ||
  references.pos.length ||
  references.commitments.length
)
  throw new Error("Refusing to populate a nonempty workspace");
const fixture = JSON.parse(
  await readFile("public/samples/reference-records.json", "utf8"),
) as {
  vendors: {
    id: string;
    name: string;
    identifier: string;
    aliases: string[];
    approved: boolean;
  }[];
  pos: {
    id: string;
    vendorId: string;
    currency: string;
    limitMinor: string;
    status: string;
    description: string;
  }[];
  commitments: {
    invoiceId: string;
    poId: string;
    vendorId: string;
    amountMinor: string;
    label: string;
  }[];
};
const headers = [
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
const rows: Record<string, string>[] = [
  ...fixture.vendors.map((v) => ({
    record_type: "vendor",
    id: v.id,
    name: v.name,
    identifier: v.identifier,
    aliases: v.aliases.join("|"),
    approved: String(v.approved),
  })),
  ...fixture.pos.map((p) => ({
    record_type: "po",
    id: p.id,
    vendor_id: p.vendorId,
    currency: p.currency,
    limit_minor: p.limitMinor,
    status: p.status,
    description: p.description,
  })),
  ...fixture.commitments.map((c) => ({
    record_type: "opening_commitment",
    id: c.invoiceId,
    vendor_id: c.vendorId,
    po_id: c.poId,
    invoice_number: "HIST-001",
    amount_minor: c.amountMinor,
    label: c.label,
  })),
];
const csv = [
  headers,
  ...rows.map((row) => headers.map((key) => row[key] ?? "")),
]
  .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(","))
  .join("\r\n");
const previewId = `validation-${randomUUID()}`;
await request("/api/references/import", { mode: "preview", previewId, csv });
await request("/api/references/import", { mode: "commit", previewId, csv });
console.log(
  JSON.stringify({
    syntheticReferences: "provisioned through authenticated preview/commit",
    vendors: fixture.vendors.length,
    pos: fixture.pos.length,
    openingCommitments: fixture.commitments.length,
  }),
);
