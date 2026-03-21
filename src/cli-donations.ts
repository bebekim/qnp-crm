#!/usr/bin/env node

/**
 * np-donations — Donation management for NanoClaw CRM.
 *
 * WRITE tier. Does NOT handle receipts (see nc-receipts).
 */

import { Command } from "commander";
import { output } from "./types.js";
import { donationsAdd } from "./donations/add.js";
import { donationsList } from "./donations/list.js";
import { donationsShow } from "./donations/show.js";
import { donationsVoid } from "./donations/void-donation.js";
import { type CommandName } from "./shared/command-schema.js";
import { attachSafetyLayerAndParse, makeFmt, stub, today } from "./shared/cli-harness.js";

const program = new Command();
program
  .name("np-donations")
  .description("Donation management")
  .version("0.1.0")
  .option("--format <format>", "Output: json (default) or table");

const fmt = makeFmt(program);

program.command("add").argument("<amount>").description("Record a donation (WRITE)")
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

program.command("list").description("List donations (READ)")
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

program.command("show").argument("<id>").description("Show donation (READ)")
  .action(async (id) => {
    output(await donationsShow(id), fmt());
  });

program.command("edit").argument("<id>").description("Edit donation (WRITE)").option("--confirm").action(stub("edit"));

program.command("void").argument("<id>").description("Void a donation (WRITE)")
  .option("--reason <reason>", "Reason for voiding (required with --confirm)")
  .option("--confirm", "Execute (without this flag, outputs plan only)", false)
  .action(async (id, opts) => {
    output(await donationsVoid(id, opts), fmt());
  });

// =========================================================================
// Safety layer + parse
// =========================================================================

const commands: CommandName[] = [
  "donations.add", "donations.list", "donations.show", "donations.void",
];

async function dispatch(command: CommandName, params: Record<string, unknown>) {
  const p = params as any;
  switch (command) {
    case "donations.add": return donationsAdd(String(p.amount), { date: today(), fund: "general", dgr: !(p.noDgr ?? false), confirm: false, ...p });
    case "donations.list": return donationsList({ sort: "-donationDate", ...p, limit: p.limit ?? 50 });
    case "donations.show": return donationsShow(p.id);
    case "donations.void": return donationsVoid(p.id, { confirm: false, ...p });
    default: return { ok: false, data: null, count: 0, warnings: [`${command} not handled by np-donations`], hints: [] };
  }
}

attachSafetyLayerAndParse(program, commands, dispatch);
