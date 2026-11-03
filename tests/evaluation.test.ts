import { it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fixtures from "./extraction/fixtures.json";

it("authorized evaluator extracts a generated PDF, reports production review and rejects incomplete independent labels", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "invoicelens-evaluation-contract-"),
  );
  try {
    const fixture = fixtures.fixtures[0];
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const lines of fixture.pages) {
      const page = pdf.addPage([612, 792]);
      lines.forEach((line, i) => {
        const colon = line.indexOf(":");
        if (colon < 0)
          page.drawText(line, { x: 40, y: 740 - i * 32, size: 14, font });
        else {
          // Deliberately paint values before labels: drawing order is not reading order.
          page.drawText(line.slice(colon + 1).trim(), {
            x: 220,
            y: 740 - i * 32,
            size: 14,
            font,
          });
          page.drawText(line.slice(0, colon + 1), {
            x: 40,
            y: 740 - i * 32,
            size: 14,
            font,
          });
        }
      });
    }
    const bytes = await pdf.save();
    await writeFile(join(root, "source.pdf"), bytes);
    await writeFile(
      join(root, "references.json"),
      await readFile("public/samples/reference-records.json"),
    );
    const manifest = {
      provenance: {
        authorizedBy:
          "Self-authored synthetic harness regression; not a real-data study",
        consented: true,
        deidentified: true,
        labeledAt: "2026-11-01",
      },
      referenceFile: "references.json",
      entries: [
        {
          id: "synthetic-only",
          file: "source.pdf",
          sha256: createHash("sha256").update(bytes).digest("hex"),
          category: "synthetic-test",
          layout: "two-page-labels",
          scanQuality: "digital",
          currency: "INR",
          missingField: null,
          critical: fixture.critical,
          labels: {
            expected: { ...fixture.expected },
            reviewerA: { ...fixture.expected },
            reviewerB: { ...fixture.expected },
            expectedReview: true,
            reviewerAReview: true,
            reviewerBReview: true,
          },
        },
      ],
    };
    const run = async () => {
      await writeFile(join(root, "labels.json"), JSON.stringify(manifest));
      return spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/evaluate-authorized.ts",
          join(root, "labels.json"),
          join(root, "report.json"),
        ],
        {
          cwd: process.cwd(),
          env: { ...process.env, APP_ENV: "test", OCR_PROVIDER: "disabled" },
          encoding: "utf8",
          timeout: 15000,
        },
      );
    };
    const result = await run();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(
      await readFile(join(root, "report.json"), "utf8"),
    );
    expect(report.totals).toMatchObject({
      documents: 1,
      criticalFieldAccuracy: 1,
      incorrectValuesAcceptedWithoutReview: 0,
      reviewRoutingRate: 1,
      processingFailures: 0,
    });
    expect(
      report.byCategory.some(
        (group: { group: string }) => group.group === "category:synthetic-test",
      ),
    ).toBe(true);
    // An omitted label is unknown, not an independently confirmed null.
    Reflect.deleteProperty(manifest.entries[0].labels.reviewerB, "supplierId");
    const invalid = await run();
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("explicit labels");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("synthetic reference provisioning refuses the company port and missing isolation acknowledgment before any sign-in", () => {
  for (const [base, acknowledgment] of [
    ["http://127.0.0.1:3003", "synthetic-isolated-only"],
    ["http://127.0.0.1:3180", ""],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/provision-validation.ts", base],
      {
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, INVOICELENS_VALIDATION_DATA: acknowledgment },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("disposable loopback stack");
  }
});
