import { sql } from "drizzle-orm";
import { connect } from "../db/connection.js";
import { ok, fail, type CommandResult } from "../types.js";

export interface TimelineEntry {
  timestamp: string;
  table: string;
  action: string;
  summary: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
}

interface HistoryOpts {
  limit?: number;
  from?: string;
  to?: string;
}

/**
 * Build a human-readable summary from an audit log row.
 */
function summarize(tableName: string, action: string, changes: Record<string, { old: unknown; new: unknown }> | null): string {
  if (action === "INSERT") {
    const labels: Record<string, string> = {
      contacts: "Contact created",
      donations: "Donation recorded",
      receipts: "Receipt issued",
      contact_org_links: "Linked to organisation",
    };
    return labels[tableName] ?? `${tableName} created`;
  }

  if (action === "DELETE") {
    const labels: Record<string, string> = {
      contacts: "Contact deleted",
      donations: "Donation deleted",
      receipts: "Receipt deleted",
      contact_org_links: "Organisation link removed",
    };
    return labels[tableName] ?? `${tableName} deleted`;
  }

  // UPDATE — describe changed fields
  if (!changes || Object.keys(changes).length === 0) {
    return `${tableName} updated`;
  }

  const parts: string[] = [];
  for (const [field, { old: oldVal, new: newVal }] of Object.entries(changes)) {
    const label = field.replace(/_/g, " ").replace(/([A-Z])/g, " $1").toLowerCase().trim();
    if (oldVal === null || oldVal === undefined || oldVal === "") {
      parts.push(`${label} set to "${newVal}"`);
    } else if (newVal === null || newVal === undefined || newVal === "") {
      parts.push(`${label} cleared (was "${oldVal}")`);
    } else {
      parts.push(`${label} changed from "${oldVal}" to "${newVal}"`);
    }
  }

  return parts.join("; ");
}

export async function contactsHistory(
  idPrefix: string,
  opts: HistoryOpts
): Promise<CommandResult<TimelineEntry[]>> {
  const db = connect();
  const limit = opts.limit ?? 50;

  // Resolve contact UUID from prefix
  const contacts: any[] = await db.execute(
    sql`SELECT id FROM contacts WHERE id::text LIKE ${idPrefix + "%"}`
  );

  if (contacts.length === 0) {
    return fail(`No contact found matching "${idPrefix}"`) as unknown as CommandResult<TimelineEntry[]>;
  }
  if (contacts.length > 1) {
    return fail(`Multiple contacts match "${idPrefix}" — use more characters`) as unknown as CommandResult<TimelineEntry[]>;
  }

  const contactId = contacts[0].id;

  // Date filters
  const dateConditions: string[] = [];
  if (opts.from) {
    dateConditions.push(`performed_at >= '${opts.from}'::timestamptz`);
  }
  if (opts.to) {
    dateConditions.push(`performed_at <= '${opts.to}'::timestamptz + INTERVAL '1 day'`);
  }
  const dateClause = dateConditions.length > 0 ? `AND ${dateConditions.join(" AND ")}` : "";

  // UNION ALL across all related tables
  const rows: any[] = await db.execute(sql.raw(`
    SELECT table_name, record_id, action, changed_fields, performed_at, performed_by
    FROM audit_log
    WHERE (
      (table_name = 'contacts' AND record_id = '${contactId}')
      OR (table_name = 'donations' AND record_id IN (SELECT id FROM donations WHERE contact_id = '${contactId}'))
      OR (table_name = 'receipts' AND record_id IN (SELECT id FROM receipts WHERE donation_id IN (SELECT id FROM donations WHERE contact_id = '${contactId}')))
      OR (table_name = 'contact_org_links' AND record_id IN (SELECT id FROM contact_org_links WHERE contact_id = '${contactId}'))
      OR (table_name = 'tags' AND record_id IN (SELECT id FROM tags WHERE entity_type = 'contact' AND entity_id = '${contactId}'))
    )
    ${dateClause}
    ORDER BY performed_at DESC
    LIMIT ${limit}
  `));

  const entries: TimelineEntry[] = rows.map((row) => {
    const changes = row.changed_fields as Record<string, { old: unknown; new: unknown }> | null;
    return {
      timestamp: new Date(row.performed_at).toISOString(),
      table: row.table_name,
      action: row.action,
      summary: summarize(row.table_name, row.action, changes),
      changes,
    };
  });

  const result = ok(entries);
  if (entries.length === 0) {
    result.hints.push("No activity recorded for this contact yet");
  } else {
    result.hints.push(`Showing ${entries.length} event${entries.length !== 1 ? "s" : ""}`);
  }

  return result;
}
