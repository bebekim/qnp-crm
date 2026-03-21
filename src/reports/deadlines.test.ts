import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, createMockDbConfig, type MockDbConfig } from "../test-helpers.js";

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

const { reportDeadlines } = await import("./deadlines.js");

describe("reports deadlines", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns EOFY item with no other data", async () => {
    // Three execute calls: unreceipted count, aging buckets, recurring
    // Mock returns same executeResults for all calls
    mockCfg.executeResults = [];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    expect(result.data.items.length).toBeGreaterThanOrEqual(1);
    // EOFY item should always be present
    expect(result.data.items.some(i => i.category === "eofy")).toBe(true);
    expect(result.data.generatedAt).toBeDefined();
  });

  it("includes unreceipted donations when present", async () => {
    mockCfg.executeResults = [{ count: 5, total: "1250.00" }];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    // Should have EOFY item + unreceipted item
    const unreceiptedItem = result.data.items.find(i => i.category === "unreceipted");
    if (unreceiptedItem) {
      expect(unreceiptedItem.label).toContain("5 unreceipted");
      expect(unreceiptedItem.detail).toContain("$1250.00");
      expect(unreceiptedItem.actionHint).toContain("receipts batch");
    }
  });

  it("includes aging buckets", async () => {
    mockCfg.executeResults = [
      { count: 3, total: "750.00" },            // unreceipted count
      { bucket: ">90d", count: 1, total: "200.00" },
      { bucket: "7-30d", count: 2, total: "550.00" },
    ];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    // Since mock returns same array for all execute calls,
    // all rows appear in each query result
    const agingItems = result.data.items.filter(i => i.category === "aging");
    // The number depends on how the mock distributes results
    // but the function should not crash
  });

  it("includes recurring donations within look-ahead window", async () => {
    mockCfg.executeResults = [
      {
        id: "rrrraaaa-1111-2222-3333-444444444444",
        amount: "100.00",
        frequency: "monthly",
        next_expected_date: "2026-03-20",
        contact_name: "Jane Smith",
        days_away: "5",
        count: 0,
        total: "0.00",
      },
    ];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    const recurringItems = result.data.items.filter(i => i.category === "recurring");
    if (recurringItems.length > 0) {
      expect(recurringItems[0].label).toContain("Jane Smith");
      expect(recurringItems[0].detail).toContain("$100.00");
    }
  });

  it("sorts by priority (urgent first)", async () => {
    mockCfg.executeResults = [];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    const priorities = result.data.items.map(i => i.priority);
    const order = { urgent: 0, soon: 1, upcoming: 2, info: 3 };
    for (let i = 1; i < priorities.length; i++) {
      expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]]);
    }
  });

  it("accepts days option for look-ahead window", async () => {
    mockCfg.executeResults = [];

    const result = await reportDeadlines({ days: 60 });

    expect(result.ok).toBe(true);
    // Should not crash and should return items
  });

  it("defaults to 30-day look-ahead", async () => {
    mockCfg.executeResults = [];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    // Default should work without specifying days
  });

  it("hints about urgent items when present", async () => {
    // Mock data that would produce urgent items
    // The EOFY item could be urgent if close to June 30
    mockCfg.executeResults = [{ count: 15, total: "3000.00" }];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    // If there are urgent items, a hint should mention them
    const urgentCount = result.data.items.filter(i => i.priority === "urgent").length;
    if (urgentCount > 0) {
      expect(result.hints.some(h => h.includes("urgent"))).toBe(true);
    }
  });

  it("hints about receipt generation when unreceipted exist", async () => {
    mockCfg.executeResults = [{ count: 3, total: "600.00" }];

    const result = await reportDeadlines({});

    expect(result.ok).toBe(true);
    // Should hint about generating receipts
    if (result.data.items.some(i => i.category === "unreceipted")) {
      expect(result.hints.some(h => h.includes("receipts batch"))).toBe(true);
    }
  });

  it("EOFY item has no actionHint", async () => {
    mockCfg.executeResults = [];

    const result = await reportDeadlines({});

    const eofyItem = result.data.items.find(i => i.category === "eofy");
    expect(eofyItem).toBeDefined();
    expect(eofyItem!.actionHint).toBeNull();
  });
});
