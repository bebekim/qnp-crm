import { describe, it, expect, vi, afterEach } from "vitest";
import { Envelope } from "./envelope.js";
import { defaultFormat, formatTable, formatEnvelope } from "./format.js";

// ---------------------------------------------------------------------------
// defaultFormat — auto-detect output format
// ---------------------------------------------------------------------------

describe("defaultFormat()", () => {
  const origIsTTY = process.stdout.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, writable: true });
  });

  it("returns 'table' when stdout is a TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true });
    expect(defaultFormat()).toBe("table");
  });

  it("returns 'json' when stdout is not a TTY (piped)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, writable: true });
    expect(defaultFormat()).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// formatTable — human-readable table output
// ---------------------------------------------------------------------------

describe("formatTable()", () => {
  it("formats a success envelope as a table", () => {
    const env = Envelope.ok(
      {
        receipt_number: 44,
        contact_name: "Jane Smith",
        donation_amount: 500.0,
      },
      { pipeId: "p-abc123", stage: 2, command: "receipts generate" },
    );

    const output = formatTable(env, "Receipt Generated");

    expect(output).toContain("Receipt Generated");
    expect(output).toContain("receipt_number");
    expect(output).toContain("44");
    expect(output).toContain("Jane Smith");
    expect(output).toContain("500");
  });

  it("includes warnings with ⚠ prefix", () => {
    const env = Envelope.ok({}, { warnings: ["No postal address on file."] });
    const output = formatTable(env, "Done");

    expect(output).toContain("⚠");
    expect(output).toContain("No postal address on file.");
  });

  it("shows pipe context when available", () => {
    const env = Envelope.ok({}, { pipeId: "p-test123", stage: 2 });
    const output = formatTable(env, "Done");

    expect(output).toContain("p-test123");
    expect(output).toContain("stage 2");
  });

  it("formats error envelopes", () => {
    const env = Envelope.err("Contact not found", "contacts show");
    const output = formatTable(env, "Error");

    expect(output).toContain("Error");
    expect(output).toContain("Contact not found");
  });

  it("omits _plan from table display", () => {
    const env = Envelope.ok({
      donation_id: "d-abc",
      _plan: { steps: [], confirm_command: "cmd" },
    });
    const output = formatTable(env, "Plan");

    expect(output).toContain("d-abc");
    expect(output).not.toContain("_plan");
  });
});

// ---------------------------------------------------------------------------
// formatEnvelope — output an envelope in the requested format
// ---------------------------------------------------------------------------

describe("formatEnvelope()", () => {
  it("returns JSON string for json format", () => {
    const env = Envelope.ok({ x: 1 });
    const output = formatEnvelope(env, "json");
    const parsed = JSON.parse(output);

    expect(parsed.v).toBe(1);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.x).toBe(1);
  });

  it("returns table string for table format", () => {
    const env = Envelope.ok({ x: 1 });
    const output = formatEnvelope(env, "table", "Test");

    expect(output).toContain("Test");
    expect(output).toContain("x");
  });
});
