/**
 * Pipe envelope → Langfuse span bridge.
 *
 * Converts qnp-crm envelope outputs into Langfuse-compatible span data.
 * This enables cross-correlation between:
 *   - Langfuse traces (LLM decision-making)
 *   - PostgreSQL audit log (CRM data mutations)
 *
 * The pipe_id is the shared correlation key between both systems.
 *
 * Usage in commands:
 *   import { createTraceSpan, emitTraceSpan } from "./shared/trace.js";
 *   const span = createTraceSpan(envelope);
 *   emitTraceSpan(span); // writes to stderr for agent runner to capture
 */

import { Envelope, type Plan } from "./envelope.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipeMetadata {
  pipeId: string | null;
  stage: number;
  command: string | null;
  ok: boolean;
  error: string | null;
  failedCommand?: string | null;
  dataKeys: string[];
  warningCount: number;
  warnings: string[];
  hasPlan: boolean;
  planStepCount: number;
  idempotencyKey: string | null;
}

export interface PipeSpan {
  /** Span name in format qnp-crm:{command} */
  name: string;
  /** Span level: DEFAULT, WARNING, ERROR */
  level: "DEFAULT" | "WARNING" | "ERROR";
  /** Status message (error text or warning summary) */
  statusMessage: string | null;
  /** Input data (stringified for Langfuse) */
  input: string;
  /** Output data (stringified for Langfuse) */
  output: string;
  /** Metadata for Langfuse span attributes */
  metadata: PipeMetadata;
  /** Timestamp */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Span name formatting
// ---------------------------------------------------------------------------

export function formatSpanName(command: string | null): string {
  if (!command) return "qnp-crm:unknown";
  return `qnp-crm:${command.replace(/\s+/g, "-")}`;
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

export function extractPipeMetadata(env: Envelope): PipeMetadata {
  const plan = env.data._plan as Plan | undefined;

  return {
    pipeId: env.pipe_id,
    stage: env.stage,
    command: env.command,
    ok: env.ok,
    error: env.error,
    failedCommand: env.failed_command,
    dataKeys: Object.keys(env.data).filter((k) => !k.startsWith("_")),
    warningCount: env.warnings.length,
    warnings: env.warnings,
    hasPlan: env.hasPlan(),
    planStepCount: plan?.steps?.length ?? 0,
    idempotencyKey: env.idempotency_key,
  };
}

// ---------------------------------------------------------------------------
// Span creation
// ---------------------------------------------------------------------------

export function createTraceSpan(env: Envelope): PipeSpan {
  const metadata = extractPipeMetadata(env);

  let level: PipeSpan["level"] = "DEFAULT";
  let statusMessage: string | null = null;

  if (!env.ok) {
    level = "ERROR";
    statusMessage = env.error;
  } else if (env.warnings.length > 0) {
    level = "WARNING";
    statusMessage = env.warnings.join("; ");
  }

  // Prepare input/output for Langfuse display
  const dataWithoutPlan = { ...env.data };
  delete dataWithoutPlan._plan;

  return {
    name: formatSpanName(env.command),
    level,
    statusMessage,
    input: JSON.stringify(dataWithoutPlan, null, 2),
    output: env.toJson(),
    metadata,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

/**
 * Get the correlation ID for linking Langfuse traces to PostgreSQL audit log.
 * The pipe_id appears in both systems, enabling cross-referencing.
 */
export function correlationId(env: Envelope): string | null {
  return env.pipe_id;
}

// ---------------------------------------------------------------------------
// Span emission (for agent runner to capture)
// ---------------------------------------------------------------------------

/**
 * Emit a trace span to stderr for the agent runner to capture.
 *
 * The agent runner's Langfuse integration reads these from the
 * qnp-crm command's stderr and attaches them as child spans
 * to the active Langfuse trace.
 *
 * Format: JSON line prefixed with __LANGFUSE_SPAN__
 */
export function emitTraceSpan(span: PipeSpan): void {
  const line = JSON.stringify({
    __langfuse_span__: true,
    ...span,
  });
  process.stderr.write(`__LANGFUSE_SPAN__${line}\n`);
}
