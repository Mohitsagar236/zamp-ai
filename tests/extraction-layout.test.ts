import { describe, expect, it } from "vitest";
import { layoutText } from "../services/extraction/src/layout";
import { parseText } from "../services/extraction/src/parser";

describe("layout and tax extraction", () => {
  it("orders PDF drawing fragments by position and preserves table gaps", () => {
    const item = (str: string, x: number, y: number, width: number) => ({
      str,
      width,
      transform: [12, 0, 0, 12, x, y],
    });
    const text = layoutText([
      item("20.00", 400, 680, 30),
      item("Amount", 400, 700, 45),
      item("2", 200, 680, 7),
      item("Description", 40, 700, 70),
      item("Unit price", 270, 700, 60),
      item("Paper", 40, 680, 35),
      item("Qty", 200, 700, 20),
      item("10.00", 270, 680, 30),
    ]);
    expect(parseText(text).fields.lineItems).toEqual([
      {
        description: "Paper",
        quantity: "2",
        unitPrice: "10.00",
        amount: "20.00",
      },
    ]);
  });
  it("does not mistake an invoice heading and its subtitle for a number", () => {
    expect(
      parseText("INVOICE\nFor accounts payable review\nInvoice number: INV-123")
        .fields.invoiceNumber,
    ).toBe("INV-123");
  });
  it("accepts reordered columns, an item code and repeated page headers", () => {
    const result = parseText(
      "Code | Particulars | Rate | Qty | Line total\nP1 | Paper | 10 | 2 | 20\nCode | Particulars | Rate | Qty | Line total\nP2 | Pens | 5 | 3 | 15\nSubtotal: 35",
    );
    expect(result.fields.lineItems).toHaveLength(2);
    expect(result.fields.lineItems[1]).toMatchObject({
      quantity: "3",
      unitPrice: "5",
      amount: "15",
    });
  });
  it("normalizes only valid unambiguous dates, including month names", () => {
    for (const date of [
      "31/01/2026",
      "01/31/2026",
      "31 Jan 2026",
      "January 31, 2026",
      "2026-01-31",
    ])
      expect(parseText(`Date: ${date}`).fields.invoiceDate, date).toBe(
        "2026-01-31",
      );
    for (const date of [
      "01/02/2026",
      "2026-02-30",
      "31 Feb 2026",
      "2025-02-29",
    ])
      expect(parseText(`Date: ${date}`).fields.invoiceDate, date).toBeNull();
  });
  it("reads aligned and below-label fields without treating headings as values", () => {
    const result = parseText(
      "Invoice no.  A-15\nPurchase order no.  PO-12\nCurrency\nINR\nGrand total  118.00",
    );
    expect(result.fields).toMatchObject({
      invoiceNumber: "A-15",
      poReference: "PO-12",
      currency: "INR",
      total: "118.00",
    });
  });
  it("sums explicit tax amounts exactly and rejects conflicting printed totals", () => {
    const result = parseText(
      "Currency: INR\nCGST: 9.005\nSGST: 9.005\nTotal: 118.01",
    );
    expect(result.fields.tax).toBe("18.010");
    expect(result.originalValues.tax).toBe("9.005 + 9.005");
    expect(result.warnings.some((s) => s.includes("summed"))).toBe(true);
    expect(parseText("Tax: 20\nCGST: 9\nSGST: 9").fields.tax).toBeNull();
    expect(parseText("CGST: 9%\nSGST: 9%").fields.tax).toBeNull();
    expect(parseText("CGST: 9\nCGST: 10\nSGST: 9").fields.tax).toBeNull();
    expect(parseText("CGST: 9").fields.tax).toBeNull();
    expect(parseText("CGST: 9\nSGST: 9\nIGST: 18").fields.tax).toBeNull();
  });
  it("never derives tax or subtotal from an inclusive rate alone", () => {
    const result = parseText("Total: 118\nTax inclusive at 18%");
    expect(result.fields).toMatchObject({
      tax: null,
      subtotal: null,
      total: "118",
    });
    expect(result.warnings.some((s) => s.includes("Tax-inclusive"))).toBe(true);
  });
});
