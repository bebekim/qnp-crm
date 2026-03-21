import { describe, it, expect } from "vitest";
import {
  validateCommand,
  isValidationError,
  getRegistry,
  getCommandNames,
  getCommandTier,
  getCommandBinary,
  type ValidatedCommand,
  type ValidationError,
} from "./command-schema.js";

// ---------------------------------------------------------------------------
// validateCommand — Layer 1 core
// ---------------------------------------------------------------------------

describe("validateCommand()", () => {
  // --- Happy paths ---

  it("validates contacts.add and builds CLI string", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { firstName: "Jane", lastName: "Smith", email: "jane@example.org", type: "donor" },
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.command).toBe("contacts.add");
    expect(v.tier).toBe("write");
    expect(v.cliString.startsWith("qnp-crm ")).toBe(true);
    expect(v.cliString).toContain("contacts add");
    expect(v.cliString).toContain("Jane");
    expect(v.cliString).toContain("Smith");
    expect(v.cliString).toContain("-e");
    expect(v.cliString).toContain("jane@example.org");
    expect(v.cliString).toContain("-t");
    expect(v.cliString).toContain("donor");
  });

  it("validates donations.add with numeric amount", () => {
    const result = validateCommand({
      command: "donations.add",
      params: { amount: 500, contact: "Jane Smith", method: "eft" },
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.tier).toBe("write");
    expect(v.cliString.startsWith("qnp-crm ")).toBe(true);
    expect(v.cliString).toContain("500");
    expect(v.cliString).toContain("-c");
    expect(v.cliString).toContain("-m");
    expect(v.cliString).toContain("eft");
  });

  it("validates receipts.generate as receipt tier", () => {
    const result = validateCommand({
      command: "receipts.generate",
      params: { donationId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", send: true, confirm: true },
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.tier).toBe("receipt");
    expect(v.cliString).toContain("--send");
    expect(v.cliString).toContain("--confirm");
  });

  it("validates a read command with no params", () => {
    const result = validateCommand({
      command: "reports.unreceipted",
      params: {},
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.tier).toBe("read");
    expect(v.cliString).toBe("qnp-crm reports unreceipted");
  });

  it("validates contacts.list with filters", () => {
    const result = validateCommand({
      command: "contacts.list",
      params: { type: "donor", tag: ["vip", "major=true"], limit: 10 },
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.cliString.startsWith("qnp-crm ")).toBe(true);
    expect(v.cliString).toContain("-t");
    expect(v.cliString).toContain("donor");
    expect(v.cliString).toContain("--tag");
    expect(v.cliString).toContain("vip");
    expect(v.cliString).toContain("major=true");
    expect(v.cliString).toContain("-n");
    expect(v.cliString).toContain("10");
  });

  it("handles confirm flag in output", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { firstName: "A", lastName: "B", confirm: true },
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.cliString).toContain("--confirm");
  });

  it("handles contacts.edit with add-tag and remove-tag", () => {
    const result = validateCommand({
      command: "contacts.edit",
      params: { id: "a1b2c3d4", addTag: ["vip"], removeTag: ["old-tag"] },
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.cliString).toContain("--add-tag");
    expect(v.cliString).toContain("vip");
    expect(v.cliString).toContain("--remove-tag");
    expect(v.cliString).toContain("old-tag");
  });

  // --- Rejection paths ---

  it("rejects unknown command", () => {
    const result = validateCommand({
      command: "contacts.destroy",
      params: {},
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors[0].message).toContain("Unknown command");
    expect(e.errors[0].message).toContain("contacts.destroy");
  });

  it("rejects invalid donation method", () => {
    const result = validateCommand({
      command: "donations.add",
      params: { amount: 100, method: "bitcoin" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "method")).toBe(true);
  });

  it("rejects negative donation amount", () => {
    const result = validateCommand({
      command: "donations.add",
      params: { amount: -50 },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "amount")).toBe(true);
  });

  it("rejects zero donation amount", () => {
    const result = validateCommand({
      command: "donations.add",
      params: { amount: 0 },
    });

    expect(isValidationError(result)).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = validateCommand({
      command: "donations.add",
      params: { amount: 100, date: "March 1 2026" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "date")).toBe(true);
  });

  it("rejects invalid Australian state", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { firstName: "A", lastName: "B", state: "CA" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "state")).toBe(true);
  });

  it("rejects invalid postcode", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { firstName: "A", lastName: "B", postcode: "123" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "postcode")).toBe(true);
  });

  it("rejects missing required positional args", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { lastName: "Smith" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "firstName")).toBe(true);
  });

  it("rejects non-UUID donation ID for receipts.generate", () => {
    const result = validateCommand({
      command: "receipts.generate",
      params: { donationId: "abc123" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "donationId")).toBe(true);
  });

  it("rejects short UUID prefix", () => {
    const result = validateCommand({
      command: "contacts.show",
      params: { id: "abc" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "id")).toBe(true);
  });

  it("rejects invalid contact type", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { firstName: "A", lastName: "B", type: "sponsor" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "type")).toBe(true);
  });

  it("rejects malformed top-level input", () => {
    const result = validateCommand("not an object");

    expect(isValidationError(result)).toBe(true);
  });

  it("rejects invalid email format", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { firstName: "A", lastName: "B", email: "not-an-email" },
    });

    expect(isValidationError(result)).toBe(true);
    const e = result as ValidationError;
    expect(e.errors.some((err) => err.path === "email")).toBe(true);
  });

  // --- Shell quoting ---

  it("quotes params with spaces", () => {
    const result = validateCommand({
      command: "contacts.add",
      params: { firstName: "Mary Jane", lastName: "O'Brien" },
    });

    expect(isValidationError(result)).toBe(false);
    const v = result as ValidatedCommand;
    expect(v.cliString).toContain("'Mary Jane'");
    expect(v.cliString).toContain("O");
  });
});

