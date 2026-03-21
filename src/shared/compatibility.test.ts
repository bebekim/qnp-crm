import { describe, it, expect } from "vitest";
import {
  type PipeContract,
  validatePipeline,
  type ValidationResult,
} from "./compatibility.js";

// ---------------------------------------------------------------------------
// PipeContract — command self-description
// ---------------------------------------------------------------------------

const contracts: Record<string, PipeContract> = {
  "contacts show": {
    command: "contacts show",
    tier: "read",
    requires: [],
    optional: [],
    provides: ["contact_id", "contact_name", "contact_email", "contact_phone"],
    passthrough: true,
  },
  "donations add": {
    command: "donations add",
    tier: "write",
    requires: ["contact_id"],
    optional: ["contact_name"],
    provides: ["donation_id", "donation_amount", "donation_method", "donation_date", "donation_status"],
    passthrough: true,
  },
  "receipts generate": {
    command: "receipts generate",
    tier: "receipt",
    requires: ["donation_id"],
    optional: ["contact_id", "contact_name", "donation_amount"],
    provides: ["receipt_number", "receipt_pdf_path", "receipt_pdf_hash", "receipt_date"],
    passthrough: true,
  },
  "notify thankyou": {
    command: "notify thankyou",
    tier: "write",
    requires: ["contact_email", "receipt_pdf_path"],
    optional: ["contact_name", "receipt_number"],
    provides: ["notify_email_sent", "notify_message_id"],
    passthrough: true,
  },
};

// ---------------------------------------------------------------------------
// validatePipeline
// ---------------------------------------------------------------------------

describe("validatePipeline()", () => {
  it("validates a correct pipeline", () => {
    const result = validatePipeline([
      contracts["contacts show"],
      contracts["donations add"],
      contracts["receipts generate"],
      contracts["notify thankyou"],
    ]);

    expect(result.valid).toBe(true);
    expect(result.stages).toHaveLength(4);
    expect(result.errors).toEqual([]);
  });

  it("shows accumulated provides at each stage", () => {
    const result = validatePipeline([
      contracts["contacts show"],
      contracts["donations add"],
    ]);

    // After contacts show
    expect(result.stages[0].accumulated).toContain("contact_id");
    expect(result.stages[0].accumulated).toContain("contact_name");

    // After donations add
    expect(result.stages[1].accumulated).toContain("contact_id"); // passthrough
    expect(result.stages[1].accumulated).toContain("donation_id"); // new
  });

  it("detects missing required fields", () => {
    const result = validatePipeline([
      contracts["contacts show"],
      contracts["receipts generate"], // requires donation_id, not provided
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("donation_id");
    expect(result.errors[0]).toContain("receipts generate");
  });

  it("validates a single command (no upstream requirements)", () => {
    const result = validatePipeline([contracts["contacts show"]]);

    expect(result.valid).toBe(true);
    expect(result.stages).toHaveLength(1);
  });

  it("handles empty pipeline", () => {
    const result = validatePipeline([]);

    expect(result.valid).toBe(true);
    expect(result.stages).toEqual([]);
  });

  it("detects multiple missing fields", () => {
    const result = validatePipeline([
      contracts["notify thankyou"], // requires contact_email, receipt_pdf_path
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("contact_email");
    expect(result.errors[0]).toContain("receipt_pdf_path");
  });

  it("marks each stage's check status", () => {
    const result = validatePipeline([
      contracts["contacts show"],
      contracts["donations add"],
    ]);

    expect(result.stages[0].ok).toBe(true);
    expect(result.stages[1].ok).toBe(true);
    expect(result.stages[1].requires).toEqual(["contact_id"]);
  });
});
