import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, mkdir } from "node:fs/promises";
const exec = promisify(execFile);
await mkdir(".data", { recursive: true });
for (const file of ["happy-path.pdf", "scan-missing-total.pdf"]) {
  const target = ".data/provider-check.json";
  try {
    await exec(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/extract.ts",
        "public/samples/" + file,
        target,
      ],
      { timeout: 120000 },
    );
    const result = JSON.parse(await readFile(target, "utf8"));
    if (file.startsWith("scan") && !result.provider.includes("Tesseract"))
      throw Error("Scan did not use OCR");
    console.log(
      JSON.stringify({
        file,
        provider: result.provider,
        pages: result.pageCount,
        invoiceNumber: result.fields.invoiceNumber,
        total: result.fields.total,
      }),
    );
  } finally {
    await unlink(target).catch(() => {});
  }
}
