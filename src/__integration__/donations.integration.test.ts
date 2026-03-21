import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, seedDb, closeSetupDb, getSetupDb, type SeedResult } from "./helpers.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";

const { donationsAdd } = await import("../donations/add.js");
const { donationsList } = await import("../donations/list.js");
const { donationsShow } = await import("../donations/show.js");
const { donationsVoid } = await import("../donations/void-donation.js");

let seed: SeedResult;

beforeEach(async () => {
  await resetDb();
  seed = await seedDb();
});

afterAll(async () => {
  await closeSetupDb();
});

// ---------------------------------------------------------------------------
// donationsAdd
// ---------------------------------------------------------------------------

describe("donationsAdd", () => {
  it("returns plan without --confirm", async () => {
    const result = await donationsAdd("150.00", {
      contact: "Jane Smith",
      date: "2026-03-15",
      fund: "general",
      dgr: true,
      confirm: false,
    });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
  });

  it("creates donation with --confirm and contact resolution by name", async () => {
    const result = await donationsAdd("150.00", {
      contact: "Jane Smith",
      date: "2026-03-15",
      method: "eft",
      fund: "general",
      dgr: true,
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.amount).toBe("150.00");
    // contactId is returned as first 8 chars (display format)
    expect(seed.contacts.janeSmith).toContain(result.data!.contactId!);
  });

  it("creates donation with contact resolution by email", async () => {
    const result = await donationsAdd("75.00", {
      contact: "bob.w@gmail.com",
      date: "2026-03-15",
      fund: "general",
      dgr: true,
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(seed.contacts.bobWilliams).toContain(result.data!.contactId!);
  });

  it("writes audit log on confirmed add", async () => {
    await donationsAdd("50.00", {
      contact: "Tom Nguyen",
      date: "2026-03-15",
      fund: "general",
      dgr: true,
      confirm: true,
    });

    const db = getSetupDb();
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "donations"));
    expect(audits.some((a) => a.action === "INSERT")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// donationsList
// ---------------------------------------------------------------------------

describe("donationsList", () => {
  it("returns all seeded donations", async () => {
    const result = await donationsList({
      limit: 50,
      sort: "date",
    });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(6);
  });

  it("filters by date range", async () => {
    const result = await donationsList({
      from: "2026-01-01",
      limit: 50,
      sort: "date",
    });
    expect(result.ok).toBe(true);
    // Excludes Jane's Nov/Dec donations
    expect(result.data.length).toBe(4);
  });

  it("filters by method", async () => {
    const result = await donationsList({
      method: "eft",
      limit: 50,
      sort: "date",
    });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(3); // janeEft, bobEft, tomMonthly
  });

  it("filters by campaign", async () => {
    const result = await donationsList({
      campaign: "summer-appeal",
      limit: 50,
      sort: "date",
    });
    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// donationsShow
// ---------------------------------------------------------------------------

describe("donationsShow", () => {
  it("returns full donation detail with contact info", async () => {
    const prefix = seed.donations.bobEft500.slice(0, 8);
    const result = await donationsShow(prefix);
    expect(result.ok).toBe(true);
    expect(result.data!.amount).toBe("500.00");
    expect(result.data!.contactName).toContain("Bob");
    expect(result.data!.method).toBe("eft");
  });
});

// ---------------------------------------------------------------------------
// donationsVoid
// ---------------------------------------------------------------------------

describe("donationsVoid", () => {
  it("returns plan without --confirm", async () => {
    const prefix = seed.donations.bobCard50.slice(0, 8);
    const result = await donationsVoid(prefix, {
      confirm: false,
    });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
  });

  it("voids donation with --confirm and reason", async () => {
    const prefix = seed.donations.bobCard50.slice(0, 8);
    const result = await donationsVoid(prefix, {
      reason: "Duplicate entry",
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data!.status).toBe("voided");

    // Verify DB
    const db = getSetupDb();
    const [donation] = await db
      .select()
      .from(schema.donations)
      .where(eq(schema.donations.id, seed.donations.bobCard50));
    expect(donation.status).toBe("voided");
  });

  it("rejects voiding an already-voided donation", async () => {
    const prefix = seed.donations.bobCard50.slice(0, 8);
    await donationsVoid(prefix, { reason: "First void", confirm: true });
    const result = await donationsVoid(prefix, {
      reason: "Second void",
      confirm: true,
    });
    expect(result.ok).toBe(false);
  });
});
