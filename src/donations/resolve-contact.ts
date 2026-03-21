import { eq, sql } from "drizzle-orm";
import { schema } from "../db/connection.js";

/**
 * Resolve a contact by UUID prefix, email, or full name.
 * Used by donations add and donations list.
 */
export async function resolveContact(
  db: any,
  query: string
): Promise<{ id: string; firstName: string; lastName: string } | undefined> {
  // Try UUID prefix match (8+ hex chars)
  if (/^[0-9a-f]{8,}$/i.test(query)) {
    const [row] = await db
      .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(sql`${schema.contacts.id}::text LIKE ${query + "%"}`)
      .limit(1);
    if (row) return row;
  }

  // Try email match
  if (query.includes("@")) {
    const [row] = await db
      .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(eq(schema.contacts.email, query))
      .limit(1);
    if (row) return row;
  }

  // Try name match (case-insensitive)
  const [row] = await db
    .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
    .from(schema.contacts)
    .where(sql`${schema.contacts.firstName} || ' ' || ${schema.contacts.lastName} ILIKE ${query}`)
    .limit(1);
  return row;
}
