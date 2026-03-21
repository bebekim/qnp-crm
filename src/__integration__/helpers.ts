import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema.js";
import { seedTestData, type SeedResult } from "./seed.js";

const TEST_DB_URL = process.env.DATABASE_URL!;

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

/** Direct Drizzle connection for test setup (separate from the command singleton). */
export function getSetupDb() {
  if (!_db) {
    _client = postgres(TEST_DB_URL);
    _db = drizzle(_client, { schema });
  }
  return _db;
}

/** Truncate all tables and reset receipt sequence. */
export async function resetDb(): Promise<void> {
  const db = getSetupDb();
  await db.execute(sql`
    TRUNCATE TABLE
      receipts,
      donations,
      contact_org_links,
      tags,
      contact_relationships,
      recurring_donations,
      organisations,
      contacts,
      receipt_config,
      job_runs,
      audit_log
    CASCADE
  `);
  await db.execute(
    sql`ALTER SEQUENCE qnp_receipt_seq RESTART WITH 1`,
  );
}

/** Seed the DB with test data. Returns inserted IDs. */
export async function seedDb(): Promise<SeedResult> {
  const db = getSetupDb();
  return seedTestData(db);
}

/** Close the setup connection. */
export async function closeSetupDb(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
}

export type { SeedResult };
