#!/usr/bin/env node

/**
 * np-receipts — DGR receipt and statement management for NanoClaw CRM.
 *
 * RECEIPT tier — the bright line. Every command here requires explicit --confirm.
 * No LLM output may appear on a receipt. This binary is a trust boundary.
 */

import { Command } from "commander";
import { output } from "./types.js";
import { receiptsGenerate, receiptsBatch } from "./donations/receipt.js";
import { receiptsVoid } from "./donations/void-receipt.js";
import { type CommandName } from "./shared/command-schema.js";
import { attachSafetyLayerAndParse, makeFmt, stub } from "./shared/cli-harness.js";

const program = new Command();
program
  .name("np-receipts")
  .description("DGR receipt and statement management (RECEIPT tier)")
  .version("0.1.0")
  .option("--format <format>", "Output: json (default) or table");

const fmt = makeFmt(program);

// =========================================================================
// RECEIPTS
// =========================================================================

program
  .command("generate")
  .description("Generate a DGR receipt (RECEIPT tier — requires --confirm)")
  .argument("<donationId>", "Donation UUID")
  .option("--send", "Email receipt to donor", false)
  .option("--confirm", "Execute (without this, outputs plan only)", false)
  .action(async (donationId, opts) => {
    output(await receiptsGenerate(donationId, opts), fmt());
  });

program
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

program
  .command("void")
  .argument("<receiptNumber>", "Receipt number to void")
  .description("Void a receipt (RECEIPT tier — requires --confirm + --reason)")
  .option("--reason <reason>", "Reason for voiding (required with --confirm)")
  .option("--confirm", "Execute (without this, outputs plan only)", false)
  .action(async (receiptNumber, opts) => {
    output(await receiptsVoid(receiptNumber, opts), fmt());
  });

program.command("reprint").argument("<receiptNumber>").description("Reprint receipt with DUPLICATE watermark (READ)").action(stub("reprint"));

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
// Safety layer + parse
// =========================================================================

const commands: CommandName[] = [
  "receipts.generate", "receipts.batch", "receipts.void",
];

async function dispatch(command: CommandName, params: Record<string, unknown>) {
  const p = params as any;
  switch (command) {
    case "receipts.generate": return receiptsGenerate(p.donationId, { send: false, confirm: false, ...p });
    case "receipts.batch": return receiptsBatch({ send: false, confirm: false, ...p });
    case "receipts.void": return receiptsVoid(String(p.receiptNumber), { confirm: false, ...p });
    default: return { ok: false, data: null, count: 0, warnings: [`${command} not handled by np-receipts`], hints: [] };
  }
}

attachSafetyLayerAndParse(program, commands, dispatch);
