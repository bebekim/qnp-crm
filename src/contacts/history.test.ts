import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, createMockDbConfig, type MockDbConfig } from "../test-helpers.js";

let mockCfg: MockDbConfig;
let execCallCount: number;
let execResultsQueue: any[][];

vi.mock("../db/connection.js", async () => {
  const schema = await import("../db/schema.js");
  return {
    connect: () => {
      const db = createMockDb(mockCfg);
      // Override execute to support sequential results
      const origExecute = db.execute;
      db.execute = (_sql: any) => {
        if (execResultsQueue.length > 0) {
          const result = execResultsQueue[execCallCount] ?? [];
          execCallCount++;
          return Promise.resolve(result);
        }
        return origExecute(_sql);
      };
      return db;
    },
    audit: vi.fn().mockResolvedValue(undefined),
    performer: () => "cli:test",
    schema,
  };
});

const { contactsHistory } = await import("./history.js");

describe("contacts history", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
    execCallCount = 0;
    execResultsQueue = [];
  });

  it("fails when contact not found", async () => {
    execResultsQueue = [
      [], // UUID lookup: no contacts found
    ];

    const result = await contactsHistory("deadbeef", {});

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("No contact found");
  });

  it("fails on ambiguous prefix", async () => {
    execResultsQueue = [
      [ // UUID lookup: multiple contacts
        { id: "deadbeef-1111-2222-3333-444444444444" },
        { id: "deadbeef-5555-6666-7777-888888888888" },
      ],
    ];

    const result = await contactsHistory("deadbeef", {});

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Multiple contacts");
  });

  it("returns empty timeline for contact with no activity", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }], // UUID lookup
      [], // Timeline query: no audit entries
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.hints.some(h => h.includes("No activity"))).toBe(true);
  });

  it("returns timeline entries with human-readable summaries", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }], // UUID lookup
      [ // Timeline entries
        {
          table_name: "contacts",
          record_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          action: "INSERT",
          changed_fields: null,
          performed_at: "2026-01-15T00:00:00Z",
          performed_by: "cli:agent",
        },
        {
          table_name: "contacts",
          record_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          action: "UPDATE",
          changed_fields: { email: { old: "jane@old.org", new: "jane@new.org" } },
          performed_at: "2026-02-01T00:00:00Z",
          performed_by: "cli:agent",
        },
        {
          table_name: "donations",
          record_id: "11111111-2222-3333-4444-555555555555",
          action: "INSERT",
          changed_fields: null,
          performed_at: "2026-03-01T00:00:00Z",
          performed_by: "cli:agent",
        },
      ],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(3);

    // Check INSERT summary
    expect(result.data[0].summary).toBe("Contact created");
    expect(result.data[0].action).toBe("INSERT");
    expect(result.data[0].table).toBe("contacts");

    // Check UPDATE summary with field changes
    expect(result.data[1].summary).toContain("email");
    expect(result.data[1].summary).toContain("jane@old.org");
    expect(result.data[1].summary).toContain("jane@new.org");
    expect(result.data[1].changes).not.toBeNull();

    // Check donation INSERT
    expect(result.data[2].summary).toBe("Donation recorded");
  });

  it("summarizes field set to value", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [{
        table_name: "contacts",
        record_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        action: "UPDATE",
        changed_fields: { phone: { old: null, new: "0499 111 222" } },
        performed_at: "2026-02-01T00:00:00Z",
        performed_by: "cli:agent",
      }],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].summary).toContain("set to");
    expect(result.data[0].summary).toContain("0499 111 222");
  });

  it("summarizes field cleared", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [{
        table_name: "contacts",
        record_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        action: "UPDATE",
        changed_fields: { notes: { old: "Important donor", new: null } },
        performed_at: "2026-02-01T00:00:00Z",
        performed_by: "cli:agent",
      }],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].summary).toContain("cleared");
  });

  it("summarizes receipt issued", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [{
        table_name: "receipts",
        record_id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
        action: "INSERT",
        changed_fields: null,
        performed_at: "2026-03-05T00:00:00Z",
        performed_by: "cli:agent",
      }],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].summary).toBe("Receipt issued");
  });

  it("summarizes org link", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [{
        table_name: "contact_org_links",
        record_id: "llllllll-llll-llll-llll-llllllllllll",
        action: "INSERT",
        changed_fields: null,
        performed_at: "2026-02-15T00:00:00Z",
        performed_by: "cli:agent",
      }],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].summary).toBe("Linked to organisation");
  });

  it("summarizes DELETE actions", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [{
        table_name: "contact_org_links",
        record_id: "llllllll-llll-llll-llll-llllllllllll",
        action: "DELETE",
        changed_fields: null,
        performed_at: "2026-02-20T00:00:00Z",
        performed_by: "cli:agent",
      }],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].summary).toBe("Organisation link removed");
  });

  it("accepts limit option", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [],
    ];

    const result = await contactsHistory("aaaaaaaa", { limit: 10 });

    expect(result.ok).toBe(true);
  });

  it("accepts date range options", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [],
    ];

    const result = await contactsHistory("aaaaaaaa", {
      from: "2026-01-01",
      to: "2026-03-31",
    });

    expect(result.ok).toBe(true);
  });

  it("shows event count in hints", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [
        {
          table_name: "contacts",
          record_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          action: "INSERT",
          changed_fields: null,
          performed_at: "2026-01-15T00:00:00Z",
          performed_by: "cli:agent",
        },
        {
          table_name: "contacts",
          record_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          action: "UPDATE",
          changed_fields: { email: { old: "a@a.com", new: "b@b.com" } },
          performed_at: "2026-02-01T00:00:00Z",
          performed_by: "cli:agent",
        },
      ],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.hints.some(h => h.includes("2 events"))).toBe(true);
  });

  it("includes timestamps as ISO strings", async () => {
    execResultsQueue = [
      [{ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }],
      [{
        table_name: "contacts",
        record_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        action: "INSERT",
        changed_fields: null,
        performed_at: "2026-01-15T10:30:00Z",
        performed_by: "cli:agent",
      }],
    ];

    const result = await contactsHistory("aaaaaaaa", {});

    expect(result.ok).toBe(true);
    expect(result.data[0].timestamp).toBe("2026-01-15T10:30:00.000Z");
  });
});
