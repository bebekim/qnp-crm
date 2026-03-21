#!/usr/bin/env node

import { Command } from "commander";
import { output } from "./types.js";
import { contactsAdd } from "./contacts/add.js";
import { contactsList } from "./contacts/list.js";
import { contactsSearch } from "./contacts/search.js";
import { contactsShow } from "./contacts/show.js";
import { contactsEdit } from "./contacts/edit.js";
import { contactsHistory } from "./contacts/history.js";
import { contactsImport } from "./contacts/import.js";
import { donationsAdd } from "./donations/add.js";
import { donationsList } from "./donations/list.js";
import { receiptsGenerate, receiptsBatch } from "./donations/receipt.js";
import { receiptsVoid } from "./donations/void-receipt.js";
import { donationsShow } from "./donations/show.js";
import { donationsVoid } from "./donations/void-donation.js";
import { orgsAdd } from "./orgs/add.js";
import { configShow } from "./config/show.js";
import { configSet } from "./config/set.js";
import { reportSummary } from "./reports/summary.js";
import { reportUnreceipted } from "./reports/unreceipted.js";
import { reportDeadlines } from "./reports/deadlines.js";
import { universalSearch } from "./search/universal.js";
import { jobsHistory } from "./jobs/history.js";
import {
  validateCommand,
  isValidationError,
  getRegistry,
  type CommandName,
} from "./shared/command-schema.js";
import { verify, type Expectation } from "./shared/verify.js";

// ---------------------------------------------------------------------------
// qnp-crm — single-binary CLI for nonprofit CRM
//
// Runs inside the NanoClaw container. Claude Code calls these via bash.
// Output is JSON by default (Claude Code parses it) or table for TTY.
//
// The --confirm flag enforces the bright line:
//   - Without it: write/receipt commands output a plan
//   - With it: they execute
// ---------------------------------------------------------------------------

const program = new Command();
program
  .name("qnp-crm")
  .description("Nonprofit CRM tools for NanoClaw")
  .version("0.2.0")
  .option("--format <format>", "Output: json (default) or table");

const fmt = (): "json" | "table" => {
  const f = program.opts().format;
  if (f === "table") return "table";
  return "json";
};

// =========================================================================
// UNIVERSAL SEARCH (Feature 3)
// =========================================================================

program
  .command("search")
  .description("Search across contacts, orgs, and donations (READ tier)")
  .argument("<query>", "Search query")
  .option("--type <type>", "Filter: contact, org, donation", undefined)
  .option("-n, --limit <n>", "Max results", "20")
  .action(async (query, opts) => {
    output(await universalSearch(query, { type: opts.type, limit: parseInt(opts.limit) }), fmt());
  });

// =========================================================================
// CONTACTS
// =========================================================================

const contacts = program.command("contacts").description("Contact management");

contacts
  .command("add")
  .description("Add a new contact (WRITE tier)")
  .argument("<firstName>", "First name")
  .argument("<lastName>", "Last name")
  .option("-e, --email <email>", "Email address")
  .option("-p, --phone <phone>", "Phone number")
  .option("--address-line1 <addr>", "Street address")
  .option("--address-line2 <addr>", "Address line 2")
  .option("--suburb <suburb>", "Suburb")
  .option("--state <state>", "State (VIC, NSW, QLD, SA, WA, TAS, NT, ACT)")
  .option("--postcode <postcode>", "4-digit postcode")
  .option("-t, --type <type>", "Type: donor, volunteer, client, board, other", "other")
  .option("--tag <tag...>", "Tags (key or key=value, repeatable)")
  .option("--notes <notes>", "Notes")
  .option("--confirm", "Execute (without this flag, outputs plan only)", false)
  .action(async (firstName, lastName, opts) => {
    output(await contactsAdd(firstName, lastName, opts), fmt());
  });

contacts
  .command("list")
  .description("List contacts with filters (READ tier)")
  .option("-t, --type <type>", "Filter by type")
  .option("--tag <tag...>", "Filter by tag (AND logic)")
  .option("-s, --search <query>", "Full-text search")
  .option("--state <state>", "Filter by state")
  .option("-n, --limit <n>", "Max results", "50")
  .option("--offset <n>", "Pagination offset", "0")
  .option("--sort <field>", "Sort field (prefix - for desc)", "lastName")
  .action(async (opts) => {
    output(await contactsList({ ...opts, limit: parseInt(opts.limit), offset: parseInt(opts.offset) }), fmt());
  });

