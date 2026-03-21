import { sql } from "drizzle-orm";
import { connect } from "../db/connection.js";
import { ok, type CommandResult } from "../types.js";

export interface UniversalSearchResult {
  id: string;
  type: "contact" | "org" | "donation";
  name: string;
  detail: string | null;
  score: number;
}

interface SearchOpts {
  type?: string;
  limit?: number;
}

export async function universalSearch(
  query: string,
  opts: SearchOpts
): Promise<CommandResult<UniversalSearchResult[]>> {
  const db = connect();
  const limit = opts.limit ?? 20;
  const typeFilter = opts.type; // "contact", "org", "donation", or undefined for all

  const parts: string[] = [];

  if (!typeFilter || typeFilter === "contact") {
    parts.push(`
      SELECT id, 'contact' AS type,
        first_name || ' ' || last_name AS name,
        email AS detail,
        ts_rank(search_vector, plainto_tsquery('english', ${escapeLiteral(query)})) * 2
          + similarity(first_name || ' ' || last_name, ${escapeLiteral(query)}) AS score
      FROM contacts
      WHERE merged_into IS NULL AND (
        search_vector @@ plainto_tsquery('english', ${escapeLiteral(query)})
        OR similarity(first_name || ' ' || last_name, ${escapeLiteral(query)}) > 0.3
        OR first_name || ' ' || last_name ILIKE ${escapeLiteral("%" + query + "%")}
        OR email ILIKE ${escapeLiteral("%" + query + "%")}
      )
    `);
  }

  if (!typeFilter || typeFilter === "org") {
    parts.push(`
      SELECT id, 'org' AS type,
        name,
        abn AS detail,
        ts_rank(search_vector, plainto_tsquery('english', ${escapeLiteral(query)})) * 2
          + similarity(name, ${escapeLiteral(query)}) AS score
      FROM organisations
      WHERE search_vector @@ plainto_tsquery('english', ${escapeLiteral(query)})
        OR similarity(name, ${escapeLiteral(query)}) > 0.3
        OR name ILIKE ${escapeLiteral("%" + query + "%")}
    `);
  }

  if (!typeFilter || typeFilter === "donation") {
    parts.push(`
      SELECT d.id, 'donation' AS type,
        '$' || d.amount::text || ' on ' || d.donation_date AS name,
        COALESCE(d.reference, d.campaign) AS detail,
        ts_rank(d.search_vector, plainto_tsquery('english', ${escapeLiteral(query)})) * 2
          + GREATEST(
            similarity(COALESCE(d.reference, ''), ${escapeLiteral(query)}),
            similarity(COALESCE(d.campaign, ''), ${escapeLiteral(query)})
          ) AS score
      FROM donations d
      WHERE d.status != 'voided' AND (
        d.search_vector @@ plainto_tsquery('english', ${escapeLiteral(query)})
        OR similarity(COALESCE(d.reference, ''), ${escapeLiteral(query)}) > 0.3
        OR similarity(COALESCE(d.campaign, ''), ${escapeLiteral(query)}) > 0.3
        OR d.reference ILIKE ${escapeLiteral("%" + query + "%")}
        OR d.campaign ILIKE ${escapeLiteral("%" + query + "%")}
      )
    `);
  }

  if (parts.length === 0) {
    return ok<UniversalSearchResult[]>([]);
  }

  const unionQuery = parts.join("\nUNION ALL\n");
  const fullQuery = `SELECT * FROM (${unionQuery}) sub ORDER BY score DESC LIMIT ${limit}`;

  const rows: any[] = await db.execute(sql.raw(fullQuery));

  const results: UniversalSearchResult[] = rows.map((r) => ({
    id: r.id.slice(0, 8),
    type: r.type,
    name: r.name,
    detail: r.detail,
    score: parseFloat(r.score),
  }));

  const result = ok(results);
  if (results.length === 0) {
    result.hints.push("No results — try a broader search or different spelling");
  }

  return result;
}

/**
 * Escape a string for use in a raw SQL literal.
 * Uses PostgreSQL dollar-quoting to avoid injection.
 */
function escapeLiteral(value: string): string {
  // Use dollar-quoting with a unique tag to safely embed any string
  const tag = "$esc$";
  if (value.includes(tag)) {
    // Fallback: standard quoting with doubled single quotes
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `${tag}${value}${tag}`;
}
