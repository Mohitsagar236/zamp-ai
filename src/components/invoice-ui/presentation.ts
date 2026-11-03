import type { Finding, Invoice, PO, Vendor } from "@/lib/types";
import { amount, minor } from "@/lib/money";
export type References = {
  vendors: Vendor[];
  pos: PO[];
  commitments: {
    invoiceId: string;
    poId: string;
    amountMinor: string;
    label: string;
  }[];
};
export type Health = {
  database: string;
  worker: string;
  ocr: string;
  authMode: string;
  environment?: "demo" | "test" | "production";
  sourceVerificationRequired?: boolean;
  limits: { maxMB: number; maxPages: number };
  policy: { version: string; roundingMinor: number; reservation: string };
};
export type ReviewAction =
  "approve" | "reject" | "correct" | "select-po" | "rerun" | "retry";
export const labels: Record<string, string> = {
  READY_FOR_APPROVAL: "Ready for approval",
  NEEDS_REVIEW: "Needs review",
  BLOCKED: "Blocked",
  queued: "Queued",
  running: "Processing",
  failed: "Processing failed",
  completed: "Completed",
  pending: "Not reviewed",
  approved: "Approved",
  rejected: "Rejected",
  passed: "Passed",
  review: "Needs review",
  blocked: "Blocked",
  "not-evaluated": "Not checked",
  skipped: "Reused / skipped",
};
export function money(
  value: string | null | undefined,
  currency: string | null | undefined,
) {
  if (!value) return "Not available";
  if (!currency) return value;
  try {
    return amount(minor(value, currency), currency);
  } catch {
    return `${currency} ${value}`;
  }
}
export const date = (value: string | Date) =>
  new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const isActive = (row: Invoice) =>
  ["running", "queued"].includes(row.status);
export const openDecision = (row: Invoice, decision: string) =>
  row.status === "completed" &&
  row.state.review === "pending" &&
  row.state.evaluation?.decision === decision;
const checkNames: Record<string, string> = {
  TOTAL_ARITHMETIC: "Subtotal and tax",
  ARITHMETIC_UNAVAILABLE: "Incomplete totals",
  BUNDLED_CHARGE: "Charge detail",
  LINE_ARITHMETIC: "Line item calculation",
  LINES_SUBTOTAL: "Line items and subtotal",
  LINE_AMOUNT_MISSING: "Missing line amount",
  LINE_QUANTITY: "Line item quantity",
  VENDOR_APPROVED: "Supplier approval",
  VENDOR_UNVERIFIED: "Supplier identity",
  VENDOR_ID_UNKNOWN: "Supplier identifier",
  PO_NOT_FOUND: "Purchase order reference",
  PO_AMBIGUOUS: "Purchase order selection",
  PO_NOT_EVALUATED: "Purchase order match",
  PO_VENDOR: "Purchase order supplier",
  PO_STATUS: "Purchase order eligibility",
  PO_CURRENCY: "Currency match",
  DUPLICATE: "Duplicate check",
  PO_BALANCE: "Purchase order balance",
  REQUIRED_FIELDS: "Required invoice details",
  MONEY_PRECISION: "Amount format",
  UNSUPPORTED_CURRENCY: "Currency support",
  INVALID_DATE: "Invoice date",
  NONPOSITIVE_TOTAL: "Invoice total",
};
export function findingName(finding: Finding) {
  if (finding.code.startsWith("MISSING_"))
    return (
      "Missing " +
      ({
        MISSING_INVOICENUMBER: "invoice number",
        MISSING_INVOICEDATE: "invoice date",
        MISSING_CURRENCY: "currency",
        MISSING_TOTAL: "total",
      }[finding.code] ?? "invoice detail")
    );
  return checkNames[finding.code] ?? "Invoice check";
}
export function attention(row: Invoice) {
  if (row.status === "failed")
    return "Processing stopped. Check the document or retry.";
  if (isActive(row)) return "Processing is in progress.";
  const issue =
    row.state.evaluation?.findings.find((f) => f.status === "blocked") ??
    row.state.evaluation?.findings.find((f) => f.status === "review");
  return issue
    ? findingName(issue)
    : row.state.review === "approved"
      ? "Reviewed and approved"
      : row.state.review === "rejected"
        ? "Rejected by reviewer"
        : "All required checks passed";
}
