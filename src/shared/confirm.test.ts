import { describe, it, expect } from "vitest";
import { Envelope, type PlanStep } from "./envelope.js";
import {
  Tier,
  needsConfirmation,
  shouldExecute,
  buildPlanEnvelope,
  shouldSkipForPlan,
} from "./confirm.js";

// ---------------------------------------------------------------------------
// needsConfirmation — tier-based confirmation requirement
// ---------------------------------------------------------------------------

describe("needsConfirmation()", () => {
  it("returns false for READ tier", () => {
    expect(needsConfirmation(Tier.READ)).toBe(false);
  });

  it("returns true for WRITE tier", () => {
    expect(needsConfirmation(Tier.WRITE)).toBe(true);
  });

  it("returns true for RECEIPT tier", () => {
    expect(needsConfirmation(Tier.RECEIPT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldExecute — determine if a command should execute or plan
// ---------------------------------------------------------------------------

describe("shouldExecute()", () => {
  it("always executes READ tier commands (regardless of --confirm)", () => {
    expect(shouldExecute(Tier.READ, false)).toBe(true);
    expect(shouldExecute(Tier.READ, true)).toBe(true);
  });

  it("does not execute WRITE tier without --confirm", () => {
    expect(shouldExecute(Tier.WRITE, false)).toBe(false);
  });

  it("executes WRITE tier with --confirm", () => {
    expect(shouldExecute(Tier.WRITE, true)).toBe(true);
  });

  it("does not execute RECEIPT tier without --confirm", () => {
    expect(shouldExecute(Tier.RECEIPT, false)).toBe(false);
  });

  it("executes RECEIPT tier with --confirm", () => {
    expect(shouldExecute(Tier.RECEIPT, true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldSkipForPlan — plan propagation rule
// ---------------------------------------------------------------------------

describe("shouldSkipForPlan()", () => {
  it("returns false when no plan in upstream data", () => {
    const env = Envelope.ok({ donation_id: "d-abc" });
    expect(shouldSkipForPlan(env)).toBe(false);
  });

  it("returns true when _plan exists in upstream data", () => {
    const env = Envelope.ok({
      donation_id: "d-abc",
      _plan: {
        steps: [{ stage: 0, command: "donations add", tier: "write", description: "Add $500" }],
        confirm_command: "qnp-crm donations add 500 --confirm",
      },
    });
    expect(shouldSkipForPlan(env)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildPlanEnvelope — create a plan envelope for dry-run
// ---------------------------------------------------------------------------

describe("buildPlanEnvelope()", () => {
  it("creates a plan envelope with step metadata", () => {
    const upstream = Envelope.ok(
      { contact_id: "c-abc", donation_id: "d-xyz" },
      { pipeId: "p-test", stage: 0 },
    );

    const step: PlanStep = {
      stage: 1,
      command: "receipts generate",
      tier: "receipt",
      description: "Generate DGR receipt #44 for Jane Smith — $500.00",
    };

    const result = buildPlanEnvelope(upstream, step, "qnp-crm receipts generate d-xyz --confirm");

    expect(result.ok).toBe(true);
    expect(result.pipe_id).toBe("p-test");
    expect(result.stage).toBe(1);

    const plan = result.data._plan!;
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].command).toBe("receipts generate");
    expect(plan.confirm_command).toBe("qnp-crm receipts generate d-xyz --confirm");

    // Original data preserved
    expect(result.data.contact_id).toBe("c-abc");
    expect(result.data.donation_id).toBe("d-xyz");
  });

  it("appends to existing plan from upstream", () => {
    const upstream = Envelope.ok(
      {
        donation_id: "d-abc",
        _plan: {
          steps: [
            { stage: 0, command: "donations add", tier: "write", description: "Add $500" },
          ],
          confirm_command: "qnp-crm donations add 500 --confirm",
        },
      },
      { pipeId: "p-test", stage: 0 },
    );

    const step: PlanStep = {
      stage: 1,
      command: "receipts generate",
      tier: "receipt",
      description: "Generate receipt",
    };

    const result = buildPlanEnvelope(
      upstream,
      step,
      "qnp-crm donations add 500 --confirm | qnp-crm receipts generate --confirm",
    );

    const plan = result.data._plan!;
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].command).toBe("donations add");
    expect(plan.steps[1].command).toBe("receipts generate");
  });

  it("preserves upstream warnings", () => {
    const upstream = Envelope.ok({}, { warnings: ["no address on file"] });
    const step: PlanStep = {
      stage: 0,
      command: "cmd",
      tier: "write",
      description: "test",
    };

    const result = buildPlanEnvelope(upstream, step, "cmd --confirm");
    expect(result.warnings).toEqual(["no address on file"]);
  });
});
