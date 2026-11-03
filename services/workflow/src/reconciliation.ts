import type {
  Evaluation,
  Fields,
} from "../../../packages/contracts/src/index.js";

export type FinancialSnapshot = {
  invoiceId: string;
  generation: number;
  review: string;
  hash: string;
  evaluation: Evaluation | null;
  hasCommitment: boolean;
  poId?: string | null;
  amountMinor?: string | null;
  kind?: string | null;
};
export function sameFields(
  a: Fields | undefined,
  b: Fields | undefined,
): boolean {
  if (!a || !b) return false;
  const keys = [
    "supplierName",
    "supplierId",
    "invoiceNumber",
    "invoiceDate",
    "poReference",
    "currency",
    "subtotal",
    "tax",
    "total",
    "lineItems",
  ] as const;
  return keys.every((key) =>
    key === "lineItems"
      ? a.lineItems.length === b.lineItems.length &&
        a.lineItems.every((line, index) =>
          (["description", "quantity", "unitPrice", "amount"] as const).every(
            (field) => line[field] === b.lineItems[index][field],
          ),
        )
      : a[key] === b[key],
  );
}
export function inspectConsistency(
  invoice: {
    generation: number;
    status: string;
    hash: string;
    state: { review: string; fields?: Fields; evaluation?: Evaluation };
  },
  financial: FinancialSnapshot | undefined,
  activeJob: boolean,
): { code: string; explanation: string }[] {
  // In-flight operations are expected to be ahead of their caller. Scanning
  // cannot treat an HTTP/transaction window as corruption or release money.
  if (activeJob) return [];
  if (!financial)
    return [
      {
        code: "registration-missing",
        explanation:
          "Workflow has an invoice but Decision has no registration. Replay its durable job after investigating service/operation records.",
      },
    ];
  const issues: { code: string; explanation: string }[] = [];
  const add = (code: string, explanation: string) =>
    issues.push({ code, explanation });
  if (financial.hash !== invoice.hash)
    add(
      "identity-mismatch",
      "Document hashes disagree across services. Approval must remain blocked until the original is restored and verified.",
    );
  if (invoice.state.review !== financial.review)
    add(
      "review-mismatch",
      "Workflow and Decision final review states disagree. Decision is authoritative for financial finalization.",
    );
  if (invoice.state.review === "pending" && financial.review === "pending") {
    if (Number(invoice.generation) !== Number(financial.generation))
      add(
        "generation-mismatch",
        "Service generations disagree with no active job. Inspect the generation fence and replay the existing job; do not create a new financial command.",
      );
    else if (
      invoice.status === "completed" &&
      (!financial.evaluation ||
        !sameFields(invoice.state.fields, financial.evaluation.inputs) ||
        !sameFields(invoice.state.fields, invoice.state.evaluation?.inputs) ||
        invoice.state.evaluation?.decision !== financial.evaluation.decision ||
        invoice.state.evaluation?.poId !== financial.evaluation.poId ||
        invoice.state.evaluation?.balance?.impact !==
          financial.evaluation.balance?.impact)
    )
      add(
        "evaluation-mismatch",
        "The saved recommendation differs from Decision's evaluation or current fields. Reevaluate using the existing supported revision workflow.",
      );
  }
  if (
    financial.review === "approved" &&
    (!financial.hasCommitment || financial.kind !== "approval")
  )
    add(
      "approved-commitment-missing",
      "Decision says approved without a matching approved commitment. Investigate; never fabricate a commitment during reconciliation.",
    );
  if (financial.review === "rejected" && financial.hasCommitment)
    add(
      "rejected-commitment-present",
      "A rejected invoice still has a commitment. Investigate the financial transaction; do not release it manually.",
    );
  if (financial.review === "pending") {
    const ready = financial.evaluation?.decision === "READY_FOR_APPROVAL";
    if (
      ready !== financial.hasCommitment ||
      (ready && financial.kind !== "reservation")
    )
      add(
        "reservation-mismatch",
        "Reservation presence or kind disagrees with the pending Decision recommendation.",
      );
  }
  if (
    financial.hasCommitment &&
    financial.evaluation &&
    (financial.poId !== financial.evaluation.poId ||
      financial.amountMinor !== financial.evaluation.balance?.impact)
  )
    add(
      "commitment-values-mismatch",
      "Committed PO/amount differs from Decision's recorded evaluation. Investigate before any new approval.",
    );
  return issues;
}
