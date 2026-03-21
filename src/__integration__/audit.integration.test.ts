import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, seedDb, closeSetupDb, getSetupDb, type SeedResult } from "./helpers.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";

const { contactsAdd } = await import("../contacts/add.js");
const { donationsAdd } = await import("../donations/add.js");
const { receiptsGenerate } = await import("../donations/receipt.js");
const { receiptsVoid } = await import("../donations/void-receipt.js");

let seed: SeedResult;

beforeEach(async () => {
  await resetDb();
  seed = await seedDb();
});

afterAll(async () => {
  await closeSetupDb();
});

describe("audit trail", () => {
  it("records full lifecycle: add contact → add donation → generate receipt → void receipt", async () => {
    // Step 1: Add contact
    const contact = await contactsAdd("Audit", "Test", {
      email: "audit@test.org",
      type: "donor",
      confirm: true,
    });
    expect(contact.ok).toBe(true);

    // Step 2: Add donation for that contact
    const donation = await donationsAdd("200.00", {
      contact: "Audit Test",
      date: "2026-03-18",
      fund: "general",
      dgr: true,
      confirm: true,
    });
    expect(donation.ok).toBe(true);

    // Step 3: Generate receipt — need full UUID (donationsAdd returns truncated)
    const db = getSetupDb();
    const allDonations = await db.select().from(schema.donations);
    const newDonation = allDonations.find(d => d.id.startsWith(donation.data!.id));
    const receipt = await receiptsGenerate(newDonation!.id, {
      send: false,
      confirm: true,
    });
    expect(receipt.ok).toBe(true);

    // Step 4: Void receipt
    const voided = await receiptsVoid("1", {
      reason: "Test void",
      confirm: true,
    });
    expect(voided.ok).toBe(true);

    // Verify audit trail
    const audits = await db
      .select()
      .from(schema.auditLog)
      .orderBy(schema.auditLog.performedAt);

    // Should have at least 4 entries (contact INSERT, donation INSERT, receipt INSERT, receipt UPDATE)
    expect(audits.length).toBeGreaterThanOrEqual(4);

    const tables = audits.map((a) => `${a.tableName}:${a.action}`);
    expect(tables).toContain("contacts:INSERT");
    expect(tables).toContain("donations:INSERT");
    expect(tables).toContain("receipts:INSERT");
    expect(tables).toContain("receipts:UPDATE");
  });

  it("records changed fields in JSONB", async () => {
    const db = getSetupDb();
    const { contactsEdit } = await import("../contacts/edit.js");

    const prefix = seed.contacts.janeSmith.slice(0, 8);
    await contactsEdit(prefix, { suburb: "Carlton", confirm: true });

    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "contacts"));

    const updateEntry = audits.find((a) => a.action === "UPDATE");
    expect(updateEntry).toBeDefined();
    expect(updateEntry!.changedFields).toBeDefined();

    const changes = updateEntry!.changedFields as Record<string, any>;
    expect(changes.suburb).toBeDefined();
    expect(changes.suburb.old).toBe("Eltham");
    expect(changes.suburb.new).toBe("Carlton");
  });
});
