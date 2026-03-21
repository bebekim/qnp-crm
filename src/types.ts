// ---------------------------------------------------------------------------
// Tiers — enforced by the --confirm flag on the CLI
// Claude Code reads the container SKILL.md to know the rules.
// The CLI enforces it structurally: without --confirm, write/receipt
// commands output a plan instead of executing.
// ---------------------------------------------------------------------------

export type Tier = "read" | "write" | "receipt";

// ---------------------------------------------------------------------------
// Command result — every command returns this shape as JSON
// Claude Code parses it and formats a WhatsApp-friendly reply
// ---------------------------------------------------------------------------

export interface CommandResult<T = unknown> {
  ok: boolean;
  data: T;
  count: number;
  /** Plan for write/receipt tier when --confirm is not set */
  plan?: CommandPlan;
  warnings: string[];
  /** Proactive follow-up hints for Claude Code */
  hints: string[];
}

export interface CommandPlan {
  action: string;
  details: Record<string, unknown>;
  tier: Tier;
  confirmCommand: string; // the exact command to re-run with --confirm
}

// ---------------------------------------------------------------------------
// Contact types
// ---------------------------------------------------------------------------

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  contactType: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRow {
  id: string;
  name: string;
  email: string | null;
  type: string;
  tags: string;
}

// ---------------------------------------------------------------------------
// Donation types
// ---------------------------------------------------------------------------

export interface Donation {
  id: string;
  contactId: string | null;
  contactName: string | null;
  amount: string;
  donationDate: string;
  method: string;
  fund: string;
  status: string;
  isDgrEligible: boolean;
  campaign: string | null;
  reference: string | null;
  receiptNumber: number | null;
}

// ---------------------------------------------------------------------------
// Receipt types
// ---------------------------------------------------------------------------

export interface ReceiptPlan {
  receiptNumber: number;
  donorName: string;
  amount: string;
  donationDate: string;
  email: string | null;
}

export interface ReceiptResult {
  receiptNumber: number;
  donationId: string;
  recipientName: string;
  amount: string;
  pdfPath: string;
  emailSent: boolean;
}

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface ReportSummary {
  totalAmount: string;
  donationCount: number;
  averageAmount: string;
  byMethod: Record<string, { count: number; total: string }>;
  byFund: Record<string, { count: number; total: string }>;
}

// ---------------------------------------------------------------------------
// Timeline types (Feature 1)
// ---------------------------------------------------------------------------

export { type TimelineEntry } from "./contacts/history.js";

// ---------------------------------------------------------------------------
// Import types (Feature 2)
// ---------------------------------------------------------------------------

export { type ImportResult } from "./contacts/import.js";

// ---------------------------------------------------------------------------
// Universal search types (Feature 3)
// ---------------------------------------------------------------------------

export { type UniversalSearchResult } from "./search/universal.js";

// ---------------------------------------------------------------------------
// Deadline types (Feature 4)
// ---------------------------------------------------------------------------

export { type DeadlineItem, type DeadlinesResult } from "./reports/deadlines.js";

// ---------------------------------------------------------------------------
// Job history types (Feature 5)
// ---------------------------------------------------------------------------

export { type JobRun } from "./jobs/history.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function ok<T>(data: T, count?: number): CommandResult<T> {
  return { ok: true, data, count: count ?? (Array.isArray(data) ? data.length : 1), warnings: [], hints: [] };
}

export function fail(message: string): CommandResult<null> {
  return { ok: false, data: null, count: 0, warnings: [message], hints: [] };
}

export function needsConfirm<T>(data: T, plan: CommandPlan): CommandResult<T> {
  return { ok: true, data, count: 0, plan, warnings: [], hints: [] };
}

/** Output result as JSON (for Claude Code) or formatted (for TTY) */
export function output(result: CommandResult, format: "json" | "table" = "json"): void {
  if (format === "json" || !process.stdout.isTTY) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Simple table output for admin/debug
    if (!result.ok) {
      console.error(`Error: ${result.warnings.join("; ")}`);
      process.exit(1);
    }
    if (result.plan) {
      console.log(`\n${result.plan.action}\n`);
      for (const [k, v] of Object.entries(result.plan.details)) {
        console.log(`  ${k}: ${v}`);
      }
      console.log(`\nTier: ${result.plan.tier}`);
      console.log(`Run: ${result.plan.confirmCommand}\n`);
      return;
    }
    if (Array.isArray(result.data) && result.data.length > 0) {
      console.table(result.data);
    } else if (result.data && typeof result.data === "object") {
      for (const [k, v] of Object.entries(result.data as Record<string, unknown>)) {
        if (v !== null && v !== undefined) console.log(`  ${k}: ${v}`);
      }
    }
    console.log(`(${result.count} row${result.count !== 1 ? "s" : ""})`);
    for (const h of result.hints) console.log(`Hint: ${h}`);
  }
}
