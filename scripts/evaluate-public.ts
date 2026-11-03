import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep, join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import {
  requiresSourceVerification,
  type Fields,
} from "../packages/contracts/src/index.js";

const filename = process.argv[2];
if (!filename)
  throw new Error(
    "Usage: npm run evaluate:public -- <public-labels.json> <report.json>",
  );
const root = dirname(resolve(filename));
const manifest = JSON.parse(await readFile(filename, "utf8")) as {
  source: string;
  citation: string;
  license: string;
  labelProvenance: string;
  sampling: string;
  entries: {
    id: string;
    file: string;
    sha256: string;
    category: string;
    language: string;
    scanQuality: string;
    supported: boolean;
    expected: Partial<Record<keyof Fields, string>>;
  }[];
};
if (manifest.license !== "CC-BY-4.0" || !manifest.entries.length)
  throw new Error("Expected the prepared CC-BY-4.0 public benchmark manifest");
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1/unused";
process.env.SERVICE_TOKEN ??=
  "public-evaluation-local-only-not-a-network-token";
process.env.OCR_PROVIDER = "tesseract";
process.env.OCR_CACHE_DIR ??= resolve(".data/ocr-cache");
const { localProvider } =
  await import("../services/extraction/src/provider.js");
const temp = await mkdtemp(join(tmpdir(), "invoicelens-public-eval-"));
type Row = {
  id: string;
  category: string;
  language: string;
  scanQuality: string;
  supported: boolean;
  scored: number;
  correct: number;
  wrong: number;
  missing: number;
  routedForReview: boolean;
  incorrectValuesAcceptedWithoutReview: boolean;
  processingFailure?: string;
  sha256: string;
  pdfSha256?: string;
  extractionVersion?: string;
  provider?: string;
  errors?: Record<string, { expected: string; actual: unknown }>;
};
const rows: Row[] = [];
const normalize = (value: string) =>
  value.trim().toLocaleLowerCase("en").replace(/\s+/g, " ");
try {
  for (const entry of manifest.entries) {
    const path = resolve(root, entry.file);
    if (!path.startsWith(root + sep))
      throw new Error("Public image path escapes dataset root");
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw new Error("Public image hash mismatch");
    const row: Row = {
      ...entry,
      scored: Object.keys(entry.expected).length,
      correct: 0,
      wrong: 0,
      missing: 0,
      routedForReview: true,
      incorrectValuesAcceptedWithoutReview: false,
    };
    // Re-encapsulate the original image bytes in a PDF; do not reconstruct a
    // document from labels or change its pixels. Labels never reach the parser.
    try {
      const pdf = await PDFDocument.create();
      const image = entry.file.toLowerCase().endsWith(".png")
        ? await pdf.embedPng(bytes)
        : await pdf.embedJpg(bytes);
      const scale = Math.min(1, 1400 / Math.max(image.width, image.height));
      const page = pdf.addPage([image.width * scale, image.height * scale]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: page.getWidth(),
        height: page.getHeight(),
      });
      const pdfBytes = await pdf.save();
      row.pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");
      const input = join(temp, entry.id + ".pdf");
      await writeFile(input, pdfBytes, { mode: 0o600 });
      const extracted = await localProvider.extract(input);
      row.extractionVersion = extracted.version;
      row.provider = extracted.provider;
      row.routedForReview = requiresSourceVerification(extracted, true);
      row.errors = {};
      for (const [field, expected] of Object.entries(entry.expected)) {
        const actual = extracted.fields[field as keyof Fields];
        if (
          typeof actual === "string" &&
          normalize(actual) === normalize(expected)
        )
          row.correct++;
        else {
          if (actual === null || actual === undefined) row.missing++;
          else row.wrong++;
          row.errors[field] = { expected, actual };
        }
      }
      row.incorrectValuesAcceptedWithoutReview =
        !row.routedForReview && row.correct !== row.scored;
    } catch (error) {
      row.processingFailure =
        error instanceof Error ? error.message : String(error);
      row.missing = row.scored;
    }
    rows.push(row);
    console.error(
      `Public benchmark ${rows.length}/${manifest.entries.length}: ${entry.id}${row.processingFailure ? " failed" : " processed locally"}`,
    );
  }
  const summarize = (items: Row[]) => {
    const scored = items.reduce((sum, row) => sum + row.scored, 0);
    const correct = items.reduce((sum, row) => sum + row.correct, 0);
    return {
      documents: items.length,
      scoredAnnotatedFields: scored,
      correct,
      criticalFieldAccuracy: scored ? correct / scored : null,
      wrong: items.reduce((sum, row) => sum + row.wrong, 0),
      missing: items.reduce((sum, row) => sum + row.missing, 0),
      incorrectValuesAcceptedWithoutReview: items.filter(
        (row) => row.incorrectValuesAcceptedWithoutReview,
      ).length,
      reviewRoutingRate: items.length
        ? items.filter((row) => row.routedForReview).length / items.length
        : null,
      processingFailures: items.filter((row) => row.processingFailure).length,
    };
  };
  const report = {
    codeHashes: Object.fromEntries(
      await Promise.all(
        [
          "services/extraction/src/provider.ts",
          "services/extraction/src/parser.ts",
          "packages/contracts/src/index.ts",
        ].map(async (path) => [
          path,
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        ]),
      ),
    ),
    nodeVersion: process.version,
    generatedAt: new Date().toISOString(),
    source: manifest.source,
    citation: manifest.citation,
    license: manifest.license,
    labelProvenance: manifest.labelProvenance,
    sampling: manifest.sampling,
    scope:
      "Public Portuguese invoices/receipts: unsupported-language negative evaluation with publisher labels. No company PO/vendor snapshot, no end-to-end financial matching evaluation, and no representative English accuracy claim. Production requires source review for every invoice; zero ungated errors reflects that policy, not extraction quality.",
    totals: summarize(rows),
    byCategory: [...new Set(rows.map((row) => row.category))].map(
      (category) => ({
        category,
        ...summarize(rows.filter((row) => row.category === category)),
      }),
    ),
    documents: rows,
  };
  if (process.argv[3])
    await writeFile(
      resolve(process.argv[3]),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
  console.log(JSON.stringify(report.totals, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
