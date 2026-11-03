import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { type Extraction } from "../../../packages/contracts/src/index.js";
import { config } from "./config.js";
import { parseText } from "./parser.js";
import { layoutText } from "./layout.js";
import { EXTRACTOR_VERSION } from "./cache.js";
const require = createRequire(import.meta.url);
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
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
        const textItems = content.items.filter(
          (
            item,
          ): item is import("pdfjs-dist/types/src/display/api.js").TextItem =>
            "str" in item,
        );
        const rotated = textItems.some(
          (item) =>
            Math.abs(item.transform[1]) > 0.01 ||
            Math.abs(item.transform[2]) > 0.01,
        );
        let text = rotated ? "" : layoutText(textItems);
        if (text.replace(/\s/g, "").length < 60) {
          if (config.OCR_PROVIDER === "disabled")
            throw Error(
              "This PDF needs OCR. Set OCR_PROVIDER=tesseract and run the provider health check.",
            );
          usedOCR = true;
          ocr ??= await createWorker("eng", 1, {
            cachePath: config.OCR_CACHE_DIR,
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
          const result = await ocr.recognize(
            canvas.toBuffer("image/png"),
            {},
            { text: true, blocks: true },
          );
          const words = (result.data.blocks ?? []).flatMap((block) =>
            block.paragraphs.flatMap((paragraph) =>
              paragraph.lines.flatMap((line) =>
                line.words.map((word) => ({
                  str: word.text,
                  width: word.bbox.x1 - word.bbox.x0,
                  transform: [
                    line.bbox.y1 - line.bbox.y0,
                    0,
                    0,
                    line.bbox.y1 - line.bbox.y0,
                    word.bbox.x0,
                    -line.baseline.y0,
                  ],
                })),
              ),
            ),
          );
          text = words.length ? layoutText(words) : result.data.text;
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
        version: EXTRACTOR_VERSION,
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
