import { z } from "zod";
const money = z
  .string()
  .regex(/^\d{1,12}(?:\.\d{1,3})?$/)
  .nullable();
export const fieldsSchema = z.object({
  supplierName: z.string().max(200).nullable(),
  supplierId: z.string().max(100).nullable(),
  invoiceNumber: z.string().max(100).nullable(),
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  poReference: z.string().max(100).nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  subtotal: money,
  tax: money,
  total: money,
  lineItems: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.string(),
        unitPrice: money,
        amount: money,
      }),
    )
    .max(200)
    .default([]),
});
export type Fields = z.infer<typeof fieldsSchema>;
export type Finding = {
  code: string;
  status: "passed" | "review" | "blocked" | "not-evaluated";
  message: string;
  evidence?: unknown;
};
export type Decision = "READY_FOR_APPROVAL" | "NEEDS_REVIEW" | "BLOCKED";
export type Extraction = {
  fields: Fields;
  originalValues: Record<string, string | null>;
  text: string;
  pages: { page: number; text: string }[];
  provider: string;
  version: string;
  warnings: string[];
  pageCount: number;
};
export type Stage = {
  name: string;
  status: "queued" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  endedAt?: string;
  message?: string;
};
export const stageNames = [
  "Register document",
  "Inspect PDF",
  "Extract invoice data",
  "Validate fields & arithmetic",
  "Match vendor & purchase order",
  "Check duplicates & balance",
  "Save recommendation",
];
export type Evaluation = {
  decision: Decision;
  findings: Finding[];
  vendorId: string | null;
  poId: string | null;
  candidates: string[];
  duplicateOf: string | null;
  balance?: {
    limit: string;
    prior: string;
    remaining: string;
    impact: string;
    excess: string;
    commitments: unknown[];
  };
  policyVersion: string;
  at: string;
  inputs: Fields;
};
export type InvoiceState = {
  stages: Stage[];
  extraction?: Extraction;
  fields?: Fields;
  evaluation?: Evaluation;
  error?: string;
  revision: number;
  review: "pending" | "approved" | "rejected";
  selectedPo?: string;
  history: {
    at: string;
    action: string;
    reason: string;
    actor: string;
    revision: number;
    fields?: Fields;
    evaluation?: Evaluation;
  }[];
};
export type Vendor = {
  id: string;
  name: string;
  identifier: string;
  aliases: string[];
  approved: boolean;
};
export type PO = {
  id: string;
  vendorId: string;
  currency: string;
  status: string;
  limitMinor: string;
  description: string;
};
export type Invoice = {
  id: string;
  filename: string;
  hash: string;
  storageKey: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  state: InvoiceState;
};
