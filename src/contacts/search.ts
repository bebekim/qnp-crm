import { sql } from "drizzle-orm";
import { connect } from "../db/connection.js";
import { ok, type CommandResult } from "../types.js";

interface SearchResult {
  id: string;
  type: "contact" | "org";
  name: string;
  email: string | null;
  score: number;
}

export async function contactsSearch(
  query: string,
  opts: { type: string; limit: number }
): Promise<CommandResult<SearchResult[]>> {
  const db = connect();
  const results: SearchResult[] = [];

  if (opts.type === "contact" || opts.type === "all") {
    const rows = await db.execute(sql`
      SELECT id, first_name, last_name, email,
        GREATEST(
          similarity(first_name || ' ' || last_name, ${query}),
          similarity(COALESCE(email, ''), ${query})
        ) as score
      FROM contacts
      WHERE merged_into IS NULL AND (
        first_name || ' ' || last_name ILIKE ${"%" + query + "%"}
        OR email ILIKE ${"%" + query + "%"}
        OR phone ILIKE ${"%" + query + "%"}
        OR similarity(first_name || ' ' || last_name, ${query}) > 0.3
      )
      ORDER BY score DESC LIMIT ${opts.limit}
    `);
    for (const r of rows as any[]) {
      results.push({
        id: r.id.slice(0, 8),
        type: "contact",
        name: `${r.first_name} ${r.last_name}`,
        email: r.email,
        score: parseFloat(r.score),
      });
    }
  }

  if (opts.type === "org" || opts.type === "all") {
    const rows = await db.execute(sql`
      SELECT id, name, similarity(name, ${query}) as score
      FROM organisations
      WHERE name ILIKE ${"%" + query + "%"}
        OR similarity(name, ${query}) > 0.3
      ORDER BY score DESC LIMIT ${opts.limit}
    `);
    for (const r of rows as any[]) {
      results.push({ id: r.id.slice(0, 8), type: "org", name: r.name, email: null, score: parseFloat(r.score) });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return ok(results.slice(0, opts.limit));
}
