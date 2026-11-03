import type {
  Fields,
  Finding,
  Evaluation,
  Vendor,
  PO,
} from "../../../packages/contracts/src/index.js";
import { minor, normalize, precisions, amount } from "./money.js";
export type Context = {
  vendors: Vendor[];
  pos: PO[];
  commitments: {
    invoiceId: string;
    poId: string;
    businessKey: string;
    amountMinor: string;
    label: string;
  }[];
  duplicateOf?: string | null;
  selectedPo?: string;
  roundingMinor: number;
  policyVersion: string;
  extractionReviewRequired?: boolean;
};
export function evaluate(fields: Fields, ctx: Context): Evaluation {
  const findings: Finding[] = [];
  const add = (
    code: string,
    status: Finding["status"],
    message: string,
    evidence?: unknown,
  ) => findings.push({ code, status, message, evidence });
  if (ctx.extractionReviewRequired)
    add(
      "OCR_VERIFICATION_REQUIRED",
      "review",
      "Verify all invoice values, item details and tax treatment against the original document before approval.",
    );
  const required = [
    "invoiceNumber",
    "invoiceDate",
    "currency",
    "total",
  ] as const;
  for (const k of required)
    if (
      !fields[k] ||
      !fields[k]!.trim() ||
      (k === "invoiceNumber" && !normalize(fields[k]!))
    )
      add(
        "MISSING_" + k.toUpperCase(),
        "review",
        `${k.replace(/([A-Z])/g, " $1")} is missing. Verify it against the original document.`,
      );
  if (fields.invoiceDate) {
    const d = new Date(fields.invoiceDate + "T00:00:00Z");
    if (
      Number.isNaN(d.getTime()) ||
      d.toISOString().slice(0, 10) !== fields.invoiceDate
    )
      add(
        "INVALID_DATE",
        "review",
        "Invoice date is not a valid calendar date.",
      );
  }
  const currency = fields.currency;
  let total: bigint | null = null;
  if (currency && precisions[currency] === undefined)
    add(
      "UNSUPPORTED_CURRENCY",
      "review",
      `Currency ${currency} is not supported by the configured precision table.`,
    );
  if (currency && precisions[currency] !== undefined) {
    try {
      total = fields.total === null ? null : minor(fields.total, currency);
      if (total !== null && total <= 0n)
        add("NONPOSITIVE_TOTAL", "review", "Invoice total must be positive.");
      if (fields.subtotal !== null && fields.tax !== null && total !== null) {
        const expected =
          minor(fields.subtotal, currency) + minor(fields.tax, currency);
        const diff = total - expected;
        const delta = diff < 0n ? -diff : diff;
        add(
          "TOTAL_ARITHMETIC",
          delta <= BigInt(ctx.roundingMinor) ? "passed" : "review",
          `Subtotal + tax = ${amount(expected, currency)}; total = ${amount(total, currency)}. Allowed rounding difference: ${ctx.roundingMinor} minor unit(s).`,
          {
            expected: expected.toString(),
            actual: total.toString(),
            difference: diff.toString(),
            tolerance: ctx.roundingMinor,
          },
        );
      } else
        add(
          "ARITHMETIC_UNAVAILABLE",
          "review",
          "Subtotal or tax is missing; total arithmetic cannot be verified.",
        );
      if (fields.lineItems.length) {
        let sum = 0n;
        let complete = true;
        for (const line of fields.lineItems) {
          if (line.amount === null) {
            complete = false;
            add(
              "LINE_AMOUNT_MISSING",
              "review",
              `Line “${line.description}” has no verifiable amount.`,
            );
            continue;
          }
          const lineAmount = minor(line.amount, currency);
          sum += lineAmount;
          if (line.unitPrice !== null) {
            if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(line.quantity)) {
              add(
                "LINE_QUANTITY",
                "review",
                `Line “${line.description}” has an invalid quantity.`,
              );
              continue;
            }
            const [whole, fraction = ""] = line.quantity.split(".");
            const scale = 10n ** BigInt(fraction.length);
            const quantity = BigInt(whole) * scale + BigInt(fraction || "0");
            const numerator = minor(line.unitPrice, currency) * quantity;
            const expected = (numerator + scale / 2n) / scale;
            const d = expected - lineAmount;
            add(
              "LINE_ARITHMETIC",
              (d < 0n ? -d : d) <= BigInt(ctx.roundingMinor)
                ? "passed"
                : "review",
              `Line “${line.description}”: quantity × unit price compared with line amount.`,
            );
          }
        }
        if (complete && fields.subtotal !== null) {
          const d = sum - minor(fields.subtotal, currency);
          add(
            "LINES_SUBTOTAL",
            (d < 0n ? -d : d) <= BigInt(ctx.roundingMinor)
              ? "passed"
              : "review",
            "Sum of line amounts compared with subtotal.",
            { sum: sum.toString() },
          );
        }
      } else
        add(
          "BUNDLED_CHARGE",
          "not-evaluated",
          "No detailed line items supplied. Item arithmetic was not evaluated; the reviewer must establish whether the original is a bundled charge or contains unparsed items.",
        );
    } catch (e) {
      add(
        "MONEY_PRECISION",
        "review",
        e instanceof Error ? e.message : "Invalid monetary value",
      );
    }
  }
  let vendor: Vendor | undefined;
  if (fields.supplierId) {
    vendor = ctx.vendors.find(
      (v) => normalize(v.identifier) === normalize(fields.supplierId!),
    );
    if (!vendor)
      add(
        "VENDOR_ID_UNKNOWN",
        "review",
        "Supplier identifier is not registered. A matching name alone cannot override an unknown identifier.",
      );
  } else if (fields.supplierName) {
    const matches = ctx.vendors.filter((v) =>
      v.aliases.some((a) => normalize(a) === normalize(fields.supplierName!)),
    );
    if (matches.length === 1) vendor = matches[0];
  }
  if (!vendor)
    add(
      "VENDOR_UNVERIFIED",
      "review",
      "Supplier identity could not be verified using a registered identifier or exact registered alias.",
    );
  else
    add(
      "VENDOR_APPROVED",
      vendor.approved ? "passed" : "blocked",
      vendor.approved
        ? `${vendor.name} is an approved supplier, matched by ${fields.supplierId ? "registered identifier" : "registered alias"}.`
        : `${vendor.name} is not approved.`,
      { vendorId: vendor.id, identifier: vendor.identifier },
    );
  let po: PO | undefined;
  let candidates: PO[] = [];
  const ref = ctx.selectedPo || fields.poReference;
  if (ref) {
    po = ctx.pos.find((p) => normalize(p.id) === normalize(ref));
    if (!po)
      add("PO_NOT_FOUND", "blocked", `Purchase order ${ref} does not exist.`);
  } else if (vendor && currency) {
    candidates = ctx.pos.filter(
      (p) =>
        p.vendorId === vendor!.id &&
        p.currency === currency &&
        p.status === "open" &&
        (total === null ||
          BigInt(p.limitMinor) -
            ctx.commitments
              .filter((c) => c.poId === p.id)
              .reduce((s, c) => s + BigInt(c.amountMinor), 0n) >=
            total),
    );
    if (candidates.length === 1) po = candidates[0];
    else
      add(
        "PO_AMBIGUOUS",
        "review",
        candidates.length
          ? `${candidates.length} eligible purchase orders match the supplier, currency and available amount. Select the correct order.`
          : "No eligible purchase order candidate found. Select a verified purchase order.",
        candidates,
      );
  } else
    add(
      "PO_NOT_EVALUATED",
      "not-evaluated",
      "Purchase order matching needs a verified supplier and currency.",
    );
  if (po) {
    add(
      "PO_VENDOR",
      vendor && po.vendorId === vendor.id
        ? "passed"
        : vendor
          ? "blocked"
          : "review",
      vendor && po.vendorId === vendor.id
        ? "Purchase order belongs to this supplier."
        : "Purchase order supplier could not be matched to the invoice.",
    );
    add(
      "PO_STATUS",
      po.status === "open" ? "passed" : "blocked",
      `Purchase order is ${po.status}.`,
    );
    if (currency)
      add(
        "PO_CURRENCY",
        po.currency === currency ? "passed" : "blocked",
        `Invoice currency ${currency}; purchase order currency ${po.currency}. No currency conversion is applied.`,
      );
  }
  let duplicateOf = ctx.duplicateOf ?? null;
  if (vendor && fields.invoiceNumber) {
    const key = vendor.id + ":" + normalize(fields.invoiceNumber);
    const earlier = ctx.commitments.find((c) => c.businessKey === key);
    if (earlier) duplicateOf = earlier.invoiceId;
  }
  add(
    "DUPLICATE",
    duplicateOf ? "blocked" : "passed",
    duplicateOf
      ? "This file or supplier/invoice-number identity matches an earlier invoice. No additional funds will be reserved."
      : "No earlier file hash or supplier/invoice-number match found.",
    duplicateOf ? { invoiceId: duplicateOf } : undefined,
  );
  let balance: Evaluation["balance"];
  if (po && currency === po.currency && total !== null) {
    const prior = ctx.commitments.filter((c) => c.poId === po.id);
    const used = prior.reduce((s, c) => s + BigInt(c.amountMinor), 0n);
    const remaining = BigInt(po.limitMinor) - used;
    const excess = total > remaining ? total - remaining : 0n;
    balance = {
      limit: po.limitMinor,
      prior: used.toString(),
      remaining: remaining.toString(),
      impact: duplicateOf ? "0" : total.toString(),
      excess: excess.toString(),
      commitments: prior,
    };
    add(
      "PO_BALANCE",
      excess > 0n ? "blocked" : "passed",
      excess > 0n
        ? `${amount(total, currency)} exceeds the available ${amount(remaining, currency)} by ${amount(excess, currency)}. Hard balance tolerance: 0.`
        : `${amount(remaining, currency)} available before this invoice; ${amount(total, currency)} requested. Hard balance tolerance: 0.`,
      balance,
    );
  }
  if (!findings.some((f) => f.code.startsWith("MISSING_")))
    add(
      "REQUIRED_FIELDS",
      "passed",
      "Invoice number, date, currency and total are present.",
    );
  const decision = findings.some((f) => f.status === "blocked")
    ? "BLOCKED"
    : findings.some((f) => f.status === "review")
      ? "NEEDS_REVIEW"
      : "READY_FOR_APPROVAL";
  return {
    decision,
    findings,
    vendorId: vendor?.id ?? null,
    poId: po?.id ?? null,
    candidates: candidates.map((c) => c.id),
    duplicateOf,
    balance,
    policyVersion: ctx.policyVersion,
    at: new Date().toISOString(),
    inputs: fields,
  };
}