contacts
  .command("search")
  .description("Fuzzy search contacts and orgs (READ tier)")
  .argument("<query>", "Search query")
  .option("--type <type>", "contact, org, or all", "all")
  .option("-n, --limit <n>", "Max results", "20")
  .action(async (query, opts) => {
    output(await contactsSearch(query, { type: opts.type, limit: parseInt(opts.limit) }), fmt());
  });

contacts
  .command("show")
  .argument("<id>", "Contact UUID prefix (8+ chars)")
  .description("Show full contact details (READ tier)")
  .action(async (id) => {
    output(await contactsShow(id), fmt());
  });

contacts
  .command("edit")
  .argument("<id>", "Contact UUID prefix (8+ chars)")
  .description("Edit a contact (WRITE tier)")
  .option("--first-name <name>", "First name")
  .option("--last-name <name>", "Last name")
  .option("-e, --email <email>", "Email address")
  .option("-p, --phone <phone>", "Phone number")
  .option("--address-line1 <addr>", "Street address")
  .option("--address-line2 <addr>", "Address line 2")
  .option("--suburb <suburb>", "Suburb")
  .option("--state <state>", "State (VIC, NSW, QLD, SA, WA, TAS, NT, ACT)")
  .option("--postcode <postcode>", "4-digit postcode")
  .option("-t, --type <type>", "Type: donor, volunteer, client, board, other")
  .option("--notes <notes>", "Notes")
  .option("--add-tag <tag...>", "Add tags (key or key=value, repeatable)")
  .option("--remove-tag <tag...>", "Remove tags by key (repeatable)")
  .option("--confirm", "Execute (without this flag, outputs plan only)", false)
  .action(async (id, opts) => {
    output(await contactsEdit(id, opts), fmt());
  });

contacts
  .command("history")
  .argument("<id>", "Contact UUID prefix (8+ chars)")
  .description("Activity timeline for a contact (READ tier)")
  .option("-n, --limit <n>", "Max events", "50")
  .option("--from <date>", "Start date filter")
  .option("--to <date>", "End date filter")
  .action(async (id, opts) => {
    output(await contactsHistory(id, { limit: parseInt(opts.limit), from: opts.from, to: opts.to }), fmt());
  });

contacts
  .command("import")
  .argument("<file>", "CSV file path")
  .description("Import contacts from CSV (WRITE tier)")
  .option("--map <mapping...>", "Column mapping: \"CSV Column=fieldName\" (repeatable)")
  .option("--preset <preset>", "Column preset: salesforce")
  .option("--on-duplicate <action>", "skip, update, or error", "skip")
  .option("--tag <tag...>", "Tags to apply to all imported contacts")
  .option("-t, --type <type>", "Contact type for all imports")
  .option("--confirm", "Execute (without this flag, outputs plan only)", false)
  .action(async (file, opts) => {
    output(await contactsImport(file, opts), fmt());
  });

contacts.command("delete").argument("<id>").description("Delete a contact (WRITE)").option("--confirm").action(stub("contacts.delete"));
contacts.command("export").description("Export contacts to CSV (READ)").option("-o, --output <file>").action(stub("contacts.export"));
contacts.command("dedup").description("Find duplicate contacts (READ)").action(stub("contacts.dedup"));
contacts.command("merge").arguments("<id1> <id2>").description("Merge two contacts (WRITE)").option("--confirm").action(stub("contacts.merge"));
contacts.command("link").arguments("<contact> <org>").description("Link contact to org (WRITE)").option("--role <role>").option("--confirm").action(stub("contacts.link"));

// =========================================================================
// ORGANISATIONS
// =========================================================================

const orgs = program.command("orgs").description("Organisation management");
orgs.command("add").argument("<name>").description("Add organisation (WRITE)")
  .option("--abn <abn>", "ABN (11 digits)")
  .option("--org-type <type>", "Type: charity, government, corporate, community, other", "other")
  .option("--address-line1 <addr>", "Street address")
  .option("--suburb <suburb>", "Suburb")
  .option("--state <state>", "State (VIC, NSW, QLD, SA, WA, TAS, NT, ACT)")
  .option("--postcode <postcode>", "4-digit postcode")
  .option("--phone <phone>", "Phone number")
  .option("--website <url>", "Website URL")
  .option("--notes <notes>", "Notes")
  .option("--tag <tag...>", "Tags (key or key=value, repeatable)")
  .option("--confirm", "Execute (without this flag, outputs plan only)", false)
  .action(async (name, opts) => {
    output(await orgsAdd(name, opts), fmt());
  });
