/**
 * CLI harness — shared boilerplate for per-binary CLIs.
 *
 * The qnp-crm CLI creates a Commander program,
 * registers its domain commands, then calls `attachSafetyLayer()` to add
 * schema/validate/verify subcommands and the parseAsync error handler.
 *
 * This avoids duplicating the safety layer across 5 binaries.
 */

import { Command } from "commander";
import { output, type CommandResult } from "../types.js";
import {
  validateCommand,
  isValidationError,
  getRegistry,
  getCommandNames,
  type CommandName,
  type ValidatedCommand,
} from "./command-schema.js";
import { verify, type Expectation } from "./verify.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A dispatcher maps validated command names to handler functions. */
export type Dispatcher = (command: CommandName, params: Record<string, unknown>) => Promise<CommandResult>;

// ---------------------------------------------------------------------------
// Format helper — shared across all CLIs
// ---------------------------------------------------------------------------

export function makeFmt(program: Command): () => "json" | "table" {
  return () => {
    const f = program.opts().format;
    if (f === "table") return "table";
    return "json";
  };
}

// ---------------------------------------------------------------------------
// Stub helper
// ---------------------------------------------------------------------------

export function stub(name: string) {
  return async (..._args: unknown[]) => {
    output({ ok: false, data: null, count: 0, warnings: [`${name} not yet implemented`], hints: [] });
  };
}

// ---------------------------------------------------------------------------
// Today helper
// ---------------------------------------------------------------------------

export function today(): string {
  return new Date().toISOString().split("T")[0]!;
}

// ---------------------------------------------------------------------------
// Safety layer — schema, validate, verify
// ---------------------------------------------------------------------------

/**
 * Attach schema/validate/verify subcommands and the error handler,
 * then parse argv.
 *
 * @param program - The Commander program with domain commands already registered
 * @param binaryCommands - Which command names this binary handles (for schema filtering)
 * @param dispatch - Function to execute a validated command
 */
export function attachSafetyLayerAndParse(
  program: Command,
  binaryCommands: CommandName[],
  dispatch: Dispatcher,
): void {
  const binarySet = new Set(binaryCommands);

  program
    .command("schema")
    .description("Output the command schema registry for this tool")
    .action(() => {
      const full = getRegistry();
      const filtered: Record<string, unknown> = {};
      for (const name of binaryCommands) {
        if (name in full) {
          filtered[name] = full[name];
        }
      }
      console.log(JSON.stringify(filtered, null, 2));
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
      } else if (!binarySet.has(result.command)) {
        output({
          ok: false,
          data: { command: result.command },
          count: 0,
          warnings: [`Command "${result.command}" is not handled by this binary. Use the appropriate tool.`],
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

      // Step 1: Validate
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

      if (!binarySet.has(validated.command)) {
        output({
          ok: false,
          data: { phase: "validation", command: validated.command },
          count: 0,
          warnings: [`Command "${validated.command}" is not handled by this binary.`],
          hints: [],
        });
        return;
      }

      // Step 2: Execute
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

      // Step 3: Verify
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

  // Run
  program.parseAsync().catch((err) => {
    console.error(JSON.stringify({ ok: false, data: null, count: 0, warnings: [err.message], hints: [] }));
    process.exit(1);
  });
}
