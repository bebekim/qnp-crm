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

const { orgsAdd } = await import("./add.js");

describe("orgs add", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns plan without --confirm", async () => {
    mockCfg.selectResults.set("organisations", []);

    const result = await orgsAdd("Good Corp", { orgType: "charity", confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
    expect(result.plan!.action).toContain("Good Corp");
    expect(result.plan!.confirmCommand).toContain("--confirm");
  });

  it("validates ABN format (11 digits)", async () => {
    const result = await orgsAdd("Bad ABN Corp", { orgType: "charity", abn: "123", confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("11 digits");
  });

  it("checks duplicate ABN", async () => {
    mockCfg.selectResults.set("organisations", [
      { id: "bbbbbbbb-0000-0000-0000-000000000000", name: "Existing Corp", abn: "12345678901" },
    ]);

    const result = await orgsAdd("New Corp", { orgType: "charity", abn: "12345678901", confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("already exists");
  });

  it("executes add with --confirm", async () => {
    mockCfg.selectResults.set("organisations", []);
    mockCfg.insertResults.set("organisations", [
      { id: "cccccccc-dddd-eeee-ffff-000000000000", name: "Good Corp", orgType: "charity", abn: null, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await orgsAdd("Good Corp", { orgType: "charity", confirm: true });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.name).toBe("Good Corp");
    expect(mockCfg.inserts.some((i: any) => i.table === "organisations")).toBe(true);
  });

  it("adds tags to org", async () => {
    mockCfg.selectResults.set("organisations", []);
    mockCfg.insertResults.set("organisations", [
      { id: "cccccccc-dddd-eeee-ffff-000000000000", name: "Tagged Corp", orgType: "charity", abn: null, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await orgsAdd("Tagged Corp", { orgType: "charity", tag: ["partner", "tier=gold"], confirm: true });

    expect(result.ok).toBe(true);
    expect(mockCfg.inserts.some((i: any) => i.table === "tags")).toBe(true);
  });

  it("fails on duplicate ABN", async () => {
    mockCfg.selectResults.set("organisations", [
      { id: "bbbbbbbb-0000-0000-0000-000000000000", name: "Existing Corp", abn: "98765432101" },
    ]);

    const result = await orgsAdd("Duplicate ABN Corp", { orgType: "other", abn: "98765432101", confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Existing Corp");
  });

  it("hints for linking contacts", async () => {
    mockCfg.selectResults.set("organisations", []);
    mockCfg.insertResults.set("organisations", [
      { id: "cccccccc-dddd-eeee-ffff-000000000000", name: "New Org", orgType: "other", abn: null, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await orgsAdd("New Org", { orgType: "other", confirm: true });

    expect(result.ok).toBe(true);
    expect(result.hints.some((h: string) => h.includes("link"))).toBe(true);
  });
});
