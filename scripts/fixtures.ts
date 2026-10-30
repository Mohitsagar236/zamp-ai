import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { writeFile, mkdir, copyFile } from "node:fs/promises";
import { seed } from "./seed";
import { references } from "../src/lib/service";
import { pool } from "../src/lib/db";
await mkdir("public/samples", { recursive: true });
const common = ["Invoice date: 2026-10-26", "Currency: INR"];
const scenarios = [
  {
    file: "happy-path.pdf",
    lines: [
      "Supplier: Northstar Office Supplies",
      "Supplier ID: GST-NORTHSTAR-01",
      "Invoice number: NS-2026-1042",
      ...common,
      "PO reference: PO-2026-101",
      "Description: Bundled office supplies, October delivery",
      "Subtotal: 20000.00",
      "Tax: 3600.00",
      "Total: 23600.00",
    ],
  },
  {
    file: "split-overbalance.pdf",
    lines: [
      "Supplier: Cloudline Technologies",
      "Supplier ID: GST-CLOUDLINE-03",
      "Invoice number: CL-2026-204",
      ...common,
      "PO reference: PO-2026-200",
      "Description: Migration milestone, second delivery",
      "Subtotal: 33898.31",
      "Tax: 6101.69",
      "Total: 40000.00",
    ],
  },
  {
    file: "ambiguous-po.pdf",
    lines: [
      "Supplier: Studio Meridian",
      "Supplier ID: GST-MERIDIAN-02",
      "Invoice number: SM-2026-089",
      ...common,
      "Description: Bundled design services, October",
      "Subtotal: 10000.00",
      "Tax: 1800.00",
      "Total: 11800.00",
    ],
  },
];
for (const s of scenarios) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({
    x: 0,
    y: 720,
    width: 595,
    height: 122,
    color: rgb(0.93, 0.96, 0.94),
  });
  page.drawText("INVOICE", {
    x: 48,
    y: 777,
    size: 28,
    font: bold,
    color: rgb(0.1, 0.35, 0.3),
  });
  page.drawText("For accounts payable review", {
    x: 49,
    y: 750,
    size: 10,
    font,
    color: rgb(0.4, 0.5, 0.45),
  });
  let y = 675;
  for (const line of s.lines) {
    page.drawText(line, {
      x: 48,
      y,
      size: 12,
      font: line.startsWith("Total:") ? bold : font,
      color: rgb(0.15, 0.22, 0.2),
    });
    y -= 32;
  }
  page.drawLine({
    start: { x: 48, y: 125 },
    end: { x: 547, y: 125 },
    thickness: 1,
    color: rgb(0.8, 0.86, 0.81),
  });
  page.drawText(
    "Payment terms: Net 30. No payment is initiated by InvoiceLens.",
    { x: 48, y: 100, size: 9, font },
  );
  page.drawText("DEMO DOCUMENT - NOT A PAYMENT REQUEST", {
    x: 48,
    y: 76,
    size: 8,
    font,
  });
  await writeFile("public/samples/" + s.file, await pdf.save());
}
await copyFile(
  "public/samples/happy-path.pdf",
  "public/samples/duplicate-renamed.pdf",
);
// Rasterize actual printed content; embed only a PNG, with no text layer.
const canvas = createCanvas(1190, 1684);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fff";
ctx.fillRect(0, 0, 1190, 1684);
ctx.fillStyle = "#edf3ee";
ctx.fillRect(0, 0, 1190, 235);
ctx.fillStyle = "#204e41";
ctx.font = "bold 48px Arial";
ctx.fillText("INVOICE", 95, 135);
ctx.font = "24px Arial";
ctx.fillText("Supplier copy - scanned document", 95, 185);
ctx.fillStyle = "#222";
ctx.font = "25px Arial";
const scanLines = [
  "Supplier: Northstar Office Supplies",
  "Supplier ID: GST-NORTHSTAR-01",
  "Invoice number: NS-2026-SCAN",
  ...common,
  "PO reference: PO-2026-101",
  "Description: Bundled office supplies",
  "Subtotal: 10000.00",
  "Tax: 1800.00",
  "Total:",
];
scanLines.forEach((line, i) => ctx.fillText(line, 95, 330 + i * 68));
ctx.fillStyle = "#222";
ctx.fillRect(185, 330 + 9 * 68 - 24, 300, 30);
ctx.fillStyle = "#777";
ctx.font = "20px Arial";
ctx.fillText(
  "Total obscured on the supplied scan. Verify against supplier copy.",
  95,
  1120,
);
ctx.fillText("DEMO DOCUMENT - NOT A PAYMENT REQUEST", 95, 1530);
const pdf = await PDFDocument.create();
const page = pdf.addPage([595, 842]);
const png = await pdf.embedPng(canvas.toBuffer("image/png"));
page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 });
await writeFile("public/samples/scan-missing-total.pdf", await pdf.save());
await seed();
await writeFile(
  "public/samples/reference-records.json",
  JSON.stringify(await references(), null, 2),
);
await pool.end();
console.log("Generated 5 real PDF fixtures including one image-only scan.");
