/**
 * Pipe composition evaluation — parse, validate, and score pipe commands.
 *
 * Used by:
 *   1. Unit tests — validate pipe shapes deterministically
 *   2. LLM eval runner — score agent-composed pipes against expected shapes
 *   3. Langfuse dataset — track regression in pipe composition quality
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  /** Full raw command string */
  raw: string;
  /** Command domain (contacts, donations, receipts, notify, etc.) */
  domain: string;
  /** Command action (add, show, generate, etc.) */
  action: string;
  /** Whether --confirm flag is present */
  hasConfirm: boolean;
  /** Whether --fail-fast flag is present */
  hasFailFast: boolean;
  /** --format value if specified */
  format: string | null;
  /** Whether --send flag is present */
  hasSend: boolean;
}

export interface ParsedPipe {
  /** Individual commands in the pipe chain */
  commands: ParsedCommand[];
  /** Raw full pipe command */
  raw: string;
}

export interface PipeStageSpec {
  domain: string;
  action: string;
  requireConfirm?: boolean;
}

export interface PipeShape {
  stages: PipeStageSpec[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface EvalCase {
  /** Unique ID for this eval case */
  id: string;
  /** Human-readable description */
  description: string;
  /** The user prompt (what the Also Admin would say) */
  prompt: string;
  /** Expected pipe shape the agent should produce */
  expectedShape: PipeShape;
  /** Expected full command (optional — for self-validation) */
  expectedCommand?: string;
  /** Tags for filtering/grouping */
  tags: string[];
}

// ---------------------------------------------------------------------------
// Parse a pipe command string
// ---------------------------------------------------------------------------

export function parsePipeCommand(raw: string): ParsedPipe {
  const segments = raw.split("|").map((s) => s.trim());
  const commands: ParsedCommand[] = [];

  for (const segment of segments) {
    // Extract the qnp-crm <domain> <action> part
    const match = segment.match(/qnp-crm\s+(\S+)\s+(\S+)/);
    if (!match) continue;

    const domain = match[1];
    const action = match[2];

    // Extract flags
    const hasConfirm = /--confirm\b/.test(segment);
    const hasFailFast = /--fail-fast\b/.test(segment);
    const hasSend = /--send\b/.test(segment);

    const formatMatch = segment.match(/--format\s+(\S+)/);
    const format = formatMatch ? formatMatch[1] : null;

    commands.push({
      raw: segment,
      domain,
      action,
      hasConfirm,
      hasFailFast,
      format,
      hasSend,
    });
  }

  return { commands, raw };
}

// ---------------------------------------------------------------------------
// Validate a parsed pipe against an expected shape
// ---------------------------------------------------------------------------

export function validatePipeShape(
  actual: ParsedPipe,
  expected: PipeShape,
): ValidationResult {
  const errors: string[] = [];

  if (actual.commands.length !== expected.stages.length) {
    errors.push(
      `Expected ${expected.stages.length} stages, got ${actual.commands.length}`,
    );
    return { valid: false, errors };
  }

  for (let i = 0; i < expected.stages.length; i++) {
    const exp = expected.stages[i];
    const act = actual.commands[i];

    if (act.domain !== exp.domain || act.action !== exp.action) {
      errors.push(
        `stage ${i}: expected ${exp.domain} ${exp.action}, got ${act.domain} ${act.action}`,
      );
    }

    if (exp.requireConfirm && !act.hasConfirm) {
      errors.push(
        `stage ${i}: ${exp.domain} ${exp.action} requires --confirm but it was not present`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Canonical evaluation dataset
// ---------------------------------------------------------------------------

export const EVAL_DATASET: EvalCase[] = [
  {
    id: "full-donation-lifecycle",
    description: "Full donation lifecycle: add → receipt → thank",
    prompt:
      'Jane Smith just donated $500 by bank transfer. Receipt and thank her please.',
    expectedShape: {
      stages: [
        { domain: "donations", action: "add" },
        { domain: "receipts", action: "generate" },
        { domain: "notify", action: "thankyou" },
      ],
    },
    expectedCommand:
      'qnp-crm donations add 500 --contact "Jane Smith" --method eft --confirm ' +
      "| qnp-crm receipts generate --confirm " +
      "| qnp-crm notify thankyou --send --confirm",
    tags: ["lifecycle", "pipe", "receipt"],
  },
  {
    id: "receipt-existing-donation",
    description: "Receipt an existing donation",
    prompt: "Generate a receipt for donation d-abc123 and send it to the donor.",
    expectedShape: {
      stages: [
        { domain: "receipts", action: "generate" },
        { domain: "notify", action: "thankyou" },
      ],
    },
    expectedCommand:
      "qnp-crm receipts generate d-abc123 --confirm " +
      "| qnp-crm notify thankyou --send --confirm",
    tags: ["receipt", "pipe"],
  },
  {
    id: "batch-receipt",
    description: "Batch receipt all unreceipted donations",
    prompt: "Receipt all unreceipted donations and send thank you emails.",
    expectedShape: {
      stages: [
        { domain: "donations", action: "list" },
        { domain: "receipts", action: "batch" },
        { domain: "notify", action: "batch-thankyou" },
      ],
    },
    expectedCommand:
      "qnp-crm donations list --status recorded --format json " +
      "| qnp-crm receipts batch --confirm " +
      "| qnp-crm notify batch-thankyou --send --confirm",
    tags: ["batch", "receipt", "pipe"],
  },
  {
    id: "contact-lookup-donate",
    description: "Contact lookup → donation",
    prompt: 'Record a $200 EFT donation from Jane Smith.',
    expectedShape: {
      stages: [
        { domain: "contacts", action: "show" },
        { domain: "donations", action: "add" },
      ],
    },
    expectedCommand:
      'qnp-crm contacts show "Jane Smith" ' +
      "| qnp-crm donations add 200 --method eft --confirm",
    tags: ["contact", "donation", "pipe"],
  },
  {
    id: "eofy-statements",
    description: "EOFY statement run (fail-fast)",
    prompt:
      "Generate end of financial year statements for all donors for FY 2025-26.",
    expectedShape: {
      stages: [
        { domain: "donations", action: "list" },
        { domain: "receipts", action: "statements" },
        { domain: "notify", action: "batch-statements" },
      ],
    },
    expectedCommand:
      "qnp-crm donations list --from 2025-07-01 --to 2026-06-30 --format json " +
      "| qnp-crm receipts statements generate --confirm --fail-fast " +
      "| qnp-crm notify batch-statements --send --confirm --fail-fast",
    tags: ["eofy", "batch", "fail-fast", "pipe"],
  },
  {
    id: "dry-run-plan",
    description: "Dry-run plan (no --confirm)",
    prompt: "Show me what would happen if I receipt Jane's $500 donation.",
    expectedShape: {
      stages: [
        { domain: "receipts", action: "generate" },
      ],
    },
    expectedCommand: "qnp-crm receipts generate d-abc123",
    tags: ["plan", "dry-run"],
  },
  {
    id: "dedup-merge",
    description: "Dedup check → merge",
    prompt: "Find and merge duplicate contacts.",
    expectedShape: {
      stages: [
        { domain: "contacts", action: "dedup" },
        { domain: "contacts", action: "merge" },
      ],
    },
    expectedCommand:
      "qnp-crm contacts dedup --threshold 0.85 " +
      "| qnp-crm contacts merge --confirm",
    tags: ["contacts", "dedup", "pipe"],
  },
];

// ---------------------------------------------------------------------------
// Eval scoring (for Langfuse dataset integration)
// ---------------------------------------------------------------------------

export interface EvalScore {
  caseId: string;
  passed: boolean;
  score: number; // 0.0 to 1.0
  errors: string[];
  actualCommand: string;
}

/**
 * Score an agent's pipe composition against the expected shape.
 *
 * Returns a score:
 *   1.0 = perfect match
 *   0.5 = correct commands but wrong order or missing flags
 *   0.0 = wrong commands
 */
export function scoreComposition(
  evalCase: EvalCase,
  actualCommand: string,
): EvalScore {
  const parsed = parsePipeCommand(actualCommand);
  const validation = validatePipeShape(parsed, evalCase.expectedShape);

  if (validation.valid) {
    return {
      caseId: evalCase.id,
      passed: true,
      score: 1.0,
      errors: [],
      actualCommand,
    };
  }

  // Partial scoring: check if at least the right commands are present
  const expectedDomains = evalCase.expectedShape.stages.map((s) => `${s.domain}:${s.action}`);
  const actualDomains = parsed.commands.map((c) => `${c.domain}:${c.action}`);
  const correctCommands = expectedDomains.filter((d) => actualDomains.includes(d)).length;
  const partialScore = correctCommands / expectedDomains.length;

  return {
    caseId: evalCase.id,
    passed: false,
    score: partialScore * 0.5, // Cap partial at 0.5
    errors: validation.errors,
    actualCommand,
  };
}
