#!/usr/bin/env node

/**
 * np-config — Receipt configuration management for NanoClaw CRM.
 *
 * WRITE tier for set, READ tier for show.
 */

import { Command } from "commander";
import { output } from "./types.js";
import { configShow } from "./config/show.js";
import { configSet } from "./config/set.js";
import { type CommandName } from "./shared/command-schema.js";
import { attachSafetyLayerAndParse, makeFmt } from "./shared/cli-harness.js";

const program = new Command();
program
  .name("np-config")
  .description("Receipt configuration management")
  .version("0.1.0")
  .option("--format <format>", "Output: json (default) or table");

const fmt = makeFmt(program);

program.command("show").description("Show current config (READ)").action(async () => {
  output(await configShow(), fmt());
});

program.command("set").arguments("<key> <value>").description("Set config value (WRITE)")
  .option("--confirm", "Execute (without this, outputs plan only)", false)
  .action(async (key, value, opts) => {
    output(await configSet(key, value, opts), fmt());
  });

// =========================================================================
// Safety layer + parse
// =========================================================================

const commands: CommandName[] = ["config.show", "config.set"];

async function dispatch(command: CommandName, params: Record<string, unknown>) {
  const p = params as any;
  switch (command) {
    case "config.show": return configShow();
    case "config.set": return configSet(p.key, p.value, { confirm: false, ...p });
    default: return { ok: false, data: null, count: 0, warnings: [`${command} not handled by np-config`], hints: [] };
  }
}

attachSafetyLayerAndParse(program, commands, dispatch);
