import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { Pool, PoolClient } from "pg";
import { pool, transaction } from "./db.js";
import { normalize } from "./money.js";

type VendorRow = {
  row: number;
  type: "vendor";
  id: string;
  name: string;
  identifier: string;
  aliases: string[];
  approved: boolean;
};
type PoRow = {
  row: number;
  type: "po";
  id: string;
  vendorId: string;
  currency: string;
  limitMinor: string;
  status: "open" | "closed" | "blocked";
  description: string;
};
type OpeningRow = {
  row: number;
  type: "opening_commitment";
  id: string;
  vendorId: string;
  poId: string;
  invoiceNumber: string;
  amountMinor: string;
  label: string;
};
type ImportRow = VendorRow | PoRow | OpeningRow;
type Issue = { row: number; code: string; message: string };
type Db = Pick<Pool, "query"> | Pick<PoolClient, "query">;
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
  "amount_minor",
  "label",
];
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const currencies = new Set(["INR", "USD", "EUR", "GBP", "JPY", "KWD"]);

function parseRows(csv: string): { rows: ImportRow[]; errors: Issue[] } {
  const errors: Issue[] = [];
  let values: Record<string, string>[];
  try {
    values = parse(csv, {
      bom: true,
      columns: (columns: string[]) => {
        if (
          new Set(columns).size !== columns.length ||
          columns.some((name) => !headers.includes(name) && name !== "po_id") ||
          headers.some((name) => !columns.includes(name))
        )
          throw new Error(
            "CSV columns must match the template, without duplicate or unknown headers",
          );
        return columns;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
      max_record_size: 20000,
    }) as Record<string, string>[];
  } catch {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          code: "invalid_csv",
          message: "CSV quoting or column counts are invalid.",
        },
      ],
    };
  }
  if (!values.length)
    return {
      rows: [],
      errors: [
        { row: 1, code: "empty_csv", message: "CSV contains no data rows." },
      ],
    };
  const rows: ImportRow[] = [];
  const seen = new Map<string, number>();
  values.forEach((v, index) => {
    const rowNumber = index + 2;
    const type = v.record_type;
    const id = v.id ?? "";
    if (!idPattern.test(id)) {
      errors.push({
        row: rowNumber,
        code: "invalid_id",
        message:
          "Provide a stable ID using letters, numbers, dot, underscore, colon or hyphen (up to 80 characters).",
      });
      return;
    }
    if (type !== "vendor" && type !== "po" && type !== "opening_commitment") {
      errors.push({
        row: rowNumber,
        code: "invalid_record_type",
        message: "record_type must be vendor, po or opening_commitment.",
      });
      return;
    }
    const compound = `${type}:${id}`;
    if (seen.has(compound)) {
      errors.push({
        row: rowNumber,
        code: "duplicate_id_in_file",
        message: `ID repeats row ${seen.get(compound)} in this file.`,
      });
      return;
    }
    seen.set(compound, rowNumber);
    if (type === "vendor") {
      const aliasMap = new Map(
        (v.aliases ?? "")
          .split("|")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((x) => [normalize(x), x]),
      );
      const aliases = [...aliasMap.values()];
      if (
        !v.name ||
        v.name.length > 200 ||
        !v.identifier ||
        v.identifier.length > 100 ||
        !["true", "false"].includes((v.approved ?? "").toLowerCase())
      ) {
        errors.push({
          row: rowNumber,
          code: "invalid_vendor",
          message:
            "Vendor needs a name, tax/reference identifier and approved=true or false.",
        });
        return;
      }
      rows.push({
        row: rowNumber,
        type,
        id,
        name: v.name,
        identifier: v.identifier,
        aliases: [...new Set(aliases)],
        approved: v.approved.toLowerCase() === "true",
      });
    } else if (type === "po") {
      if (
        !id ||
        !idPattern.test(v.vendor_id ?? "") ||
        !currencies.has(v.currency ?? "") ||
        !/^\d{1,15}$/.test(v.limit_minor ?? "") ||
        !["open", "closed", "blocked"].includes(v.status ?? "") ||
        !v.description
      ) {
        errors.push({
          row: rowNumber,
          code: "invalid_po",
          message:
            "PO needs vendor_id, a supported currency, nonnegative limit_minor, open/closed/blocked status and description.",
        });
        return;
      }
      rows.push({
        row: rowNumber,
        type,
        id,
        vendorId: v.vendor_id,
        currency: v.currency,
        limitMinor: v.limit_minor,
        status: v.status as PoRow["status"],
        description: v.description,
      });
    } else {
      if (
        !idPattern.test(v.vendor_id ?? "") ||
        !idPattern.test(v.po_id ?? "") ||
        !v.invoice_number ||
        v.invoice_number.length > 120 ||
        !/^\d{1,15}$/.test(v.amount_minor ?? "") ||
        BigInt(v.amount_minor || "0") <= 0n ||
        !v.label
      ) {
        errors.push({
          row: rowNumber,
          code: "invalid_opening_commitment",
          message:
            "Opening commitment needs vendor_id, po_id, invoice_number, positive amount_minor and label.",
        });
        return;
      }
      rows.push({
        row: rowNumber,
        type,
        id,
        vendorId: v.vendor_id,
        poId: v.po_id,
        invoiceNumber: v.invoice_number,
        amountMinor: v.amount_minor,
        label: v.label,
      });
    }
  });
  return { rows, errors };
}

