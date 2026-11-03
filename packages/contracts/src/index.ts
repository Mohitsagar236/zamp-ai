import { z } from "zod";
// Supports 200 reviewed item rows, including multi-byte descriptions, with a bounded allocation.
export const INVOICE_COMMAND_MAX_BYTES = 1_000_000;
export function assertIndependentSecrets(
  secrets: Record<string, string | undefined>,
) {
  const values = Object.values(secrets);
  if (
    values.some(
      (value) =>
        !value ||
        value.length < 32 ||
        /^(replace|build-only|change-me)/i.test(value) ||
        new Set(value).size < 8,
    ) ||
    new Set(values).size !== values.length
  )
    throw new Error(
      "Production signing and service secrets must be strong, non-placeholder and independent",
    );
}
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
// The parser's warnings are evidence gaps, not financial-policy overrides.
// Production requires source verification even for an apparently clean parse.
export function requiresSourceVerification(
  extraction: Pick<Extraction, "provider" | "warnings"> | undefined,
  production = false,
): boolean {
  return (
    production ||
    !extraction ||
    extraction.provider.includes("Tesseract") ||
    extraction.warnings.length > 0
  );
}
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
  "Validate extracted fields",
  "Load supplier & purchase order records",
  "Evaluate rules, duplicates & balance",
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
  extractionVerified?: boolean;
  selectedPo?: string;
  history: {
    at: string;
    action: string;
    reason: string;
    actor: string;
    actorId?: string;
    revision: number;
    fields?: Fields;
    evaluation?: Evaluation;
    previousFields?: Fields | null;
    correctedFields?: Fields | null;
    extractionVerified?: boolean;
    previousPo?: string | null;
    selectedPo?: string | null;
    generation?: number;
    correlationId?: string;
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

// Wire contracts v1. Only transport schemas/types live in this package.
export const API_VERSION = "1" as const;
const id = z.string().min(1).max(200);
const instant = z.string().datetime({ offset: true });
export const findingSchema = z.object({
  code: z.string(),
  status: z.enum(["passed", "review", "blocked", "not-evaluated"]),
  message: z.string(),
  evidence: z.unknown().optional(),
});
export const extractionSchema = z.object({
  fields: fieldsSchema,
  originalValues: z.record(z.string(), z.string().nullable()),
  text: z.string().max(2500000),
  pages: z
    .array(
      z.object({
        page: z.number().int().positive(),
        text: z.string().max(100000),
      }),
    )
    .max(25),
  provider: z.string(),
  version: z.string(),
  warnings: z.array(z.string()),
  pageCount: z.number().int().min(1).max(25),
});
export const evaluationSchema = z.object({
  decision: z.enum(["READY_FOR_APPROVAL", "NEEDS_REVIEW", "BLOCKED"]),
  findings: z.array(findingSchema),
  vendorId: id.nullable(),
  poId: id.nullable(),
  candidates: z.array(id),
  duplicateOf: id.nullable(),
  balance: z
    .object({
      limit: z.string().regex(/^\d+$/),
      prior: z.string().regex(/^\d+$/),
      remaining: z.string().regex(/^-?\d+$/),
      impact: z.string().regex(/^-?\d+$/),
      excess: z.string().regex(/^\d+$/),
      commitments: z.array(z.unknown()),
    })
    .optional(),
  policyVersion: z.string(),
  at: instant,
  inputs: fieldsSchema,
});
export const vendorSchema = z.object({
  id,
  name: z.string(),
  identifier: z.string(),
  aliases: z.array(z.string()),
  approved: z.boolean(),
});
export const poSchema = z.object({
  id,
  vendorId: id,
  currency: z.string(),
  status: z.string(),
  limitMinor: z.string().regex(/^\d+$/),
  description: z.string(),
});
export const commitmentSchema = z.object({
  invoiceId: id,
  poId: id,
  vendorId: id,
  businessKey: z.string(),
  amountMinor: z.string().regex(/^\d+$/),
  label: z.string(),
  kind: z.enum(["reservation", "approval", "opening"]).optional(),
});
export const policySchema = z.object({
  version: z.string(),
  roundingMinor: z.number().int(),
  balanceToleranceMinor: z.literal(0),
  reservation: z.string(),
});
export const referencesSchema = z.object({
  vendors: z.array(vendorSchema),
  pos: z.array(poSchema),
  commitments: z.array(commitmentSchema),
});
export const identitySchema = z.object({
  invoiceId: id,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: instant,
});
export const evaluateRequestSchema = identitySchema
  .extend({
    apiVersion: z.literal("1"),
    generation: z.number().int().positive(),
    fields: fieldsSchema,
    selectedPo: id.optional(),
    extractionReviewRequired: z.boolean().optional(),
  })
  .strict();
export const decisionResponseSchema = z.object({
  apiVersion: z.literal("1"),
  generation: z.number().int().positive(),
  review: z.enum(["pending", "approved", "rejected"]),
  evaluation: evaluationSchema.nullable(),
});
export const decisionCommandSchema = z
  .object({
    apiVersion: z.literal("1"),
    invoiceId: id,
    generation: z.number().int().positive(),
    expectedGeneration: z.number().int().nonnegative(),
    action: z.enum(["approve", "reject"]),
    reason: z.string().trim().min(5).max(2000),
    actorId: id.optional(),
  })
  .strict();
export const reviewRequestSchema = z
  .object({
    action: z.enum([
      "approve",
      "reject",
      "correct",
      "select-po",
      "rerun",
      "retry",
    ]),
    reason: z.string().trim().min(5).max(2000),
    fields: fieldsSchema.optional(),
    selectedPo: id.optional(),
    verifiedExtraction: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.action === "correct" && !v.fields)
      c.addIssue({
        code: "custom",
        message: "Corrected fields required",
        path: ["fields"],
      });
    if (v.action === "select-po" && !v.selectedPo)
      c.addIssue({
        code: "custom",
        message: "Choose a purchase order",
        path: ["selectedPo"],
      });
    if (v.verifiedExtraction && v.action !== "correct")
      c.addIssue({
        code: "custom",
        message: "Extraction verification requires a correction review",
        path: ["verifiedExtraction"],
      });
  });
