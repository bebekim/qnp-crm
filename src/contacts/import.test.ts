import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
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

const { contactsImport } = await import("./import.js");

// Helper to create temp CSV files
function writeTempCsv(content: string): string {
  const path = `/tmp/test-import-${Date.now()}.csv`;
  fs.writeFileSync(path, content);
  return path;
}

describe("contacts import", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  afterEach(() => {
    // Clean up temp files
    try {
      const files = fs.readdirSync("/tmp").filter(f => f.startsWith("test-import-"));
      files.forEach(f => fs.unlinkSync(`/tmp/${f}`));
    } catch {}
  });

  it("fails when file not found", async () => {
    const result = await contactsImport("/nonexistent/file.csv", { confirm: false });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("not found");
  });

  it("fails on empty CSV", async () => {
    const path = writeTempCsv("");

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("empty");
  });

  it("fails when no name columns can be mapped", async () => {
    const path = writeTempCsv("Foo,Bar,Baz\n1,2,3\n");

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Cannot auto-map");
  });

  it("auto-maps common column names", async () => {
    const csv = `First Name,Last Name,Email,Phone
Jane,Smith,jane@example.org,0499111222
Tom,Nguyen,tom@example.org,0411222333
`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = []; // No existing contacts with those emails

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
    expect(result.plan!.details.totalRows).toBe(2);
    expect(result.plan!.details.valid).toBe(2);
    expect(result.plan!.details.errors).toBe(0);
  });

  it("returns plan without --confirm", async () => {
    const csv = `firstName,lastName,email\nJane,Smith,jane@example.org\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.confirmCommand).toContain("--confirm");
    expect(result.plan!.action).toContain("1 contacts");
  });

  it("validates email format", async () => {
    const csv = `firstName,lastName,email\nJane,Smith,not-an-email\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.warnings.some(w => w.includes("Invalid email"))).toBe(true);
    expect(result.plan!.details.errors).toBe(1);
  });

  it("validates missing last name", async () => {
    const csv = `firstName,lastName,email\nJane,,jane@example.org\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.warnings.some(w => w.includes("Missing last name"))).toBe(true);
  });

  it("validates state codes", async () => {
    const csv = `firstName,lastName,state\nJane,Smith,INVALID\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { confirm: false });

    expect(result.warnings.some(w => w.includes("Invalid state"))).toBe(true);
  });

  it("validates postcode format", async () => {
    const csv = `firstName,lastName,postcode\nJane,Smith,123\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { confirm: false });

    expect(result.warnings.some(w => w.includes("Invalid postcode"))).toBe(true);
  });

  it("detects duplicate emails", async () => {
    const csv = `firstName,lastName,email\nJane,Smith,jane@example.org\n`;
    const path = writeTempCsv(csv);
    // Existing contact with same email
    mockCfg.executeResults = [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", email: "jane@example.org" }];

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.warnings.some(w => w.includes("Duplicate email"))).toBe(true);
    expect(result.plan!.details.duplicates).toBe(1);
  });

  it("uses salesforce preset mapping", async () => {
    const csv = `First Name,Last Name,Email,Mailing City,Mailing State/Province
Jane,Smith,jane@example.org,Richmond,VIC
`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { preset: "salesforce", confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan!.details.mappedColumns).toContain("First Name");
    expect(result.plan!.details.mappedColumns).toContain("Mailing City");
  });

  it("respects explicit --map overrides", async () => {
    const csv = `GivenName,FamilyName\nJane,Smith\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, {
      map: ["GivenName=firstName", "FamilyName=lastName"],
      confirm: false,
    });

    expect(result.ok).toBe(true);
    expect(result.plan!.details.valid).toBe(1);
  });

  it("inserts contacts with --confirm", async () => {
    const csv = `firstName,lastName,email\nJane,Smith,jane@example.org\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = []; // No duplicates
    const contact = fixtures.contact();
    mockCfg.insertResults.set("contacts", [contact]);

    const result = await contactsImport(path, { confirm: true });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.imported).toBe(1);
    expect(mockCfg.inserts.length).toBeGreaterThan(0);
  });

  it("applies tags to imported contacts", async () => {
    const csv = `firstName,lastName\nJane,Smith\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];
    mockCfg.insertResults.set("contacts", [fixtures.contact()]);

    const result = await contactsImport(path, { tag: ["imported", "batch=2026-03"], confirm: true });

    expect(result.ok).toBe(true);
    expect(mockCfg.inserts.some(i => i.table === "tags")).toBe(true);
  });

  it("skips duplicates with on-duplicate=skip", async () => {
    const csv = `firstName,lastName,email\nJane,Smith,jane@example.org\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", email: "jane@example.org" }];

    const result = await contactsImport(path, { onDuplicate: "skip", confirm: true });

    expect(result.ok).toBe(true);
    expect(result.data!.skipped).toBe(1);
    expect(result.data!.imported).toBe(0);
  });

  it("updates duplicates with on-duplicate=update", async () => {
    const csv = `firstName,lastName,email,phone\nJane,Updated,jane@example.org,0400999888\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", email: "jane@example.org" }];

    const result = await contactsImport(path, { onDuplicate: "update", confirm: true });

    expect(result.ok).toBe(true);
    expect(result.data!.imported).toBe(1);
    expect(mockCfg.updates.length).toBeGreaterThan(0);
  });

  it("handles multiple rows with mixed valid/invalid", async () => {
    const csv = `firstName,lastName,email
Jane,Smith,jane@example.org
Tom,Nguyen,invalid-email
Bob,Jones,bob@example.org
`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { confirm: false });

    expect(result.ok).toBe(true);
    expect(result.plan!.details.totalRows).toBe(3);
    expect((result.plan!.details.errors as number)).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some(w => w.includes("Invalid email"))).toBe(true);
  });

  it("includes on-duplicate in confirm command", async () => {
    const csv = `firstName,lastName\nJane,Smith\n`;
    const path = writeTempCsv(csv);
    mockCfg.executeResults = [];

    const result = await contactsImport(path, { onDuplicate: "update", confirm: false });

    expect(result.plan!.confirmCommand).toContain("--on-duplicate update");
  });
});

// Need to import afterEach
import { afterEach } from "vitest";
