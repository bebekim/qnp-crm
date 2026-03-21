/**
 * Output formatting — auto-detect JSON vs table, render envelopes.
 *
 * Default: JSON when piped, table when TTY.
 * --format flag always overrides auto-detection.
 */

import { Envelope } from "./envelope.js";

// ---------------------------------------------------------------------------
// Auto-detection
// ---------------------------------------------------------------------------

export function defaultFormat(): "json" | "table" {
  return process.stdout.isTTY ? "table" : "json";
}

// ---------------------------------------------------------------------------
// Table rendering
// ---------------------------------------------------------------------------

/**
 * Render an envelope as a human-readable table.
 * Omits internal fields (prefixed with _).
 */
export function formatTable(env: Envelope, title: string): string {
  const lines: string[] = [];

  // Title
  lines.push(`┌${"─".repeat(50)}┐`);
  lines.push(`│ ${title.padEnd(49)}│`);
  lines.push(`├${"─".repeat(50)}┤`);

  if (!env.ok) {
    lines.push(`│ ERROR: ${(env.error ?? "Unknown error").padEnd(41)}│`);
    if (env.failed_command) {
      lines.push(`│ Command: ${env.failed_command.padEnd(39)}│`);
    }
    lines.push(`└${"─".repeat(50)}┘`);
    return lines.join("\n");
  }

  // Data fields (skip internal _-prefixed keys)
  for (const [key, value] of Object.entries(env.data)) {
    if (key.startsWith("_")) continue;
    const display = formatValue(value);
    lines.push(`│ ${key.padEnd(18)} ${display.padEnd(30)}│`);
  }

  // Pipe context
  if (env.pipe_id) {
    lines.push(`│ ${"pipe".padEnd(18)} ${`${env.pipe_id} (stage ${env.stage})`.padEnd(30)}│`);
  }

  lines.push(`└${"─".repeat(50)}┘`);

  // Warnings
  for (const w of env.warnings) {
    lines.push(`⚠ ${w}`);
  }

  return lines.join("\n");
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// ---------------------------------------------------------------------------
// Unified formatter
// ---------------------------------------------------------------------------

export function formatEnvelope(
  env: Envelope,
  format: "json" | "table",
  title?: string,
): string {
  if (format === "json") {
    return env.toJson();
  }
  return formatTable(env, title ?? env.command ?? "Result");
}
