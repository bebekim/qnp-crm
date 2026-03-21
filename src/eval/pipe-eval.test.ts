/**
 * LLM Evaluation Test Harness — Pipe Composition
 *
 * Tests that scripted prompts produce correct pipe compositions.
 * These tests validate the SKILL.md teaching effectiveness by
 * checking that the agent composes the right pipe shapes for
 * common user requests.
 *
 * Two modes:
 *   1. Unit mode (default): validates pipe structure against expected
 *      shapes using deterministic parsing. No LLM call needed.
 *   2. LLM mode (EVAL_LLM=1): sends prompts to Claude via the SDK,
 *      captures tool uses, and validates the composed pipe.
 *
 * Langfuse integration:
 *   When LANGFUSE_SECRET_KEY is set, each eval run is scored in Langfuse
 *   as a dataset experiment, enabling regression tracking over time.
 */

import { describe, it, expect } from "vitest";
import {
  parsePipeCommand,
  validatePipeShape,
  type PipeShape,
  type EvalCase,
  EVAL_DATASET,
} from "./pipe-eval.js";

// ---------------------------------------------------------------------------
// parsePipeCommand — extract structured pipe info from a command string
// ---------------------------------------------------------------------------

describe("parsePipeCommand()", () => {
  it("parses a single command", () => {
    const result = parsePipeCommand("qnp-crm contacts show \"Jane Smith\"");

    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].domain).toBe("contacts");
    expect(result.commands[0].action).toBe("show");
    expect(result.commands[0].hasConfirm).toBe(false);
  });

  it("parses a piped chain", () => {
    const result = parsePipeCommand(
      'qnp-crm donations add 500 --contact "Jane" --confirm | qnp-crm receipts generate --confirm',
    );

    expect(result.commands).toHaveLength(2);
    expect(result.commands[0].domain).toBe("donations");
    expect(result.commands[0].action).toBe("add");
    expect(result.commands[0].hasConfirm).toBe(true);
    expect(result.commands[1].domain).toBe("receipts");
    expect(result.commands[1].action).toBe("generate");
    expect(result.commands[1].hasConfirm).toBe(true);
  });

  it("parses the full donation lifecycle pipe", () => {
    const result = parsePipeCommand(
      'qnp-crm donations add 500 --contact "Jane" --method eft --confirm ' +
        "| qnp-crm receipts generate --confirm " +
        "| qnp-crm notify thankyou --send --confirm",
    );

    expect(result.commands).toHaveLength(3);
    expect(result.commands[0].domain).toBe("donations");
    expect(result.commands[1].domain).toBe("receipts");
    expect(result.commands[2].domain).toBe("notify");
  });

  it("detects --fail-fast flag", () => {
    const result = parsePipeCommand(
      "qnp-crm donations list --status recorded | qnp-crm receipts batch --confirm --fail-fast",
    );

    expect(result.commands[1].hasFailFast).toBe(true);
  });

  it("detects --format flag", () => {
    const result = parsePipeCommand("qnp-crm donations list --format json");
    expect(result.commands[0].format).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// validatePipeShape — check if a command matches expected pipe shape
// ---------------------------------------------------------------------------

describe("validatePipeShape()", () => {
  it("validates matching pipe shape", () => {
    const expected: PipeShape = {
      stages: [
        { domain: "donations", action: "add" },
        { domain: "receipts", action: "generate" },
        { domain: "notify", action: "thankyou" },
      ],
    };

    const actual = parsePipeCommand(
      'qnp-crm donations add 500 --contact "Jane" --confirm ' +
        "| qnp-crm receipts generate --confirm " +
        "| qnp-crm notify thankyou --send --confirm",
    );

    const result = validatePipeShape(actual, expected);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("detects wrong command order", () => {
    const expected: PipeShape = {
      stages: [
        { domain: "donations", action: "add" },
        { domain: "receipts", action: "generate" },
      ],
    };

    const actual = parsePipeCommand(
      "qnp-crm receipts generate --confirm | qnp-crm donations add 500 --confirm",
    );

    const result = validatePipeShape(actual, expected);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("stage 0");
  });

  it("detects missing stages", () => {
    const expected: PipeShape = {
      stages: [
        { domain: "donations", action: "add" },
        { domain: "receipts", action: "generate" },
        { domain: "notify", action: "thankyou" },
      ],
    };

    const actual = parsePipeCommand(
      'qnp-crm donations add 500 --contact "Jane" --confirm',
    );

    const result = validatePipeShape(actual, expected);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Expected 3 stages, got 1");
  });

  it("validates with required confirm flags", () => {
    const expected: PipeShape = {
      stages: [
        { domain: "donations", action: "add", requireConfirm: true },
        { domain: "receipts", action: "generate", requireConfirm: true },
      ],
    };

    const actual = parsePipeCommand(
      'qnp-crm donations add 500 --contact "Jane" | qnp-crm receipts generate',
    );

    const result = validatePipeShape(actual, expected);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("--confirm");
  });
});

// ---------------------------------------------------------------------------
// EVAL_DATASET — canonical evaluation cases
// ---------------------------------------------------------------------------

describe("EVAL_DATASET", () => {
  it("has evaluation cases for all canonical pipe recipes", () => {
    expect(EVAL_DATASET.length).toBeGreaterThanOrEqual(6);
  });

  it("each case has prompt, expected shape, and description", () => {
    for (const evalCase of EVAL_DATASET) {
      expect(evalCase.prompt).toBeTruthy();
      expect(evalCase.expectedShape.stages.length).toBeGreaterThan(0);
      expect(evalCase.description).toBeTruthy();
      expect(evalCase.id).toBeTruthy();
    }
  });

  it("includes the full donation lifecycle case", () => {
    const lifecycle = EVAL_DATASET.find((c) => c.id === "full-donation-lifecycle");
    expect(lifecycle).toBeDefined();
    expect(lifecycle!.expectedShape.stages).toHaveLength(3);
  });

  it("includes the batch receipt case", () => {
    const batch = EVAL_DATASET.find((c) => c.id === "batch-receipt");
    expect(batch).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Eval runner (unit mode — validates expected commands)
// ---------------------------------------------------------------------------

describe("eval cases validate against their own expected commands", () => {
  for (const evalCase of EVAL_DATASET) {
    it(`[${evalCase.id}] expected command matches expected shape`, () => {
      if (!evalCase.expectedCommand) return; // skip if no expected command

      const parsed = parsePipeCommand(evalCase.expectedCommand);
      const result = validatePipeShape(parsed, evalCase.expectedShape);

      expect(result.valid).toBe(true);
      if (!result.valid) {
        console.error(`Case ${evalCase.id} self-validation failed:`, result.errors);
      }
    });
  }
});
