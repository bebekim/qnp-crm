/**
 * Test helpers for mocking the Drizzle database layer.
 *
 * Since all commands go through `connect()` from db/connection.ts,
 * we mock that module to return a fake DB that records queries
 * and returns configurable results.
 */
import { vi } from "vitest";
import * as schema from "./db/schema.js";

// ---------------------------------------------------------------------------
// Mock DB builder — chainable query builder that returns preset data
// ---------------------------------------------------------------------------

export interface MockDbConfig {
  /**
   * Rows returned by select queries, keyed by table name.
   * Values can be:
   * - any[] — same result every time
   * - any[][] — queue of results, shifted on each query (first-in-first-out)
   */
  selectResults: Map<string, any[] | any[][]>;
  /** Rows returned by insert...returning() */
  insertResults: Map<string, any[]>;
  /** Track all inserts */
  inserts: { table: string; values: any }[];
  /** Track all updates */
  updates: { table: string; set: any; where: any }[];
  /** Track all deletes */
  deletes: { table: string; where: any }[];
  /** Rows returned by db.execute (raw SQL) */
  executeResults: any[];
}

export function createMockDbConfig(): MockDbConfig {
  return {
    selectResults: new Map(),
    insertResults: new Map(),
    inserts: [],
    updates: [],
    deletes: [],
    executeResults: [],
  };
}

/**
 * Set select results that will be returned in sequence.
 * Each call to the table pulls the next result from the queue.
 */
export function setSelectQueue(cfg: MockDbConfig, table: string, results: any[][]) {
  cfg.selectResults.set(table, results);
}

function getSelectResult(cfg: MockDbConfig, table: string): any[] {
  const val = cfg.selectResults.get(table);
  if (!val) return [];
  // Check if it's a queue (array of arrays) vs a flat result array
  if (val.length > 0 && Array.isArray(val[0]) && isQueue(val)) {
    return (val as any[][]).shift() ?? [];
  }
  return val as any[];
}

/** Distinguish queue [[...], [...]] from flat results [{...}, {......}] */
function isQueue(val: any[]): boolean {
  // A queue is an array where every element is itself an array
  return val.every((item) => Array.isArray(item));
}

function tableName(table: any): string | null {
  if (table && typeof table === "object") {
    if (table._ && table._.name) return table._.name;
    const syms = Object.getOwnPropertySymbols(table);
    for (const s of syms) {
      const val = table[s];
      if (typeof val === "string") return val;
    }
  }
  return null;
}

function makeChain(cfg: MockDbConfig, operation: "select" | "insert" | "update" | "delete", context: any = {}) {
  const chain: any = {};
  let currentTable: string | null = context.table ?? null;

  const self = () => chain;

  chain.from = (table: any) => {
    currentTable = tableName(table) ?? "unknown";
    return chain;
  };

  chain.where = (condition: any) => {
    if (operation === "update") cfg.updates[cfg.updates.length - 1].where = condition;
    if (operation === "delete") cfg.deletes[cfg.deletes.length - 1].where = condition;
    return chain;
  };

  chain.set = (values: any) => {
    if (operation === "update") cfg.updates[cfg.updates.length - 1].set = values;
    return chain;
  };

  chain.values = (values: any) => {
    if (operation === "insert") {
      cfg.inserts.push({ table: currentTable ?? "unknown", values });
    }
    return chain;
  };

  chain.returning = () => {
    const results = cfg.insertResults.get(currentTable ?? "") ?? [];
    return Promise.resolve(results);
  };

  chain.onConflictDoNothing = self;
  chain.limit = (_n: number) => chain;
  chain.offset = (_n: number) => chain;
  chain.orderBy = (..._args: any[]) => chain;
  chain.innerJoin = (..._args: any[]) => chain;
  chain.leftJoin = (..._args: any[]) => chain;

  // Terminal: select chains resolve to arrays
  chain.then = (resolve: (v: any) => any, reject?: (e: any) => any) => {
    const key = currentTable ?? "unknown";
    const results = getSelectResult(cfg, key);
    return Promise.resolve(results).then(resolve, reject);
  };

  return chain;
}

export function createMockDb(cfg: MockDbConfig) {
  const db: any = {
    select: (fields?: any) => {
      const chain = makeChain(cfg, "select");
      return chain;
    },

    insert: (table: any) => {
      const name = tableName(table) ?? "unknown";
      const chain = makeChain(cfg, "insert", { table: name });
      return chain;
    },

    update: (table: any) => {
      const name = tableName(table) ?? "unknown";
      cfg.updates.push({ table: name, set: null, where: null });
      const chain = makeChain(cfg, "update", { table: name });
      return chain;
    },

    delete: (table: any) => {
      const name = tableName(table) ?? "unknown";
      cfg.deletes.push({ table: name, where: null });
      const chain = makeChain(cfg, "delete", { table: name });
      return chain;
    },

    execute: (_sql: any) => {
      return Promise.resolve(cfg.executeResults);
    },
  };

  return db;
}

// ---------------------------------------------------------------------------
// Fixtures — reusable test data
// ---------------------------------------------------------------------------

export const fixtures = {
  contact: (overrides: Partial<typeof schema.contacts.$inferSelect> = {}) => ({
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    firstName: "Jane",
    lastName: "Smith",
    email: "jane@example.org",
    phone: "0499 111 222",
    addressLine1: "123 Example St",
    addressLine2: null,
    suburb: "Richmond",
    state: "VIC",
    postcode: "3121",
    contactType: "donor",
    notes: null,
    mergedInto: null,
    createdAt: new Date("2026-01-15T00:00:00Z"),
    updatedAt: new Date("2026-01-15T00:00:00Z"),
    ...overrides,
  }),

  donation: (overrides: any = {}) => ({
    id: "11111111-2222-3333-4444-555555555555",
    contactId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    amount: "250.00",
    donationDate: "2026-03-01",
    method: "eft",
    fund: "general",
    status: "received",
    isDgrEligible: true,
    description: null,
    reference: null,
    campaign: null,
    voidReason: null,
    voidedAt: null,
    recurringId: null,
    bankTransactionId: null,
    notes: null,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    updatedAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  }),

  receipt: (overrides: any = {}) => ({
    id: "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr",
    receiptNumber: 44,
    donationId: "11111111-2222-3333-4444-555555555555",
    issuedAt: new Date("2026-03-01T00:00:00Z"),
    recipientName: "Jane Smith",
    recipientAddress: "123 Example St, Richmond VIC 3121",
    amount: "250.00",
    donationDate: "2026-03-01",
    dgrName: "Our Village Inc.",
    dgrAbn: "12345678901",
    pdfPath: "/var/lib/nanoclaw/receipts/2026/RC-44.pdf",
    pdfHash: "abc123",
    isDuplicate: false,
    originalReceiptId: null,
    isVoided: false,
    voidReason: null,
    voidedAt: null,
    createdBy: "cli:agent",
    ...overrides,
  }),

  receiptConfig: (overrides: any = {}) => ({
    id: 1,
    orgName: "Our Village Inc.",
    dgrName: "Our Village Inc.",
    abn: "12345678901",
    address: "1 Main St, Melbourne VIC 3000",
    dgrItemNumber: "1",
    receiptPrefix: "RC-",
    logoPath: null,
    receiptFooter: "No goods or services were provided.",
    emailFrom: "receipts@village.org",
    emailReplyTo: "admin@village.org",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  }),
};
