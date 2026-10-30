import { describe, it, expect } from "vitest";
import { evaluate, type Context } from "../src/lib/rules";
import { minor, amount } from "../src/lib/money";
import { validateUpload } from "../src/lib/storage";
import { authorize } from "../src/lib/auth";
import type { Fields } from "../src/lib/types";
const fields: Fields = {
  supplierName: "Acme registered alias",
  supplierId: "ID-1",
  invoiceNumber: "INV-1",
  invoiceDate: "2026-10-25",
  poReference: "PO-1",
  currency: "INR",
  subtotal: "100.00",
  tax: "18.00",
  total: "118.00",
  lineItems: [],
};
const ctx: Context = {
  vendors: [
    {
      id: "v1",
      name: "Acme",
      identifier: "ID-1",
      aliases: ["Acme registered alias"],
      approved: true,
    },
  ],
  pos: [
    {
      id: "PO-1",
      vendorId: "v1",
      currency: "INR",
      status: "open",
      limitMinor: "10000000",
      description: "test",
    },
  ],
  commitments: [],
  roundingMinor: 1,
  policyVersion: "test",
};
const run = (f: Partial<Fields> = {}, c: Partial<Context> = {}) =>
  evaluate({ ...fields, ...f }, { ...ctx, ...c });
describe("deterministic financial policy", () => {
  it("clean invoice is ready", () =>
    expect(run().decision).toBe("READY_FOR_APPROVAL"));
  for (const key of [
    "invoiceNumber",
    "invoiceDate",
    "currency",
    "total",
  ] as const)
    it(`missing ${key} prevents ready`, () =>
      expect(run({ [key]: null }).decision).toBe("NEEDS_REVIEW"));
  it("rejects nonexistent calendar dates", () =>
    expect(
      run({ invoiceDate: "2026-02-30" }).findings.some(
        (f) => f.code === "INVALID_DATE",
      ),
    ).toBe(true));
  it("applies exact rounding tolerance", () => {
    expect(run({ total: "118.01" }).decision).toBe("READY_FOR_APPROVAL");
    expect(run({ total: "118.02" }).decision).toBe("NEEDS_REVIEW");
  });
  it("does not invent missing arithmetic", () =>
    expect(run({ subtotal: null }).decision).toBe("NEEDS_REVIEW"));
  it("checks line arithmetic", () =>
    expect(
      run({
        lineItems: [
          {
            description: "goods",
            quantity: "2",
            unitPrice: "20",
            amount: "100",
          },
        ],
      }).decision,
    ).toBe("NEEDS_REVIEW"));
  it("checks fractional quantities with integer rounding", () => {
    const e = run({
      subtotal: "10.01",
      tax: "0.00",
      total: "10.01",
      lineItems: [
        {
          description: "hours",
          quantity: "2.5",
          unitPrice: "4.00",
          amount: "10.01",
        },
      ],
    });
    expect(e.decision).toBe("READY_FOR_APPROVAL");
    const bad = run({
      lineItems: [
        {
          description: "hours",
          quantity: "0.5",
          unitPrice: "20",
          amount: "100",
        },
      ],
    });
    expect(bad.decision).toBe("NEEDS_REVIEW");
  });
  it("blocks currency mismatch", () =>
    expect(run({ currency: "USD" }).decision).toBe("BLOCKED"));
  it("uses registered aliases", () =>
    expect(run({ supplierId: null }).decision).toBe("READY_FOR_APPROVAL"));
  it("does not use name similarity", () =>
    expect(
      run({ supplierId: null, supplierName: "Acme registerd alia" }).decision,
    ).toBe("NEEDS_REVIEW"));
  it("unknown explicit ID is not overridden by alias", () =>
    expect(run({ supplierId: "OTHER" }).decision).toBe("NEEDS_REVIEW"));
  it("blocks unapproved suppliers", () =>
    expect(
      run({}, { vendors: [{ ...ctx.vendors[0], approved: false }] }).decision,
    ).toBe("BLOCKED"));
  it("returns ambiguous candidates without choosing", () => {
    const e = run(
      { poReference: null },
      { pos: [...ctx.pos, { ...ctx.pos[0], id: "PO-2" }] },
    );
    expect(e.decision).toBe("NEEDS_REVIEW");
    expect(e.candidates).toHaveLength(2);
    expect(e.poId).toBeNull();
  });
  it("selected candidate resolves ambiguity", () =>
    expect(
      run(
        { poReference: null },
        {
          pos: [...ctx.pos, { ...ctx.pos[0], id: "PO-2" }],
          selectedPo: "PO-2",
        },
      ).decision,
    ).toBe("READY_FOR_APPROVAL"));
  it("hard cumulative balance blocks INR 10,000 excess", () => {
    const e = run(
      { subtotal: "33898.31", tax: "6101.69", total: "40000.00" },
      {
        commitments: [
          {
            invoiceId: "old",
            poId: "PO-1",
            businessKey: "v1:OLD",
            amountMinor: "7000000",
            label: "old",
          },
        ],
      },
    );
    expect(e.decision).toBe("BLOCKED");
    expect(e.balance?.excess).toBe("1000000");
  });
  it("exact hash duplicate blocks and has zero impact", () => {
    const e = run({}, { duplicateOf: "earlier" });
    expect(e.decision).toBe("BLOCKED");
    expect(e.duplicateOf).toBe("earlier");
    expect(e.balance?.impact).toBe("0");
  });
  it("normalized business identity detects duplicates", () =>
    expect(
      run(
        { invoiceNumber: " inv / 1 " },
        {
          commitments: [
            {
              invoiceId: "old",
              poId: "PO-1",
              businessKey: "v1:INV1",
              amountMinor: "11800",
              label: "old",
            },
          ],
        },
      ).duplicateOf,
    ).toBe("old"));
  it("blocked takes precedence over missing fields", () =>
    expect(run({ invoiceNumber: null }, { duplicateOf: "old" }).decision).toBe(
      "BLOCKED",
    ));
});
describe("money and file boundaries", () => {
  it("uses integer minor units", () => {
    expect(minor("0.10", "INR") + minor("0.20", "INR")).toBe(30n);
    expect(amount(10000000n, "INR")).toBe("INR 100,000.00");
    expect(minor("25", "JPY")).toBe(25n);
    expect(minor("1.234", "KWD")).toBe(1234n);
    expect(() => minor("1.001", "INR")).toThrow();
  });
  it("validates extension, content and size", () => {
    const valid = Buffer.from("%PDF-1.7\nexample");
    expect(() => validateUpload("a.pdf", valid)).not.toThrow();
    expect(() => validateUpload("a.exe", valid)).toThrow();
    expect(() => validateUpload("a.pdf", Buffer.from("not a pdf"))).toThrow();
    expect(() =>
      validateUpload("a.pdf", Buffer.alloc(11 * 1024 * 1024)),
    ).toThrow();
  });
  it("refuses nonlocal invoice access", () =>
    expect(() =>
      authorize(
        new Request("http://evil.test/api/invoices", {
          headers: { host: "evil.test" },
        }),
      ),
    ).toThrow());
  it("refuses cross-origin writes", () =>
    expect(() =>
      authorize(
        new Request("http://127.0.0.1:3000/api/invoices", {
          method: "POST",
          headers: { host: "127.0.0.1:3000", origin: "http://evil.test" },
        }),
      ),
    ).toThrow());
});
