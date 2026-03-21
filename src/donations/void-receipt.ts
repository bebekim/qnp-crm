import { eq } from "drizzle-orm";
import { connect, audit, performer, schema } from "../db/connection.js";
import { ok, fail, needsConfirm, type CommandResult } from "../types.js";

// ---------------------------------------------------------------------------
// receipts void — RECEIPT tier
//
// Voids an existing receipt and reverts the linked donation to "received"
// so it can be re-receipted if needed.
//
// Without --confirm: outputs a plan showing receipt details
// With --confirm + --reason: executes the void
// ---------------------------------------------------------------------------

interface VoidOpts {
  reason?: string;
  confirm: boolean;
}

export async function receiptsVoid(
  receiptNumber: string,
  opts: VoidOpts
): Promise<CommandResult<{ receiptNumber: number; donationId: string; reason: string } | null>> {
  // --- Parse receipt number ---
  const num = parseInt(receiptNumber, 10);
  if (isNaN(num) || !Number.isInteger(num) || num <= 0 || String(num) !== receiptNumber.trim()) {
    return fail(`Invalid receipt number: "${receiptNumber}". Must be a positive integer.`);
  }

  const db = connect();

  // --- Look up receipt ---
  const [receipt] = await db
    .select()
    .from(schema.receipts)
    .where(eq(schema.receipts.receiptNumber, num))
    .limit(1);

  if (!receipt) {
    return fail(`Receipt #${num} not found.`);
  }

  // --- Validate not already voided ---
  if (receipt.isVoided) {
    return fail(`Receipt #${num} is already voided.`);
  }

  // --- Without --confirm: output plan ---
  if (!opts.confirm) {
    return needsConfirm(null, {
      action: `Void receipt #${num}`,
      details: {
        receiptNumber: receipt.receiptNumber,
        recipientName: receipt.recipientName,
        amount: `$${receipt.amount}`,
        donationDate: receipt.donationDate,
        donationId: receipt.donationId.slice(0, 8),
        issuedAt: receipt.issuedAt,
      },
      tier: "receipt",
      confirmCommand: `qnp-crm receipts void ${num} --reason "<reason>" --confirm`,
    });
  }

  // --- --reason is required for execution ---
  if (!opts.reason) {
    return fail(`--reason is required when voiding a receipt.`);
  }

  // --- Execute void ---
  const now = new Date();

  // Update receipt: set voided
  await db
    .update(schema.receipts)
    .set({ isVoided: true, voidReason: opts.reason, voidedAt: now })
    .where(eq(schema.receipts.receiptNumber, num));

  // Revert linked donation status to "received"
  await db
    .update(schema.donations)
    .set({ status: "received", updatedAt: now })
    .where(eq(schema.donations.id, receipt.donationId));

  // Audit log
  await audit(db, {
    table: "receipts",
    recordId: receipt.id,
    action: "UPDATE",
    changes: {
      isVoided: { old: false, new: true },
      voidReason: { old: null, new: opts.reason },
    },
    by: performer(),
  });

  return ok({
    receiptNumber: receipt.receiptNumber,
    donationId: receipt.donationId.slice(0, 8),
    reason: opts.reason,
  });
}
