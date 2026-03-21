import { eq, and, sql, desc, asc, inArray } from "drizzle-orm";
import { connect, schema } from "../db/connection.js";
import { ok, type CommandResult, type Donation } from "../types.js";
import { resolveContact } from "./resolve-contact.js";

interface ListOpts {
  contact?: string;
  from?: string;
  to?: string;
  method?: string;
  fund?: string;
  campaign?: string;
  status?: string;
  unreceipted?: boolean;
  limit: number;
  sort: string;
}

export async function donationsList(opts: ListOpts): Promise<CommandResult<Donation[]>> {
  const db = connect();
  const conditions: any[] = [];

  // Exclude voided by default unless explicitly requested
  if (opts.status) {
    conditions.push(eq(schema.donations.status, opts.status));
  }

  if (opts.unreceipted) {
    conditions.push(eq(schema.donations.status, "received"));
    conditions.push(eq(schema.donations.isDgrEligible, true));
  }

  if (opts.method) conditions.push(eq(schema.donations.method, opts.method));
  if (opts.fund) conditions.push(eq(schema.donations.fund, opts.fund));
  if (opts.campaign) conditions.push(eq(schema.donations.campaign, opts.campaign));
  if (opts.from) conditions.push(sql`${schema.donations.donationDate} >= ${opts.from}`);
  if (opts.to) conditions.push(sql`${schema.donations.donationDate} <= ${opts.to}`);

  // Contact filter — resolve by UUID prefix, email, or name
  if (opts.contact) {
    const resolved = await resolveContact(db, opts.contact);
    const contactId = resolved?.id;
    if (!contactId) {
      const result = ok<Donation[]>([], 0);
      result.warnings.push(`Contact not found: "${opts.contact}"`);
      return result;
    }
    conditions.push(eq(schema.donations.contactId, contactId));
  }

  const descending = opts.sort.startsWith("-");
  const sortField = descending ? opts.sort.slice(1) : opts.sort;
  const sortCol = (schema.donations as any)[sortField] ?? schema.donations.donationDate;
  const orderFn = descending ? desc : asc;

  const limit = opts.limit || 50;

  const rows = await db
    .select({
      id: schema.donations.id,
      contactId: schema.donations.contactId,
      amount: schema.donations.amount,
      donationDate: schema.donations.donationDate,
      method: schema.donations.method,
      fund: schema.donations.fund,
      status: schema.donations.status,
      isDgrEligible: schema.donations.isDgrEligible,
      campaign: schema.donations.campaign,
      reference: schema.donations.reference,
    })
    .from(schema.donations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderFn(sortCol))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);

  // Fetch contact names for all donations
  const contactIds = [...new Set(data.map((r) => r.contactId).filter(Boolean) as string[])];
  const contactNames = new Map<string, string>();

  if (contactIds.length > 0) {
    const contactRows = await db
      .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(inArray(schema.contacts.id, contactIds));
    for (const c of contactRows) {
      contactNames.set(c.id, `${c.firstName} ${c.lastName}`);
    }
  }

  // Fetch receipt numbers
  const donationIds = data.map((r) => r.id);
  const receiptMap = new Map<string, number>();

  if (donationIds.length > 0) {
    const receiptRows = await db
      .select({ donationId: schema.receipts.donationId, receiptNumber: schema.receipts.receiptNumber })
      .from(schema.receipts)
      .where(and(
        inArray(schema.receipts.donationId, donationIds),
        eq(schema.receipts.isVoided, false),
      ));
    for (const r of receiptRows) {
      receiptMap.set(r.donationId, r.receiptNumber);
    }
  }

  const donations: Donation[] = data.map((r) => ({
    id: r.id.slice(0, 8),
    contactId: r.contactId?.slice(0, 8) ?? null,
    contactName: r.contactId ? (contactNames.get(r.contactId) ?? null) : null,
    amount: r.amount,
    donationDate: r.donationDate,
    method: r.method,
    fund: r.fund,
    status: r.status,
    isDgrEligible: r.isDgrEligible,
    campaign: r.campaign,
    reference: r.reference,
    receiptNumber: receiptMap.get(r.id) ?? null,
  }));

  const result = ok(donations);

  if (hasMore) result.hints.push(`Showing first ${limit}. Use --limit to see more.`);

  // Summarise totals
  const total = data.reduce((sum, r) => sum + parseFloat(r.amount), 0);
  if (data.length > 0) {
    result.hints.push(`Total: $${total.toFixed(2)} across ${data.length} donation${data.length !== 1 ? "s" : ""}`);
  }

  return result;
}

