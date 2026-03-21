import {
  pgTable, uuid, varchar, text, timestamp, boolean,
  decimal, date, integer, bigserial, jsonb,
  uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  firstName: varchar("first_name", { length: 100 }).notNull(),
  lastName: varchar("last_name", { length: 100 }).notNull(),
  email: varchar("email", { length: 254 }),
  phone: varchar("phone", { length: 20 }),
  addressLine1: varchar("address_line1", { length: 200 }),
  addressLine2: varchar("address_line2", { length: 200 }),
  suburb: varchar("suburb", { length: 100 }),
  state: varchar("state", { length: 3 }),
  postcode: varchar("postcode", { length: 4 }),
  contactType: varchar("contact_type", { length: 20 }).default("other").notNull(),
  notes: text("notes"),
  mergedInto: uuid("merged_into"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("contacts_email_uniq").on(t.email).where(sql`email IS NOT NULL`),
  index("contacts_name_idx").on(t.lastName, t.firstName),
]);

// ---------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------

export const organisations = pgTable("organisations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 200 }).notNull(),
  orgType: varchar("org_type", { length: 30 }).default("other").notNull(),
  abn: varchar("abn", { length: 11 }),
  addressLine1: varchar("address_line1", { length: 200 }),
  addressLine2: varchar("address_line2", { length: 200 }),
  suburb: varchar("suburb", { length: 100 }),
  state: varchar("state", { length: 3 }),
  postcode: varchar("postcode", { length: 4 }),
  phone: varchar("phone", { length: 20 }),
  website: varchar("website", { length: 500 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("orgs_abn_uniq").on(t.abn).where(sql`abn IS NOT NULL`),
]);

// ---------------------------------------------------------------------------
// Contact ↔ Organisation links
// ---------------------------------------------------------------------------

export const contactOrgLinks = pgTable("contact_org_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  role: varchar("role", { length: 100 }),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("contact_org_uniq").on(t.contactId, t.orgId),
]);

// ---------------------------------------------------------------------------
// Tags (polymorphic)
// ---------------------------------------------------------------------------

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: varchar("entity_type", { length: 10 }).notNull(),
  entityId: uuid("entity_id").notNull(),
  key: varchar("key", { length: 50 }).notNull(),
  value: varchar("value", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tags_entity_key_uniq").on(t.entityType, t.entityId, t.key),
  index("tags_entity_idx").on(t.entityType, t.entityId),
]);

// ---------------------------------------------------------------------------
// Donations
// ---------------------------------------------------------------------------

export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").references(() => contacts.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  donationDate: date("donation_date").notNull(),
  method: varchar("method", { length: 20 }).notNull(),
  fund: varchar("fund", { length: 100 }).default("general").notNull(),
  status: varchar("status", { length: 20 }).default("received").notNull(),
  isDgrEligible: boolean("is_dgr_eligible").default(true).notNull(),
  description: text("description"),
  reference: varchar("reference", { length: 100 }),
  campaign: varchar("campaign", { length: 100 }),
  voidReason: text("void_reason"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  recurringId: uuid("recurring_id").references(() => recurringDonations.id),
  bankTransactionId: varchar("bank_transaction_id", { length: 100 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("donations_contact_date_idx").on(t.contactId, t.donationDate),
  index("donations_date_idx").on(t.donationDate),
  index("donations_status_idx").on(t.status),
  uniqueIndex("donations_bank_tx_uniq").on(t.bankTransactionId).where(sql`bank_transaction_id IS NOT NULL`),
]);

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptNumber: integer("receipt_number").notNull().unique(),
  donationId: uuid("donation_id").notNull().references(() => donations.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  recipientName: varchar("recipient_name", { length: 200 }).notNull(),
  recipientAddress: text("recipient_address"),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  donationDate: date("donation_date").notNull(),
  dgrName: varchar("dgr_name", { length: 200 }).notNull(),
  dgrAbn: varchar("dgr_abn", { length: 11 }).notNull(),
  pdfPath: varchar("pdf_path", { length: 500 }).notNull(),
  pdfHash: varchar("pdf_hash", { length: 64 }).notNull(),
  isDuplicate: boolean("is_duplicate").default(false).notNull(),
  originalReceiptId: uuid("original_receipt_id"),
  isVoided: boolean("is_voided").default(false).notNull(),
  voidReason: text("void_reason"),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: varchar("created_by", { length: 100 }).notNull(),
}, (t) => [
  index("receipts_donation_idx").on(t.donationId),
]);

// ---------------------------------------------------------------------------
// Receipt config (singleton)
// ---------------------------------------------------------------------------

export const receiptConfig = pgTable("receipt_config", {
  id: integer("id").primaryKey().default(1),
  orgName: varchar("org_name", { length: 200 }),
  dgrName: varchar("dgr_name", { length: 200 }),
  abn: varchar("abn", { length: 11 }),
  address: text("address"),
  dgrItemNumber: varchar("dgr_item_number", { length: 20 }),
  receiptPrefix: varchar("receipt_prefix", { length: 10 }),
  logoPath: varchar("logo_path", { length: 500 }),
  receiptFooter: text("receipt_footer"),
  emailFrom: varchar("email_from", { length: 254 }),
  emailReplyTo: varchar("email_reply_to", { length: 254 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Recurring donations
// ---------------------------------------------------------------------------

export const recurringDonations = pgTable("recurring_donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  frequency: varchar("frequency", { length: 20 }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  nextExpectedDate: date("next_expected_date").notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(),
  matchReference: varchar("match_reference", { length: 200 }),
  fund: varchar("fund", { length: 100 }).default("general").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("recurring_status_idx").on(t.status),
]);

// ---------------------------------------------------------------------------
// Contact ↔ Contact relationships
// ---------------------------------------------------------------------------

export const contactRelationships = pgTable("contact_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  relatedContactId: uuid("related_contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 50 }).notNull(),
  reciprocalType: varchar("reciprocal_type", { length: 50 }),
  status: varchar("status", { length: 20 }).default("current"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("contact_rel_contact_idx").on(t.contactId),
  index("contact_rel_related_idx").on(t.relatedContactId),
]);

// ---------------------------------------------------------------------------
// Job runs — queryable mirror of task scheduler history
// ---------------------------------------------------------------------------

export const jobRuns = pgTable("job_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  taskId: varchar("task_id", { length: 100 }).notNull(),
  taskPrompt: text("task_prompt"),
  groupFolder: varchar("group_folder", { length: 200 }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  status: varchar("status", { length: 20 }).notNull(),
  result: text("result"),
  error: text("error"),
}, (t) => [
  index("job_runs_task_idx").on(t.taskId),
  index("job_runs_started_idx").on(t.startedAt),
  index("job_runs_status_idx").on(t.status),
]);

// ---------------------------------------------------------------------------
// Audit log — compliance, append-only, never pruned
// ---------------------------------------------------------------------------

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tableName: varchar("table_name", { length: 50 }).notNull(),
  recordId: uuid("record_id").notNull(),
  action: varchar("action", { length: 10 }).notNull(),
  changedFields: jsonb("changed_fields"),
  performedBy: varchar("performed_by", { length: 100 }).notNull(),
  performedAt: timestamp("performed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_record_idx").on(t.tableName, t.recordId),
  index("audit_time_idx").on(t.performedAt),
]);
