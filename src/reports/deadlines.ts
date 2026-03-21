import { sql } from "drizzle-orm";
import { connect } from "../db/connection.js";
import { ok, type CommandResult } from "../types.js";

export interface DeadlineItem {
  category: string;
  label: string;
  priority: "urgent" | "soon" | "upcoming" | "info";
  detail: string;
  actionHint: string | null;
}

export interface DeadlinesResult {
  items: DeadlineItem[];
  generatedAt: string;
}

interface DeadlinesOpts {
  days?: number;
}

/**
 * Get the current Australian financial year boundaries.
 * Australian FY runs July 1 – June 30.
 */
function currentAustralianFY(): { from: string; to: string; label: string; daysUntilEnd: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const fyStart = month >= 7 ? year : year - 1;
  const fyEnd = fyStart + 1;

  const endDate = new Date(fyEnd, 5, 30); // June 30
  const daysUntilEnd = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return {
    from: `${fyStart}-07-01`,
    to: `${fyEnd}-06-30`,
    label: `FY ${fyStart}-${fyEnd}`,
    daysUntilEnd,
  };
}

export async function reportDeadlines(opts: DeadlinesOpts): Promise<CommandResult<DeadlinesResult>> {
  const db = connect();
  const lookAhead = opts.days ?? 30;
  const items: DeadlineItem[] = [];
  const fy = currentAustralianFY();

  // 1. EOFY countdown + unreceipted DGR count
  const unreceiptedRows: any[] = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(d.amount), 0)::numeric(12,2)::text AS total
    FROM donations d
    LEFT JOIN receipts r ON r.donation_id = d.id AND r.is_voided = false
    WHERE d.status = 'received'
      AND d.is_dgr_eligible = true
      AND r.id IS NULL
  `));

  const unreceiptedCount = unreceiptedRows[0]?.count ?? 0;
  const unreceiptedTotal = unreceiptedRows[0]?.total ?? "0.00";

  // EOFY item
  const eofyPriority: DeadlineItem["priority"] =
    fy.daysUntilEnd <= 14 ? "urgent" : fy.daysUntilEnd <= 30 ? "soon" : "info";

  items.push({
    category: "eofy",
    label: `EOFY ${fy.label}`,
    priority: eofyPriority,
    detail: `${fy.daysUntilEnd} days until June 30`,
    actionHint: null,
  });

  // Unreceipted donations
  if (unreceiptedCount > 0) {
    const agePriority: DeadlineItem["priority"] = unreceiptedCount > 10 ? "urgent" : "soon";
    items.push({
      category: "unreceipted",
      label: `${unreceiptedCount} unreceipted DGR donation${unreceiptedCount !== 1 ? "s" : ""}`,
      priority: agePriority,
      detail: `$${unreceiptedTotal} total awaiting receipts`,
      actionHint: `qnp-crm receipts batch --confirm`,
    });
  }

  // 2. Unreceipted donation aging buckets
  const agingRows: any[] = await db.execute(sql.raw(`
    SELECT
      CASE
        WHEN CURRENT_DATE - d.donation_date::date < 7 THEN '<7d'
        WHEN CURRENT_DATE - d.donation_date::date < 30 THEN '7-30d'
        WHEN CURRENT_DATE - d.donation_date::date < 90 THEN '30-90d'
        ELSE '>90d'
      END AS bucket,
      COUNT(*)::int AS count,
      SUM(d.amount)::numeric(12,2)::text AS total
    FROM donations d
    LEFT JOIN receipts r ON r.donation_id = d.id AND r.is_voided = false
    WHERE d.status = 'received'
      AND d.is_dgr_eligible = true
      AND r.id IS NULL
    GROUP BY bucket
    ORDER BY
      CASE bucket
        WHEN '>90d' THEN 1
        WHEN '30-90d' THEN 2
        WHEN '7-30d' THEN 3
        WHEN '<7d' THEN 4
      END
  `));

  for (const row of agingRows) {
    const bucketPriority: DeadlineItem["priority"] =
      row.bucket === ">90d" ? "urgent" :
      row.bucket === "30-90d" ? "soon" :
      row.bucket === "7-30d" ? "upcoming" : "info";

    items.push({
      category: "aging",
      label: `Unreceipted ${row.bucket}`,
      priority: bucketPriority,
      detail: `${row.count} donation${row.count !== 1 ? "s" : ""}, $${row.total}`,
      actionHint: `qnp-crm reports unreceipted`,
    });
  }

  // 3. Recurring donations — next expected in look-ahead window
  const recurringRows: any[] = await db.execute(sql.raw(`
    SELECT rd.id, rd.amount::text, rd.frequency, rd.next_expected_date,
           c.first_name || ' ' || c.last_name AS contact_name,
           rd.next_expected_date::date - CURRENT_DATE AS days_away
    FROM recurring_donations rd
    JOIN contacts c ON c.id = rd.contact_id
    WHERE rd.status = 'active'
      AND rd.next_expected_date::date <= CURRENT_DATE + INTERVAL '${lookAhead} days'
    ORDER BY rd.next_expected_date
    LIMIT 20
  `));

  for (const row of recurringRows) {
    const daysAway = parseInt(row.days_away, 10);
    const recurPriority: DeadlineItem["priority"] =
      daysAway < 0 ? "urgent" : daysAway <= 7 ? "soon" : "upcoming";
    const label = daysAway < 0
      ? `Overdue recurring: ${row.contact_name}`
      : `Recurring due: ${row.contact_name}`;

    items.push({
      category: "recurring",
      label,
      priority: recurPriority,
      detail: `$${row.amount} ${row.frequency}, ${daysAway < 0 ? `${Math.abs(daysAway)}d overdue` : `in ${daysAway}d`}`,
      actionHint: null,
    });
  }

  // Sort: urgent first, then soon, upcoming, info
  const priorityOrder = { urgent: 0, soon: 1, upcoming: 2, info: 3 };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const result = ok<DeadlinesResult>({ items, generatedAt: new Date().toISOString() });

  const urgentCount = items.filter(i => i.priority === "urgent").length;
  if (urgentCount > 0) {
    result.hints.push(`${urgentCount} urgent item${urgentCount !== 1 ? "s" : ""} need attention`);
  }
  if (unreceiptedCount > 0) {
    result.hints.push(`Generate receipts with: qnp-crm receipts batch --confirm`);
  }

  return result;
}
