import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Fields } from "../packages/contracts/src/index.js";

type Field = keyof Pick<
  Fields,
  | "supplierName"
  | "supplierId"
  | "invoiceNumber"
  | "invoiceDate"
  | "poReference"
  | "currency"
  | "subtotal"
  | "tax"
  | "total"
>;
type Label = {
  expected: Partial<Record<Field, string | null>>;
  reviewerA: Partial<Record<Field, string | null>>;
  reviewerB: Partial<Record<Field, string | null>>;
  expectedReview: boolean;
  reviewerAReview: boolean;
  reviewerBReview: boolean;
  adjudicationNote?: string;
};
type Entry = {
  id: string;
  file: string;
  sha256: string;
  category: string;
  layout: string;
  scanQuality: string;
  currency: string;
  missingField: string | null;
  critical: Field[];
  labels: Label;
};
type Manifest = {
  provenance: {
    authorizedBy: string;
    consented: boolean;
    deidentified: boolean;
    labeledAt: string;
  };
  referenceFile: string;
  entries: Entry[];
};

const manifestPath = process.argv[2];
if (!manifestPath)
  throw new Error(
    "Usage: npm run evaluate:authorized -- <private-dataset-directory>/labels.json [report.json]",
  );
const manifestFile = resolve(manifestPath);
const root = dirname(manifestFile);
const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Manifest;
if (
  !manifest.provenance?.authorizedBy ||
  !manifest.provenance.consented ||
  !manifest.provenance.deidentified ||
  !manifest.provenance.labeledAt ||
  !manifest.referenceFile ||
  !Array.isArray(manifest.entries) ||
  !manifest.entries.length
)
  throw new Error(
    "Manifest must document authorization, consent, de-identification, labeling date, local reference data and at least one entry",
  );
const referencePath = resolve(root, manifest.referenceFile);
if (!referencePath.startsWith(root + sep))
  throw new Error(
    "Reference data must be inside the private dataset directory",
  );
const referenceData = JSON.parse(await readFile(referencePath, "utf8")) as {
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
    status: string;
    limitMinor: string;
    description: string;
  }[];
  commitments: {
    invoiceId: string;
    poId: string;
    businessKey: string;
    amountMinor: string;
    label: string;
  }[];
};
if (
  !Array.isArray(referenceData.vendors) ||
  !Array.isArray(referenceData.pos) ||
  !Array.isArray(referenceData.commitments)
)
  throw new Error(
    "Reference data must contain vendors, purchase orders and commitments arrays",
  );

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1/unused";
process.env.SERVICE_TOKEN ??=
  "authorized-evaluation-local-only-not-a-network-token";
process.env.APP_ENV ??= "test";
process.env.OCR_PROVIDER ??= "tesseract";
process.env.OCR_CACHE_DIR ??= resolve(".data/ocr-cache");
process.env.MAX_PAGES ??= "10";
const { localProvider } =
  await import("../services/extraction/src/provider.js");
const { evaluate } = await import("../services/decision/src/rules.js");
const { policy } = await import("../services/decision/src/config.js");
const fields = [
  "supplierName",
  "supplierId",
  "invoiceNumber",
  "invoiceDate",
  "poReference",
  "currency",
  "subtotal",
  "tax",
  "total",
] as const;
const labelDiffs: string[] = [];
const rows: Record<string, unknown>[] = [];
let criticalCorrect = 0;
let criticalCount = 0;
let incorrectAccepted = 0;
let readyCount = 0;
let reviewCount = 0;
let reviewLabeledCount = 0;
let reviewLabelMatches = 0;
let processingFailures = 0;
let processedCount = 0;

