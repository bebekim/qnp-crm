import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, seedDb, closeSetupDb, getSetupDb, type SeedResult } from "./helpers.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";

const { contactsAdd } = await import("../contacts/add.js");
const { contactsList } = await import("../contacts/list.js");
const { contactsShow } = await import("../contacts/show.js");
const { contactsSearch } = await import("../contacts/search.js");
const { contactsEdit } = await import("../contacts/edit.js");

let seed: SeedResult;

beforeEach(async () => {
  await resetDb();
  seed = await seedDb();
});

afterAll(async () => {
  await closeSetupDb();
});

// ---------------------------------------------------------------------------
// contactsAdd
// ---------------------------------------------------------------------------

describe("contactsAdd", () => {
  it("returns plan without --confirm", async () => {
    const result = await contactsAdd("Alice", "Wong", {
      email: "alice@example.org",
      type: "donor",
      confirm: false,
    });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
  });

  it("creates contact with --confirm", async () => {
    const result = await contactsAdd("Alice", "Wong", {
      email: "alice@example.org",
      suburb: "Carlton",
      state: "VIC",
      postcode: "3053",
      type: "donor",
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.name).toContain("Alice");

    // Verify audit trail
    const db = getSetupDb();
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "INSERT"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.some((a) => a.tableName === "contacts")).toBe(true);
  });

  it("rejects duplicate email", async () => {
    const result = await contactsAdd("Fake", "Smith", {
      email: "jane.smith@bigpond.com.au", // already in seed
      type: "donor",
      confirm: true,
    });
    expect(result.ok).toBe(false);
  });

  it("creates tags when provided", async () => {
    const result = await contactsAdd("Tagged", "Person", {
      type: "donor",
      tag: ["vip", "source=referral"],
      confirm: true,
    });
    expect(result.ok).toBe(true);

    // Verify tags in DB
    const db = getSetupDb();
    const tags = await db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.entityType, "contact"));
    const personTags = tags.filter(
      (t) => t.key === "vip" || (t.key === "source" && t.value === "referral"),
    );
    expect(personTags.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// contactsList
// ---------------------------------------------------------------------------

describe("contactsList", () => {
  it("returns all non-merged contacts", async () => {
    const result = await contactsList({
      limit: 50,
      offset: 0,
      sort: "name",
    });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(4);
  });

  it("filters by type", async () => {
    const result = await contactsList({
      type: "volunteer",
      limit: 50,
      offset: 0,
      sort: "name",
    });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.name).toContain("Priya");
  });

  it("filters by tag", async () => {
    const result = await contactsList({
      tag: ["vip"],
      limit: 50,
      offset: 0,
      sort: "name",
    });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0]!.name).toContain("Jane");
  });

  it("paginates correctly", async () => {
    const page1 = await contactsList({
      limit: 2,
      offset: 0,
      sort: "name",
    });
    const page2 = await contactsList({
      limit: 2,
      offset: 2,
      sort: "name",
    });
    expect(page1.data.length).toBe(2);
    expect(page2.data.length).toBe(2);
    const allIds = [...page1.data, ...page2.data].map((c) => c.id);
    expect(new Set(allIds).size).toBe(4); // no overlap
  });
});

// ---------------------------------------------------------------------------
// contactsShow
// ---------------------------------------------------------------------------

describe("contactsShow", () => {
  it("returns full detail with tags, orgs, and donation summary", async () => {
    const prefix = seed.contacts.janeSmith.slice(0, 8);
    const result = await contactsShow(prefix);
    expect(result.ok).toBe(true);
    const data = result.data!;
    expect(data.firstName).toBe("Jane");
    expect(data.tags).toContain("vip");
    expect(data.organisations.length).toBe(1);
    expect(data.organisations[0]!.role).toBe("Board Chair");
    expect(data.donationSummary.totalDonations).toBe(2);
  });

  it("fails on nonexistent prefix", async () => {
    const result = await contactsShow("zzzzzzzz");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contactsSearch
// ---------------------------------------------------------------------------

describe("contactsSearch", () => {
  it("finds by name", async () => {
    const result = await contactsSearch("Smith", { type: "all", limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data.some((r) => r.name.includes("Smith"))).toBe(true);
  });

  it("finds by email", async () => {
    const result = await contactsSearch("bigpond", { type: "all", limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// contactsEdit
// ---------------------------------------------------------------------------

describe("contactsEdit", () => {
  it("returns plan without --confirm", async () => {
    const prefix = seed.contacts.bobWilliams.slice(0, 8);
    const result = await contactsEdit(prefix, {
      suburb: "Heidelberg",
      confirm: false,
    });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
  });

  it("updates field with --confirm and writes audit log", async () => {
    const prefix = seed.contacts.bobWilliams.slice(0, 8);
    const result = await contactsEdit(prefix, {
      suburb: "Heidelberg",
      confirm: true,
    });
    expect(result.ok).toBe(true);

    // Verify DB updated
    const db = getSetupDb();
    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, seed.contacts.bobWilliams));
    expect(contact.suburb).toBe("Heidelberg");

    // Verify audit log
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "contacts"));
    expect(audits.some((a) => a.action === "UPDATE")).toBe(true);
  });
});
