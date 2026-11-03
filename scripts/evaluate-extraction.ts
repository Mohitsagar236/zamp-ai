import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import manifest from "../tests/extraction/fixtures.json" with { type: "json" };
import type { Fields } from "../packages/contracts/src/index.js";

type Fixture = {
  id: string;
  pages: string[][];
  expected: Partial<Record<keyof Fields, string | null>>;
  critical: (keyof Fields)[];
  needsReview: boolean;
};
const evaluationSet = manifest as { provenance: string; fixtures: Fixture[] };

process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1/unused";
process.env.SERVICE_TOKEN ??= "evaluation-only-token-not-used-by-provider";
process.env.OCR_PROVIDER = "disabled";
const { localProvider } =
  await import("../services/extraction/src/provider.js");
const directory = await mkdtemp(join(tmpdir(), "invoicelens-extraction-eval-"));
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
let exact = 0,
  wrong = 0,
  missing = 0,
  criticalErrors = 0,
  criticalTotal = 0,
  reviewExpected = 0,
  reviewCorrect = 0;
const reports: object[] = [];
try {
  for (const fixture of evaluationSet.fixtures) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const lines of fixture.pages) {
      const page = pdf.addPage([612, 792]);
      lines.forEach((line, i) =>
        page.drawText(line, { x: 40, y: 740 - i * 32, size: 14, font }),
      );
    }
    const filename = join(directory, fixture.id + ".pdf");
    const bytes = await pdf.save();
    await writeFile(filename, bytes);
    const actual = await localProvider.extract(filename);
    const result: Record<string, unknown> = { id: fixture.id, fields: {} };
    const fieldResults: Record<string, object> = {};
    for (const field of fields) {
      const expected = fixture.expected[field] ?? null;
      const got = actual.fields[field] ?? null;
      const status =
        got === expected ? "exact" : got === null ? "missing" : "wrong";
      if (status === "exact") exact++;
      else if (status === "missing") missing++;
      else wrong++;
      fieldResults[field] = { expected, actual: got, status };
    }
    for (const field of fixture.critical) {
      criticalTotal++;
      if ((actual.fields[field] ?? null) !== (fixture.expected[field] ?? null))
        criticalErrors++;
    }
    const routed = actual.warnings.length > 0;
    if (fixture.needsReview) reviewExpected++;
    if (routed === fixture.needsReview) reviewCorrect++;
    Object.assign(result, {
      fields: fieldResults,
      warnings: actual.warnings,
      expectedReview: fixture.needsReview,
      routedForReview: routed,
    });
    reports.push(result);
  }
  const summary = {
    fixtureCount: evaluationSet.fixtures.length,
    fieldComparisons: exact + wrong + missing,
    exact,
    wrong,
    missing,
    criticalErrorCount: criticalErrors,
    criticalFieldCount: criticalTotal,
    criticalErrorRate: criticalTotal ? criticalErrors / criticalTotal : null,
    reviewFixtures: reviewExpected,
    reviewRoutingCorrect: reviewCorrect,
    reviewRoutingAccuracy: evaluationSet.fixtures.length
      ? reviewCorrect / evaluationSet.fixtures.length
      : null,
    reports,
  };
  console.log(
    JSON.stringify({ provenance: evaluationSet.provenance, summary }, null, 2),
  );
  if (
    wrong ||
    criticalErrors ||
    reviewCorrect !== evaluationSet.fixtures.length
  )
    process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
