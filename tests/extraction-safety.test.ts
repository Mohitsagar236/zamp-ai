import { describe, expect, it } from "vitest";
import { parseText } from "../services/extraction/src/parser";
import {
  assertIndependentSecrets,
  requiresSourceVerification,
} from "../packages/contracts/src/index";
import { boundedBody } from "../src/lib/request-body";

describe("source extraction safety", () => {
  it("rejects reused and placeholder production secrets without exposing values", () => {
    const strong = "a53c97e218d04b6f12ea436dc0b97fa6a";
    expect(() =>
      assertIndependentSecrets({ auth: strong, identity: strong }),
    ).toThrow(/independent/);
    expect(() =>
      assertIndependentSecrets({
        auth: "replace-with-an-independent-32-byte-secret",
      }),
    ).toThrow(/non-placeholder/);
    expect(() =>
      assertIndependentSecrets({
        auth: strong,
        identity: "b64d08f329e15c7a23fb547ed1c08ab7b",
      }),
    ).not.toThrow();
  });
  it("does not convert decimal commas into larger amounts", () => {
    const result = parseText("Total: 118,50\nSubtotal: 100,00\nTax: 18,50");
    expect(result.fields.total).toBeNull();
    expect(result.warnings).toContain("Unclear monetary value: 118,50");
    expect(parseText("Total: 1,23,456.78").fields.total).toBe("123456.78");
    expect(parseText("Total: 1,234.56").fields.total).toBe("1234.56");
    expect(parseText("Total: 12,34.56").fields.total).toBeNull();
  });
  it("refuses conflicting total/amount-due values instead of choosing one", () => {
    const result = parseText("Grand total: 118.00\nAmount due: 100.00");
    expect(result.fields.total).toBeNull();
    expect(
      result.warnings.some((warning) => warning.includes("Conflicting Total")),
    ).toBe(true);
  });
  it("does not strip a conflicting currency prefix from an amount", () => {
    const result = parseText("Currency: INR\nTotal: USD 118.00");
    expect(result.fields.total).toBeNull();
    expect(result.warnings).toContain(
      "Amount currency conflicts with the invoice currency; verify the source.",
    );
  });
  it("extracts supported item tables and exposes incomplete rows", () => {
    const result = parseText(
      "Description | Qty | Unit price | Amount\nPaper | 2 | 50.00 | 100.00\nUnknown | x | 3.00 | 3.00\nSubtotal: 100.00\nTax: 18.00\nTotal: 118.00",
    );
    expect(result.fields.lineItems).toEqual([
      {
        description: "Paper",
        quantity: "2",
        unitPrice: "50.00",
        amount: "100.00",
      },
    ]);
    expect(
      result.warnings.some((warning) =>
        warning.includes("incomplete or unsupported"),
      ),
    ).toBe(true);
  });
  it("requires source verification for warnings and all production inputs", () => {
    const clean = { provider: "PDF.js text", warnings: [] };
    expect(requiresSourceVerification(clean)).toBe(false);
    expect(requiresSourceVerification(clean, true)).toBe(true);
    expect(
      requiresSourceVerification({
        ...clean,
        warnings: ["Unsupported item table"],
      }),
    ).toBe(true);
    expect(
      requiresSourceVerification({
        ...clean,
        provider: "PDF.js + Tesseract English OCR",
      }),
    ).toBe(true);
    expect(requiresSourceVerification(undefined)).toBe(true);
  });
});

describe("bounded gateway body", () => {
  it("rejects oversized declared bodies before consuming them", async () => {
    await expect(
      boundedBody(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-length": "10000" },
          body: "x",
        }),
        10,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it("counts chunked bytes even when the length is absent or lies", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      },
    });
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-length": "1" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(boundedBody(request, 10)).rejects.toMatchObject({
      status: 413,
    });
  });
  it("accepts exact-size data and times out a stalled body", async () => {
    expect(
      new TextDecoder().decode(
        await boundedBody(
          new Request("http://localhost", { method: "POST", body: "hello" }),
          5,
        ),
      ),
    ).toBe("hello");
    const stalled = new Request("http://localhost", {
      method: "POST",
      body: new ReadableStream(),
      duplex: "half",
    } as RequestInit);
    await expect(boundedBody(stalled, 5, 10)).rejects.toMatchObject({
      status: 408,
    });
  });
});
