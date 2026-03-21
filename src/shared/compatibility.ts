/**
 * Pipe compatibility — command self-description and pipeline validation.
 *
 * Every command supports --explain-pipe which outputs its pipe contract:
 * what it requires, what it provides, and its confirmation tier.
 *
 * `qnp-crm pipe validate` checks a sequence of commands for field
 * compatibility before execution.
 */

import type { Tier } from "./confirm.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipeContract {
  command: string;
  tier: "read" | "write" | "receipt";
  requires: string[];
  optional: string[];
  provides: string[];
  passthrough: boolean;
}

export interface StageResult {
  command: string;
  ok: boolean;
  requires: string[];
  provides: string[];
  accumulated: string[];
  missing?: string[];
}

export interface ValidationResult {
  valid: boolean;
  stages: StageResult[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Pipeline validation
// ---------------------------------------------------------------------------

/**
 * Validate that a sequence of commands can be piped together.
 *
 * Checks that each command's `requires` are satisfied by the accumulated
 * `provides` of all upstream commands.
 */
export function validatePipeline(contracts: PipeContract[]): ValidationResult {
  const stages: StageResult[] = [];
  const errors: string[] = [];
  let accumulated: string[] = [];

  for (const contract of contracts) {
    const missing = contract.requires.filter((r) => !accumulated.includes(r));
    const ok = missing.length === 0;

    if (!ok) {
      errors.push(
        `${contract.command} requires: ${missing.join(", ")} — not provided by upstream commands.`,
      );
    }

    // After this stage, what's available?
    // passthrough means all upstream fields are preserved
    const newProvides = contract.provides;
    if (contract.passthrough) {
      accumulated = [...new Set([...accumulated, ...newProvides])];
    } else {
      accumulated = [...newProvides];
    }

    stages.push({
      command: contract.command,
      ok,
      requires: contract.requires,
      provides: newProvides,
      accumulated: [...accumulated],
      ...(missing.length > 0 ? { missing } : {}),
    });
  }

  return {
    valid: errors.length === 0,
    stages,
    errors,
  };
}
