import { sql } from "drizzle-orm";
import { connect, schema } from "../db/connection.js";
import { ok, type CommandResult, type ReportSummary } from "../types.js";

export interface SummaryOpts {
  from?: string;
  to?: string;
  campaign?: string;
}

/**
 * Get the current Australian financial year boundaries.
 * Australian FY runs July 1 - June 30.
 */
function currentAustralianFY(): { from: string; to: string; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based

  // If we're in Jan-Jun, FY started last July
  // If we're in Jul-Dec, FY started this July
  const fyStart = month >= 7 ? year : year - 1;
  const fyEnd = fyStart + 1;

  return {
    from: `${fyStart}-07-01`,
    to: `${fyEnd}-06-30`,
    label: `FY ${fyStart}-${fyEnd}`,
  };
}

export async function reportSummary(opts: SummaryOpts): Promise<CommandResult<ReportSummary>> {
  const db = connect();

  // Default to current Australian FY
  const fy = currentAustralianFY();
  const from = opts.from ?? fy.from;
  const to = opts.to ?? fy.to;
  const dateLabel = (!opts.from && !opts.to) ? fy.label : `${from} to ${to}`;

  // Build WHERE conditions
  const conditions: string[] = [
    `status != 'voided'`,
    `donation_date >= '${from}'`,
    `donation_date <= '${to}'`,
  ];

  if (opts.campaign) {
    conditions.push(`campaign = '${opts.campaign}'`);
  }

  const whereClause = conditions.join(" AND ");

  // Single aggregate query grouped by method + fund
  const rows: any[] = await db.execute(sql.raw(
    `SELECT method, fund, COUNT(*)::text AS count, SUM(amount)::numeric(12,2)::text AS total
     FROM donations
     WHERE ${whereClause}
     GROUP BY method, fund
     ORDER BY method, fund`
  ));

  // Process results
  const byMethod: Record<string, { count: number; total: string }> = {};
  const byFund: Record<string, { count: number; total: string }> = {};
  let totalAmount = 0;
  let donationCount = 0;

  for (const row of rows) {
    const count = parseInt(row.count, 10);
    const total = parseFloat(row.total);

    donationCount += count;
    totalAmount += total;

    // Aggregate by method
    if (byMethod[row.method]) {
      byMethod[row.method].count += count;
      byMethod[row.method].total = (parseFloat(byMethod[row.method].total) + total).toFixed(2);
    } else {
      byMethod[row.method] = { count, total: total.toFixed(2) };
    }

    // Aggregate by fund
    if (byFund[row.fund]) {
      byFund[row.fund].count += count;
      byFund[row.fund].total = (parseFloat(byFund[row.fund].total) + total).toFixed(2);
    } else {
      byFund[row.fund] = { count, total: total.toFixed(2) };
    }
  }

  const averageAmount = donationCount > 0 ? (totalAmount / donationCount).toFixed(2) : "0.00";

  const summary: ReportSummary = {
    totalAmount: totalAmount.toFixed(2),
    donationCount,
    averageAmount,
    byMethod,
    byFund,
  };

  const result = ok(summary);
  result.hints.push(`Reporting period: ${dateLabel}`);

  if (donationCount > 0) {
    result.hints.push(`${donationCount} donation${donationCount !== 1 ? "s" : ""} totalling $${totalAmount.toFixed(2)}`);
  }

  // Check for unreceipted donations
  const unreceipted = await db
    .select({ id: schema.donations.id })
    .from(schema.donations)
    .where(sql`${schema.donations.status} = 'received' AND ${schema.donations.isDgrEligible} = true`)
    .leftJoin(schema.receipts, sql`${schema.receipts.donationId} = ${schema.donations.id} AND ${schema.receipts.isVoided} = false`);

  // Filter to those without receipts (left join where receipt is null)
  const unreceiptedCount = unreceipted.filter((r: any) => !r.receipts?.id).length;
  if (unreceiptedCount > 0) {
    result.hints.push(`${unreceiptedCount} unreceipted DGR-eligible donation${unreceiptedCount !== 1 ? "s" : ""} — run \`qnp-crm reports unreceipted\` for details`);
  }

  return result;
}
