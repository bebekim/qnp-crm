import { eq, sql } from "drizzle-orm";
import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult } from "../types.js";

interface VoidOpts {
  reason?: string;
  confirm: boolean;
}

export async function donationsVoid(
  idPrefix: string,
  opts: VoidOpts
): Promise<CommandResult<{ id: string; status: string } | null>> {
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

  // Validate: not already voided
  if (donation.status === "voided") {
    return fail(`Donation ${donation.id.slice(0, 8)} is already voided.`);
  }

  // Without --confirm: output plan
  if (!opts.confirm) {
    return needsConfirm(null, {
      action: `Void donation ${donation.id.slice(0, 8)} ($${donation.amount})`,
      details: {
        id: donation.id.slice(0, 8),
        amount: `$${donation.amount}`,
        date: donation.donationDate,
        status: donation.status,
        method: donation.method,
      },
      tier: "write",
      confirmCommand: `qnp-crm donations void ${idPrefix} --reason "<reason>" --confirm`,
    });
  }

  // With --confirm: requires --reason
  if (!opts.reason) {
    return fail(`--reason is required when voiding a donation with --confirm.`);
  }

  // Check for receipt
  const [receiptRow] = await db
    .select({
      receiptNumber: schema.receipts.receiptNumber,
    })
    .from(schema.receipts)
    .where(eq(schema.receipts.donationId, donation.id))
    .limit(1);

  // Execute void
  await db
    .update(schema.donations)
    .set({
      status: "voided",
      voidReason: opts.reason,
      voidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.donations.id, donation.id));

  await audit(db, {
    table: "donations",
    recordId: donation.id,
    action: "UPDATE",
    changes: {
      status: { old: donation.status, new: "voided" },
      voidReason: { old: null, new: opts.reason },
    },
    by: performer(),
  });

  const result = ok({ id: donation.id.slice(0, 8), status: "voided" });

  if (receiptRow) {
    result.warnings.push(
      `This donation has receipt #${receiptRow.receiptNumber}. Void the receipt separately: qnp-crm receipts void ${receiptRow.receiptNumber}`
    );
  }

  return result;
}
