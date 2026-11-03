import { describe, expect, it } from "vitest";
import {
  inspectConsistency,
  sameFields,
  type FinancialSnapshot,
} from "../services/workflow/src/reconciliation";
import type { Fields, Evaluation } from "../packages/contracts/src/index";
const fields: Fields = {
  supplierName: "Supplier",
  supplierId: "id",
  invoiceNumber: "1",
  invoiceDate: "2026-11-01",
  poReference: "po",
  currency: "INR",
  subtotal: "100",
  tax: "18",
  total: "118",
  lineItems: [],
};
const evaluation: Evaluation = {
  decision: "READY_FOR_APPROVAL",
  findings: [],
  inputs: fields,
  vendorId: "v",
  poId: "po",
  candidates: [],
  duplicateOf: null,
  policyVersion: "test",
  at: "2026-11-01T00:00:00Z",
  balance: {
    limit: "100000",
    prior: "0",
    remaining: "100000",
    impact: "11800",
    excess: "0",
    commitments: [],
  },
};
const invoice = {
  generation: 1,
  status: "completed",
  hash: "abc",
  state: { review: "pending", fields, evaluation },
};
const financial: FinancialSnapshot = {
  invoiceId: "i",
  hash: "abc",
  generation: 1,
  review: "pending",
  evaluation,
  hasCommitment: true,
  kind: "reservation",
  amountMinor: "11800",
  poId: "po",
};
describe("reconciliation discrepancy detection", () => {
  it("accepts consistent records and avoids transient in-flight discrepancies", () => {
    expect(inspectConsistency(invoice, financial, false)).toEqual([]);
    expect(inspectConsistency(invoice, undefined, true)).toEqual([]);
    expect(inspectConsistency(invoice, undefined, false)[0].code).toBe(
      "registration-missing",
    );
  });
  it("detects obsolete generations, conflicting inputs and document identities", () => {
    expect(
      inspectConsistency(invoice, { ...financial, generation: 2 }, false).some(
        (issue) => issue.code === "generation-mismatch",
      ),
    ).toBe(true);
    expect(
      inspectConsistency(
        invoice,
        {
          ...financial,
          evaluation: { ...evaluation, inputs: { ...fields, total: "1" } },
        },
        false,
      ).some((issue) => issue.code === "evaluation-mismatch"),
    ).toBe(true);
    expect(
      inspectConsistency(invoice, { ...financial, hash: "other" }, false).some(
        (issue) => issue.code === "identity-mismatch",
      ),
    ).toBe(true);
  });
  it("detects missing, extra and incorrectly valued financial commitments", () => {
    expect(
      inspectConsistency(
        invoice,
        { ...financial, hasCommitment: false },
        false,
      ).some((issue) => issue.code === "reservation-mismatch"),
    ).toBe(true);
    expect(
      inspectConsistency(
        invoice,
        { ...financial, amountMinor: "999" },
        false,
      ).some((issue) => issue.code === "commitment-values-mismatch"),
    ).toBe(true);
    expect(
      inspectConsistency(
        invoice,
        { ...financial, review: "rejected" },
        false,
      ).some((issue) => issue.code === "rejected-commitment-present"),
    ).toBe(true);
    expect(
      inspectConsistency(
        invoice,
        { ...financial, review: "approved", hasCommitment: false },
        false,
      ).some((issue) => issue.code === "approved-commitment-missing"),
    ).toBe(true);
  });
  it("compares fields independently of object property order, including item edits", () => {
    expect(sameFields(fields, { ...fields })).toBe(true);
    expect(
      sameFields(fields, {
        ...fields,
        lineItems: [
          {
            description: "Changed",
            quantity: "1",
            unitPrice: "100",
            amount: "100",
          },
        ],
      }),
    ).toBe(false);
  });
});
