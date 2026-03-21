import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Envelope } from "./envelope.js";
import {
  createTraceSpan,
  formatSpanName,
  extractPipeMetadata,
  correlationId,
  type PipeSpan,
} from "./trace.js";

// ---------------------------------------------------------------------------
// formatSpanName — human-readable span names
// ---------------------------------------------------------------------------

describe("formatSpanName()", () => {
  it("formats command as span name", () => {
    expect(formatSpanName("donations add")).toBe("qnp-crm:donations-add");
  });

  it("handles multi-word commands", () => {
    expect(formatSpanName("receipts generate")).toBe("qnp-crm:receipts-generate");
  });

  it("handles null command", () => {
    expect(formatSpanName(null)).toBe("qnp-crm:unknown");
  });
});

// ---------------------------------------------------------------------------
// extractPipeMetadata — extract Langfuse-relevant metadata from envelope
// ---------------------------------------------------------------------------

describe("extractPipeMetadata()", () => {
  it("extracts key fields from a success envelope", () => {
    const env = Envelope.ok(
      { donation_id: "d-abc", contact_name: "Jane" },
      { pipeId: "p-test123", stage: 1, command: "donations add" },
    );

    const meta = extractPipeMetadata(env);

    expect(meta.pipeId).toBe("p-test123");
    expect(meta.stage).toBe(1);
    expect(meta.command).toBe("donations add");
    expect(meta.ok).toBe(true);
    expect(meta.error).toBeNull();
    expect(meta.dataKeys).toContain("donation_id");
    expect(meta.dataKeys).toContain("contact_name");
    expect(meta.warningCount).toBe(0);
  });

  it("extracts error info from a failure envelope", () => {
    const env = Envelope.err("Contact not found", "contacts show", {
      pipeId: "p-abc",
      stage: 0,
    });

    const meta = extractPipeMetadata(env);

    expect(meta.ok).toBe(false);
    expect(meta.error).toBe("Contact not found");
    expect(meta.failedCommand).toBe("contacts show");
  });

  it("counts warnings", () => {
    const env = Envelope.ok({}, { warnings: ["warn1", "warn2"] });
    const meta = extractPipeMetadata(env);

    expect(meta.warningCount).toBe(2);
    expect(meta.warnings).toEqual(["warn1", "warn2"]);
  });

  it("detects plan envelopes", () => {
    const env = Envelope.ok({
      _plan: {
        steps: [{ stage: 0, command: "cmd", tier: "write", description: "test" }],
        confirm_command: "cmd --confirm",
      },
    });

    const meta = extractPipeMetadata(env);
    expect(meta.hasPlan).toBe(true);
    expect(meta.planStepCount).toBe(1);
  });

  it("detects idempotency key", () => {
    const env = Envelope.ok({}, { idempotencyKey: "ik-d-abc-receipt" });
    const meta = extractPipeMetadata(env);

    expect(meta.idempotencyKey).toBe("ik-d-abc-receipt");
  });
});

// ---------------------------------------------------------------------------
// createTraceSpan — build a span from an envelope
// ---------------------------------------------------------------------------

describe("createTraceSpan()", () => {
  it("creates a span from a success envelope", () => {
    const env = Envelope.ok(
      { donation_id: "d-abc", donation_amount: 500 },
      { pipeId: "p-test", stage: 0, command: "donations add" },
    );

    const span = createTraceSpan(env);

    expect(span.name).toBe("qnp-crm:donations-add");
    expect(span.metadata.pipeId).toBe("p-test");
    expect(span.metadata.stage).toBe(0);
    expect(span.input).toContain("donation_id");
    expect(span.output).toContain("d-abc");
    expect(span.level).toBe("DEFAULT");
  });

  it("creates an error-level span from a failure envelope", () => {
    const env = Envelope.err("DB unreachable", "receipts generate");

    const span = createTraceSpan(env);

    expect(span.level).toBe("ERROR");
    expect(span.statusMessage).toBe("DB unreachable");
  });

  it("creates a warning-level span when warnings exist", () => {
    const env = Envelope.ok({}, { warnings: ["no address"] });

    const span = createTraceSpan(env);

    expect(span.level).toBe("WARNING");
  });

  it("includes pipe_id as the correlation key", () => {
    const env = Envelope.ok({}, { pipeId: "p-abc123" });
    const span = createTraceSpan(env);

    expect(span.metadata.pipeId).toBe("p-abc123");
  });
});

// ---------------------------------------------------------------------------
// correlationId — link Langfuse traces to PostgreSQL audit log
// ---------------------------------------------------------------------------

describe("correlationId()", () => {
  it("returns pipe_id when available", () => {
    const env = Envelope.ok({}, { pipeId: "p-abc123" });
    expect(correlationId(env)).toBe("p-abc123");
  });

  it("returns null when no pipe_id", () => {
    const env = Envelope.ok({});
    expect(correlationId(env)).toBeNull();
  });
});