orgs.command("list").description("List organisations (READ)").action(stub("orgs.list"));
orgs.command("show").argument("<id>").description("Show organisation (READ)").action(stub("orgs.show"));

// =========================================================================
// DONATIONS
// =========================================================================

const don = program.command("donations").description("Donation management");
don.command("add").argument("<amount>").description("Record a donation (WRITE)")
  .option("-c, --contact <contact>", "Contact name/email/ID")
  .option("-d, --date <date>", "Donation date", today())
  .option("-m, --method <method>", "cash, cheque, eft, card, in_kind, other")
  .option("--fund <fund>", "Fund allocation", "general")
  .option("--campaign <campaign>", "Campaign attribution")
  .option("-r, --reference <ref>", "External reference")
  .option("--no-dgr", "Not DGR-eligible")
  .option("--notes <notes>")
  .option("--confirm", "", false)
  .action(async (amount, opts) => {
    output(await donationsAdd(amount, opts), fmt());
  });

don.command("list").description("List donations (READ)")
  .option("-c, --contact <contact>")
  .option("--from <date>")
  .option("--to <date>")
  .option("-m, --method <method>")
  .option("--fund <fund>")
  .option("--campaign <campaign>")
  .option("--status <status>")
  .option("--unreceipted", "Only unreceipted DGR-eligible")
  .option("-n, --limit <n>", "", "50")
  .option("--sort <field>", "", "-donationDate")
  .action(async (opts) => {
    output(await donationsList({ ...opts, limit: parseInt(opts.limit) }), fmt());
  });

don.command("show").argument("<id>").description("Show donation (READ)")
  .action(async (id) => {
    output(await donationsShow(id), fmt());
  });
don.command("edit").argument("<id>").description("Edit donation (WRITE)").option("--confirm").action(stub("donations.edit"));
don.command("void").argument("<id>").description("Void a donation (WRITE)")
  .option("--reason <reason>", "Reason for voiding (required with --confirm)")
  .option("--confirm", "Execute (without this flag, outputs plan only)", false)
  .action(async (id, opts) => {
    output(await donationsVoid(id, opts), fmt());
  });

// =========================================================================
// RECEIPTS
// =========================================================================

const rec = program.command("receipts").description("DGR receipt management");

rec
  .command("generate")
  .description("Generate a DGR receipt (RECEIPT tier — requires --confirm)")
  .argument("<donationId>", "Donation UUID")
  .option("--send", "Email receipt to donor", false)
  .option("--confirm", "Execute (without this, outputs plan only)", false)
  .action(async (donationId, opts) => {
    output(await receiptsGenerate(donationId, opts), fmt());
  });

rec
  .command("batch")
  .description("Batch generate receipts (RECEIPT tier — requires --confirm)")
  .option("--from <date>", "Start date")
  .option("--to <date>", "End date")
  .option("--fund <fund>", "Filter by fund")
  .option("--send", "Email receipts", false)
  .option("--confirm", "Execute", false)
  .action(async (opts) => {
    output(await receiptsBatch(opts), fmt());
  });

rec
  .command("void")
  .argument("<receiptNumber>", "Receipt number to void")
  .description("Void a receipt (RECEIPT tier — requires --confirm + --reason)")
  .option("--reason <reason>", "Reason for voiding (required with --confirm)")
  .option("--confirm", "Execute (without this, outputs plan only)", false)
  .action(async (receiptNumber, opts) => {
    output(await receiptsVoid(receiptNumber, opts), fmt());
  });
rec.command("reprint").argument("<receiptNumber>").description("Reprint receipt with DUPLICATE watermark (READ)").action(stub("receipts.reprint"));

// =========================================================================
// STATEMENTS
// =========================================================================

const stmts = program.command("statements").description("EOFY tax statements");
stmts.command("generate").argument("<contact>").description("Generate EOFY statement (RECEIPT)")
  .option("--fy <fy>", "Financial year: 2025-2026")
  .option("--send", "Email statement", false)
  .option("--confirm", "", false)
  .action(stub("statements.generate"));

// =========================================================================
// REPORTS
// =========================================================================

const reports = program.command("reports").description("Donation reports (READ tier)");
reports.command("summary").description("Totals by method and fund")
  .option("--from <date>", "Start date (default: current AU FY start)")
  .option("--to <date>", "End date (default: current AU FY end)")
  .option("--campaign <campaign>", "Filter by campaign")
  .action(async (opts) => {
    output(await reportSummary(opts), fmt());
  });
