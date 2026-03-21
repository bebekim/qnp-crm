import { eq, and, sql, desc, asc, inArray } from "drizzle-orm";
import { connect, schema } from "../db/connection.js";
import { ok, type CommandResult, type ContactRow } from "../types.js";

interface ListOpts {
  type?: string;
  tag?: string[];
  search?: string;
  state?: string;
  limit: number;
  offset: number;
  sort: string;
}

export async function contactsList(opts: ListOpts): Promise<CommandResult<ContactRow[]>> {
  const db = connect();
  const conditions: any[] = [sql`${schema.contacts.mergedInto} IS NULL`];

  if (opts.type) conditions.push(eq(schema.contacts.contactType, opts.type));
  if (opts.state) conditions.push(eq(schema.contacts.state, opts.state));
  if (opts.search) {
    conditions.push(sql`(
      ${schema.contacts.firstName} || ' ' || ${schema.contacts.lastName} ILIKE ${"%" + opts.search + "%"}
      OR ${schema.contacts.email} ILIKE ${"%" + opts.search + "%"}
      OR ${schema.contacts.notes} ILIKE ${"%" + opts.search + "%"}
    )`);
  }

  // Tag filtering: for each --tag, require a matching row in tags table
  if (opts.tag?.length) {
    for (const t of opts.tag) {
      const [key, value] = t.includes("=") ? t.split("=", 2) : [t, undefined];
      if (value) {
        conditions.push(sql`EXISTS (
          SELECT 1 FROM tags WHERE entity_type = 'contact'
          AND entity_id = ${schema.contacts.id}
          AND key = ${key} AND value = ${value}
        )`);
      } else {
        conditions.push(sql`EXISTS (
          SELECT 1 FROM tags WHERE entity_type = 'contact'
          AND entity_id = ${schema.contacts.id} AND key = ${key}
        )`);
      }
    }
  }

  const descending = opts.sort.startsWith("-");
  const sortField = descending ? opts.sort.slice(1) : opts.sort;
  const sortCol = (schema.contacts as any)[sortField] ?? schema.contacts.lastName;
  const orderFn = descending ? desc : asc;

  const rows = await db
    .select({
      id: schema.contacts.id,
      firstName: schema.contacts.firstName,
      lastName: schema.contacts.lastName,
      email: schema.contacts.email,
      contactType: schema.contacts.contactType,
    })
    .from(schema.contacts)
    .where(and(...conditions))
    .orderBy(orderFn(sortCol))
    .limit(opts.limit + 1)
    .offset(opts.offset);

  const hasMore = rows.length > opts.limit;
  const data = rows.slice(0, opts.limit);

  // Fetch tags for these contacts
  const ids = data.map((r) => r.id);
  const contactTags = ids.length > 0
    ? await db
        .select({ entityId: schema.tags.entityId, key: schema.tags.key, value: schema.tags.value })
        .from(schema.tags)
        .where(and(eq(schema.tags.entityType, "contact"), inArray(schema.tags.entityId, ids)))
    : [];

  const tagMap = new Map<string, string[]>();
  for (const t of contactTags) {
    const list = tagMap.get(t.entityId) ?? [];
    list.push(t.value ? `${t.key}=${t.value}` : t.key);
    tagMap.set(t.entityId, list);
  }

  const result = ok<ContactRow[]>(
    data.map((r) => ({
      id: r.id.slice(0, 8),
      name: `${r.firstName} ${r.lastName}`,
      email: r.email,
      type: r.contactType,
      tags: (tagMap.get(r.id) ?? []).join(", "),
    }))
  );

  if (hasMore) result.hints.push(`Showing first ${opts.limit} — use --offset ${opts.offset + opts.limit} for more.`);

  return result;
}
