import {
  fieldsSchema,
  type Fields,
} from "../../../packages/contracts/src/index.js";
export function parseText(text: string): {
  fields: Fields;
  originalValues: Record<string, string | null>;
  warnings: string[];
} {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const warnings: string[] = [];
  const value = (labels: string[]) => {
    const found = new Set<string>();
    for (const [index, line] of lines.entries()) {
      for (const label of labels) {
        const m = line.match(
          new RegExp("^" + label + "(?:\\s*[:#]\\s*|\\s{2,})(.*)$", "i"),
        );
        if (m?.[1].trim()) found.add(m[1].trim());
        if (
          label.toLowerCase() !== "invoice" &&
          new RegExp("^" + label + "\\s*[:#]?\\s*$", "i").test(line)
        ) {
          const next = lines[index + 1];
          if (next && !/[:#|]/.test(next)) found.add(next);
        }
      }
    }
    if (found.size > 1) {
      warnings.push(`Conflicting ${labels[0]} values; verify the source.`);
      return null;
    }
    return [...found][0] ?? null;
  };
  const originalValues = {
    supplierName: value(["Supplier", "Supplier name", "Vendor"]),
    supplierId: value(["Supplier ID", "GSTIN", "Vendor ID"]),
    invoiceNumber: value([
      "Invoice number",
      "Invoice no\\.?",
      "Invoice #",
      "Invoice",
    ]),
    invoiceDate: value(["Invoice date", "Date"]),
    poReference: value([
      "PO reference",
      "Purchase order(?: number| no\\.?)?",
      "PO(?: number| no\\.?)?",
    ]),
    currency: value(["Currency"]),
    subtotal: value(["Subtotal", "Sub total"]),
    tax: value(["Total tax", "Tax", "GST", "VAT"]),
    total: value(["Total", "Grand total", "Amount due"]),
  };
  const money = (s: string | null) => {
    if (!s) return null;
    const prefix = s.match(/^(INR|USD|EUR|GBP|JPY|KWD|Rs\.?|₹|\$)/i)?.[0];
    if (prefix && originalValues.currency) {
      const code = /^(Rs\.?|₹)$/i.test(prefix)
        ? "INR"
        : prefix === "$"
          ? "USD"
          : prefix.toUpperCase();
      if (code !== originalValues.currency.toUpperCase()) {
        warnings.push(
          "Amount currency conflicts with the invoice currency; verify the source.",
        );
        return null;
      }
    }
    const v = s.replace(/^(INR|USD|EUR|GBP|JPY|KWD|Rs\.?|₹|\$)\s*/i, "").trim();
    // Only accept unambiguous plain decimals or valid Western/Indian grouping.
    // A decimal comma must never silently become a hundred-fold larger amount.
    if (
      !/^(?:\d{1,12}|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,3})?$/.test(
        v,
      )
    ) {
      warnings.push(`Unclear monetary value: ${s.slice(0, 80)}`);
      return null;
    }
    const normalized = v.replace(/,/g, "");
    if (!/^\d{1,12}(?:\.\d{1,3})?$/.test(normalized)) {
      warnings.push("Monetary value exceeds supported precision or length.");
      return null;
    }
    return normalized;
  };
  const date = originalValues.invoiceDate;
  let invoiceDate: string | null = null;
  if (date) {
    const iso = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const numeric = date.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
    const named =
      date.match(/^(\d{1,2})[ \-]([A-Za-z]+)[, \-]+(\d{4})$/) ??
      date.match(/^([A-Za-z]+) +(\d{1,2}),? +(\d{4})$/);
    let parts: number[] | undefined;
    if (iso) parts = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (numeric) {
      const a = Number(numeric[1]),
        b = Number(numeric[2]);
      if (a > 12 && b <= 12) parts = [Number(numeric[3]), b, a];
      else if (b > 12 && a <= 12) parts = [Number(numeric[3]), a, b];
      else if (a === b) parts = [Number(numeric[3]), a, b];
    } else if (named) {
      const monthToken = /^[A-Za-z]/.test(named[1]) ? named[1] : named[2];
      const months = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
      ];
      const month =
        months.findIndex(
          (m) =>
            m === monthToken.toLowerCase() ||
            m.slice(0, 3) === monthToken.toLowerCase(),
        ) + 1;
      if (month)
        parts = [
          Number(named[3]),
          month,
          Number(/^[A-Za-z]/.test(named[1]) ? named[2] : named[1]),
        ];
    }
    if (parts) {
      const [year, month, day] = parts;
      const checked = new Date(Date.UTC(year, month - 1, day));
      if (
        year >= 1000 &&
        checked.getUTCFullYear() === year &&
        checked.getUTCMonth() === month - 1 &&
        checked.getUTCDate() === day
      )
        invoiceDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (invoiceDate && !iso)
      warnings.push(
        "Invoice date was normalized from a non-ISO source; verify the source.",
      );
    if (!invoiceDate)
      warnings.push(
        "Invoice date is ambiguous or invalid; verify before approval.",
      );
  }
  let currency = originalValues.currency?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    warnings.push("Currency could not be read as an ISO currency code.");
    currency = null;
  }
  const lineItems: Fields["lineItems"] = [];
  const columns = (line: string) =>
    line
      .split(/\s*\|\s*|\t+|\s{2,}/)
      .map((cell) => cell.trim())
      .filter(Boolean);
  const aliases = {
    description: /^(description|item|item description|particulars)$/,
    quantity: /^(qty|quantity)$/,
    unitPrice: /^(unit price|unit cost|rate|price)$/,
    amount: /^(amount|total|line total|net amount)$/,
  };
  const headerColumns = (line: string) => {
    const cells = columns(line).map((cell) => cell.toLowerCase());
    const indexes = Object.fromEntries(
      Object.entries(aliases).map(([key, pattern]) => [
        key,
        cells.findIndex((cell) => pattern.test(cell)),
      ]),
    ) as Record<keyof typeof aliases, number>;
    return cells.length >= 4 &&
      Object.values(indexes).every((i) => i >= 0) &&
      cells.every(
        (cell) =>
          Object.values(aliases).some((pattern) => pattern.test(cell)) ||
          /^(sku|code|item code|no\.?)$/.test(cell),
      )
      ? { indexes, count: cells.length }
      : null;
  };
  const header = lines.findIndex((line) => headerColumns(line));
  if (header >= 0) {
    let table = headerColumns(lines[header])!;
    for (const line of lines.slice(header + 1)) {
      const repeated = headerColumns(line);
      if (repeated) {
        table = repeated;
        continue;
      }
      if (
        /^(subtotal|sub total|tax|[cis]gst|vat|total|grand total|amount due|currency|invoice|po reference)(?:\s*[:#]|\s{2,})/i.test(
          line,
        )
      )
        break;
      if (/^[-|\s]+$/.test(line)) continue;
      const cells = columns(line);
      if (
        cells.length !== table.count ||
        !/^\d{1,9}(?:\.\d{1,6})?$/.test(cells[table.indexes.quantity]) ||
        lineItems.length >= 200
      ) {
        warnings.push(
          "Item table is incomplete or unsupported; verify every line against the original.",
        );
        continue;
      }
      lineItems.push({
        description: cells[table.indexes.description],
        quantity: cells[table.indexes.quantity],
        unitPrice: money(cells[table.indexes.unitPrice]),
        amount: money(cells[table.indexes.amount]),
      });
    }
    if (!lineItems.length)
      warnings.push(
        "Item table was detected but no complete lines could be read.",
      );
  } else if (
    /\b(quantity|qty|unit price|line items|item description)\b/i.test(text)
  ) {
    warnings.push(
      "Itemized layout detected without a supported table; verify all item details.",
    );
  }
  let tax = money(originalValues.tax);
  const componentSources = [value(["CGST"]), value(["SGST"]), value(["IGST"])];
  const hasComponents = lines.some((line) =>
    /^(CGST|SGST|IGST)(?:\s*[:#]|\s{2,})/i.test(line),
  );
  if (hasComponents) {
    const components = componentSources
      .filter((v): v is string => v !== null)
      .map(money);
    const validCombination =
      (componentSources[0] !== null &&
        componentSources[1] !== null &&
        componentSources[2] === null) ||
      (componentSources[0] === null &&
        componentSources[1] === null &&
        componentSources[2] !== null);
    const conflictedComponent = warnings.some((warning) =>
      /^Conflicting (CGST|SGST|IGST)/.test(warning),
    );
    if (
      validCombination &&
      !conflictedComponent &&
      components.every((v) => v !== null)
    ) {
      // Add explicitly printed tax amounts only. Never infer a rate or a taxable base.
      const scaled = (v: string) => {
        const [whole, decimal = ""] = v.split(".");
        return BigInt(whole) * 1000n + BigInt(decimal.padEnd(3, "0"));
      };
      const sum = components.reduce((total, v) => total + scaled(v!), 0n);
      if (tax && scaled(tax) !== sum) {
        tax = null;
        warnings.push(
          "Printed tax total conflicts with tax components; verify the source.",
        );
      } else if (!originalValues.tax) {
        const formatted = `${sum / 1000n}.${String(sum % 1000n).padStart(3, "0")}`;
        tax = money(formatted);
        originalValues.tax = componentSources.filter(Boolean).join(" + ");
        warnings.push(
          "Tax was summed from printed components; verify the source and tax treatment.",
        );
      }
    } else {
      tax = null;
      warnings.push(
        "Tax components are incomplete or unreadable; verify the source.",
      );
    }
  }
  if (
    /\b(tax inclusive|inclusive of tax|tax included|including (?:tax|vat|gst))\b/i.test(
      text,
    )
  )
    warnings.push(
      "Tax-inclusive pricing requires source verification; tax is not inferred.",
    );
  const fields = fieldsSchema.parse({
    ...originalValues,
    invoiceDate,
    currency,
    subtotal: money(originalValues.subtotal),
    tax,
    total: money(originalValues.total),
    lineItems,
  });
  for (const k of [
    "invoiceNumber",
    "invoiceDate",
    "currency",
    "total",
  ] as const)
    if (!fields[k]) warnings.push(`Missing or unreadable ${k}.`);
  return { fields, originalValues, warnings };
}