reports.command("by-donor").description("Totals per donor").option("--from <date>").option("--to <date>").action(stub("reports.by-donor"));
reports.command("by-fund").description("Totals per fund").option("--from <date>").option("--to <date>").action(stub("reports.by-fund"));
reports.command("by-month").description("Monthly trend").option("--from <date>").option("--to <date>").action(stub("reports.by-month"));
reports.command("lapsed").description("Donors who gave in period A but not B")
  .option("--gave-from <date>").option("--gave-to <date>")
  .option("--not-from <date>").option("--not-to <date>")
  .action(stub("reports.lapsed"));
reports.command("unreceipted").description("Unreceipted DGR-eligible donations")
  .action(async () => {
    output(await reportUnreceipted(), fmt());
  });
reports.command("deadlines").description("Upcoming deadlines and action items (READ tier)")
  .option("--days <n>", "Look-ahead window in days", "30")
  .action(async (opts) => {
    output(await reportDeadlines({ days: parseInt(opts.days) }), fmt());
  });

// =========================================================================
// DEADLINES (top-level alias for reports deadlines) (Feature 4)
// =========================================================================

program
  .command("deadlines")
  .description("Upcoming deadlines and action items (READ tier)")
  .option("--days <n>", "Look-ahead window in days", "30")
  .action(async (opts) => {
    output(await reportDeadlines({ days: parseInt(opts.days) }), fmt());
  });

// =========================================================================
// RECURRING
// =========================================================================

const rec2 = program.command("recurring").description("Recurring donations");
rec2.command("add").argument("<amount>").description("Create recurring schedule (WRITE)")
  .option("-c, --contact <contact>").option("--frequency <freq>").option("--start-date <date>")
  .option("--confirm").action(stub("recurring.add"));
rec2.command("list").description("List recurring (READ)").option("--status <status>").action(stub("recurring.list"));
rec2.command("cancel").argument("<id>").description("Cancel (WRITE)").option("--confirm").action(stub("recurring.cancel"));

// =========================================================================
// JOBS (Feature 5)
// =========================================================================

const jobs = program.command("jobs").description("Scheduled job management");
jobs
  .command("history")
  .description("View job run history (READ tier)")
  .option("--task <id>", "Filter by task ID")
  .option("--status <status>", "Filter: success or error")
  .option("--from <date>", "Start date filter")
  .option("-n, --limit <n>", "Max results", "50")
  .action(async (opts) => {
    output(await jobsHistory({ task: opts.task, status: opts.status, from: opts.from, limit: parseInt(opts.limit) }), fmt());
  });

// =========================================================================
// CONFIG
// =========================================================================

const cfg = program.command("config").description("Receipt configuration");
cfg.command("show").description("Show current config (READ)").action(async () => {
  output(await configShow(), fmt());
});
cfg.command("set").arguments("<key> <value>").description("Set config value (WRITE)")
  .option("--confirm", "Execute (without this, outputs plan only)", false)
  .action(async (key, value, opts) => {
    output(await configSet(key, value, opts), fmt());
  });

// =========================================================================
// SCHEMA / VALIDATE / VERIFY — Safety layers
// =========================================================================

program
  .command("schema")
  .description("Output the full command schema registry (READ)")
  .action(() => {
    console.log(JSON.stringify(getRegistry(), null, 2));
  });

program
  .command("validate")
  .description("Validate a structured command object and output CLI string")
  .argument("<json>", "JSON command object: {command, params}")
  .action((json: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      output({ ok: false, data: null, count: 0, warnings: ["Invalid JSON input"], hints: [] });
      return;
    }

    const result = validateCommand(parsed);
    if (isValidationError(result)) {
      output({
        ok: false,
        data: { command: result.command, errors: result.errors },
        count: 0,
        warnings: result.errors.map((e) => `${e.path}: ${e.message}`),
        hints: [],
      });
    } else {
      output({
        ok: true,
        data: {
          command: result.command,
          tier: result.tier,
          cliString: result.cliString,
          cliArgs: result.cliArgs,
          params: result.params,
        },
        count: 1,
        warnings: [],
        hints: [],
      });
    }
  });

