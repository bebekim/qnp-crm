/**
 * Confirmation tier logic for pipe orchestration.
 *
 * Enforces the three-tier confirmation model across pipe boundaries:
 * - READ: execute immediately, no --confirm needed
 * - WRITE: dry-run plan without --confirm, execute with it
 * - RECEIPT: dry-run plan without --confirm, execute with it (bright line)
 */

import { Envelope, type PlanStep, type Plan } from "./envelope.js";

// ---------------------------------------------------------------------------
// Tier enum
// ---------------------------------------------------------------------------

export enum Tier {
  READ = "read",
  WRITE = "write",
  RECEIPT = "receipt",
}

// ---------------------------------------------------------------------------
// Tier checks
// ---------------------------------------------------------------------------

/** Does this tier require --confirm to execute? */
export function needsConfirmation(tier: Tier): boolean {
  return tier !== Tier.READ;
}

/** Should this command execute (vs emit a plan)? */
export function shouldExecute(tier: Tier, confirmFlag: boolean): boolean {
  if (tier === Tier.READ) return true;
  return confirmFlag;
}

// ---------------------------------------------------------------------------
// Plan propagation
// ---------------------------------------------------------------------------

/**
 * Should this command skip execution because upstream is in plan mode?
 * If `_plan` exists in the piped input, the command MUST NOT execute
 * side effects — it should append its own step to the plan instead.
 */
export function shouldSkipForPlan(upstream: Envelope): boolean {
  return upstream.hasPlan();
}

/**
 * Build a plan envelope for a dry-run (no --confirm) or plan propagation.
 *
 * Creates or appends to the `_plan` in the envelope data.
 * Passes through all upstream data fields.
 */
export function buildPlanEnvelope(
  upstream: Envelope,
  step: PlanStep,
  confirmCommand: string,
): Envelope {
  const env = upstream.nextStage(step.command);

  // Preserve existing plan steps or start fresh
  const existingPlan = upstream.data._plan as Plan | undefined;
  const steps = existingPlan ? [...existingPlan.steps, step] : [step];

  env.data._plan = {
    steps,
    confirm_command: confirmCommand,
  };

  return env;
}
