/**
 * Pipe utilities — stdin detection, envelope parsing, input merging.
 *
 * Every qnp-crm command uses these to detect piped input, parse upstream
 * envelopes, and merge piped data with CLI flags.
 */

import { Envelope, type EnvelopeData } from "./envelope.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipeFieldSpec {
  name: string;
  flag?: string; // CLI flag name, e.g. "--contact"
}

export type ParseResult =
  | { type: "envelope"; envelope: Envelope }
  | { type: "failure"; envelope: Envelope }
  | { type: "batch"; envelopes: Envelope[] }
  | { type: "empty" }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// isPiped — check if stdin is a pipe (not a TTY)
// ---------------------------------------------------------------------------

export function isPiped(): boolean {
  return !process.stdin.isTTY;
}

// ---------------------------------------------------------------------------
// parseStdin — parse raw stdin content into envelope(s)
// ---------------------------------------------------------------------------

export function parseStdin(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { type: "empty" };
  }

  // Check for JSONL (multiple lines, each a JSON object)
  const lines = trimmed.split("\n").filter((l) => l.trim() !== "");

  if (lines.length > 1) {
    // Attempt batch (JSONL) parse
    const envelopes: Envelope[] = [];
    for (const line of lines) {
      try {
        const env = Envelope.fromJson(line.trim());
        envelopes.push(env);
      } catch (e: any) {
        return { type: "error", message: e.message };
      }
    }
    return { type: "batch", envelopes };
  }

  // Single line — parse as single envelope
  try {
    const env = Envelope.fromJson(trimmed);
    if (!env.ok) {
      return { type: "failure", envelope: env };
    }
    return { type: "envelope", envelope: env };
  } catch (e: any) {
    return { type: "error", message: e.message };
  }
}

// ---------------------------------------------------------------------------
// mergeInputs — merge piped data with CLI flags
// ---------------------------------------------------------------------------

/**
 * Merge upstream piped data with CLI flag values.
 *
 * Priority: CLI flag (explicitly provided, non-undefined) > piped data.
 * When a flag overrides a piped value, a warning is emitted.
 */
export function mergeInputs(
  upstream: Envelope,
  flags: Record<string, unknown>,
): { data: Record<string, unknown>; warnings: string[] } {
  const data: Record<string, unknown> = { ...upstream.data };
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined) continue;

    if (key in data && data[key] !== value) {
      warnings.push(
        `Flag --${key} overrode piped ${key} (was: ${data[key]})`,
      );
    }
    data[key] = value;
  }

  return { data, warnings };
}

// ---------------------------------------------------------------------------
// checkRequiredFields — validate that required fields are present
// ---------------------------------------------------------------------------

/**
 * Check that all required fields are present in the merged data.
 * Returns null if all present, or an error message listing missing fields.
 */
export function checkRequiredFields(
  data: Record<string, unknown>,
  required: string[],
): string | null {
  const missing = required.filter((f) => data[f] === undefined || data[f] === null);
  if (missing.length === 0) return null;

  const available = Object.keys(data)
    .filter((k) => !k.startsWith("_"))
    .join(", ");

  return (
    `Missing required field(s): ${missing.join(", ")}. ` +
    `Available: ${available || "(none)"}.`
  );
}

// ---------------------------------------------------------------------------
// readStdin — read all of stdin (for use in commands)
// ---------------------------------------------------------------------------

export async function readStdin(): Promise<string> {
  if (!isPiped()) return "";

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