program
  .command("verify")
  .description("Validate, execute a command, then verify the result matches expectations")
  .argument("<json>", "JSON: {command, params, expect}")
  .action(async (json: string) => {
    let parsed: { command: string; params: Record<string, unknown>; expect: Expectation };
    try {
      parsed = JSON.parse(json);
    } catch {
      output({ ok: false, data: null, count: 0, warnings: ["Invalid JSON input"], hints: [] });
      return;
    }

    if (!parsed.expect) {
      output({ ok: false, data: null, count: 0, warnings: ["Missing 'expect' field"], hints: [] });
      return;
    }

    // Step 1: Validate the command
    const validated = validateCommand({ command: parsed.command, params: parsed.params });
    if (isValidationError(validated)) {
      output({
        ok: false,
        data: { phase: "validation", command: validated.command, errors: validated.errors },
        count: 0,
        warnings: validated.errors.map((e) => `${e.path}: ${e.message}`),
        hints: [],
      });
      return;
    }

    // Step 2: Execute the command by dispatching to the handler
    let cmdResult;
    try {
      cmdResult = await dispatch(validated.command, validated.params);
    } catch (err) {
      output({
        ok: false,
        data: { phase: "execution", error: err instanceof Error ? err.message : String(err) },
        count: 0,
        warnings: ["Command execution failed"],
        hints: [],
      });
      return;
    }

    // Step 3: Verify the result against expectations
    const verification = verify(cmdResult, parsed.expect);

    output({
      ok: verification.passed,
      data: {
        phase: "complete",
        passed: verification.passed,
        divergences: verification.divergences,
        commandResult: verification.result,
      },
      count: verification.result.count,
      warnings: verification.divergences
        .filter((d) => d.severity === "error")
        .map((d) => `${d.field}: expected ${d.expected}, got ${d.actual}`),
      hints: verification.divergences
        .filter((d) => d.severity === "warning")
        .map((d) => `${d.field}: expected ${d.expected}, got ${d.actual}`),
    });
  });

// =========================================================================

program.parseAsync().catch((err) => {
  console.error(JSON.stringify({ ok: false, data: null, count: 0, warnings: [err.message], hints: [] }));
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

function stub(name: string) {
  return async (..._args: unknown[]) => {
    output({ ok: false, data: null, count: 0, warnings: [`${name} not yet implemented`], hints: [] });
  };
}

// ---------------------------------------------------------------------------
// Command dispatcher — routes validated command objects to handlers
// Used by the verify command to execute after validation (the verify subcommand is built in).
// ---------------------------------------------------------------------------

type CommandResult = import("./types.js").CommandResult;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zod has already validated the params
async function dispatch(command: CommandName, params: Record<string, unknown>): Promise<CommandResult> {
  const p = params as any;
  switch (command) {
    case "contacts.add":
      return contactsAdd(p.firstName, p.lastName, p);
    case "contacts.list":
      return contactsList({ sort: "lastName", ...p, limit: p.limit ?? 50, offset: p.offset ?? 0 });
    case "contacts.search":
      return contactsSearch(p.query, { type: p.type, limit: p.limit ?? 20 });
    case "contacts.show":
      return contactsShow(p.id);
    case "contacts.edit":
      return contactsEdit(p.id, { confirm: false, ...p });
    case "contacts.history":
      return contactsHistory(p.id, { limit: p.limit ?? 50, from: p.from, to: p.to });
    case "contacts.import":
      return contactsImport(p.file, { confirm: false, ...p });
    case "orgs.add":
      return orgsAdd(p.name, { orgType: "other", confirm: false, ...p });
    case "donations.add":
      return donationsAdd(String(p.amount), { date: today(), fund: "general", dgr: !(p.noDgr ?? false), confirm: false, ...p });
    case "donations.list":
      return donationsList({ sort: "-donationDate", ...p, limit: p.limit ?? 50 });
    case "donations.show":
      return donationsShow(p.id);
    case "donations.void":
      return donationsVoid(p.id, { confirm: false, ...p });
    case "receipts.generate":
      return receiptsGenerate(p.donationId, { send: false, confirm: false, ...p });
    case "receipts.batch":
      return receiptsBatch({ send: false, confirm: false, ...p });
    case "receipts.void":
      return receiptsVoid(String(p.receiptNumber), { confirm: false, ...p });
    case "reports.summary":
      return reportSummary(p);
    case "reports.unreceipted":
      return reportUnreceipted();
    case "reports.deadlines":
    case "deadlines":
      return reportDeadlines({ days: p.days ?? 30 });
    case "search":
      return universalSearch(p.query, { type: p.type, limit: p.limit ?? 20 });
    case "config.show":
      return configShow();
    case "config.set":
      return configSet(p.key, p.value, { confirm: false, ...p });
    case "jobs.history":
      return jobsHistory({ task: p.task, status: p.status, from: p.from, limit: p.limit ?? 50 });
    default:
      return { ok: false, data: null, count: 0, warnings: [`${command} not yet implemented`], hints: [] };
  }
}