export const extractionResponseSchema = z.object({
  apiVersion: z.literal("1"),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  extraction: extractionSchema,
});
export const stageSchema = z.object({
  name: z.string(),
  status: z.enum(["queued", "running", "completed", "failed", "skipped"]),
  startedAt: instant.optional(),
  endedAt: instant.optional(),
  message: z.string().optional(),
});
export const invoiceStateSchema = z.object({
  stages: z.array(stageSchema),
  extraction: extractionSchema.optional(),
  fields: fieldsSchema.optional(),
  evaluation: evaluationSchema.optional(),
  error: z.string().optional(),
  revision: z.number().int().positive(),
  review: z.enum(["pending", "approved", "rejected"]),
  extractionVerified: z.boolean().optional(),
  selectedPo: id.optional(),
  history: z.array(
    z.object({
      at: instant,
      action: z.string(),
      reason: z.string(),
      actor: z.string(),
      actorId: z.string().optional(),
      revision: z.number().int(),
      fields: fieldsSchema.optional(),
      evaluation: evaluationSchema.optional(),
      previousFields: fieldsSchema.nullable().optional(),
      correctedFields: fieldsSchema.nullable().optional(),
      extractionVerified: z.boolean().optional(),
      previousPo: id.nullable().optional(),
      selectedPo: id.nullable().optional(),
      generation: z.number().int().positive().optional(),
      correlationId: z.string().optional(),
    }),
  ),
});
export const invoiceSchema = z.object({
  id,
  filename: z.string(),
  hash: z.string(),
  storageKey: z.string(),
  status: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  state: invoiceStateSchema,
});
export const eventSchema = z.object({
  id: z.coerce.number(),
  invoiceId: id,
  at: z.coerce.date(),
  type: z.string(),
  data: z.unknown(),
});
export const healthSchema = z.object({
  database: z.string(),
  worker: z.string(),
  ocr: z.string(),
  limits: z.object({ maxMB: z.number(), maxPages: z.number() }),
  policy: policySchema,
  authMode: z.enum(["local", "basic"]),
});
