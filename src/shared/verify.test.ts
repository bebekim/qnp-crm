import { describe, it, expect } from "vitest";
import { verify, type Expectation } from "./verify.js";
import type { CommandResult } from "../types.js";

// ---------------------------------------------------------------------------
// Helper — build a CommandResult for testing
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    ok: true,
    data: { id: "abc123", name: "Jane Smith", amount: "500.00", method: "eft" },
    count: 1,
    warnings: [],
    hints: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// verify() — Layer 3 core
// ---------------------------------------------------------------------------

describe("verify()", () => {
  // --- ok status ---

  it("passes when ok matches expectation", () => {
    const result = verify(makeResult({ ok: true }), { ok: true });
    expect(result.passed).toBe(true);
    expect(result.divergences).toEqual([]);
  });

  it("fails when ok diverges", () => {
    const result = verify(makeResult({ ok: false }), { ok: true });
    expect(result.passed).toBe(false);
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].field).toBe("ok");
    expect(result.divergences[0].severity).toBe("error");
  });

  // --- count ---

  it("passes when count matches exact number", () => {
    const result = verify(makeResult({ count: 5 }), { count: 5 });
    expect(result.passed).toBe(true);
  });

  it("warns when count diverges from exact (non-zero actual)", () => {
    const result = verify(makeResult({ count: 3 }), { count: 5 });
    expect(result.passed).toBe(true); // warnings don't fail
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].severity).toBe("warning");
  });

  it("fails when count is zero but expected non-zero", () => {
    const result = verify(makeResult({ count: 0 }), { count: 5 });
    expect(result.passed).toBe(false);
    expect(result.divergences[0].severity).toBe("error");
  });

  it("passes when count is within range", () => {
    const result = verify(makeResult({ count: 5 }), { count: { min: 1, max: 10 } });
    expect(result.passed).toBe(true);
  });

  it("fails when count is below min", () => {
    const result = verify(makeResult({ count: 0 }), { count: { min: 1 } });
    expect(result.passed).toBe(false);
    expect(result.divergences[0].expected).toBe(">= 1");
  });

  it("warns when count exceeds max", () => {
    const result = verify(makeResult({ count: 100 }), { count: { max: 50 } });
    expect(result.passed).toBe(true); // warning only
    expect(result.divergences[0].severity).toBe("warning");
    expect(result.divergences[0].expected).toBe("<= 50");
  });

  // --- plan presence ---

  it("passes when plan presence matches", () => {
    const result = verify(
      makeResult({ plan: { action: "test", details: {}, tier: "write", confirmCommand: "qnp-crm ..." } }),
      { hasPlan: true },
    );
    expect(result.passed).toBe(true);
  });

  it("fails when plan expected but absent", () => {
    const result = verify(makeResult(), { hasPlan: true });
    expect(result.passed).toBe(false);
    expect(result.divergences[0].field).toBe("plan");
    expect(result.divergences[0].expected).toBe("present");
    expect(result.divergences[0].actual).toBe("absent");
  });

  it("fails when plan absent expected but present", () => {
    const result = verify(
      makeResult({ plan: { action: "test", details: {}, tier: "write", confirmCommand: "" } }),
      { hasPlan: false },
    );
    expect(result.passed).toBe(false);
    expect(result.divergences[0].expected).toBe("absent");
    expect(result.divergences[0].actual).toBe("present");
  });

  // --- warning count ---

  it("passes when warning count is within range", () => {
    const result = verify(makeResult({ warnings: ["a", "b"] }), { warningCount: { min: 1, max: 3 } });
    expect(result.passed).toBe(true);
  });

  it("warns when too many warnings", () => {
    const result = verify(makeResult({ warnings: ["a", "b", "c"] }), { warningCount: { max: 1 } });
    expect(result.divergences).toHaveLength(1);
    expect(result.divergences[0].severity).toBe("warning");
  });

  // --- field checks: equals ---

  it("passes when field equals expected value", () => {
    const result = verify(makeResult(), { fields: { method: { equals: "eft" } } });
    expect(result.passed).toBe(true);
  });

  it("fails when field does not equal expected value", () => {
    const result = verify(makeResult(), { fields: { method: { equals: "cash" } } });
    expect(result.passed).toBe(false);
    expect(result.divergences[0].field).toBe("method");
    expect(result.divergences[0].expected).toBe('"cash"');
    expect(result.divergences[0].actual).toBe('"eft"');
  });

  // --- field checks: contains ---

  it("passes when field contains substring", () => {
    const result = verify(makeResult(), { fields: { name: { contains: "Jane" } } });
    expect(result.passed).toBe(true);
  });

  it("fails when field does not contain substring", () => {
    const result = verify(makeResult(), { fields: { name: { contains: "Tom" } } });
    expect(result.passed).toBe(false);
    expect(result.divergences[0].expected).toContain("Tom");
  });

  // --- field checks: matches ---

  it("passes when field matches regex", () => {
    const result = verify(makeResult(), { fields: { amount: { matches: "^\\d+\\.\\d{2}$" } } });
    expect(result.passed).toBe(true);
  });

  it("fails when field does not match regex", () => {
    const result = verify(makeResult(), { fields: { amount: { matches: "^\\d{4}$" } } });
    expect(result.passed).toBe(false);
  });

  // --- field checks: type ---

  it("passes when field type matches", () => {
    const result = verify(makeResult(), { fields: { name: { type: "string" } } });
    expect(result.passed).toBe(true);
  });

  it("fails when field type does not match", () => {
    const result = verify(makeResult(), { fields: { name: { type: "number" } } });
    expect(result.passed).toBe(false);
    expect(result.divergences[0].expected).toBe("type: number");
    expect(result.divergences[0].actual).toBe("type: string");
  });

  // --- field checks: present ---

  it("passes when field is present", () => {
    const result = verify(makeResult(), { fields: { id: { present: true } } });
    expect(result.passed).toBe(true);
  });

  it("fails when field is missing", () => {
    const result = verify(makeResult(), { fields: { nonexistent: { present: true } } });
    expect(result.passed).toBe(false);
    expect(result.divergences[0].expected).toBe("present");
    expect(result.divergences[0].actual).toBe("missing");
  });

  it("fails when field is null", () => {
    const result = verify(
      makeResult({ data: { id: null } }),
      { fields: { id: { present: true } } },
    );
    expect(result.passed).toBe(false);
  });

  // --- combined checks ---

  it("accumulates multiple divergences", () => {
    const result = verify(
      makeResult({ ok: false, count: 0 }),
      { ok: true, count: 1, fields: { method: { equals: "cash" } } },
    );
    expect(result.passed).toBe(false);
    expect(result.divergences.length).toBeGreaterThanOrEqual(2);
  });

  it("passes result through in VerifyResult", () => {
    const original = makeResult({ count: 42 });
    const result = verify(original, {});
    expect(result.result).toBe(original);
    expect(result.result.count).toBe(42);
  });

  // --- empty expectations ---

  it("passes with empty expectations", () => {
    const result = verify(makeResult(), {});
    expect(result.passed).toBe(true);
    expect(result.divergences).toEqual([]);
  });
});
