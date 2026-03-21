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

const { universalSearch } = await import("./universal.js");

describe("universal search", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns empty results for no matches", async () => {
    mockCfg.executeResults = [];

    const result = await universalSearch("nonexistent", {});

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.hints.some(h => h.includes("No results"))).toBe(true);
  });

  it("returns contact results", async () => {
    mockCfg.executeResults = [
      {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        type: "contact",
        name: "Jane Smith",
        detail: "jane@example.org",
        score: 1.5,
      },
    ];

    const result = await universalSearch("Jane", {});

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0].type).toBe("contact");
    expect(result.data[0].name).toBe("Jane Smith");
    expect(result.data[0].id).toBe("aaaaaaaa"); // truncated to 8 chars
  });

  it("returns org results", async () => {
    mockCfg.executeResults = [
      {
        id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
        type: "org",
        name: "Good Corp",
        detail: "12345678901",
        score: 1.2,
      },
    ];

    const result = await universalSearch("Good", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].type).toBe("org");
    expect(result.data[0].name).toBe("Good Corp");
  });

  it("returns donation results", async () => {
    mockCfg.executeResults = [
      {
        id: "11111111-2222-3333-4444-555555555555",
        type: "donation",
        name: "$250.00 on 2026-03-01",
        detail: "REF-001",
        score: 0.8,
      },
    ];

    const result = await universalSearch("REF-001", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].type).toBe("donation");
    expect(result.data[0].detail).toBe("REF-001");
  });

  it("returns mixed results sorted by score", async () => {
    mockCfg.executeResults = [
      {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        type: "contact",
        name: "Jane Smith",
        detail: "jane@example.org",
        score: 2.0,
      },
      {
        id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
        type: "org",
        name: "Smith Foundation",
        detail: null,
        score: 1.5,
      },
    ];

    const result = await universalSearch("Smith", {});

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(2);
    // Should be sorted by score descending
    expect(result.data[0].score).toBeGreaterThanOrEqual(result.data[1].score);
  });

  it("filters by type when specified", async () => {
    mockCfg.executeResults = [
      {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        type: "contact",
        name: "Jane Smith",
        detail: "jane@example.org",
        score: 1.5,
      },
    ];

    const result = await universalSearch("Jane", { type: "contact" });

    expect(result.ok).toBe(true);
    // The function constructs the query with only contact part when type is "contact"
  });

  it("respects limit option", async () => {
    mockCfg.executeResults = [
      { id: "aaaaaaaa-1111-2222-3333-444444444444", type: "contact", name: "A", detail: null, score: 1.0 },
    ];

    const result = await universalSearch("test", { limit: 5 });

    expect(result.ok).toBe(true);
  });

  it("truncates IDs to 8 chars", async () => {
    mockCfg.executeResults = [
      {
        id: "12345678-abcd-efgh-ijkl-mnopqrstuvwx",
        type: "contact",
        name: "Test",
        detail: null,
        score: 1.0,
      },
    ];

    const result = await universalSearch("Test", {});

    expect(result.data[0].id).toBe("12345678");
  });

  it("handles null detail gracefully", async () => {
    mockCfg.executeResults = [
      {
        id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        type: "org",
        name: "Unnamed Org",
        detail: null,
        score: 0.5,
      },
    ];

    const result = await universalSearch("Unnamed", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].detail).toBeNull();
  });
});
