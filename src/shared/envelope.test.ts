import { describe, it, expect } from "vitest";
import { Envelope } from "./envelope.js";

describe("Envelope", () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe("ok()", () => {
    it("creates a success envelope with data", () => {
      const env = Envelope.ok({ donation_id: "d-abc123", donation_amount: 500 });

      expect(env.v).toBe(1);
      expect(env.ok).toBe(true);
      expect(env.data.donation_id).toBe("d-abc123");
      expect(env.data.donation_amount).toBe(500);
      expect(env.warnings).toEqual([]);
      expect(env.error).toBeNull();
      expect(env.stage).toBe(0);
    });

    it("accepts optional pipe_id", () => {
      const env = Envelope.ok({ x: 1 }, { pipeId: "p-test123" });
      expect(env.pipe_id).toBe("p-test123");
    });

    it("accepts optional stage", () => {
      const env = Envelope.ok({ x: 1 }, { stage: 3 });
      expect(env.stage).toBe(3);
    });

    it("accepts optional command", () => {
      const env = Envelope.ok({ x: 1 }, { command: "donations add" });
      expect(env.command).toBe("donations add");
    });

    it("accepts optional idempotency_key", () => {
      const env = Envelope.ok({ x: 1 }, { idempotencyKey: "ik-d-abc-receipt" });
      expect(env.idempotency_key).toBe("ik-d-abc-receipt");
    });

    it("accepts optional warnings", () => {
      const env = Envelope.ok({ x: 1 }, { warnings: ["no address on file"] });
      expect(env.warnings).toEqual(["no address on file"]);
    });
  });

  describe("err()", () => {
    it("creates a failure envelope", () => {
      const env = Envelope.err("Contact not found: Jane Smyth", "donations add");

      expect(env.v).toBe(1);
      expect(env.ok).toBe(false);
      expect(env.error).toBe("Contact not found: Jane Smyth");
      expect(env.command).toBe("donations add");
      expect(env.failed_command).toBe("donations add");
      expect(env.data).toEqual({});
    });

    it("preserves pipe context on failure", () => {
      const env = Envelope.err("broken", "cmd", {
        pipeId: "p-abc",
        stage: 2,
      });

      expect(env.pipe_id).toBe("p-abc");
      expect(env.stage).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  describe("toJson()", () => {
    it("serializes to a valid JSON string", () => {
      const env = Envelope.ok({ donation_id: "d-abc" }, { command: "donations add" });
      const json = env.toJson();
      const parsed = JSON.parse(json);

      expect(parsed.v).toBe(1);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.donation_id).toBe("d-abc");
      expect(parsed.command).toBe("donations add");
    });

    it("includes all fields for failure envelopes", () => {
      const env = Envelope.err("bad", "cmd1");
      const parsed = JSON.parse(env.toJson());

      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBe("bad");
      expect(parsed.failed_command).toBe("cmd1");
    });
  });

  describe("fromJson()", () => {
    it("parses a valid success envelope", () => {
      const input = JSON.stringify({
        v: 1,
        ok: true,
        pipe_id: "p-test",
        stage: 1,
        data: { donation_id: "d-xyz" },
        warnings: ["warning1"],
        error: null,
        command: "donations add",
      });

      const env = Envelope.fromJson(input);
      expect(env.ok).toBe(true);
      expect(env.pipe_id).toBe("p-test");
      expect(env.stage).toBe(1);
      expect(env.data.donation_id).toBe("d-xyz");
      expect(env.warnings).toEqual(["warning1"]);
      expect(env.command).toBe("donations add");
    });

    it("parses a valid failure envelope", () => {
      const input = JSON.stringify({
        v: 1,
        ok: false,
        pipe_id: "p-test",
        stage: 2,
        data: {},
        warnings: [],
        error: "not found",
        failed_command: "donations add",
        command: "receipts generate",
      });

      const env = Envelope.fromJson(input);
      expect(env.ok).toBe(false);
      expect(env.error).toBe("not found");
      expect(env.failed_command).toBe("donations add");
      expect(env.command).toBe("receipts generate");
    });

    it("throws on invalid JSON", () => {
      expect(() => Envelope.fromJson("not json at all")).toThrow();
    });

    it("throws on missing required fields", () => {
      expect(() => Envelope.fromJson(JSON.stringify({ v: 1, ok: true }))).toThrow();
    });

    it("throws on unsupported envelope version", () => {
      const input = JSON.stringify({
        v: 99,
        ok: true,
        pipe_id: null,
        stage: 0,
        data: {},
        warnings: [],
        error: null,
      });

      expect(() => Envelope.fromJson(input)).toThrow(/version/i);
    });
  });

  // -------------------------------------------------------------------------
  // Mutation helpers
  // -------------------------------------------------------------------------

  describe("addData()", () => {
    it("merges new data fields", () => {
      const env = Envelope.ok({ contact_id: "c-abc" });
      env.addData({ donation_id: "d-xyz", donation_amount: 100 });

      expect(env.data.contact_id).toBe("c-abc");
      expect(env.data.donation_id).toBe("d-xyz");
      expect(env.data.donation_amount).toBe(100);
    });

    it("overwrites existing keys", () => {
      const env = Envelope.ok({ contact_name: "Jane" });
      env.addData({ contact_name: "Jane Smith" });

      expect(env.data.contact_name).toBe("Jane Smith");
    });
  });

  describe("addWarning()", () => {
    it("appends a warning", () => {
      const env = Envelope.ok({});
      env.addWarning("no address");
      env.addWarning("email bounced");

      expect(env.warnings).toEqual(["no address", "email bounced"]);
    });
  });

  describe("nextStage()", () => {
    it("increments stage and sets command", () => {
      const env = Envelope.ok({ x: 1 }, { stage: 0, pipeId: "p-abc" });
      const next = env.nextStage("receipts generate");

      expect(next.stage).toBe(1);
      expect(next.command).toBe("receipts generate");
      expect(next.pipe_id).toBe("p-abc");
      // Original data preserved
      expect(next.data.x).toBe(1);
    });

    it("carries warnings forward", () => {
      const env = Envelope.ok({}, { warnings: ["w1"] });
      const next = env.nextStage("cmd2");

      expect(next.warnings).toEqual(["w1"]);
    });
  });

  describe("propagateFailure()", () => {
    it("re-emits failure with new command but preserves failed_command", () => {
      const original = Envelope.err("bad input", "donations add", { pipeId: "p-abc", stage: 1 });
      const propagated = original.propagateFailure("receipts generate");

      expect(propagated.ok).toBe(false);
      expect(propagated.error).toBe("bad input");
      expect(propagated.failed_command).toBe("donations add");
      expect(propagated.command).toBe("receipts generate");
      expect(propagated.stage).toBe(2); // incremented
    });
  });

  // -------------------------------------------------------------------------
  // Plan envelope support
  // -------------------------------------------------------------------------

  describe("plan support", () => {
    it("hasPlan() returns false for normal envelopes", () => {
      const env = Envelope.ok({ x: 1 });
      expect(env.hasPlan()).toBe(false);
    });

    it("hasPlan() returns true when _plan exists in data", () => {
      const env = Envelope.ok({
        _plan: {
          steps: [{ stage: 0, command: "donations add", tier: "write", description: "Add $500" }],
          confirm_command: "qnp-crm donations add 500 --confirm",
        },
      });
      expect(env.hasPlan()).toBe(true);
    });

    it("appendPlanStep() creates plan if none exists", () => {
      const env = Envelope.ok({ donation_id: "d-abc" });
      env.appendPlanStep({
        stage: 1,
        command: "receipts generate",
        tier: "receipt",
        description: "Generate receipt for d-abc",
      });

      expect(env.hasPlan()).toBe(true);
      const plan = env.data._plan as any;
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].command).toBe("receipts generate");
    });

    it("appendPlanStep() appends to existing plan", () => {
      const env = Envelope.ok({
        _plan: {
          steps: [{ stage: 0, command: "donations add", tier: "write", description: "Add $500" }],
          confirm_command: "qnp-crm donations add 500 --confirm",
        },
      });

      env.appendPlanStep({
        stage: 1,
        command: "receipts generate",
        tier: "receipt",
        description: "Generate receipt",
      });

      const plan = env.data._plan as any;
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[1].command).toBe("receipts generate");
    });
  });

  // -------------------------------------------------------------------------
  // pipe_id generation
  // -------------------------------------------------------------------------

  describe("generatePipeId()", () => {
    it("generates an id starting with p-", () => {
      const id = Envelope.generatePipeId();
      expect(id).toMatch(/^p-[a-z0-9]+$/);
    });

    it("generates unique ids", () => {
      const ids = new Set(Array.from({ length: 100 }, () => Envelope.generatePipeId()));
      expect(ids.size).toBe(100);
    });
  });
});
