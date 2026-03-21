#!/usr/bin/env node

/**
 * np-reports — Read-only reports, search, and diagnostics for NanoClaw CRM.
 *
 * READ tier only. No mutations. Safe to run without confirmation.
 */

import { Command } from "commander";
import { output } from "./types.js";
import { reportSummary } from "./reports/summary.js";
import { reportUnreceipted } from "./reports/unreceipted.js";
import { reportDeadlines } from "./reports/deadlines.js";
import { universalSearch } from "./search/universal.js";
import { jobsHistory } from "./jobs/history.js";
import { type CommandName } from "./shared/command-schema.js";
import { attachSafetyLayerAndParse, makeFmt, stub } from "./shared/cli-harness.js";

const program = new Command();
program
  .name("np-reports")
  .description("Reports, search, and diagnostics (READ tier)")
  .version("0.1.0")
  .option("--format <format>", "Output: json (default) or table");

const fmt = makeFmt(program);

// =========================================================================
// SEARCH
// =========================================================================

program
  .command("search")
  .description("Search across contacts, orgs, and donations")
  .argument("<query>", "Search query")
  .option("--type <type>", "Filter: contact, org, donation", undefined)
  .option("-n, --limit <n>", "Max results", "20")
  .action(async (query, opts) => {
    output(await universalSearch(query, { type: opts.type, limit: parseInt(opts.limit) }), fmt());
  });

// =========================================================================
// REPORTS
// =========================================================================

program.command("summary").description("Totals by method and fund")
  .option("--from <date>", "Start date (default: current AU FY start)")
  .option("--to <date>", "End date (default: current AU FY end)")
  .option("--campaign <campaign>", "Filter by campaign")
  .action(async (opts) => {
    output(await reportSummary(opts), fmt());
  });

program.command("by-donor").description("Totals per donor").option("--from <date>").option("--to <date>").action(stub("by-donor"));
program.command("by-fund").description("Totals per fund").option("--from <date>").option("--to <date>").action(stub("by-fund"));
program.command("by-month").description("Monthly trend").option("--from <date>").option("--to <date>").action(stub("by-month"));
program.command("lapsed").description("Donors who gave in period A but not B")
  .option("--gave-from <date>").option("--gave-to <date>")
  .option("--not-from <date>").option("--not-to <date>")
  .action(stub("lapsed"));

program.command("unreceipted").description("Unreceipted DGR-eligible donations")
  .action(async () => {
    output(await reportUnreceipted(), fmt());
  });

program.command("deadlines").description("Upcoming deadlines and action items")
  .option("--days <n>", "Look-ahead window in days", "30")
  .action(async (opts) => {
    output(await reportDeadlines({ days: parseInt(opts.days) }), fmt());
  });

// =========================================================================
// JOBS
// =========================================================================

const jobs = program.command("jobs").description("Scheduled job management");
jobs
  .command("history")
  .description("View job run history")
  .option("--task <id>", "Filter by task ID")
  .option("--status <status>", "Filter: success or error")
  .option("--from <date>", "Start date filter")
  .option("-n, --limit <n>", "Max results", "50")
  .action(async (opts) => {
    output(await jobsHistory({ task: opts.task, status: opts.status, from: opts.from, limit: parseInt(opts.limit) }), fmt());
  });

// =========================================================================
// Safety layer + parse
// =========================================================================

const commands: CommandName[] = [
  "reports.summary", "reports.unreceipted", "reports.deadlines",
  "search", "jobs.history", "deadlines",
];

async function dispatch(command: CommandName, params: Record<string, unknown>) {
  const p = params as any;
  switch (command) {
    case "reports.summary": return reportSummary(p);
    case "reports.unreceipted": return reportUnreceipted();
    case "reports.deadlines":
    case "deadlines": return reportDeadlines({ days: p.days ?? 30 });
    case "search": return universalSearch(p.query, { type: p.type, limit: p.limit ?? 20 });
    case "jobs.history": return jobsHistory({ task: p.task, status: p.status, from: p.from, limit: p.limit ?? 50 });
    default: return { ok: false, data: null, count: 0, warnings: [`${command} not handled by np-reports`], hints: [] };
  }
}

attachSafetyLayerAndParse(program, commands, dispatch);
