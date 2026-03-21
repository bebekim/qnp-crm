import { eq, and, sql } from "drizzle-orm";
import { connect, schema } from "../db/connection.js";
import { ok, fail, type CommandResult } from "../types.js";

export interface DonationDetail {
  id: string;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  amount: string;
  donationDate: string;
  method: string;
  fund: string;
  status: string;
  isDgrEligible: boolean;
  campaign: string | null;
  reference: string | null;
  notes: string | null;
  receipt: { number: number; issuedAt: string; isVoided: boolean } | null;
  createdAt: string;
  updatedAt: string;
}

export async function donationsShow(idPrefix: string): Promise<CommandResult<DonationDetail | null>> {
  const db = connect();

  // Resolve by UUID prefix
  const [donation] = await db
    .select()
    .from(schema.donations)
    .where(sql`${schema.donations.id}::text LIKE ${idPrefix + "%"}`)
    .limit(1);

  if (!donation) return fail(`Donation not found: "${idPrefix}"`);

  // Check for ambiguous prefix
  const [second] = await db
    .select({ id: schema.donations.id })
    .from(schema.donations)
    .where(sql`${schema.donations.id}::text LIKE ${idPrefix + "%"} AND ${schema.donations.id} != ${donation.id}`)
    .limit(1);

  if (second) {
    return fail(`Ambiguous ID prefix "${idPrefix}" matches multiple donations. Use more characters.`);
  }

  // Fetch linked contact
  let contactName: string | null = null;
  let contactEmail: string | null = null;

  if (donation.contactId) {
    const [contact] = await db
      .select({
        firstName: schema.contacts.firstName,
        lastName: schema.contacts.lastName,
        email: schema.contacts.email,
      })
      .from(schema.contacts)
      .where(eq(schema.contacts.id, donation.contactId))
      .limit(1);

    if (contact) {
      contactName = `${contact.firstName} ${contact.lastName}`;
      contactEmail = contact.email;
    }
  }

  // Fetch receipt
  let receipt: DonationDetail["receipt"] = null;
  const [receiptRow] = await db
    .select({
      receiptNumber: schema.receipts.receiptNumber,
      issuedAt: schema.receipts.issuedAt,
      isVoided: schema.receipts.isVoided,
    })
    .from(schema.receipts)
    .where(eq(schema.receipts.donationId, donation.id))
    .limit(1);

  if (receiptRow) {
    receipt = {
      number: receiptRow.receiptNumber,
      issuedAt: receiptRow.issuedAt.toISOString(),
      isVoided: receiptRow.isVoided,
    };
  }

  const detail: DonationDetail = {
    id: donation.id.slice(0, 8),
    contactId: donation.contactId?.slice(0, 8) ?? null,
    contactName,
    contactEmail,
    amount: donation.amount,
    donationDate: donation.donationDate,
    method: donation.method,
    fund: donation.fund,
    status: donation.status,
    isDgrEligible: donation.isDgrEligible,
    campaign: donation.campaign,
    reference: donation.reference,
    notes: donation.notes,
    receipt,
    createdAt: donation.createdAt.toISOString(),
    updatedAt: donation.updatedAt.toISOString(),
  };

  const result = ok(detail);

  // Hint about receipting if DGR-eligible and not receipted
  if (donation.isDgrEligible && donation.status === "received" && !receipt) {
    result.hints.push(`DGR-eligible and unreceipted. Generate receipt: qnp-crm receipts generate ${donation.id.slice(0, 8)}`);
  }

  return result;
}
