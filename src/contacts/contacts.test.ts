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

const { contactsShow } = await import("./show.js");
const { contactsEdit } = await import("./edit.js");

describe("contacts show", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("fails when contact not found", async () => {
    setSelectQueue(mockCfg, "contacts", [[]]);

    const result = await contactsShow("deadbeef");

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("not found");
  });

  it("returns full contact details", async () => {
    const contact = fixtures.contact();
    // Query 1: find contact, Query 2: ambiguity check (no second match)
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);
    mockCfg.selectResults.set("contact_org_links", []);
    mockCfg.selectResults.set("donations", []);

    const result = await contactsShow("aaaaaaaa");

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.firstName).toBe("Jane");
    expect(result.data!.lastName).toBe("Smith");
    expect(result.data!.email).toBe("jane@example.org");
    expect(result.data!.id).toBe("aaaaaaaa");
    expect(result.data!.suburb).toBe("Richmond");
    expect(result.data!.state).toBe("VIC");
  });

  it("fails on ambiguous prefix", async () => {
    const contact = fixtures.contact();
    const other = fixtures.contact({ id: "aaaaaaab-0000-0000-0000-000000000000", firstName: "John" });
    // Query 1: find contact, Query 2: ambiguity check (finds second match)
    setSelectQueue(mockCfg, "contacts", [[contact], [other]]);

    const result = await contactsShow("aaaaaaaa");

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Ambiguous");
  });

  it("includes donation summary", async () => {
    const contact = fixtures.contact();
    const d1 = fixtures.donation({ amount: "100.00", status: "received", isDgrEligible: true });
    const d2 = fixtures.donation({ amount: "200.00", status: "receipted", isDgrEligible: true });
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);
    mockCfg.selectResults.set("contact_org_links", []);
    mockCfg.selectResults.set("donations", [d1, d2]);

    const result = await contactsShow("aaaaaaaa");

    expect(result.ok).toBe(true);
    expect(result.data!.donationSummary.totalDonations).toBe(2);
    expect(result.data!.donationSummary.totalAmount).toBe("300.00");
    expect(result.data!.donationSummary.unreceipted).toBe(1);
  });

  it("hints about unreceipted donations", async () => {
    const contact = fixtures.contact();
    const d1 = fixtures.donation({ status: "received", isDgrEligible: true });
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);
    mockCfg.selectResults.set("contact_org_links", []);
    mockCfg.selectResults.set("donations", [d1]);

    const result = await contactsShow("aaaaaaaa");

    expect(result.hints.some((h: string) => h.includes("unreceipted"))).toBe(true);
  });

  it("hints about missing email", async () => {
    const contact = fixtures.contact({ email: null });
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);
    mockCfg.selectResults.set("contact_org_links", []);
    mockCfg.selectResults.set("donations", []);

    const result = await contactsShow("aaaaaaaa");

    expect(result.hints.some((h: string) => h.includes("No email"))).toBe(true);
  });

  it("includes tags in result", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", [
      { key: "vip", value: null },
      { key: "source", value: "website" },
    ]);
    mockCfg.selectResults.set("contact_org_links", []);
    mockCfg.selectResults.set("donations", []);

    const result = await contactsShow("aaaaaaaa");

    expect(result.data!.tags).toContain("vip");
    expect(result.data!.tags).toContain("source=website");
  });

  it("includes organisation links", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);
    mockCfg.selectResults.set("contact_org_links", [
      { name: "Good Corp", role: "Board Chair" },
    ]);
    mockCfg.selectResults.set("donations", []);

    const result = await contactsShow("aaaaaaaa");

    expect(result.data!.organisations).toHaveLength(1);
    expect(result.data!.organisations[0].name).toBe("Good Corp");
    expect(result.data!.organisations[0].role).toBe("Board Chair");
  });

  it("shows zero donation summary when no donations", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);
    mockCfg.selectResults.set("contact_org_links", []);
    mockCfg.selectResults.set("donations", []);

    const result = await contactsShow("aaaaaaaa");

    expect(result.data!.donationSummary.totalDonations).toBe(0);
    expect(result.data!.donationSummary.totalAmount).toBe("0.00");
    expect(result.data!.donationSummary.lastDonation).toBeNull();
  });
});