async function validateAgainstDb(db: Db, csv: string) {
  const parsed = parseRows(csv);
  const errors = [...parsed.errors];
  const outcomes: {
    row: number;
    type: string;
    id: string;
    status: "create" | "skip" | "invalid";
    message?: string;
  }[] = [];
  const newVendors = new Map<string, VendorRow>();
  const newPos = new Map<string, PoRow>();
  const namesInFile = new Set<string>();
  for (const row of parsed.rows) {
    if (row.type === "vendor") {
      const key = normalize(row.identifier);
      if (namesInFile.has(`identifier:${key}`))
        errors.push({
          row: row.row,
          code: "duplicate_identifier_in_file",
          message: "Vendor identifier repeats in this file.",
        });
      namesInFile.add(`identifier:${key}`);
      newVendors.set(row.id, row);
    }
    if (row.type === "po") newPos.set(row.id, row);
  }
  for (const row of parsed.rows) {
    try {
      if (row.type === "vendor") {
        const q = await db.query(
          "SELECT id,name,identifier,aliases,approved FROM vendors WHERE id=$1 OR identifier=$2",
          [row.id, row.identifier],
        );
        const current = q.rows.find((x) => x.id === row.id);
        const conflict = q.rows.find((x) => x.id !== row.id);
        if (conflict)
          errors.push({
            row: row.row,
            code: "vendor_identifier_exists",
            message: `Identifier already belongs to vendor ${conflict.id}.`,
          });
        else if (current) {
          const same =
            current.name === row.name &&
            current.identifier === row.identifier &&
            JSON.stringify(current.aliases) === JSON.stringify(row.aliases) &&
            current.approved === row.approved;
          if (same)
            outcomes.push({
              row: row.row,
              type: row.type,
              id: row.id,
              status: "skip",
              message: "Exact existing row; skipped.",
            });
          else
            errors.push({
              row: row.row,
              code: "vendor_id_conflict",
              message:
                "Vendor ID exists with different details; import does not overwrite records.",
            });
        }
      } else if (row.type === "po") {
        const vendor =
          newVendors.get(row.vendorId) ??
          (
            await db.query("SELECT id,approved FROM vendors WHERE id=$1", [
              row.vendorId,
            ])
          ).rows[0];
        if (!vendor)
          errors.push({
            row: row.row,
            code: "unknown_vendor",
            message: `Vendor ${row.vendorId} is not in this import or the reference database.`,
          });
        const q = await db.query(
          "SELECT vendor_id,currency,status,limit_minor::text AS limit_minor,description FROM purchase_orders WHERE id=$1",
          [row.id],
        );
        if (q.rowCount) {
          const old = q.rows[0];
          if (
            old.vendor_id === row.vendorId &&
            old.currency === row.currency &&
            old.status === row.status &&
            old.limit_minor === row.limitMinor &&
            old.description === row.description
          )
            outcomes.push({
              row: row.row,
              type: row.type,
              id: row.id,
              status: "skip",
              message: "Exact existing row; skipped.",
            });
          else
            errors.push({
              row: row.row,
              code: "po_id_conflict",
              message:
                "PO ID exists with different details; import does not overwrite records or commitments.",
            });
        }
      } else {
        const vendor =
          newVendors.get(row.vendorId) ??
          (await db.query("SELECT id FROM vendors WHERE id=$1", [row.vendorId]))
            .rows[0];
        const po =
          newPos.get(row.poId) ??
          (
            await db.query(
              "SELECT id,vendor_id FROM purchase_orders WHERE id=$1",
              [row.poId],
            )
          ).rows[0];
        const vendorId = po?.vendorId ?? po?.vendor_id;
        if (!vendor)
          errors.push({
            row: row.row,
            code: "unknown_vendor",
            message: `Vendor ${row.vendorId} is not in this import or the reference database.`,
          });
        if (!po)
          errors.push({
            row: row.row,
            code: "unknown_po",
            message: `PO ${row.poId} is not in this import or the reference database.`,
          });
        else if (vendorId !== row.vendorId)
          errors.push({
            row: row.row,
            code: "po_vendor_mismatch",
            message: "Opening commitment vendor does not match the PO vendor.",
          });
        const openingId = `opening:${row.id}`;
        const old = await db.query(
          "SELECT po_id,vendor_id,amount_minor::text AS amount_minor,label,kind,fields->>'invoiceNumber' AS invoice_number FROM decision_records LEFT JOIN commitments USING(invoice_id) WHERE invoice_id=$1",
          [openingId],
        );
        if (old.rowCount) {
          const o = old.rows[0];
          if (
            o.kind === "opening" &&
            o.po_id === row.poId &&
            o.vendor_id === row.vendorId &&
            o.amount_minor === row.amountMinor &&
            o.label === row.label &&
            normalize(o.invoice_number ?? "") === normalize(row.invoiceNumber)
          )
            outcomes.push({
              row: row.row,
              type: row.type,
              id: row.id,
              status: "skip",
              message: "Exact existing opening commitment; skipped.",
            });
          else
            errors.push({
              row: row.row,
              code: "opening_id_conflict",
              message: "Opening commitment ID exists with different details.",
            });
        } else {
          const businessKey = `${row.vendorId}:${normalize(row.invoiceNumber)}`;
          const duplicate = await db.query(
            "SELECT invoice_id FROM business_claims WHERE business_key=$1",
            [businessKey],
          );
          if (duplicate.rowCount)
            errors.push({
              row: row.row,
              code: "opening_invoice_exists",
              message: `Invoice identity is already claimed by ${duplicate.rows[0].invoice_id}.`,
            });
        }
      }
    } catch {
      errors.push({
        row: row.row,
        code: "validation_unavailable",
        message: "Could not validate this row against current reference data.",
      });
    }
  }
  const existingOutcome = new Set(outcomes.map((x) => `${x.type}:${x.id}`));
  for (const row of parsed.rows) {
    const invalid = errors.some((e) => e.row === row.row);
    if (invalid)
      outcomes.push({
        row: row.row,
        type: row.type,
        id: row.id,
        status: "invalid",
      });
    else if (!existingOutcome.has(`${row.type}:${row.id}`))
      outcomes.push({
        row: row.row,
        type: row.type,
        id: row.id,
        status: "create",
      });
  }
  return {
    rows: outcomes.sort((a, b) => a.row - b.row),
    errors,
    rowCount: parsed.rows.length,
    createCount: outcomes.filter((x) => x.status === "create").length,
    skippedCount: outcomes.filter((x) => x.status === "skip").length,
  };
}

