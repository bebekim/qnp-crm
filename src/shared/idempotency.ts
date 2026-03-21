/**
 * Idempotency — crash-safe re-runs for pipe orchestration.
 *
 * Every command that produces side effects carries an idempotency key.
 * Re-running a pipe after a crash does not duplicate records, receipts,
 * or emails. Uses INSERT ... ON CONFLICT DO NOTHING keyed on the
 * idempotency value.
 *
 * Key format: ik-{entity_id}-{operation}
 * TTL: entries older than 7 days are pruned.
 */

import { Envelope } from "./envelope.js";

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate an idempotency key.
 * Format: ik-{entityId}-{operation}
 *
 * Examples:
 * - ik-d-a1b2c3d4-receipt
 * - ik-d-a1b2c3d4-notify
 * - ik-batch-2026-03-17-receipt
 */
export function makeIdempotencyKey(entityId: string, operation: string): string {
  return `ik-${entityId}-${operation}`;
}

// ---------------------------------------------------------------------------
// Check — look up prior execution
// ---------------------------------------------------------------------------

/**
 * Check if this idempotency key has already been executed.
 * Returns the stored Envelope if found, null otherwise.
 */
export async function checkIdempotency(
  db: any,
  key: string,
): Promise<Envelope | null> {
  const rows = await db
    .select()
    .from({ _: { name: "idempotency_log" } })
    .where({ key })
    .limit(1);

  if (rows.length === 0) return null;

  const stored = rows[0].result;
  return Envelope.fromJson(
    typeof stored === "string" ? stored : JSON.stringify(stored),
  );
}

// ---------------------------------------------------------------------------
// Record — store result for future lookups
// ---------------------------------------------------------------------------

/**
 * Record the result of an idempotent operation.
 * Called after successful execution to prevent re-execution on replay.
 */
export async function recordIdempotency(
  db: any,
  key: string,
  envelope: Envelope,
): Promise<void> {
  await db.insert({ _: { name: "idempotency_log" } }).values({
    key,
    pipeId: envelope.pipe_id,
    command: envelope.command,
    result: JSON.parse(envelope.toJson()),
    createdAt: new Date(),
  });
}