describe("contacts edit", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("fails when contact not found", async () => {
    setSelectQueue(mockCfg, "contacts", [[]]);

    const result = await contactsEdit("deadbeef", { confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("not found");
  });

  it("fails on ambiguous prefix", async () => {
    const contact = fixtures.contact();
    const other = fixtures.contact({ id: "aaaaaaab-0000-0000-0000-000000000000" });
    setSelectQueue(mockCfg, "contacts", [[contact], [other]]);

    const result = await contactsEdit("aaaaaaaa", { email: "new@example.org", confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("Ambiguous");
  });

  it("fails when no changes specified", async () => {
    const contact = fixtures.contact();
    // Query 1: find, Query 2: ambiguity check
    setSelectQueue(mockCfg, "contacts", [[contact], []]);

    const result = await contactsEdit("aaaaaaaa", { confirm: true });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("No changes specified");
  });

  it("returns plan without --confirm", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);

    const result = await contactsEdit("aaaaaaaa", {
      email: "newemail@example.org",
      confirm: false,
    });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan!.tier).toBe("write");
    expect(result.plan!.action).toContain("Jane Smith");
    expect(result.plan!.confirmCommand).toContain("--confirm");
  });

  it("plan shows old → new values", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);

    const result = await contactsEdit("aaaaaaaa", {
      phone: "0400 999 888",
      confirm: false,
    });

    expect(result.plan!.details.phone).toContain("0499 111 222");
    expect(result.plan!.details.phone).toContain("0400 999 888");
  });

  it("updates contact with --confirm", async () => {
    const contact = fixtures.contact();
    // Query 1: find, Query 2: ambiguity, Query 3: email uniqueness check (no conflict)
    setSelectQueue(mockCfg, "contacts", [[contact], [], []]);
    mockCfg.selectResults.set("tags", []);

    const result = await contactsEdit("aaaaaaaa", {
      phone: "0400 999 888",
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data).not.toBeNull();
    expect(result.data!.name).toBe("Jane Smith");
    expect(mockCfg.updates.length).toBeGreaterThan(0);
  });

  it("rejects duplicate email", async () => {
    const contact = fixtures.contact();
    const other = fixtures.contact({ id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff" });
    // Query 1: find, Query 2: ambiguity (none), Query 3: email uniqueness (conflict found)
    setSelectQueue(mockCfg, "contacts", [[contact], [], [other]]);

    const result = await contactsEdit("aaaaaaaa", {
      email: "taken@example.org",
      confirm: true,
    });

    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain("already used");
  });

  it("includes add-tag in plan details", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);

    const result = await contactsEdit("aaaaaaaa", {
      addTag: ["vip", "source=referral"],
      confirm: false,
    });

    expect(result.plan!.details.addTags).toContain("vip");
    expect(result.plan!.details.addTags).toContain("source=referral");
  });

  it("updates name fields correctly", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);

    const result = await contactsEdit("aaaaaaaa", {
      firstName: "Janet",
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data!.name).toBe("Janet Smith");
  });

  it("handles tag additions with --confirm", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", [{ key: "vip", value: null }]);

    const result = await contactsEdit("aaaaaaaa", {
      addTag: ["vip"],
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(mockCfg.inserts.some((i: any) => i.table === "tags")).toBe(true);
  });

  it("handles tag removals with --confirm", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", []);

    const result = await contactsEdit("aaaaaaaa", {
      removeTag: ["old-tag"],
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(mockCfg.deletes.some((d: any) => d.table === "tags")).toBe(true);
  });

  it("handles combined field and tag changes", async () => {
    const contact = fixtures.contact();
    setSelectQueue(mockCfg, "contacts", [[contact], []]);
    mockCfg.selectResults.set("tags", [{ key: "new-tag", value: null }]);

    const result = await contactsEdit("aaaaaaaa", {
      suburb: "Fitzroy",
      addTag: ["new-tag"],
      confirm: true,
    });

    expect(result.ok).toBe(true);
    expect(mockCfg.updates.length).toBeGreaterThan(0);
    expect(mockCfg.inserts.some((i: any) => i.table === "tags")).toBe(true);
  });
});
