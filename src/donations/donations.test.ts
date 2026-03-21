import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, createMockDbConfig, fixtures, type MockDbConfig } from "../test-helpers.js";

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

const { donationsAdd } = await import("./add.js");
const { donationsList } = await import("./list.js");

describe("donations add", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("rejects invalid amount (zero)", async () => {
    const result = await donationsAdd("0", {
      date: "2026-03-01", fund: "general", dgr: true, confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Invalid amount");
  });

  it("rejects negative amount", async () => {
    const result = await donationsAdd("-50", {
      date: "2026-03-01", fund: "general", dgr: true, confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Invalid amount");
  });

  it("rejects non-numeric amount", async () => {
    const result = await donationsAdd("abc", {
      date: "2026-03-01", fund: "general", dgr: true, confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Invalid amount");
  });

  it("rejects invalid date format", async () => {
    const result = await donationsAdd("100", {
      date: "03-01-2026", fund: "general", dgr: true, confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Invalid date");
  });

  it("rejects invalid method", async () => {
    const result = await donationsAdd("100", {
      date: "2026-03-01", method: "bitcoin", fund: "general", dgr: true, confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Invalid method");
  });

  it("returns plan without --confirm", async () => {
    const result = await donationsAdd("250", {
      date: "2026-03-01", fund: "general", dgr: true, confirm: false,
    });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
    expect(result.plan!.action).toContain("$250.00");
    expect(result.plan!.confirmCommand).toContain("--confirm");
  });

  it("plan includes contact name when provided and found", async () => {
    // Mock contact resolution: name match
    mockCfg.selectResults.set("contacts", [fixtures.contact()]);

    const result = await donationsAdd("500", {
      contact: "Jane Smith", date: "2026-03-01", fund: "general", dgr: true, confirm: false,
    });

    expect(result.ok).toBe(true);
    expect(result.plan!.action).toContain("Jane Smith");
  });

  it("fails when contact not found", async () => {
    mockCfg.selectResults.set("contacts", []);

    const result = await donationsAdd("100", {
      contact: "Nobody Here", date: "2026-03-01", fund: "general", dgr: true, confirm: true,
    });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Contact not found");
  });

  it("inserts donation with --confirm", async () => {
    const donation = fixtures.donation();
    mockCfg.insertResults.set("donations", [donation]);

    const result = await donationsAdd("250", {
      date: "2026-03-01", method: "eft", fund: "general", dgr: true, confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.amount).toBe("250.00");
    expect(result.data!.method).toBe("eft");
  });

  it("hints about missing contact when none linked", async () => {
    const donation = fixtures.donation({ contactId: null });
    mockCfg.insertResults.set("donations", [donation]);

    const result = await donationsAdd("250", {
      date: "2026-03-01", fund: "general", dgr: true, confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(result.hints.some((h: string) => h.includes("No contact linked"))).toBe(true);
  });

  it("hints about receipt generation when DGR-eligible with contact", async () => {
    const contact = fixtures.contact();
    const donation = fixtures.donation();
    mockCfg.selectResults.set("contacts", [contact]);
    mockCfg.insertResults.set("donations", [donation]);

    const result = await donationsAdd("250", {
      contact: "Jane Smith", date: "2026-03-01", fund: "general", dgr: true, confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(result.hints.some((h: string) => h.includes("receipt"))).toBe(true);
  });

  it("formats amount to 2 decimal places", async () => {
    const result = await donationsAdd("100.5", {
      date: "2026-03-01", fund: "general", dgr: true, confirm: false,
    });

    expect(result.plan!.details.amount).toBe("$100.50");
  });

  it("includes --no-dgr in confirm command", async () => {
    const result = await donationsAdd("100", {
      date: "2026-03-01", fund: "general", dgr: false, confirm: false,
    });

    expect(result.plan!.confirmCommand).toContain("--no-dgr");
  });
});

describe("donations list", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns empty array when no donations", async () => {
    mockCfg.selectResults.set("donations", []);

    const result = await donationsList({
      limit: 50, sort: "-donationDate",
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("returns donations with contact names", async () => {
    const donation = fixtures.donation();
    const contact = fixtures.contact();
    mockCfg.selectResults.set("donations", [donation]);
    mockCfg.selectResults.set("contacts", [contact]);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsList({
      limit: 50, sort: "-donationDate",
    });

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0].contactName).toBe("Jane Smith");
    expect(result.data[0].amount).toBe("250.00");
    expect(result.data[0].id).toHaveLength(8);
  });

  it("shows total in hints", async () => {
    const d1 = fixtures.donation({ id: "11111111-0000-0000-0000-000000000000", amount: "100.00" });
    const d2 = fixtures.donation({ id: "22222222-0000-0000-0000-000000000000", amount: "200.00" });
    mockCfg.selectResults.set("donations", [d1, d2]);
    mockCfg.selectResults.set("contacts", [fixtures.contact()]);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsList({
      limit: 50, sort: "-donationDate",
    });

    expect(result.hints.some((h: string) => h.includes("$300.00"))).toBe(true);
    expect(result.hints.some((h: string) => h.includes("2 donations"))).toBe(true);
  });

  it("warns when contact filter not found", async () => {
    mockCfg.selectResults.set("contacts", []);

    const result = await donationsList({
      contact: "Nobody", limit: 50, sort: "-donationDate",
    });

    expect(result.data).toEqual([]);
    expect(result.warnings[0]).toContain("Contact not found");
  });

  it("truncates IDs to 8 chars", async () => {
    const donation = fixtures.donation();
    mockCfg.selectResults.set("donations", [donation]);
    mockCfg.selectResults.set("contacts", []);
    mockCfg.selectResults.set("receipts", []);

    const result = await donationsList({
      limit: 50, sort: "-donationDate",
    });

    expect(result.data[0].id).toBe("11111111");
    expect(result.data[0].contactId).toBe("aaaaaaaa");
  });
});
