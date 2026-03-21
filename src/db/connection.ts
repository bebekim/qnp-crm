import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { auditLog } from "./schema.js";

export type Db = ReturnType<typeof connect>;

let _db: Db | null = null;

export function connect(url?: string): ReturnType<typeof drizzle> {
  if (_db) return _db;
  const connStr = url ?? process.env.QNP_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://nanoclaw:nanoclaw@localhost:5432/nanoclaw";
  const client = postgres(connStr);
  _db = drizzle(client, { schema });
  return _db;
}

// ---------------------------------------------------------------------------
// Audit — compliance-critical, deterministic, every mutation logged
// ---------------------------------------------------------------------------

export async function audit(
  db: Db,
  entry: {
    table: string;
    recordId: string;
    action: "INSERT" | "UPDATE" | "DELETE";
    changes?: Record<string, { old: unknown; new: unknown }>;
    by: string;
  }
): Promise<void> {
  await db.insert(auditLog).values({
    tableName: entry.table,
    recordId: entry.recordId,
    action: entry.action,
    changedFields: entry.changes ?? null,
    performedBy: entry.by,
  });
}

export function performer(): string {
  return process.env.QNP_PERFORMER ?? process.env.NANOCLAW_PERFORMER ?? `cli:${process.env.USER ?? "agent"}`;
}

export { schema };
