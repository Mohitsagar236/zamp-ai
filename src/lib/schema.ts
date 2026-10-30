import {
  pgTable,
  text,
  jsonb,
  timestamp,
  bigint,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import type { InvoiceState, Vendor } from "./types";
export const vendors = pgTable("vendors", {
  id: text().primaryKey(),
  name: text().notNull(),
  identifier: text().notNull().unique(),
  aliases: jsonb().$type<Vendor["aliases"]>().notNull(),
  approved: boolean().notNull(),
});
export const pos = pgTable("purchase_orders", {
  id: text().primaryKey(),
  vendorId: text("vendor_id")
    .notNull()
    .references(() => vendors.id),
  currency: text().notNull(),
  status: text().notNull(),
  limitMinor: bigint("limit_minor", { mode: "bigint" }).notNull(),
  description: text().notNull(),
});
export const invoices = pgTable("invoices", {
  id: text().primaryKey(),
  filename: text().notNull(),
  hash: text().notNull(),
  storageKey: text("storage_key").notNull(),
  status: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  state: jsonb().$type<InvoiceState>().notNull(),
});
export const commitments = pgTable("commitments", {
  invoiceId: text("invoice_id").primaryKey(),
  poId: text("po_id")
    .notNull()
    .references(() => pos.id),
  vendorId: text("vendor_id").notNull(),
  businessKey: text("business_key").notNull().unique(),
  amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
  label: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const jobs = pgTable("jobs", {
  id: text().primaryKey(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  status: text().notNull(),
  attempts: integer().default(0).notNull(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  error: text(),
});
export const events = pgTable("events", {
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id),
  at: timestamp({ withTimezone: true }).defaultNow().notNull(),
  type: text().notNull(),
  data: jsonb().notNull(),
});
export const heartbeat = pgTable("worker_heartbeat", {
  id: text().primaryKey(),
  at: timestamp({ withTimezone: true }).notNull(),
});
