import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { fieldsSchema, type Extraction, type Fields } from "./types";
import { config } from "./config";
const require = createRequire(import.meta.url);
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
function parseText(text: string): {
  fields: Fields;
  originalValues: Record<string, string | null>;
  warnings: string[];
} {
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const value = (labels: string[]) => {
    for (const line of lines) {
      for (const label of labels) {
        const m = line.match(
          new RegExp("^" + label + "\\s*[:#]\\s*(.*)$", "i"),
        );
        if (m) return m[1].trim() || null;
      }
    }
    return null;
  };
  const originalValues = {
    supplierName: value(["Supplier", "Supplier name", "Vendor"]),
    supplierId: value(["Supplier ID", "GSTIN", "Vendor ID"]),
    invoiceNumber: value(["Invoice number", "Invoice no", "Invoice"]),
    invoiceDate: value(["Invoice date", "Date"]),
    poReference: value(["PO reference", "Purchase order", "PO"]),
    currency: value(["Currency"]),
    subtotal: value(["Subtotal", "Sub total"]),
    tax: value(["Tax", "GST"]),
    total: value(["Total", "Grand total", "Amount due"]),
  };
  const warnings: string[] = [];
  const money = (s: string | null) => {
    if (!s) return null;
    const v = s
      .replace(/^(INR|USD|EUR|GBP|JPY|KWD|Rs\.?|₹|\$)\s*/i, "")
      .replace(/,/g, "")
      .trim();
    if (!/^\d{1,12}(\.\d{1,3})?$/.test(v)) {
      warnings.push(`Unclear monetary value: ${s.slice(0, 80)}`);
      return null;
    }
    return v;
  };
  const date = originalValues.invoiceDate;
  const invoiceDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  if (date && !invoiceDate)
    warnings.push(
      "Invoice date format is not YYYY-MM-DD; verify before approval.",
    );
  let currency = originalValues.currency?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    warnings.push("Currency could not be read as an ISO currency code.");
    currency = null;
  }
  const fields = fieldsSchema.parse({
    ...originalValues,
    invoiceDate,
    currency,
    subtotal: money(originalValues.subtotal),
    tax: money(originalValues.tax),
    total: money(originalValues.total),
    lineItems: [],
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
export interface ExtractionProvider {
  extract(path: string): Promise<Extraction>;
}
export const localProvider: ExtractionProvider = {
  async extract(path) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(await readFile(path)),
      useSystemFonts: true,
      disableFontFace: true,
      standardFontDataUrl: require
        .resolve("pdfjs-dist/package.json")
        .replace("package.json", "standard_fonts/"),
    });
    const pdf = await task.promise;
    let ocr: Awaited<ReturnType<typeof createWorker>> | undefined;
    try {
      if (pdf.numPages > config.MAX_PAGES)
        throw Error(`PDF exceeds the ${config.MAX_PAGES}-page limit.`);
      const pages: { page: number; text: string }[] = [];
      let usedOCR = false;
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        let text = "";
        let lastY: number | undefined;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const y = item.transform[5];
          if (lastY !== undefined && Math.abs(y - lastY) > 3) text += "\n";
          else if (text && !text.endsWith("\n")) text += " ";
          text += item.str;
          lastY = y;
          if (item.hasEOL) text += "\n";
        }
        if (text.replace(/\s/g, "").length < 60) {
          if (config.OCR_PROVIDER === "disabled")
            throw Error(
              "This PDF needs OCR. Set OCR_PROVIDER=tesseract and run the provider health check.",
            );
          usedOCR = true;
          ocr ??= await createWorker("eng", 1, {
            cachePath: ".data/ocr",
            logger: () => {},
          });
          const viewport = page.getViewport({ scale: 2 });
          if (viewport.width * viewport.height > 25_000_000)
            throw Error("PDF page dimensions exceed the safe rendering limit.");
          const canvas = createCanvas(
            Math.ceil(viewport.width),
            Math.ceil(viewport.height),
          );
          await page.render({
            canvasContext: canvas.getContext("2d") as never,
            canvas: canvas as never,
            viewport,
          }).promise;
          const result = await ocr.recognize(canvas.toBuffer("image/png"));
          text = result.data.text;
        }
        pages.push({ page: n, text: text.slice(0, 100000) });
        page.cleanup();
      }
      const text = pages.map((p) => p.text).join("\n");
      const parsed = parseText(text);
      return {
        ...parsed,
        text,
        pages,
        provider: usedOCR ? "PDF.js + Tesseract English OCR" : "PDF.js text",
        version: "label-parser/1.0",
        pageCount: pdf.numPages,
        warnings: [
          ...parsed.warnings,
          ...(usedOCR
            ? [
                "OCR output requires verification against the original image. No calibrated confidence is supplied.",
              ]
            : []),
        ],
      };
    } finally {
      if (ocr) await ocr.terminate();
      await task.destroy();
    }
  },
};
export { parseText };