// ---------------------------------------------------------------------------
// getRegistry — introspection
// ---------------------------------------------------------------------------

describe("getRegistry()", () => {
  it("returns all commands with tiers and shapes", () => {
    const registry = getRegistry();
    expect(Object.keys(registry).length).toBeGreaterThan(15);
    expect(registry["contacts.add"].tier).toBe("write");
    expect(registry["contacts.add"].shape).toHaveProperty("firstName");
    expect(registry["receipts.generate"].tier).toBe("receipt");
  });
});

// ---------------------------------------------------------------------------
// getCommandNames / getCommandTier
// ---------------------------------------------------------------------------

describe("getCommandNames()", () => {
  it("returns all command names", () => {
    const names = getCommandNames();
    expect(names).toContain("contacts.add");
    expect(names).toContain("donations.add");
    expect(names).toContain("receipts.generate");
    expect(names).toContain("search");
  });
});

describe("getCommandTier()", () => {
  it("returns correct tiers", () => {
    expect(getCommandTier("contacts.list")).toBe("read");
    expect(getCommandTier("contacts.add")).toBe("write");
    expect(getCommandTier("receipts.generate")).toBe("receipt");
  });
});

// ---------------------------------------------------------------------------
// getCommandBinary — per-binary routing
// ---------------------------------------------------------------------------

describe("getCommandBinary()", () => {
  it("routes all commands to qnp-crm", () => {
    expect(getCommandBinary("contacts.add")).toBe("qnp-crm");
    expect(getCommandBinary("contacts.list")).toBe("qnp-crm");
    expect(getCommandBinary("orgs.add")).toBe("qnp-crm");
    expect(getCommandBinary("donations.add")).toBe("qnp-crm");
    expect(getCommandBinary("donations.void")).toBe("qnp-crm");
    expect(getCommandBinary("receipts.generate")).toBe("qnp-crm");
    expect(getCommandBinary("receipts.batch")).toBe("qnp-crm");
    expect(getCommandBinary("receipts.void")).toBe("qnp-crm");
    expect(getCommandBinary("reports.summary")).toBe("qnp-crm");
    expect(getCommandBinary("search")).toBe("qnp-crm");
    expect(getCommandBinary("jobs.history")).toBe("qnp-crm");
    expect(getCommandBinary("deadlines")).toBe("qnp-crm");
    expect(getCommandBinary("config.show")).toBe("qnp-crm");
    expect(getCommandBinary("config.set")).toBe("qnp-crm");
  });
});