const contexts = new Map<string, Entry[]>();
function push(group: string, entry: Entry) {
  contexts.set(group, [...(contexts.get(group) ?? []), entry]);
}
for (const entry of manifest.entries) {
  if (
    !entry.critical.length ||
    !entry.id ||
    !entry.category ||
    !entry.layout ||
    !entry.scanQuality ||
    !entry.currency
  )
    throw new Error(
      "Every entry requires an ID, categories, currency and critical fields",
    );
  const path = resolve(root, entry.file);
  if (path !== root && !path.startsWith(root + sep))
    throw new Error(`Entry ${entry.id} escapes the private dataset directory`);
  if (!/^[a-f0-9]{64}$/.test(entry.sha256))
    throw new Error(`Entry ${entry.id} requires a SHA-256 label`);
  for (const field of fields) {
    if (
      ![
        entry.labels.reviewerA,
        entry.labels.reviewerB,
        entry.labels.expected,
      ].every((labels) => Object.hasOwn(labels, field))
    )
      labelDiffs.push(
        `${entry.id}.${field}: explicit labels (including null for missing values) are required`,
      );
    const a = entry.labels.reviewerA[field] ?? null;
    const b = entry.labels.reviewerB[field] ?? null;
    const expected = entry.labels.expected[field] ?? null;
    if (a !== b && !entry.labels.adjudicationNote?.trim())
      labelDiffs.push(
        `${entry.id}.${field}: independent labels disagree without an adjudication note`,
      );
    if (a === b && expected !== a)
      labelDiffs.push(
        `${entry.id}.${field}: adjudicated value differs from agreeing independent labels`,
      );
    if (a !== b && !Object.hasOwn(entry.labels.expected, field))
      labelDiffs.push(
        `${entry.id}.${field}: disagreement has no adjudicated expected value`,
      );
  }
  for (const field of entry.critical) {
    if (!fields.includes(field))
      labelDiffs.push(`${entry.id}: unsupported critical field ${field}`);
    if (
      !Object.hasOwn(entry.labels.expected, field) ||
      !Object.hasOwn(entry.labels.reviewerA, field) ||
      !Object.hasOwn(entry.labels.reviewerB, field)
    )
      labelDiffs.push(
        `${entry.id}.${field}: all three independent/adjudicated labels are required`,
      );
  }
  if (
    entry.labels.reviewerAReview !== entry.labels.reviewerBReview &&
    !entry.labels.adjudicationNote?.trim()
  )
    labelDiffs.push(
      `${entry.id}.review-routing: independent labels disagree without an adjudication note`,
    );
  if (
    entry.labels.reviewerAReview === entry.labels.reviewerBReview &&
    entry.labels.expectedReview !== entry.labels.reviewerAReview
  )
    labelDiffs.push(
      `${entry.id}.review-routing: adjudicated outcome differs from agreeing labels`,
    );
}
if (labelDiffs.length)
  throw new Error(
    `Resolve independent label disagreements before evaluation:\n${labelDiffs.join("\n")}`,
  );

