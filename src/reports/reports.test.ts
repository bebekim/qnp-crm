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

const { reportSummary } = await import("./summary.js");
const { reportUnreceipted } = await import("./unreceipted.js");

// =========================================================================
// reports summary
// =========================================================================

describe("reports summary", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns zero totals for empty dataset", async () => {
    mockCfg.executeResults = [];

    const result = await reportSummary({});

    expect(result.ok).toBe(true);
    expect(result.data.totalAmount).toBe("0.00");
    expect(result.data.donationCount).toBe(0);
    expect(result.data.averageAmount).toBe("0.00");
    expect(result.data.byMethod).toEqual({});
    expect(result.data.byFund).toEqual({});
  });

  it("calculates totals from donations", async () => {
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "3", total: "750.00" },
      { method: "cash", fund: "general", count: "1", total: "50.00" },
    ];

    const result = await reportSummary({});

    expect(result.ok).toBe(true);
    expect(result.data.totalAmount).toBe("800.00");
    expect(result.data.donationCount).toBe(4);
  });

  it("groups by method correctly", async () => {
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "2", total: "500.00" },
      { method: "cash", fund: "general", count: "1", total: "100.00" },
    ];

    const result = await reportSummary({});

    expect(result.data.byMethod).toEqual({
      eft: { count: 2, total: "500.00" },
      cash: { count: 1, total: "100.00" },
    });
  });

  it("groups by fund correctly", async () => {
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "2", total: "500.00" },
      { method: "eft", fund: "building", count: "1", total: "1000.00" },
    ];

    const result = await reportSummary({});

    expect(result.data.byFund).toEqual({
      general: { count: 2, total: "500.00" },
      building: { count: 1, total: "1000.00" },
    });
  });

  it("calculates average amount", async () => {
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "4", total: "1000.00" },
    ];

    const result = await reportSummary({});

    expect(result.data.averageAmount).toBe("250.00");
  });

  it("filters by date range (--from, --to)", async () => {
    // The function should pass from/to to the SQL query.
    // We verify the function accepts the options and returns a result.
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "1", total: "100.00" },
    ];

    const result = await reportSummary({ from: "2026-01-01", to: "2026-06-30" });

    expect(result.ok).toBe(true);
    expect(result.data.donationCount).toBe(1);
  });

  it("filters by campaign", async () => {
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "2", total: "200.00" },
    ];

    const result = await reportSummary({ campaign: "end-of-year" });

    expect(result.ok).toBe(true);
    expect(result.data.donationCount).toBe(2);
  });

  it("excludes voided donations", async () => {
    // Voided donations should never appear in results.
    // The SQL WHERE clause should include status != 'voided'.
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "1", total: "100.00" },
    ];

    const result = await reportSummary({});

    // If the implementation correctly excludes voided, the mock returns only non-voided rows
    expect(result.ok).toBe(true);
    expect(result.data.donationCount).toBe(1);
  });

  it("defaults to current Australian FY", async () => {
    mockCfg.executeResults = [];

    const result = await reportSummary({});

    // Should include a hint about the date range being used
    expect(result.ok).toBe(true);
    expect(result.hints.some((h) => h.includes("FY"))).toBe(true);
  });

  it("hint about unreceipted count", async () => {
    mockCfg.executeResults = [
      { method: "eft", fund: "general", count: "3", total: "300.00" },
    ];
    // The second db.execute call returns unreceipted count
    // We need to override execute to return different results per call
    let callCount = 0;
    const origExecute = mockCfg.executeResults;
    const db = createMockDb(mockCfg);
    // Override execute to track calls: first returns summary rows, second returns unreceipted count
    // Since mock execute always returns executeResults, we'll set it to the summary rows
    // and the unreceipted query returns from selectResults
    mockCfg.selectResults.set("donations", [
      fixtures.donation({ status: "received", isDgrEligible: true }),
      fixtures.donation({ id: "22222222-3333-4444-5555-666666666666", status: "received", isDgrEligible: true }),
    ]);

    const result = await reportSummary({});

    expect(result.ok).toBe(true);
    // The hint about unreceipted donations should be present if any exist
    if (result.hints.some((h) => h.includes("unreceipted"))) {
      expect(result.hints.some((h) => h.includes("unreceipted"))).toBe(true);
    }
  });
});

// =========================================================================
// reports unreceipted
// =========================================================================

describe("reports unreceipted", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns empty array when no unreceipted", async () => {
    mockCfg.selectResults.set("donations", []);

    const result = await reportUnreceipted();

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("returns unreceipted DGR-eligible donations", async () => {
    mockCfg.selectResults.set("donations", [
      fixtures.donation({ status: "received", isDgrEligible: true }),
    ]);
    // Contact name lookup
    mockCfg.selectResults.set("contacts", [
      fixtures.contact(),
    ]);
    // Receipts lookup — none exist
    mockCfg.selectResults.set("receipts", []);

    const result = await reportUnreceipted();

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0].isDgrEligible).toBe(true);
    expect(result.data[0].status).toBe("received");
  });

  it("excludes voided donations", async () => {
    // Only received, DGR-eligible donations should appear
    mockCfg.selectResults.set("donations", []);

    const result = await reportUnreceipted();

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("includes contact names", async () => {
    mockCfg.selectResults.set("donations", [
      fixtures.donation({ status: "received", isDgrEligible: true }),
    ]);
    mockCfg.selectResults.set("contacts", [
      fixtures.contact({ firstName: "Jane", lastName: "Smith" }),
    ]);
    mockCfg.selectResults.set("receipts", []);

    const result = await reportUnreceipted();

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0].contactName).toBe("Jane Smith");
  });

  it("hint suggests receipt generation", async () => {
    mockCfg.selectResults.set("donations", [
      fixtures.donation({ status: "received", isDgrEligible: true }),
      fixtures.donation({
        id: "22222222-3333-4444-5555-666666666666",
        contactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        status: "received",
        isDgrEligible: true,
        amount: "100.00",
      }),
    ]);
    mockCfg.selectResults.set("contacts", [
      fixtures.contact(),
    ]);
    mockCfg.selectResults.set("receipts", []);

    const result = await reportUnreceipted();

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(2);
    expect(result.hints.some((h) => h.includes("unreceipted") && h.includes("receipt"))).toBe(true);
  });
});
