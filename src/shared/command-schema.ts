/**
 * Command Schema Registry — Layer 1 of the verification architecture.
 *
 * Defines Zod schemas for every implemented qnp-crm command.
 * The LLM generates a structured JSON object; the schema validates it
 * and converts it to CLI args. This eliminates an entire class of
 * hallucination: the LLM cannot generate a command that doesn't exist
 * in the registry, or pass a parameter that isn't in the schema.
 *
 * Usage:
 *   qnp-crm validate '{"command":"contacts.add","params":{"firstName":"Jane","lastName":"Smith"}}'
 *   → validates and outputs the CLI string + tier
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared validators
// ---------------------------------------------------------------------------

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const uuidPrefix = z.string().min(8, "UUID prefix must be at least 8 characters");
const auState = z.enum(["VIC", "NSW", "QLD", "SA", "WA", "TAS", "NT", "ACT"]);
const contactType = z.enum(["donor", "volunteer", "client", "board", "other"]);
const orgType = z.enum(["charity", "government", "corporate", "community", "other"]);
const donationMethod = z.enum(["cash", "cheque", "eft", "card", "in_kind", "other"]);
const postcode = z.string().regex(/^\d{4}$/, "Postcode must be 4 digits");
const positiveNumber = z.number().positive("Amount must be positive");
const positiveInt = z.number().int().positive();
const tag = z.string().regex(/^[a-zA-Z0-9_-]+(=[a-zA-Z0-9_ -]+)?$/, "Tag format: key or key=value");
const sortField = z.string().regex(/^-?[a-zA-Z]+$/, "Sort: fieldName or -fieldName");

// ---------------------------------------------------------------------------
// Command parameter schemas — one per implemented command
// ---------------------------------------------------------------------------

const schemas = {
  // --- Contacts ---
  "contacts.add": z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    suburb: z.string().optional(),
    state: auState.optional(),
    postcode: postcode.optional(),
    type: contactType.optional(),
    tag: z.array(tag).optional(),
    notes: z.string().optional(),
    confirm: z.boolean().optional(),
  }),

  "contacts.list": z.object({
    type: contactType.optional(),
    tag: z.array(tag).optional(),
    search: z.string().optional(),
    state: auState.optional(),
    limit: positiveInt.optional(),
    offset: z.number().int().nonnegative().optional(),
    sort: sortField.optional(),
  }),

  "contacts.search": z.object({
    query: z.string().min(1),
    type: z.enum(["contact", "org", "all"]).optional(),
    limit: positiveInt.optional(),
  }),

  "contacts.show": z.object({
    id: uuidPrefix,
  }),

  "contacts.edit": z.object({
    id: uuidPrefix,
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    suburb: z.string().optional(),
    state: auState.optional(),
    postcode: postcode.optional(),
    type: contactType.optional(),
    notes: z.string().optional(),
    addTag: z.array(tag).optional(),
    removeTag: z.array(z.string()).optional(),
    confirm: z.boolean().optional(),
  }),

  "contacts.history": z.object({
    id: uuidPrefix,
    limit: positiveInt.optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
  }),

  "contacts.import": z.object({
    file: z.string().min(1),
    map: z.array(z.string().regex(/^.+=.+$/, "Mapping format: CSV Column=fieldName")).optional(),
    preset: z.enum(["salesforce"]).optional(),
    onDuplicate: z.enum(["skip", "update", "error"]).optional(),
    tag: z.array(tag).optional(),
    type: contactType.optional(),
    confirm: z.boolean().optional(),
  }),

  // --- Organisations ---
  "orgs.add": z.object({
    name: z.string().min(1),
    abn: z.string().regex(/^\d{11}$/, "ABN must be 11 digits").optional(),
    orgType: orgType.optional(),
    addressLine1: z.string().optional(),
    suburb: z.string().optional(),
    state: auState.optional(),
    postcode: postcode.optional(),
    phone: z.string().optional(),
    website: z.string().optional(),
    notes: z.string().optional(),
    tag: z.array(tag).optional(),
    confirm: z.boolean().optional(),
  }),

  // --- Donations ---
  "donations.add": z.object({
    amount: positiveNumber,
    contact: z.string().optional(),
    date: dateStr.optional(),
    method: donationMethod.optional(),
    fund: z.string().optional(),
    campaign: z.string().optional(),
    reference: z.string().optional(),
    noDgr: z.boolean().optional(),
    notes: z.string().optional(),
    confirm: z.boolean().optional(),
  }),

  "donations.list": z.object({
    contact: z.string().optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
    method: donationMethod.optional(),
    fund: z.string().optional(),
    campaign: z.string().optional(),
    status: z.string().optional(),
    unreceipted: z.boolean().optional(),
    limit: positiveInt.optional(),
    sort: sortField.optional(),
  }),

  "donations.show": z.object({
    id: uuidPrefix,
  }),

  "donations.void": z.object({
    id: uuidPrefix,
    reason: z.string().optional(),
    confirm: z.boolean().optional(),
  }),

  // --- Receipts ---
  "receipts.generate": z.object({
    donationId: z.string().uuid("Donation ID must be a full UUID"),
    send: z.boolean().optional(),
    confirm: z.boolean().optional(),
  }),

  "receipts.batch": z.object({
    from: dateStr.optional(),
    to: dateStr.optional(),
    fund: z.string().optional(),
    send: z.boolean().optional(),
    confirm: z.boolean().optional(),
  }),

  "receipts.void": z.object({
    receiptNumber: positiveInt,
    reason: z.string().optional(),
    confirm: z.boolean().optional(),
  }),

  // --- Reports ---
  "reports.summary": z.object({
    from: dateStr.optional(),
    to: dateStr.optional(),
    campaign: z.string().optional(),
  }),

  "reports.unreceipted": z.object({}),

  "reports.deadlines": z.object({
    days: positiveInt.optional(),
  }),

  // --- Search ---
  "search": z.object({
    query: z.string().min(1),
    type: z.enum(["contact", "org", "donation"]).optional(),
    limit: positiveInt.optional(),
  }),

  // --- Config ---
  "config.show": z.object({}),

  "config.set": z.object({
    key: z.string().min(1),
    value: z.string().min(1),
    confirm: z.boolean().optional(),
  }),

  // --- Jobs ---
  "jobs.history": z.object({
    task: z.string().optional(),
    status: z.enum(["success", "error"]).optional(),
    from: dateStr.optional(),
    limit: positiveInt.optional(),
  }),

  // --- Deadlines (alias) ---
  "deadlines": z.object({
    days: positiveInt.optional(),
  }),
} as const;

// ---------------------------------------------------------------------------
// Tier map
// ---------------------------------------------------------------------------

const tierMap: Record<CommandName, "read" | "write" | "receipt"> = {
  "contacts.add": "write",
  "contacts.list": "read",
  "contacts.search": "read",
  "contacts.show": "read",
  "contacts.edit": "write",
  "contacts.history": "read",
  "contacts.import": "write",
  "orgs.add": "write",
  "donations.add": "write",
  "donations.list": "read",
  "donations.show": "read",
  "donations.void": "write",
  "receipts.generate": "receipt",
  "receipts.batch": "receipt",
  "receipts.void": "receipt",
  "reports.summary": "read",
  "reports.unreceipted": "read",
  "reports.deadlines": "read",
  "search": "read",
  "config.show": "read",
  "config.set": "write",
  "jobs.history": "read",
  "deadlines": "read",
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CommandName = keyof typeof schemas;

export interface CommandInput {
  command: CommandName;
  params: Record<string, unknown>;
}

export interface ValidatedCommand {
  command: CommandName;
  params: Record<string, unknown>;
  tier: "read" | "write" | "receipt";
  cliArgs: string[];
  cliString: string;
}

export interface ValidationError {
  command: string;
  errors: Array<{ path: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Schema access
// ---------------------------------------------------------------------------

export function getCommandNames(): CommandName[] {
  return Object.keys(schemas) as CommandName[];
}

export function getCommandTier(command: CommandName): "read" | "write" | "receipt" {
  return tierMap[command];
}

export function getSchema(command: CommandName): z.ZodObject<z.ZodRawShape> {
  return schemas[command] as z.ZodObject<z.ZodRawShape>;
}

/** Full registry for introspection (qnp-crm schema). */
export function getRegistry(): Record<CommandName, { tier: string; shape: Record<string, string> }> {
  const registry: Record<string, { tier: string; shape: Record<string, string> }> = {};
  for (const name of getCommandNames()) {
    const schema = schemas[name];
    const shape: Record<string, string> = {};
    const zodShape = schema.shape;
    for (const [key, val] of Object.entries(zodShape)) {
      shape[key] = describeZodType(val as z.ZodTypeAny);
    }
    registry[name] = { tier: tierMap[name], shape };
  }
  return registry as Record<CommandName, { tier: string; shape: Record<string, string> }>;
}

