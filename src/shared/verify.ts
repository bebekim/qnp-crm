/**
 * Post-execution verification — Layer 3 of the verification architecture.
 *
 * Before a command runs, the caller declares expectations about the result.
 * After execution, the verifier compares actual output against expectations
 * and flags divergences. This catches semantic hallucination: a syntactically
 * valid command that does the wrong thing.
 *
 * The LLM predicts what should happen; the verifier checks reality matches.
 *
 * Usage:
 *   qnp-crm contacts verify '{"command":"contacts.add", "params":{...}, "expect":{...}}'
 *   → runs the command, compares result to expectations, outputs verdict
 */

import type { CommandResult } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** What the caller expects the command result to look like. */
export interface Expectation {
  /** Expected ok status (default: true) */
  ok?: boolean;
  /** Expected count or count range */
  count?: number | { min?: number; max?: number };
  /** Fields expected to be present in data (for single-record results) */
  fields?: Record<string, FieldCheck>;
  /** Should plan be present (for write/receipt without --confirm)? */
  hasPlan?: boolean;
  /** Expected warnings count range */
  warningCount?: { min?: number; max?: number };
}

/** A check on a single field in the result data. */
export type FieldCheck =
  | { equals: unknown }
  | { contains: string }
  | { matches: string }
  | { type: "string" | "number" | "boolean" | "object" | "array" }
  | { present: true };

// ---------------------------------------------------------------------------
// Verification result
// ---------------------------------------------------------------------------

export interface Divergence {
  field: string;
  expected: string;
  actual: string;
  severity: "error" | "warning";
}

export interface VerifyResult {
  passed: boolean;
  divergences: Divergence[];
  /** The original command result, passed through */
  result: CommandResult;
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

export function verify(result: CommandResult, expect: Expectation): VerifyResult {
  const divergences: Divergence[] = [];

  // Check ok status
  if (expect.ok !== undefined && result.ok !== expect.ok) {
    divergences.push({
      field: "ok",
      expected: String(expect.ok),
      actual: String(result.ok),
      severity: "error",
    });
  }

  // Check count
  if (expect.count !== undefined) {
    if (typeof expect.count === "number") {
      if (result.count !== expect.count) {
        divergences.push({
          field: "count",
          expected: String(expect.count),
          actual: String(result.count),
          severity: result.count === 0 ? "error" : "warning",
        });
      }
    } else {
      const { min, max } = expect.count;
      if (min !== undefined && result.count < min) {
        divergences.push({
          field: "count",
          expected: `>= ${min}`,
          actual: String(result.count),
          severity: "error",
        });
      }
      if (max !== undefined && result.count > max) {
        divergences.push({
          field: "count",
          expected: `<= ${max}`,
          actual: String(result.count),
          severity: "warning",
        });
      }
    }
  }

  // Check plan presence
  if (expect.hasPlan !== undefined) {
    const hasPlan = result.plan != null;
    if (hasPlan !== expect.hasPlan) {
      divergences.push({
        field: "plan",
        expected: expect.hasPlan ? "present" : "absent",
        actual: hasPlan ? "present" : "absent",
        severity: "error",
      });
    }
  }

  // Check warning count
  if (expect.warningCount !== undefined) {
    const wc = result.warnings.length;
    const { min, max } = expect.warningCount;
    if (min !== undefined && wc < min) {
      divergences.push({
        field: "warnings.length",
        expected: `>= ${min}`,
        actual: String(wc),
        severity: "warning",
      });
    }
    if (max !== undefined && wc > max) {
      divergences.push({
        field: "warnings.length",
        expected: `<= ${max}`,
        actual: String(wc),
        severity: "warning",
      });
    }
  }

  // Check data fields
  if (expect.fields && result.data != null && typeof result.data === "object") {
    const data = result.data as Record<string, unknown>;
    for (const [key, check] of Object.entries(expect.fields)) {
      const actual = data[key];
      checkField(key, actual, check, divergences);
    }
  }

  return {
    passed: divergences.filter((d) => d.severity === "error").length === 0,
    divergences,
    result,
  };
}

function checkField(
  key: string,
  actual: unknown,
  check: FieldCheck,
  divergences: Divergence[],
): void {
  if ("present" in check) {
    if (actual === undefined || actual === null) {
      divergences.push({
        field: key,
        expected: "present",
        actual: "missing",
        severity: "error",
      });
    }
    return;
  }

  if ("type" in check) {
    const actualType = Array.isArray(actual) ? "array" : typeof actual;
    if (actualType !== check.type) {
      divergences.push({
        field: key,
        expected: `type: ${check.type}`,
        actual: `type: ${actualType}`,
        severity: "error",
      });
    }
    return;
  }

  if ("equals" in check) {
    if (actual !== check.equals) {
      divergences.push({
        field: key,
        expected: JSON.stringify(check.equals),
        actual: JSON.stringify(actual),
        severity: "error",
      });
    }
    return;
  }

  if ("contains" in check) {
    if (typeof actual !== "string" || !actual.includes(check.contains)) {
      divergences.push({
        field: key,
        expected: `contains "${check.contains}"`,
        actual: typeof actual === "string" ? `"${actual}"` : String(actual),
        severity: "error",
      });
    }
    return;
  }

  if ("matches" in check) {
    if (typeof actual !== "string" || !new RegExp(check.matches).test(actual)) {
      divergences.push({
        field: key,
        expected: `matches /${check.matches}/`,
        actual: typeof actual === "string" ? `"${actual}"` : String(actual),
        severity: "error",
      });
    }
    return;
  }
}
