/**
 * Donation status transitions — guards, not orchestration.
 *
 * The pipe handles orchestration. Status transitions handle safety —
 * preventing illegal state changes regardless of how commands are invoked.
 *
 * Lifecycle:
 *   recorded ──→ receipted ──→ thanked
 *       │             │            │
 *       ▼             ▼            ▼
 *   cancelled      voided       voided
 */

// ---------------------------------------------------------------------------
// Transition map
// ---------------------------------------------------------------------------

export const TRANSITIONS: Record<string, string[]> = {
  recorded: ["receipted", "cancelled"],
  receipted: ["thanked", "voided"],
  thanked: ["voided"],
  voided: [],
  cancelled: [],
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidTransition(current: string, target: string): boolean {
  const valid = TRANSITIONS[current];
  if (!valid) return false;
  return valid.includes(target);
}

// ---------------------------------------------------------------------------
// Error message
// ---------------------------------------------------------------------------

export function transitionError(
  donationId: string,
  current: string,
  target: string,
): string {
  const valid = TRANSITIONS[current] ?? [];
  const alternatives = valid.length > 0 ? valid.join(", ") : "none (terminal)";
  return (
    `Invalid status change for ${donationId}: ${current} → ${target}. ` +
    `Valid next states: ${alternatives}.`
  );
}
