import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Envelope } from "./envelope.js";
import { mergeInputs, parseStdin, isPiped, type PipeFieldSpec } from "./pipe.js";

// ---------------------------------------------------------------------------
// mergeInputs — flag/pipe merge with override warnings
// ---------------------------------------------------------------------------

describe("mergeInputs()", () => {
  it("uses piped values when no flags provided", () => {
    const upstream = Envelope.ok({
      contact_id: "c-abc",
      contact_name: "Jane Smith",
    });

    const { data, warnings } = mergeInputs(upstream, {});

    expect(data.contact_id).toBe("c-abc");
    expect(data.contact_name).toBe("Jane Smith");
    expect(warnings).toEqual([]);
  });

  it("uses flag values when no piped data", () => {
    const upstream = Envelope.ok({});

    const { data, warnings } = mergeInputs(upstream, {
      contact_id: "c-from-flag",
    });

    expect(data.contact_id).toBe("c-from-flag");
    expect(warnings).toEqual([]);
  });

  it("flags override piped values with warning", () => {
    const upstream = Envelope.ok({
      contact_id: "c-piped",
      contact_name: "Jane",
    });

    const { data, warnings } = mergeInputs(upstream, {
      contact_id: "c-flag",
    });

    expect(data.contact_id).toBe("c-flag");
    expect(data.contact_name).toBe("Jane"); // not overridden
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("--contact_id");
    expect(warnings[0]).toContain("c-piped");
  });

  it("ignores undefined flag values (does not override)", () => {
    const upstream = Envelope.ok({ contact_id: "c-piped" });

    const { data, warnings } = mergeInputs(upstream, {
      contact_id: undefined,
    });

    expect(data.contact_id).toBe("c-piped");
    expect(warnings).toEqual([]);
  });

  it("merges multiple fields correctly", () => {
    const upstream = Envelope.ok({
      contact_id: "c-abc",
      donation_amount: 500,
    });

    const { data } = mergeInputs(upstream, {
      donation_method: "eft",
    });

    expect(data.contact_id).toBe("c-abc");
    expect(data.donation_amount).toBe(500);
    expect(data.donation_method).toBe("eft");
  });
});

// ---------------------------------------------------------------------------
// parseStdin — envelope parsing from raw stdin
// ---------------------------------------------------------------------------

describe("parseStdin()", () => {
  it("parses a valid JSON envelope", () => {
    const raw = JSON.stringify({
      v: 1,
      ok: true,
      pipe_id: "p-test",
      stage: 0,
      data: { contact_id: "c-abc" },
      warnings: [],
      error: null,
    });

    const result = parseStdin(raw);
    expect(result.type).toBe("envelope");
    if (result.type === "envelope") {
      expect(result.envelope.data.contact_id).toBe("c-abc");
    }
  });

  it("detects a failure envelope", () => {
    const raw = JSON.stringify({
      v: 1,
      ok: false,
      pipe_id: "p-test",
      stage: 1,
      data: {},
      warnings: [],
      error: "Contact not found",
      failed_command: "contacts show",
    });

    const result = parseStdin(raw);
    expect(result.type).toBe("failure");
    if (result.type === "failure") {
      expect(result.envelope.error).toBe("Contact not found");
      expect(result.envelope.failed_command).toBe("contacts show");
    }
  });

  it("returns empty for blank stdin", () => {
    expect(parseStdin("").type).toBe("empty");
    expect(parseStdin("  \n  ").type).toBe("empty");
  });

  it("returns error for invalid JSON", () => {
    const result = parseStdin("not json at all");
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("not json at all");
    }
  });

  it("returns error for unsupported envelope version", () => {
    const raw = JSON.stringify({
      v: 99,
      ok: true,
      pipe_id: null,
      stage: 0,
      data: {},
      warnings: [],
      error: null,
    });

    const result = parseStdin(raw);
    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toContain("version");
    }
  });

  it("parses JSONL (multiple lines) as batch", () => {
    const line1 = JSON.stringify({ v: 1, ok: true, pipe_id: "p-abc", stage: 0, data: { donation_id: "d-001" }, warnings: [] });
    const line2 = JSON.stringify({ v: 1, ok: true, pipe_id: "p-abc", stage: 0, data: { donation_id: "d-002" }, warnings: [] });
    const raw = line1 + "\n" + line2;

    const result = parseStdin(raw);
    expect(result.type).toBe("batch");
    if (result.type === "batch") {
      expect(result.envelopes).toHaveLength(2);
      expect(result.envelopes[0].data.donation_id).toBe("d-001");
      expect(result.envelopes[1].data.donation_id).toBe("d-002");
    }
  });
});

// ---------------------------------------------------------------------------
// checkRequiredFields
// ---------------------------------------------------------------------------

describe("checkRequiredFields()", () => {
  // Import inline to keep it co-located
  let checkRequiredFields: typeof import("./pipe.js").checkRequiredFields;

  beforeEach(async () => {
    const mod = await import("./pipe.js");
    checkRequiredFields = mod.checkRequiredFields;
  });

  it("returns null when all required fields present", () => {
    const data = { donation_id: "d-abc", contact_id: "c-xyz" };
    const result = checkRequiredFields(data, ["donation_id"]);
    expect(result).toBeNull();
  });

  it("returns error listing missing fields", () => {
    const data = { contact_id: "c-xyz", contact_name: "Jane" };
    const result = checkRequiredFields(data, ["donation_id", "donation_amount"]);

    expect(result).not.toBeNull();
    expect(result!).toContain("donation_id");
    expect(result!).toContain("donation_amount");
    expect(result!).toContain("contact_id"); // shows available fields
  });

  it("returns null for empty required list", () => {
    const result = checkRequiredFields({}, []);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isPiped — stdin TTY detection
// ---------------------------------------------------------------------------

describe("isPiped()", () => {
  const origIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, writable: true });
  });

  it("returns false when stdin is a TTY", () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true });
    expect(isPiped()).toBe(false);
  });

  it("returns true when stdin is not a TTY", () => {
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, writable: true });
    expect(isPiped()).toBe(true);
  });
});