for (const entry of manifest.entries) {
  push("all", entry);
  push(`category:${entry.category}`, entry);
  push(`layout:${entry.layout}`, entry);
  push(`scanQuality:${entry.scanQuality}`, entry);
  push(`currency:${entry.currency}`, entry);
  if (entry.missingField) push(`missingField:${entry.missingField}`, entry);
  criticalCount += entry.critical.length;
  let pdf: Buffer;
  try {
    pdf = await readFile(pathFor(entry));
  } catch (error) {
    processingFailures++;
    rows.push({
      id: entry.id,
      category: entry.category,
      layout: entry.layout,
      scanQuality: entry.scanQuality,
      currency: entry.currency,
      missingField: entry.missingField,
      criticalFields: entry.critical.length,
      criticalCorrect: 0,
      criticalErrors: entry.critical,
      processingFailure: error instanceof Error ? error.message : String(error),
    });
    continue;
  }
  const inputHash = createHash("sha256").update(pdf).digest("hex");
  if (inputHash !== entry.sha256)
    throw new Error(
      `Source hash mismatch for ${entry.id}; labels may target a different document`,
    );
  try {
    const extraction = await localProvider.extract(pathFor(entry));
    const mismatches = entry.critical.filter(
      (field) =>
        (extraction.fields[field] ?? null) !==
        (entry.labels.expected[field] ?? null),
    );
    criticalCorrect += entry.critical.length - mismatches.length;
    processedCount++;
    const decision = evaluate(extraction.fields, {
      vendors: referenceData.vendors,
      pos: referenceData.pos,
      commitments: referenceData.commitments,
      duplicateOf: null,
      extractionReviewRequired: true,
      roundingMinor: policy.roundingMinor,
      policyVersion: policy.version,
    });
    const actualRouted = decision.decision !== "READY_FOR_APPROVAL";
    if (decision.decision === "READY_FOR_APPROVAL") readyCount++;
    if (actualRouted) reviewCount++;
    reviewLabeledCount++;
    if (actualRouted === entry.labels.expectedReview) reviewLabelMatches++;
    if (decision.decision === "READY_FOR_APPROVAL" && mismatches.length)
      incorrectAccepted++;
    rows.push({
      id: entry.id,
      category: entry.category,
      layout: entry.layout,
      scanQuality: entry.scanQuality,
      currency: entry.currency,
      missingField: entry.missingField,
      provider: extraction.provider,
      criticalFields: entry.critical.length,
      criticalCorrect: entry.critical.length - mismatches.length,
      criticalErrors: mismatches,
      expectedReview: entry.labels.expectedReview,
      routedForReview: actualRouted,
      incorrectCriticalValuesAcceptedWithoutReview:
        decision.decision === "READY_FOR_APPROVAL" && mismatches.length > 0,
      extractionWarnings: extraction.warnings,
      evaluationDecision: decision.decision,
    });
  } catch (error) {
    processingFailures++;
    rows.push({
      id: entry.id,
      category: entry.category,
      layout: entry.layout,
      scanQuality: entry.scanQuality,
      currency: entry.currency,
      missingField: entry.missingField,
      criticalFields: entry.critical.length,
      criticalCorrect: 0,
      criticalErrors: entry.critical,
      processingFailure: error instanceof Error ? error.message : String(error),
    });
  }
}

function groupSummary(group: string, entries: Entry[]) {
  const ids = new Set(entries.map((entry) => entry.id));
  const reports = rows.filter((row) => ids.has(String(row.id)));
  const processed = reports.filter(
    (row) => typeof row.evaluationDecision === "string",
  );
  const errors = reports.reduce(
    (sum, row) =>
      sum + (Array.isArray(row.criticalErrors) ? row.criticalErrors.length : 0),
    0,
  );
  const count = reports.reduce(
    (sum, row) =>
      sum + (typeof row.criticalFields === "number" ? row.criticalFields : 0),
    0,
  );
  return {
    group,
    documents: entries.length,
    criticalFieldAccuracy: count ? (count - errors) / count : null,
    incorrectValuesAcceptedWithoutReview: processed.filter(
      (row) => row.incorrectCriticalValuesAcceptedWithoutReview,
    ).length,
    incorrectAcceptedRate: processed.length
      ? processed.filter(
          (row) => row.incorrectCriticalValuesAcceptedWithoutReview,
        ).length / processed.length
      : null,
    reviewRoutingRate: processed.length
      ? processed.filter((row) => row.routedForReview).length / processed.length
      : null,
    processingFailures: reports.filter((row) => row.processingFailure).length,
  };
}
const report = {
  generatedAt: new Date().toISOString(),
  provenance: manifest.provenance,
  totals: {
    documents: manifest.entries.length,
    criticalFields: criticalCount,
    criticalFieldAccuracy: criticalCount
      ? criticalCorrect / criticalCount
      : null,
    criticalFieldErrors: criticalCount - criticalCorrect,
    incorrectValuesAcceptedWithoutReview: incorrectAccepted,
    decisionsReadyForApproval: readyCount,
    incorrectAcceptedRate: readyCount ? incorrectAccepted / readyCount : null,
    reviewRoutingRate: processedCount ? reviewCount / processedCount : null,
    reviewRoutingLabelAccuracy: reviewLabeledCount
      ? reviewLabelMatches / reviewLabeledCount
      : null,
    decisionsEvaluated: processedCount,
    processingFailures,
  },
  byCategory: [...contexts.entries()].map(([key, entries]) =>
    groupSummary(key, entries),
  ),
  documents: rows,
};
const reportPath = process.argv[3];
if (reportPath)
  await writeFile(resolve(reportPath), JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
console.log(JSON.stringify(report, null, 2));

function pathFor(entry: Entry) {
  return resolve(root, entry.file);
}