function describeZodType(t: z.ZodTypeAny): string {
  if (t instanceof z.ZodOptional) return describeZodType(t.unwrap()) + "?";
  if (t instanceof z.ZodEnum) return (t.options as string[]).join("|");
  if (t instanceof z.ZodArray) return describeZodType(t.element) + "[]";
  if (t instanceof z.ZodString) return "string";
  if (t instanceof z.ZodNumber) return "number";
  if (t instanceof z.ZodBoolean) return "boolean";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCommand(input: unknown): ValidatedCommand | ValidationError {
  // Parse top-level shape
  const topLevel = z.object({
    command: z.string(),
    params: z.record(z.unknown()).default({}),
  }).safeParse(input);

  if (!topLevel.success) {
    return {
      command: "unknown",
      errors: topLevel.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }

  const { command, params } = topLevel.data;

  // Check command exists
  if (!(command in schemas)) {
    return {
      command,
      errors: [{
        path: "command",
        message: `Unknown command "${command}". Valid commands: ${getCommandNames().join(", ")}`,
      }],
    };
  }

  const name = command as CommandName;
  const schema = schemas[name] as z.ZodObject<z.ZodRawShape>;
  const result = schema.safeParse(params);

  if (!result.success) {
    return {
      command: name,
      errors: result.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    };
  }

  const validated = result.data;
  const args = buildCliArgs(name, validated);

  return {
    command: name,
    params: validated,
    tier: tierMap[name],
    cliArgs: args,
    cliString: `${binaryMap[name].bin} ${args.join(" ")}`,
  };
}

export function isValidationError(result: ValidatedCommand | ValidationError): result is ValidationError {
  return "errors" in result;
}

// ---------------------------------------------------------------------------
// CLI arg builder — converts validated params to CLI args
// ---------------------------------------------------------------------------

/** Map of command → { positionalArgs, optionMap } */
const cliMap: Record<CommandName, { positionals: string[]; flags: Record<string, string> }> = {
  "contacts.add": {
    positionals: ["firstName", "lastName"],
    flags: { email: "-e", phone: "-p", addressLine1: "--address-line1", addressLine2: "--address-line2", suburb: "--suburb", state: "--state", postcode: "--postcode", type: "-t", notes: "--notes" },
  },
  "contacts.list": {
    positionals: [],
    flags: { type: "-t", search: "-s", state: "--state", limit: "-n", offset: "--offset", sort: "--sort" },
  },
  "contacts.search": {
    positionals: ["query"],
    flags: { type: "--type", limit: "-n" },
  },
  "contacts.show": {
    positionals: ["id"],
    flags: {},
  },
  "contacts.edit": {
    positionals: ["id"],
    flags: { firstName: "--first-name", lastName: "--last-name", email: "-e", phone: "-p", addressLine1: "--address-line1", addressLine2: "--address-line2", suburb: "--suburb", state: "--state", postcode: "--postcode", type: "-t", notes: "--notes" },
  },
  "contacts.history": {
    positionals: ["id"],
    flags: { limit: "-n", from: "--from", to: "--to" },
  },
  "contacts.import": {
    positionals: ["file"],
    flags: { preset: "--preset", onDuplicate: "--on-duplicate", type: "-t" },
  },
  "orgs.add": {
    positionals: ["name"],
    flags: { abn: "--abn", orgType: "--org-type", addressLine1: "--address-line1", suburb: "--suburb", state: "--state", postcode: "--postcode", phone: "--phone", website: "--website", notes: "--notes" },
  },
  "donations.add": {
    positionals: ["amount"],
    flags: { contact: "-c", date: "-d", method: "-m", fund: "--fund", campaign: "--campaign", reference: "-r", notes: "--notes" },
  },
  "donations.list": {
    positionals: [],
    flags: { contact: "-c", from: "--from", to: "--to", method: "-m", fund: "--fund", campaign: "--campaign", status: "--status", limit: "-n", sort: "--sort" },
  },
  "donations.show": {
    positionals: ["id"],
    flags: {},
  },
  "donations.void": {
    positionals: ["id"],
    flags: { reason: "--reason" },
  },
  "receipts.generate": {
    positionals: ["donationId"],
    flags: {},
  },
  "receipts.batch": {
    positionals: [],
    flags: { from: "--from", to: "--to", fund: "--fund" },
  },
  "receipts.void": {
    positionals: ["receiptNumber"],
    flags: { reason: "--reason" },
  },
  "reports.summary": {
    positionals: [],
    flags: { from: "--from", to: "--to", campaign: "--campaign" },
  },
  "reports.unreceipted": {
    positionals: [],
    flags: {},
  },
  "reports.deadlines": {
    positionals: [],
    flags: { days: "--days" },
  },
  "search": {
    positionals: ["query"],
    flags: { type: "--type", limit: "-n" },
  },
  "config.show": {
    positionals: [],
    flags: {},
  },
  "config.set": {
    positionals: ["key", "value"],
    flags: {},
  },
  "jobs.history": {
    positionals: [],
    flags: { task: "--task", status: "--status", from: "--from", limit: "-n" },
  },
  "deadlines": {
    positionals: [],
    flags: { days: "--days" },
  },
};

/** Map command names to their binary + subcommand path. */
const binaryMap: Record<CommandName, { bin: string; sub: string[] }> = {
  "contacts.add": { bin: "qnp-crm", sub: ["contacts", "add"] },
  "contacts.list": { bin: "qnp-crm", sub: ["contacts", "list"] },
  "contacts.search": { bin: "qnp-crm", sub: ["contacts", "search"] },
  "contacts.show": { bin: "qnp-crm", sub: ["contacts", "show"] },
  "contacts.edit": { bin: "qnp-crm", sub: ["contacts", "edit"] },
  "contacts.history": { bin: "qnp-crm", sub: ["contacts", "history"] },
  "contacts.import": { bin: "qnp-crm", sub: ["contacts", "import"] },
  "orgs.add": { bin: "qnp-crm", sub: ["orgs", "add"] },
  "donations.add": { bin: "qnp-crm", sub: ["donations", "add"] },
  "donations.list": { bin: "qnp-crm", sub: ["donations", "list"] },
  "donations.show": { bin: "qnp-crm", sub: ["donations", "show"] },
  "donations.void": { bin: "qnp-crm", sub: ["donations", "void"] },
  "receipts.generate": { bin: "qnp-crm", sub: ["receipts", "generate"] },
  "receipts.batch": { bin: "qnp-crm", sub: ["receipts", "batch"] },
  "receipts.void": { bin: "qnp-crm", sub: ["receipts", "void"] },
  "reports.summary": { bin: "qnp-crm", sub: ["reports", "summary"] },
  "reports.unreceipted": { bin: "qnp-crm", sub: ["reports", "unreceipted"] },
  "reports.deadlines": { bin: "qnp-crm", sub: ["reports", "deadlines"] },
  "search": { bin: "qnp-crm", sub: ["search"] },
  "config.show": { bin: "qnp-crm", sub: ["config", "show"] },
  "config.set": { bin: "qnp-crm", sub: ["config", "set"] },
  "jobs.history": { bin: "qnp-crm", sub: ["jobs", "history"] },
  "deadlines": { bin: "qnp-crm", sub: ["deadlines"] },
};

export function getCommandBinary(command: CommandName): string {
  return binaryMap[command].bin;
}

function buildCliArgs(command: CommandName, params: Record<string, unknown>): string[] {
  const map = cliMap[command];
  const { sub } = binaryMap[command];
  const args: string[] = [];

  // Subcommand path within the binary
  args.push(...sub);

  // Positional args in order
  for (const key of map.positionals) {
    const val = params[key];
    if (val !== undefined) {
      args.push(shellQuote(String(val)));
    }
  }

  // Named flags
  for (const [key, flag] of Object.entries(map.flags)) {
    const val = params[key];
    if (val !== undefined) {
      args.push(flag, shellQuote(String(val)));
    }
  }

  // Repeatable arrays: tag, addTag, removeTag, map
  const repeatables: Record<string, string> = {
    tag: "--tag",
    addTag: "--add-tag",
    removeTag: "--remove-tag",
    map: "--map",
  };
  for (const [key, flag] of Object.entries(repeatables)) {
    const val = params[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        args.push(flag, shellQuote(String(item)));
      }
    }
  }

  // Boolean flags
  if (params["confirm"] === true) args.push("--confirm");
  if (params["send"] === true) args.push("--send");
  if (params["noDgr"] === true) args.push("--no-dgr");
  if (params["unreceipted"] === true) args.push("--unreceipted");

  return args;
}

function shellQuote(s: string): string {
  // If the string is simple alphanumeric/dots/dashes, no quoting needed
  if (/^[a-zA-Z0-9._@:/-]+$/.test(s)) return s;
  // Otherwise wrap in single quotes, escaping any inner single quotes
  return `'${s.replace(/'/g, "'\\''")}'`;
}
