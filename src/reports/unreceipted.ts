import { eq, and, sql } from "drizzle-orm";
import { connect, schema } from "../db/connection.js";
import { ok, type CommandResult, type Donation } from "../types.js";

export async function reportUnreceipted(): Promise<CommandResult<Donation[]>> {
  const db = connect();

  // Get DGR-eligible, received donations
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
    .where(and(
      eq(schema.donations.status, "received"),
      eq(schema.donations.isDgrEligible, true),
    ));

  if (rows.length === 0) {
    return ok<Donation[]>([], 0);
  }

  // Fetch contact names
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter(Boolean) as string[])];
  const contactNames = new Map<string, string>();

  if (contactIds.length > 0) {
    const contactRows = await db
      .select({ id: schema.contacts.id, firstName: schema.contacts.firstName, lastName: schema.contacts.lastName })
      .from(schema.contacts)
      .where(sql`${schema.contacts.id} = ANY(${contactIds})`);
    for (const c of contactRows) {
      contactNames.set(c.id, `${c.firstName} ${c.lastName}`);
    }
  }

  // Fetch existing non-voided receipts for these donations
  const donationIds = rows.map((r) => r.id);
  const receiptedIds = new Set<string>();

  if (donationIds.length > 0) {
    const receiptRows = await db
      .select({ donationId: schema.receipts.donationId, receiptNumber: schema.receipts.receiptNumber })
      .from(schema.receipts)
      .where(and(
        sql`${schema.receipts.donationId} = ANY(${donationIds})`,
        eq(schema.receipts.isVoided, false),
      ));
    for (const r of receiptRows) {
      receiptedIds.add(r.donationId);
    }
  }

  // Filter to only unreceipted
  const unreceipted = rows.filter((r) => !receiptedIds.has(r.id));

  const donations: Donation[] = unreceipted.map((r) => ({
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
    receiptNumber: null,
  }));

  const result = ok(donations);

  if (donations.length > 0) {
    const total = donations.reduce((sum, d) => sum + parseFloat(d.amount), 0);
    result.hints.push(
      `Found ${donations.length} unreceipted donation${donations.length !== 1 ? "s" : ""} totalling $${total.toFixed(2)} — generate receipts with \`qnp-crm receipts batch --confirm\``
    );
  }

  return result;
}
