import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, seedDb, closeSetupDb, getSetupDb, type SeedResult } from "./helpers.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";

const { receiptsGenerate, receiptsBatch } = await import("../donations/receipt.js");
const { receiptsVoid } = await import("../donations/void-receipt.js");

let seed: SeedResult;

beforeEach(async () => {
  await resetDb();
  seed = await seedDb();
});

afterAll(async () => {
  await closeSetupDb();
});

// ---------------------------------------------------------------------------
// receiptsGenerate
// ---------------------------------------------------------------------------

describe("receiptsGenerate", () => {
  it("returns plan without --confirm", async () => {
    const result = await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: false,
    });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("receipt");
    expect(result.plan!.details.recipient).toContain("Jane");
  });

  it("creates receipt with --confirm", async () => {
    const result = await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    expect(result.ok).toBe(true);
    const data = result.data as any;
    expect(data.receiptNumber).toBe(1);
    expect(data.recipientName).toContain("Jane");
    expect(data.amount).toBe("250.00");

    // Verify receipt row
    const db = getSetupDb();
    const [receipt] = await db
      .select()
      .from(schema.receipts)
      .where(eq(schema.receipts.receiptNumber, 1));
    expect(receipt).toBeDefined();
    expect(receipt.isVoided).toBe(false);
    expect(receipt.pdfHash).toBeTruthy();

    // Verify donation status changed to "receipted"
    const [donation] = await db
      .select()
      .from(schema.donations)
      .where(eq(schema.donations.id, seed.donations.janeEft250));
    expect(donation.status).toBe("receipted");
  });

  it("allocates sequential receipt numbers", async () => {
    const r1 = await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    const r2 = await receiptsGenerate(seed.donations.bobEft500, {
      send: false,
      confirm: true,
    });
    expect((r1.data as any).receiptNumber).toBe(1);
    expect((r2.data as any).receiptNumber).toBe(2);
  });

  it("rejects non-DGR-eligible donation", async () => {
    const result = await receiptsGenerate(seed.donations.janeCash100, {
      send: false,
      confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("DGR");
  });

  it("rejects already-receipted donation", async () => {
    await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    const result = await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("receipt");
  });

  it("writes audit log", async () => {
    await receiptsGenerate(seed.donations.bobEft500, {
      send: false,
      confirm: true,
    });

    const db = getSetupDb();
    const audits = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tableName, "receipts"));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.action).toBe("INSERT");
  });
});

// ---------------------------------------------------------------------------
// receiptsVoid
// ---------------------------------------------------------------------------

describe("receiptsVoid", () => {
  it("returns plan without --confirm", async () => {
    await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    const result = await receiptsVoid("1", { confirm: false });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("receipt");
  });

  it("voids receipt with --confirm and reverts donation status", async () => {
    await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    const result = await receiptsVoid("1", {
      reason: "Issued in error",
      confirm: true,
    });
    expect(result.ok).toBe(true);
    expect(result.data!.receiptNumber).toBe(1);

    // Verify receipt voided
    const db = getSetupDb();
    const [receipt] = await db
      .select()
      .from(schema.receipts)
      .where(eq(schema.receipts.receiptNumber, 1));
    expect(receipt.isVoided).toBe(true);
    expect(receipt.voidReason).toBe("Issued in error");

    // Verify donation reverted to "received"
    const [donation] = await db
      .select()
      .from(schema.donations)
      .where(eq(schema.donations.id, seed.donations.janeEft250));
    expect(donation.status).toBe("received");
  });

  it("requires reason for confirmation", async () => {
    await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    const result = await receiptsVoid("1", { confirm: true });
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("reason");
  });

  it("rejects voiding already-voided receipt", async () => {
    await receiptsGenerate(seed.donations.janeEft250, {
      send: false,
      confirm: true,
    });
    await receiptsVoid("1", { reason: "First", confirm: true });
    const result = await receiptsVoid("1", {
      reason: "Second",
      confirm: true,
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// receiptsBatch
// ---------------------------------------------------------------------------

describe("receiptsBatch", () => {
  it("returns plan showing all eligible donations", async () => {
    const result = await receiptsBatch({
      send: false,
      confirm: false,
    });
    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    // 5 DGR-eligible "received" donations (janeCash100 is not DGR)
    expect((result.data as any[]).length).toBe(5);
  });

  it("generates all receipts with --confirm", async () => {
    const result = await receiptsBatch({
      send: false,
      confirm: true,
    });
    expect(result.ok).toBe(true);
    const data = result.data as any[];
    expect(data.length).toBe(5);
    // Sequential receipt numbers
    expect(data[0]!.receiptNumber).toBe(1);
    expect(data[data.length - 1]!.receiptNumber).toBe(5);
  });
});