export async function importReferences(input: {
  mode: "preview" | "commit";
  previewId: string;
  csv: string;
  actorId: string;
}) {
  if (
    input.csv.length > 2_000_000 ||
    input.previewId.length > 100 ||
    !input.actorId
  )
    return {
      status: 400,
      body: { error: "Import exceeds limits or is missing its identity." },
    };
  const fingerprint = createHash("sha256").update(input.csv).digest("hex");
  if (input.mode === "preview") {
    const result = await validateAgainstDb(pool, input.csv);
    const old = await pool.query(
      "SELECT actor_id,fingerprint FROM reference_import_previews WHERE preview_id=$1",
      [input.previewId],
    );
    if (
      old.rowCount &&
      (old.rows[0].actor_id !== input.actorId ||
        old.rows[0].fingerprint !== fingerprint)
    )
      return {
        status: 409,
        body: { error: "Preview ID is already bound to another user or CSV." },
      };
    await pool.query(
      "INSERT INTO reference_import_previews(preview_id,fingerprint,actor_id,result,expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes') ON CONFLICT(preview_id) DO UPDATE SET result=excluded.result,expires_at=excluded.expires_at",
      [input.previewId, fingerprint, input.actorId, JSON.stringify(result)],
    );
    return {
      status: result.errors.length ? 422 : 200,
      body: {
        ...result,
        fingerprint,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
    };
  }
  return transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(715031)");
    const prior = await c.query(
      "SELECT fingerprint,actor_id,response FROM reference_import_operations WHERE import_id=$1",
      [input.previewId],
    );
    if (prior.rowCount) {
      if (
        prior.rows[0].fingerprint !== fingerprint ||
        prior.rows[0].actor_id !== input.actorId
      )
        return {
          status: 409,
          body: {
            error: "Import ID was reused with different content or identity.",
          },
        };
      return { status: 200, body: prior.rows[0].response };
    }
    const preview = await c.query(
      "SELECT fingerprint,actor_id FROM reference_import_previews WHERE preview_id=$1 AND expires_at>now()",
      [input.previewId],
    );
    if (
      !preview.rowCount ||
      preview.rows[0].fingerprint !== fingerprint ||
      preview.rows[0].actor_id !== input.actorId
    )
      return {
        status: 409,
        body: {
          error: "Run a fresh preview as this administrator before committing.",
        },
      };
    const result = await validateAgainstDb(c, input.csv);
    if (result.errors.length)
      return { status: 422, body: { ...result, fingerprint } };
    const parsed = parseRows(input.csv).rows;
    const skipped = new Set(
      result.rows
        .filter((x) => x.status === "skip")
        .map((x) => `${x.type}:${x.id}`),
    );
    for (const row of parsed) {
      if (skipped.has(`${row.type}:${row.id}`)) continue;
      if (row.type === "vendor") {
        await c.query(
          "INSERT INTO vendors(id,name,identifier,aliases,approved) VALUES($1,$2,$3,$4,$5)",
          [
            row.id,
            row.name,
            row.identifier,
            JSON.stringify(row.aliases),
            row.approved,
          ],
        );
      } else if (row.type === "po") {
        await c.query(
          "INSERT INTO purchase_orders(id,vendor_id,currency,status,limit_minor,description) VALUES($1,$2,$3,$4,$5,$6)",
          [
            row.id,
            row.vendorId,
            row.currency,
            row.status,
            row.limitMinor,
            row.description,
          ],
        );
      } else {
        const invoiceId = `opening:${row.id}`;
        const businessKey = `${row.vendorId}:${normalize(row.invoiceNumber)}`;
        const fields = {
          supplierName: null,
          supplierId: row.vendorId,
          invoiceNumber: row.invoiceNumber,
          invoiceDate: null,
          poReference: row.poId,
          currency: null,
          subtotal: null,
          tax: null,
          total: null,
          lineItems: [],
        };
        const hash = createHash("sha256")
          .update(JSON.stringify(row))
          .digest("hex");
        await c.query(
          "INSERT INTO decision_records(invoice_id,content_hash,created_at,fields,selected_po,review) VALUES($1,$2,now(),$3,$4,'approved')",
          [invoiceId, hash, JSON.stringify(fields), row.poId],
        );
        await c.query(
          "INSERT INTO business_claims(business_key,invoice_id,created_at) VALUES($1,$2,now())",
          [businessKey, invoiceId],
        );
        await c.query(
          "INSERT INTO commitments(invoice_id,po_id,vendor_id,business_key,amount_minor,label,kind) VALUES($1,$2,$3,$4,$5,$6,'opening')",
          [
            invoiceId,
            row.poId,
            row.vendorId,
            businessKey,
            row.amountMinor,
            row.label,
          ],
        );
      }
      await c.query(
        "INSERT INTO reference_audit(actor_id,action,subject,details) VALUES($1,'created',$2,$3)",
        [input.actorId, `${row.type}:${row.id}`, JSON.stringify(row)],
      );
    }
    const response = {
      imported: result.createCount,
      skipped: result.skippedCount,
      rows: result.rows,
      fingerprint,
    };
    await c.query(
      "INSERT INTO reference_import_operations(import_id,fingerprint,actor_id,response) VALUES($1,$2,$3,$4)",
      [input.previewId, fingerprint, input.actorId, JSON.stringify(response)],
    );
    await c.query(
      "INSERT INTO reference_audit(actor_id,action,subject,details) VALUES($1,'import_committed',$2,$3)",
      [
        input.actorId,
        input.previewId,
        JSON.stringify({
          imported: result.createCount,
          skipped: result.skippedCount,
          fingerprint,
        }),
      ],
    );
    return { status: 200, body: response };
  });
}
