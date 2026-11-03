"use client";
import { useState } from "react";
import { PageTitle } from "@/components/invoice-ui/ui";

type ImportRow = {
  row: number;
  type: string;
  id: string;
  status: string;
  message?: string;
};
type Preview = {
  rowCount: number;
  createCount: number;
  skippedCount: number;
  rows: ImportRow[];
  errors: { row: number; code: string; message: string }[];
  expiresAt?: string;
  imported?: number;
  skipped?: number;
};
const columns = [
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
const cell = (value: unknown) =>
  `"${String(value ?? "").replaceAll('"', '""')}"`;
function makeCsv(type: string, values: Record<string, FormDataEntryValue>) {
  const row: Record<string, unknown> = { record_type: type };
  for (const key of columns.slice(1)) row[key] = values[key] ?? "";
  return [
    columns.map(cell).join(","),
    columns.map((key) => cell(row[key])).join(","),
  ].join("\r\n");
}

export default function ReferenceAdmin() {
  const [csv, setCsv] = useState(""),
    [previewId, setPreviewId] = useState(""),
    [result, setResult] = useState<Preview | null>(null),
    [recordType, setRecordType] = useState("vendor"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function preview(source = csv, id = previewId) {
    if (!source) return;
    const nextId = id || crypto.randomUUID();
    setPreviewId(nextId);
    setCsv(source);
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/references/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "preview", previewId: nextId, csv: source }),
    });
    const data = (await response.json()) as Preview & { error?: string };
    setBusy(false);
    if (response.status !== 200 && response.status !== 422) {
      setResult(null);
      setMessage(data.error ?? "Preview could not be prepared.");
      return;
    }
    setResult(data);
  }
  async function single(data: FormData) {
    await preview(makeCsv(recordType, Object.fromEntries(data.entries())), "");
  }
  async function commit() {
    if (!result || result.errors.length || !previewId) return;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/references/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "commit", previewId, csv }),
    });
    const data = (await response.json()) as Preview & { error?: string };
    setBusy(false);
    if (!response.ok) {
      if (data.errors) setResult(data);
      else setMessage(data.error ?? "Import was not committed.");
      return;
    }
    setResult(data);
    setMessage(
      `Import committed: ${data.imported ?? 0} created, ${data.skipped ?? 0} identical rows skipped.`,
    );
  }
  const fields: Record<
    string,
    {
      name: string;
      label: string;
      type?: string;
      default?: string;
      placeholder?: string;
    }[]
  > = {
    vendor: [
      { label: "Stable vendor ID", name: "id" },
      { label: "Vendor name", name: "name" },
      { label: "Tax or reference ID", name: "identifier" },
      { label: "Aliases separated by |", name: "aliases" },
      { label: "Approved", name: "approved", type: "select", default: "true" },
    ],
    po: [
      { label: "Stable PO ID", name: "id" },
      { label: "Vendor ID", name: "vendor_id" },
      { label: "Currency", name: "currency", placeholder: "INR" },
      {
        label: "Limit in minor units",
        name: "limit_minor",
        placeholder: "10000000",
      },
      { label: "Status", name: "status", type: "select", default: "open" },
      { label: "Description", name: "description" },
    ],
    opening_commitment: [
      { label: "Stable source ID", name: "id" },
      { label: "Vendor ID", name: "vendor_id" },
      { label: "PO ID", name: "po_id" },
      { label: "Invoice number", name: "invoice_number" },
      { label: "Committed amount in minor units", name: "amount_minor" },
      { label: "Label", name: "label" },
    ],
  };
  return (
    <section className="page-content mt-6">
      <PageTitle
        title="Manage reference data"
        description="Add records through a validated preview. Each accepted import commits in one Decision service transaction."
      />
      <div className="card p-5">
        <h2 className="font-semibold">Create one record</h2>
        <p className="mt-1 text-sm text-slate-600">
          A single record follows the same preview and commit checks as a CSV
          import.
        </p>
        <form action={single} className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Record type
            <select
              value={recordType}
              onChange={(e) => setRecordType(e.target.value)}
              className="mt-1 w-full rounded border p-2"
            >
              <option value="vendor">Vendor</option>
              <option value="po">Purchase order</option>
              <option value="opening_commitment">Opening commitment</option>
            </select>
          </label>
          <div />
          {fields[recordType].map((field) => (
            <label key={field.name} className="text-sm">
              {field.label}
              {field.type === "select" ? (
                <select
                  name={field.name}
                  defaultValue={field.default}
                  className="mt-1 w-full rounded border p-2"
                >
                  {(field.name === "approved"
                    ? [
                        ["true", "Approved"],
                        ["false", "Blocked"],
                      ]
                    : [
                        ["open", "Open"],
                        ["closed", "Closed"],
                        ["blocked", "Blocked"],
                      ]
                  ).map(([value, title]) => (
                    <option key={value} value={value}>
                      {title}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  name={field.name}
                  placeholder={field.placeholder}
                  className="mt-1 w-full rounded border p-2"
                />
              )}
            </label>
          ))}
          <button disabled={busy} className="button md:col-span-2">
            Preview record
          </button>
        </form>
      </div>
      <div className="card mt-5 p-5">
        <h2 className="font-semibold">CSV import</h2>
        <p className="mt-1 text-sm text-slate-600">
          Supported rows: vendor, po, opening_commitment. Existing identical
          rows are skipped. Conflicts stop the whole batch.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            className="button button-secondary"
            href="/templates/reference-import.csv"
            download
          >
            Download CSV template
          </a>
          <label className="button button-secondary">
            Choose CSV
            <input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.currentTarget.files?.[0];
                if (file && file.size > 2_000_000) {
                  setMessage("CSV must be 2 MB or smaller.");
                  return;
                }
                if (file) await preview(await file.text(), "");
              }}
            />
          </label>
        </div>
      </div>
      {message && (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      )}
      {result && (
        <div className="card mt-5 overflow-x-auto p-5">
          <h2 className="font-semibold">Import preview</h2>
          <p className="mt-1 text-sm text-slate-600">
            {result.rowCount} parsed rows · {result.createCount} new ·{" "}
            {result.skippedCount} identical existing rows ·{" "}
            {result.errors.length} errors. Preview expires in 15 minutes.
          </p>
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr>
                <th className="p-2">Row</th>
                <th className="p-2">Record</th>
                <th className="p-2">ID</th>
                <th className="p-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={`${r.row}:${r.type}:${r.id}`} className="border-t">
                  <td className="p-2">{r.row}</td>
                  <td className="p-2">{r.type}</td>
                  <td className="p-2">{r.id}</td>
                  <td className="p-2">{r.message ?? r.status}</td>
                </tr>
              ))}
              {result.errors.map((e) => (
                <tr
                  key={`${e.row}:${e.code}`}
                  className="border-t text-red-700"
                >
                  <td className="p-2">{e.row}</td>
                  <td className="p-2">{e.code}</td>
                  <td className="p-2">—</td>
                  <td className="p-2">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.imported && (
            <button
              disabled={
                busy || result.errors.length > 0 || result.createCount === 0
              }
              onClick={() => void commit()}
              className="button mt-4"
            >
              {busy ? "Working…" : "Commit import"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
