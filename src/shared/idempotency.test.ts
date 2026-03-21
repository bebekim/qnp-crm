import { describe, it, expect, vi, beforeEach } from "vitest";
import { Envelope } from "./envelope.js";
import {
  makeIdempotencyKey,
  checkIdempotency,
  recordIdempotency,
} from "./idempotency.js";
import { createMockDbConfig, createMockDb, setSelectQueue } from "../test-helpers.js";

// ---------------------------------------------------------------------------
// makeIdempotencyKey
// ---------------------------------------------------------------------------

describe("makeIdempotencyKey()", () => {
  it("generates key in ik-{entityId}-{operation} format", () => {
    const key = makeIdempotencyKey("d-a1b2c3d4", "receipt");
    expect(key).toBe("ik-d-a1b2c3d4-receipt");
  });

  it("generates key for notify operation", () => {
    const key = makeIdempotencyKey("d-a1b2c3d4", "notify");
    expect(key).toBe("ik-d-a1b2c3d4-notify");
  });

  it("handles batch operations", () => {
    const key = makeIdempotencyKey("batch-2026-03-17", "receipt");
    expect(key).toBe("ik-batch-2026-03-17-receipt");
  });
});

// ---------------------------------------------------------------------------
// checkIdempotency — looks up existing result
// ---------------------------------------------------------------------------

describe("checkIdempotency()", () => {
  let mockCfg: ReturnType<typeof createMockDbConfig>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockCfg = createMockDbConfig();
    mockDb = createMockDb(mockCfg);
  });

  it("returns null when no prior execution exists", async () => {
    setSelectQueue(mockCfg, "idempotency_log", [[]]);

    const result = await checkIdempotency(mockDb, "ik-d-abc-receipt");
    expect(result).toBeNull();
  });

  it("returns stored envelope when prior execution exists", async () => {
    const storedResult = {
      v: 1,
      ok: true,
      pipe_id: "p-old",
      stage: 1,
      data: { receipt_number: 44 },
      warnings: [],
      error: null,
      command: "receipts generate",
    };

    setSelectQueue(mockCfg, "idempotency_log", [
      [{ key: "ik-d-abc-receipt", result: storedResult }],
    ]);

    const result = await checkIdempotency(mockDb, "ik-d-abc-receipt");
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(result!.data.receipt_number).toBe(44);
  });
});

// ---------------------------------------------------------------------------
// recordIdempotency — stores result for future lookups
// ---------------------------------------------------------------------------

describe("recordIdempotency()", () => {
  let mockCfg: ReturnType<typeof createMockDbConfig>;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockCfg = createMockDbConfig();
    mockDb = createMockDb(mockCfg);
    mockCfg.insertResults.set("idempotency_log", []);
  });

  it("records the envelope result with key and metadata", async () => {
    const env = Envelope.ok(
      { receipt_number: 44 },
      { pipeId: "p-abc", command: "receipts generate" },
    );

    await recordIdempotency(mockDb, "ik-d-abc-receipt", env);

    expect(mockCfg.inserts).toHaveLength(1);
    expect(mockCfg.inserts[0].values.key).toBe("ik-d-abc-receipt");
    expect(mockCfg.inserts[0].values.pipeId).toBe("p-abc");
    expect(mockCfg.inserts[0].values.command).toBe("receipts generate");
    expect(mockCfg.inserts[0].values.result).toBeDefined();
  });
});
