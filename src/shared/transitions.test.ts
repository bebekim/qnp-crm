import { describe, it, expect } from "vitest";
import { TRANSITIONS, isValidTransition, transitionError } from "./transitions.js";

// ---------------------------------------------------------------------------
// TRANSITIONS map
// ---------------------------------------------------------------------------

describe("TRANSITIONS", () => {
  it("defines valid transitions from recorded", () => {
    expect(TRANSITIONS.recorded).toContain("receipted");
    expect(TRANSITIONS.recorded).toContain("cancelled");
  });

  it("defines valid transitions from receipted", () => {
    expect(TRANSITIONS.receipted).toContain("thanked");
    expect(TRANSITIONS.receipted).toContain("voided");
  });

  it("defines valid transitions from thanked", () => {
    expect(TRANSITIONS.thanked).toContain("voided");
  });

  it("voided is terminal", () => {
    expect(TRANSITIONS.voided).toEqual([]);
  });

  it("cancelled is terminal", () => {
    expect(TRANSITIONS.cancelled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isValidTransition
// ---------------------------------------------------------------------------

describe("isValidTransition()", () => {
  it("returns true for valid transitions", () => {
    expect(isValidTransition("recorded", "receipted")).toBe(true);
    expect(isValidTransition("recorded", "cancelled")).toBe(true);
    expect(isValidTransition("receipted", "thanked")).toBe(true);
    expect(isValidTransition("receipted", "voided")).toBe(true);
    expect(isValidTransition("thanked", "voided")).toBe(true);
  });

  it("returns false for invalid transitions", () => {
    expect(isValidTransition("recorded", "thanked")).toBe(false);
    expect(isValidTransition("recorded", "voided")).toBe(false);
    expect(isValidTransition("thanked", "recorded")).toBe(false);
    expect(isValidTransition("voided", "recorded")).toBe(false);
    expect(isValidTransition("cancelled", "recorded")).toBe(false);
  });

  it("returns false for unknown current status", () => {
    expect(isValidTransition("nonexistent", "recorded")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// transitionError — produces human-readable error messages
// ---------------------------------------------------------------------------

describe("transitionError()", () => {
  it("describes invalid transition with valid alternatives", () => {
    const err = transitionError("d-abc123", "recorded", "thanked");

    expect(err).toContain("recorded");
    expect(err).toContain("thanked");
    expect(err).toContain("receipted"); // valid alternative
    expect(err).toContain("cancelled"); // valid alternative
  });

  it("notes terminal states have no valid transitions", () => {
    const err = transitionError("d-abc123", "voided", "recorded");

    expect(err).toContain("voided");
    expect(err).toContain("none (terminal)");
  });

  it("includes donation ID", () => {
    const err = transitionError("d-xyz", "recorded", "thanked");
    expect(err).toContain("d-xyz");
  });
});
