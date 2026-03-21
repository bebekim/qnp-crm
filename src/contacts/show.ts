import { eq, and, sql, desc } from "drizzle-orm";
import { connect, schema } from "../db/connection.js";
import { ok, fail, type CommandResult } from "../types.js";

export interface ContactDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  contactType: string;
  notes: string | null;
  tags: string[];
  organisations: { name: string; role: string | null }[];
  donationSummary: {
    totalDonations: number;
    totalAmount: string;
    lastDonation: string | null;
    unreceipted: number;
  };
  createdAt: string;
  updatedAt: string;
}

export async function contactsShow(idPrefix: string): Promise<CommandResult<ContactDetail | null>> {
  const db = connect();

  // Resolve by UUID prefix
  const [contact] = await db
    .select()
    .from(schema.contacts)
    .where(sql`${schema.contacts.id}::text LIKE ${idPrefix + "%"}`)
    .limit(1);

  if (!contact) return fail(`Contact not found: "${idPrefix}"`);

  // Check for ambiguous prefix
  const [second] = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(sql`${schema.contacts.id}::text LIKE ${idPrefix + "%"} AND ${schema.contacts.id} != ${contact.id}`)
    .limit(1);

  if (second) {
    return fail(`Ambiguous ID prefix "${idPrefix}" matches multiple contacts. Use more characters.`);
  }

  // Fetch tags
  const tagRows = await db
    .select({ key: schema.tags.key, value: schema.tags.value })
    .from(schema.tags)
    .where(and(eq(schema.tags.entityType, "contact"), eq(schema.tags.entityId, contact.id)));

  const tags = tagRows.map((t) => (t.value ? `${t.key}=${t.value}` : t.key));

  // Fetch org links
  const orgLinks = await db
    .select({
      name: schema.organisations.name,
      role: schema.contactOrgLinks.role,
    })
    .from(schema.contactOrgLinks)
    .innerJoin(schema.organisations, eq(schema.contactOrgLinks.orgId, schema.organisations.id))
    .where(eq(schema.contactOrgLinks.contactId, contact.id));

  // Donation summary
  const donationRows = await db
    .select({
      amount: schema.donations.amount,
      donationDate: schema.donations.donationDate,
      status: schema.donations.status,
      isDgrEligible: schema.donations.isDgrEligible,
    })
    .from(schema.donations)
    .where(eq(schema.donations.contactId, contact.id))
    .orderBy(desc(schema.donations.donationDate));

  const totalAmount = donationRows.reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const unreceipted = donationRows.filter(
    (d) => d.status === "received" && d.isDgrEligible
  ).length;

  const detail: ContactDetail = {
    id: contact.id.slice(0, 8),
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    addressLine1: contact.addressLine1,
    addressLine2: contact.addressLine2,
    suburb: contact.suburb,
    state: contact.state,
    postcode: contact.postcode,
    contactType: contact.contactType,
    notes: contact.notes,
    tags,
    organisations: orgLinks.map((o) => ({ name: o.name, role: o.role })),
    donationSummary: {
      totalDonations: donationRows.length,
      totalAmount: totalAmount.toFixed(2),
      lastDonation: donationRows[0]?.donationDate ?? null,
      unreceipted,
    },
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };

  const result = ok(detail);

  if (unreceipted > 0) {
    result.hints.push(`${unreceipted} unreceipted DGR-eligible donation${unreceipted > 1 ? "s" : ""}. Use: qnp-crm donations list --contact ${contact.id.slice(0, 8)} --unreceipted`);
  }
  if (!contact.email) {
    result.hints.push("No email on file — needed for sending receipts.");
  }

  return result;
}
