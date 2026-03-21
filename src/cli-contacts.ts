#!/usr/bin/env node

/**
 * np-contacts — Contact and organisation management for NanoClaw CRM.
 *
 * WRITE tier. Composable via pipes.
 */

import { Command } from "commander";
import { output } from "./types.js";
import { contactsAdd } from "./contacts/add.js";
import { contactsList } from "./contacts/list.js";
import { contactsSearch } from "./contacts/search.js";
import { contactsShow } from "./contacts/show.js";
import { contactsEdit } from "./contacts/edit.js";
import { contactsHistory } from "./contacts/history.js";
import { contactsImport } from "./contacts/import.js";
import { orgsAdd } from "./orgs/add.js";
import { type CommandName } from "./shared/command-schema.js";
import { attachSafetyLayerAndParse, makeFmt, stub } from "./shared/cli-harness.js";

const program = new Command();
program
  .name("np-contacts")
  .description("Contact and organisation management")
  .version("0.1.0")
  .option("--format <format>", "Output: json (default) or table");

const fmt = makeFmt(program);

// =========================================================================
// CONTACTS
// =========================================================================

program
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

program
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

program
  .command("search")
  .description("Fuzzy search contacts and orgs (READ tier)")
  .argument("<query>", "Search query")
  .option("--type <type>", "contact, org, or all", "all")
  .option("-n, --limit <n>", "Max results", "20")
  .action(async (query, opts) => {
    output(await contactsSearch(query, { type: opts.type, limit: parseInt(opts.limit) }), fmt());
  });

program
  .command("show")
  .argument("<id>", "Contact UUID prefix (8+ chars)")
  .description("Show full contact details (READ tier)")
  .action(async (id) => {
    output(await contactsShow(id), fmt());
  });

program
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

program
  .command("history")
  .argument("<id>", "Contact UUID prefix (8+ chars)")
  .description("Activity timeline for a contact (READ tier)")
  .option("-n, --limit <n>", "Max events", "50")
  .option("--from <date>", "Start date filter")
  .option("--to <date>", "End date filter")
  .action(async (id, opts) => {
    output(await contactsHistory(id, { limit: parseInt(opts.limit), from: opts.from, to: opts.to }), fmt());
  });

program
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

program.command("delete").argument("<id>").description("Delete a contact (WRITE)").option("--confirm").action(stub("delete"));
program.command("export").description("Export contacts to CSV (READ)").option("-o, --output <file>").action(stub("export"));
program.command("dedup").description("Find duplicate contacts (READ)").action(stub("dedup"));
program.command("merge").arguments("<id1> <id2>").description("Merge two contacts (WRITE)").option("--confirm").action(stub("merge"));
program.command("link").arguments("<contact> <org>").description("Link contact to org (WRITE)").option("--role <role>").option("--confirm").action(stub("link"));

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
// Safety layer + parse
// =========================================================================

const commands: CommandName[] = [
  "contacts.add", "contacts.list", "contacts.search", "contacts.show",
  "contacts.edit", "contacts.history", "contacts.import", "orgs.add",
];

async function dispatch(command: CommandName, params: Record<string, unknown>) {
  const p = params as any;
  switch (command) {
    case "contacts.add": return contactsAdd(p.firstName, p.lastName, p);
    case "contacts.list": return contactsList({ sort: "lastName", ...p, limit: p.limit ?? 50, offset: p.offset ?? 0 });
    case "contacts.search": return contactsSearch(p.query, { type: p.type, limit: p.limit ?? 20 });
    case "contacts.show": return contactsShow(p.id);
    case "contacts.edit": return contactsEdit(p.id, { confirm: false, ...p });
    case "contacts.history": return contactsHistory(p.id, { limit: p.limit ?? 50, from: p.from, to: p.to });
    case "contacts.import": return contactsImport(p.file, { confirm: false, ...p });
    case "orgs.add": return orgsAdd(p.name, { orgType: "other", confirm: false, ...p });
    default: return { ok: false, data: null, count: 0, warnings: [`${command} not handled by np-contacts`], hints: [] };
  }
}

attachSafetyLayerAndParse(program, commands, dispatch);
