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

const { donationsShow } = await import("./show.js");
const { donationsVoid } = await import("./void-donation.js");

describe("donations show", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("fails if donation not found", async () => {
    setSelectQueue(mockCfg, "donations", [[]]);

    const result = await donationsShow("deadbeef");

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("not found");
  });

  it("fails if ambiguous prefix", async () => {
    const donation = fixtures.donation();
    const other = fixtures.donation({ id: "11111112-0000-0000-0000-000000000000" });
    setSelectQueue(mockCfg, "donations", [[donation], [other]]);

    const result = await donationsShow("11111111");

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Ambiguous");
  });

  it("returns full donation detail", async () => {
    const donation = fixtures.donation();
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("contacts", []);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsShow("11111111");

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.id).toBe("11111111");
    expect(result.data!.amount).toBe("250.00");
    expect(result.data!.method).toBe("eft");
    expect(result.data!.status).toBe("received");
    expect(result.data!.isDgrEligible).toBe(true);
  });

  it("includes contact name and email", async () => {
    const donation = fixtures.donation();
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("contacts", [contact]);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsShow("11111111");

    expect(result.ok).toBe(true);
    expect(result.data!.contactName).toBe("Jane Smith");
    expect(result.data!.contactEmail).toBe("jane@example.org");
  });

  it("includes receipt info when receipted", async () => {
    const donation = fixtures.donation({ status: "receipted" });
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("contacts", []);
    mockCfg.selectResults.set("receipts", [
      { receiptNumber: 42, issuedAt: new Date("2026-03-02T00:00:00Z"), isVoided: false },
    ]);

    const result = await donationsShow("11111111");

    expect(result.ok).toBe(true);
    expect(result.data!.receipt).not.toBeNull();
    expect(result.data!.receipt!.number).toBe(42);
    expect(result.data!.receipt!.isVoided).toBe(false);
  });

  it("shows null receipt when not receipted", async () => {
    const donation = fixtures.donation();
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("contacts", []);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsShow("11111111");

    expect(result.ok).toBe(true);
    expect(result.data!.receipt).toBeNull();
  });

  it("hints about receipting if DGR eligible and not receipted", async () => {
    const donation = fixtures.donation({ isDgrEligible: true, status: "received" });
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("contacts", [fixtures.contact()]);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsShow("11111111");

    expect(result.ok).toBe(true);
    expect(result.hints.some((h: string) => h.includes("receipt"))).toBe(true);
  });
});

describe("donations void", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("fails if donation not found", async () => {
    setSelectQueue(mockCfg, "donations", [[]]);

    const result = await donationsVoid("deadbeef", { confirm: true, reason: "test" });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("not found");
  });

  it("fails if already voided", async () => {
    const donation = fixtures.donation({ status: "voided" });
    setSelectQueue(mockCfg, "donations", [[donation], []]);

    const result = await donationsVoid("11111111", { confirm: true, reason: "test" });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("already voided");
  });

  it("returns plan without --confirm", async () => {
    const donation = fixtures.donation();
    setSelectQueue(mockCfg, "donations", [[donation], []]);

    const result = await donationsVoid("11111111", { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
    expect(result.plan!.action).toContain("Void");
    expect(result.plan!.confirmCommand).toContain("--confirm");
  });

  it("fails with --confirm but no --reason", async () => {
    const donation = fixtures.donation();
    setSelectQueue(mockCfg, "donations", [[donation], []]);

    const result = await donationsVoid("11111111", { confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("reason");
  });

  it("executes void with reason", async () => {
    const donation = fixtures.donation();
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsVoid("11111111", { confirm: true, reason: "Duplicate entry" });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(mockCfg.updates.length).toBeGreaterThan(0);
    expect(mockCfg.updates[0].table).toBe("donations");
  });

  it("warns about existing receipt", async () => {
    const donation = fixtures.donation({ status: "receipted" });
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("receipts", [
      { receiptNumber: 42, issuedAt: new Date("2026-03-02T00:00:00Z"), isVoided: false },
    ]);

    const result = await donationsVoid("11111111", { confirm: true, reason: "Error" });

    expect(result.ok).toBe(true);
    expect(result.warnings.some((w: string) => w.includes("receipt"))).toBe(true);
  });

  it("audit log created", async () => {
    const { audit } = await import("../db/connection.js");
    const donation = fixtures.donation();
    setSelectQueue(mockCfg, "donations", [[donation], []]);
    mockCfg.selectResults.set("receipts", []);

    await donationsVoid("11111111", { confirm: true, reason: "Duplicate" });

    expect(audit).toHaveBeenCalled();
  });
});
