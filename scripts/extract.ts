import { writeFile, mkdir } from "node:fs/promises";
import { localProvider } from "../src/lib/extraction";
await mkdir(".data/ocr", { recursive: true, mode: 0o700 });
try {
  const result = await localProvider.extract(process.argv[2]);
  await writeFile(process.argv[3], JSON.stringify(result), { mode: 0o600 });
} catch (e) {
  const message = e instanceof Error ? e.message : "Extraction failed";
  const safe = /password|encrypted/i.test(message)
    ? "Encrypted PDFs are not supported. Upload an unlocked copy."
    : /invalid pdf|PDF structure|PDF file|xref/i.test(message)
      ? "PDF is corrupt or unreadable. Upload a valid PDF."
      : message;
  await writeFile(process.argv[3], JSON.stringify({ error: safe }), {
    mode: 0o600,
  });
  process.exitCode = 1;
}
