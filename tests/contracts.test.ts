import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  extractionResponseSchema,
  evaluateRequestSchema,
  identitySchema,
} from "../packages/contracts/src/index";

describe("versioned service contracts", () => {
  it("requires a valid content digest before invoice identity registration", () => {
    const valid = {
      invoiceId: "invoice-1",
      hash: "a".repeat(64),
      createdAt: "2026-10-31T10:00:00.000Z",
    };
    expect(identitySchema.parse(valid)).toEqual(valid);
    expect(identitySchema.safeParse({ ...valid, hash: "bad" }).success).toBe(
      false,
    );
  });

  it("rejects evaluation payloads with unsupported policy transport versions", () => {
    const valid = {
      apiVersion: API_VERSION,
      invoiceId: "invoice-1",
      hash: "a".repeat(64),
      createdAt: "2026-10-31T10:00:00.000Z",
      generation: 1,
      fields: {
        supplierName: "Supplier",
        supplierId: null,
        invoiceNumber: "INV-1",
        invoiceDate: "2026-10-31",
        poReference: "PO-1",
        currency: "INR",
        subtotal: "100.00",
        tax: "18.00",
        total: "118.00",
        lineItems: [],
      },
    };
    expect(evaluateRequestSchema.safeParse(valid).success).toBe(true);
    expect(
      evaluateRequestSchema.safeParse({ ...valid, apiVersion: "v2" }).success,
    ).toBe(false);
  });

  it("requires extraction to return complete versioned provenance", () => {
    const valid = {
      apiVersion: API_VERSION,
      hash: "a".repeat(64),
      extraction: {
        provider: "PDF.js text",
        version: "provider-v1",
        pageCount: 1,
        fields: {
          supplierName: "Supplier",
          supplierId: null,
          invoiceNumber: null,
          invoiceDate: null,
          poReference: null,
          currency: "INR",
          subtotal: null,
          tax: null,
          total: null,
          lineItems: [],
        },
        originalValues: {},
        text: "",
        pages: [{ page: 1, text: "" }],
        warnings: [],
      },
    };
    expect(extractionResponseSchema.parse(valid)).toEqual(valid);
    expect(
      extractionResponseSchema.safeParse({
        ...valid,
        extraction: { ...valid.extraction, pageCount: 0 },
      }).success,
    ).toBe(false);
  });
});
