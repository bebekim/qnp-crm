import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, createMockDbConfig, fixtures, type MockDbConfig } from "../test-helpers.js";

// Mock the connection module before importing commands
let mockCfg: MockDbConfig;

vi.mock("../db/connection.js", () => {
  return {
    connect: () => createMockDb(mockCfg),
    audit: vi.fn().mockResolvedValue(undefined),
    performer: () => "cli:test",
    schema: (() => {
      // Use the real schema
      return import("../db/schema.js").then((m) => m);
    })(),
    // Re-export schema synchronously isn't possible with async, so we
    // need to do this differently
  };
});

// Since the mock above is hoisted, we need to re-mock properly
vi.mock("../db/connection.js", async () => {
  const schema = await import("../db/schema.js");
  return {
    connect: () => createMockDb(mockCfg),
    audit: vi.fn().mockResolvedValue(undefined),
    performer: () => "cli:test",
    schema,
  };
});

const { configShow } = await import("./show.js");
const { configSet } = await import("./set.js");

describe("config show", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns null with hint when no config exists", async () => {
    mockCfg.selectResults.set("receipt_config", []);

    const result = await configShow();

    expect(result.ok).toBe(true);
    expect(result.data).toBeNull();
    expect(result.hints.length).toBeGreaterThan(0);
    expect(result.hints[0]).toContain("No config set");
  });

  it("returns config data when row exists", async () => {
    const cfg = fixtures.receiptConfig();
    mockCfg.selectResults.set("receipt_config", [cfg]);

    const result = await configShow();

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.orgName).toBe("Our Village Inc.");
    expect(result.data!.abn).toBe("12345678901");
    expect(result.data!.dgrName).toBe("Our Village Inc.");
  });

  it("warns when required fields are missing", async () => {
    const cfg = fixtures.receiptConfig({ dgrName: null, abn: null });
    mockCfg.selectResults.set("receipt_config", [cfg]);

    const result = await configShow();

    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("dgrName");
    expect(result.warnings[0]).toContain("abn");
  });

  it("no warnings when all required fields present", async () => {
    const cfg = fixtures.receiptConfig();
    mockCfg.selectResults.set("receipt_config", [cfg]);

    const result = await configShow();

    expect(result.warnings).toHaveLength(0);
  });
});

describe("config set", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("rejects unknown config key", async () => {
    const result = await configSet("nonexistent_key", "value", { confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Unknown config key");
  });

  it("returns plan without --confirm", async () => {
    const result = await configSet("org_name", "Test Org", { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
    expect(result.plan!.confirmCommand).toContain("--confirm");
    expect(result.plan!.details.key).toBe("org_name");
    expect(result.plan!.details.value).toBe("Test Org");
  });

  it("validates ABN is 11 digits", async () => {
    const result = await configSet("abn", "123", { confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("11 digits");
  });

  it("accepts ABN with spaces (strips them)", async () => {
    mockCfg.selectResults.set("receipt_config", [fixtures.receiptConfig()]);

    const result = await configSet("abn", "12 345 678 901", { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan!.details.value).toBe("12345678901");
  });

  it("accepts camelCase keys", async () => {
    const result = await configSet("dgrName", "Test DGR", { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
  });

  it("accepts snake_case keys", async () => {
    const result = await configSet("dgr_name", "Test DGR", { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
  });

  it("inserts new config row when none exists", async () => {
    mockCfg.selectResults.set("receipt_config", []);

    const result = await configSet("org_name", "New Org", { confirm: true });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ key: "org_name", value: "New Org" });
    expect(mockCfg.inserts.length).toBe(1);
  });

  it("updates existing config row", async () => {
    mockCfg.selectResults.set("receipt_config", [fixtures.receiptConfig()]);

    const result = await configSet("org_name", "Updated Org", { confirm: true });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ key: "org_name", value: "Updated Org" });
    expect(mockCfg.updates.length).toBe(1);
  });
});
