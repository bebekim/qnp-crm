import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult, type Donation } from "../types.js";
import { resolveContact } from "./resolve-contact.js";

interface AddOpts {
  contact?: string;
  date: string;
  method?: string;
  fund: string;
  campaign?: string;
  reference?: string;
  dgr: boolean; // commander: --no-dgr sets this to false
  notes?: string;
  confirm: boolean;
}

export async function donationsAdd(
  amountStr: string,
  opts: AddOpts
): Promise<CommandResult<Donation | null>> {
  const db = connect();

  // Validate amount
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    return fail(`Invalid amount: "${amountStr}". Must be a positive number.`);
  }
  const amountFixed = amount.toFixed(2);

  // Validate date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    return fail(`Invalid date format: "${opts.date}". Use YYYY-MM-DD.`);
  }

  // Validate method
  const validMethods = ["cash", "cheque", "eft", "card", "in_kind", "other"];
  const method = opts.method ?? "other";
  if (!validMethods.includes(method)) {
    return fail(`Invalid method "${method}". Options: ${validMethods.join(", ")}`);
  }

  // Resolve contact if provided
  let contactId: string | null = null;
  let contactName: string | null = null;

  if (opts.contact) {
    const contact = await resolveContact(db, opts.contact);
    if (!contact) {
      return fail(`Contact not found: "${opts.contact}". Try: qnp-crm contacts search "${opts.contact}"`);
    }
    contactId = contact.id;
    contactName = `${contact.firstName} ${contact.lastName}`;
  }

  // Without --confirm: output plan
  if (!opts.confirm) {
    const details: Record<string, unknown> = {
      amount: `$${amountFixed}`,
      date: opts.date,
      method,
      fund: opts.fund,
      dgrEligible: opts.dgr,
    };
    if (contactName) details.contact = contactName;
    if (opts.campaign) details.campaign = opts.campaign;
    if (opts.reference) details.reference = opts.reference;

    const args = [`add "${amountFixed}"`];
    if (opts.contact) args.push(`--contact "${opts.contact}"`);
    args.push(`--date ${opts.date}`);
    if (method !== "other") args.push(`--method ${method}`);
    if (opts.fund !== "general") args.push(`--fund "${opts.fund}"`);
    if (opts.campaign) args.push(`--campaign "${opts.campaign}"`);
    if (opts.reference) args.push(`--reference "${opts.reference}"`);
    if (!opts.dgr) args.push("--no-dgr");
    if (opts.notes) args.push(`--notes "${opts.notes}"`);
    args.push("--confirm");

    return needsConfirm(null, {
      action: `Record $${amountFixed} donation${contactName ? ` from ${contactName}` : ""}`,
      details,
      tier: "write",
      confirmCommand: `qnp-crm donations ${args.join(" ")}`,
    });
  }

  // With --confirm: execute
  const [inserted] = await db
    .insert(schema.donations)
    .values({
      contactId,
      amount: amountFixed,
      donationDate: opts.date,
      method,
      fund: opts.fund,
      status: "received",
      isDgrEligible: opts.dgr,
      description: opts.notes,
      reference: opts.reference,
      campaign: opts.campaign,
    })
    .returning();

  await audit(db, {
    table: "donations",
    recordId: inserted.id,
    action: "INSERT",
    by: performer(),
  });

  const result = ok<Donation>({
    id: inserted.id.slice(0, 8),
    contactId: contactId?.slice(0, 8) ?? null,
    contactName,
    amount: inserted.amount,
    donationDate: inserted.donationDate,
    method: inserted.method,
    fund: inserted.fund,
    status: inserted.status,
    isDgrEligible: inserted.isDgrEligible,
    campaign: inserted.campaign,
    reference: inserted.reference,
    receiptNumber: null,
  });

  if (!contactId) {
    result.hints.push("No contact linked — link one before receipting: qnp-crm donations edit <id> --contact <name>");
  }
  if (opts.dgr && contactId) {
    result.hints.push(`DGR-eligible. Generate receipt: qnp-crm receipts generate ${inserted.id}`);
  }

  return result;
}

