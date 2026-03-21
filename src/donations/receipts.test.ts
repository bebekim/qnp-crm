import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, createMockDbConfig, fixtures, setSelectQueue, type MockDbConfig } from "../test-helpers.js";

let mockCfg: MockDbConfig;

vi.mock("../db/connection.js", async () => {
  const schema = await import("../db/schema.js");
  return {
    connect: () => createMockDb(mockCfg),
    audit: vi.fn().mockResolvedValue(undefined),
    performer: () => "cli:test",
    schema,
  };
});

const { receiptsVoid } = await import("./void-receipt.js");

describe("receipts void", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("fails if receipt number is not a valid integer", async () => {
    const result = await receiptsVoid("abc", { confirm: false });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Invalid receipt number");
  });

  it("fails if receipt not found", async () => {
    mockCfg.selectResults.set("receipts", []);

    const result = await receiptsVoid("99", { confirm: false });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("not found");
  });

  it("fails if receipt already voided", async () => {
    const receipt = fixtures.receipt({ isVoided: true, voidReason: "duplicate", voidedAt: new Date() });
    mockCfg.selectResults.set("receipts", [receipt]);

    const result = await receiptsVoid("44", { confirm: false });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("already voided");
  });

  it("returns plan without --confirm", async () => {
    const receipt = fixtures.receipt();
    mockCfg.selectResults.set("receipts", [receipt]);

    const result = await receiptsVoid("44", { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("receipt");
    expect(result.plan!.confirmCommand).toContain("--confirm");
    expect(result.plan!.confirmCommand).toContain("--reason");
  });

  it("plan includes receipt details (number, donor, amount)", async () => {
    const receipt = fixtures.receipt();
    mockCfg.selectResults.set("receipts", [receipt]);

    const result = await receiptsVoid("44", { confirm: false });

    expect(result.plan!.details.receiptNumber).toBe(44);
    expect(result.plan!.details.recipientName).toBe("Jane Smith");
    expect(result.plan!.details.amount).toBe("$250.00");
  });

  it("fails with --confirm but no --reason", async () => {
    const receipt = fixtures.receipt();
    mockCfg.selectResults.set("receipts", [receipt]);

    const result = await receiptsVoid("44", { confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("--reason is required");
  });

  it("executes void with --confirm and --reason", async () => {
    const receipt = fixtures.receipt();
    const donation = fixtures.donation({ status: "receipted" });
    setSelectQueue(mockCfg, "receipts", [[receipt]]);
    mockCfg.selectResults.set("donations", [donation]);

    const result = await receiptsVoid("44", { confirm: true, reason: "issued in error" });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.receiptNumber).toBe(44);
    expect(result.data!.donationId).toBe("11111111");
    expect(result.data!.reason).toBe("issued in error");

    // Check receipt was updated (is_voided, void_reason, voided_at)
    const receiptUpdate = mockCfg.updates.find((u) => u.table === "receipts");
    expect(receiptUpdate).toBeDefined();
    expect(receiptUpdate!.set.isVoided).toBe(true);
    expect(receiptUpdate!.set.voidReason).toBe("issued in error");
    expect(receiptUpdate!.set.voidedAt).toBeInstanceOf(Date);
  });

  it("reverts donation status to received", async () => {
    const receipt = fixtures.receipt();
    const donation = fixtures.donation({ status: "receipted" });
    setSelectQueue(mockCfg, "receipts", [[receipt]]);
    mockCfg.selectResults.set("donations", [donation]);

    await receiptsVoid("44", { confirm: true, reason: "issued in error" });

    const donationUpdate = mockCfg.updates.find((u) => u.table === "donations");
    expect(donationUpdate).toBeDefined();
    expect(donationUpdate!.set.status).toBe("received");
  });

  it("creates audit log entry", async () => {
    const receipt = fixtures.receipt();
    const donation = fixtures.donation({ status: "receipted" });
    setSelectQueue(mockCfg, "receipts", [[receipt]]);
    mockCfg.selectResults.set("donations", [donation]);

    await receiptsVoid("44", { confirm: true, reason: "issued in error" });

    // audit is a mock from the connection module
    const { audit } = await import("../db/connection.js");
    expect(audit).toHaveBeenCalled();
  });
});
