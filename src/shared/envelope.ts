/**
 * Envelope — the shared data contract for Unix pipe orchestration.
 *
 * Every qnp-crm command reads and writes this shape when piped.
 * The envelope accumulates data: each stage passes through everything
 * it received plus what it added.
 */

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanStep {
  stage: number;
  command: string;
  tier: "read" | "write" | "receipt";
  description: string;
}

export interface Plan {
  steps: PlanStep[];
  confirm_command: string;
}

export interface EnvelopeData {
  [key: string]: unknown;
  _plan?: Plan;
}

export interface EnvelopeShape {
  v: number;
  ok: boolean;
  pipe_id: string | null;
  stage: number;
  idempotency_key?: string | null;
  data: EnvelopeData;
  warnings: string[];
  error: string | null;
  command: string | null;
  failed_command?: string | null;
}

interface OkOptions {
  pipeId?: string | null;
  stage?: number;
  command?: string | null;
  idempotencyKey?: string | null;
  warnings?: string[];
}

interface ErrOptions {
  pipeId?: string | null;
  stage?: number;
}

// ---------------------------------------------------------------------------
// Envelope class
// ---------------------------------------------------------------------------

export class Envelope implements EnvelopeShape {
  readonly v = 1;
  ok: boolean;
  pipe_id: string | null;
  stage: number;
  idempotency_key: string | null;
  data: EnvelopeData;
  warnings: string[];
  error: string | null;
  command: string | null;
  failed_command: string | null;

  private constructor(shape: EnvelopeShape) {
    this.ok = shape.ok;
    this.pipe_id = shape.pipe_id;
    this.stage = shape.stage;
    this.idempotency_key = shape.idempotency_key ?? null;
    this.data = shape.data;
    this.warnings = shape.warnings;
    this.error = shape.error;
    this.command = shape.command;
    this.failed_command = shape.failed_command ?? null;
  }

  // -----------------------------------------------------------------------
  // Static constructors
  // -----------------------------------------------------------------------

  static ok(data: EnvelopeData, opts: OkOptions = {}): Envelope {
    return new Envelope({
      v: 1,
      ok: true,
      pipe_id: opts.pipeId ?? null,
      stage: opts.stage ?? 0,
      idempotency_key: opts.idempotencyKey ?? null,
      data,
      warnings: opts.warnings ?? [],
      error: null,
      command: opts.command ?? null,
    });
  }

  static err(message: string, command: string, opts: ErrOptions = {}): Envelope {
    return new Envelope({
      v: 1,
      ok: false,
      pipe_id: opts.pipeId ?? null,
      stage: opts.stage ?? 0,
      data: {},
      warnings: [],
      error: message,
      command,
      failed_command: command,
    });
  }

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  toJson(): string {
    const shape: EnvelopeShape = {
      v: this.v,
      ok: this.ok,
      pipe_id: this.pipe_id,
      stage: this.stage,
      data: this.data,
      warnings: this.warnings,
      error: this.error,
      command: this.command,
    };

    if (this.idempotency_key != null) {
      shape.idempotency_key = this.idempotency_key;
    }

    if (!this.ok && this.failed_command != null) {
      shape.failed_command = this.failed_command;
    }

    return JSON.stringify(shape);
  }

  static fromJson(raw: string): Envelope {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Couldn't read input from the previous command. Expected JSON, got: ${raw.slice(0, 80)}`,
      );
    }

    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(
        `Couldn't read input from the previous command. Expected JSON object, got: ${raw.slice(0, 80)}`,
      );
    }

    if (parsed.v !== undefined && parsed.v !== 1) {
      throw new Error(
        `Upstream envelope version ${parsed.v} is newer than this command supports (v1). Update qnp-crm.`,
      );
    }

    if (parsed.data === undefined || parsed.warnings === undefined) {
      throw new Error(
        `Invalid envelope: missing required fields (data, warnings). Got keys: ${Object.keys(parsed).join(", ")}`,
      );
    }

    return new Envelope({
      v: 1,
      ok: parsed.ok ?? true,
      pipe_id: parsed.pipe_id ?? null,
      stage: parsed.stage ?? 0,
      idempotency_key: parsed.idempotency_key ?? null,
      data: parsed.data,
      warnings: parsed.warnings ?? [],
      error: parsed.error ?? null,
      command: parsed.command ?? null,
      failed_command: parsed.failed_command ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // Mutation helpers
  // -----------------------------------------------------------------------

  addData(fields: Record<string, unknown>): void {
    Object.assign(this.data, fields);
  }

  addWarning(warning: string): void {
    this.warnings.push(warning);
  }

  /**
   * Create a new envelope for the next stage in a pipe.
   * Increments stage, sets the new command, carries all data and warnings.
   */
  nextStage(command: string): Envelope {
    return new Envelope({
      v: 1,
      ok: true,
      pipe_id: this.pipe_id,
      stage: this.stage + 1,
      idempotency_key: this.idempotency_key,
      data: { ...this.data },
      warnings: [...this.warnings],
      error: null,
      command,
    });
  }

  /**
   * Re-emit a failure envelope from a downstream command.
   * Preserves the original error and failed_command, sets the new command.
   */
  propagateFailure(command: string): Envelope {
    return new Envelope({
      v: 1,
      ok: false,
      pipe_id: this.pipe_id,
      stage: this.stage + 1,
      data: { ...this.data },
      warnings: [...this.warnings],
      error: this.error,
      command,
      failed_command: this.failed_command,
    });
  }

  // -----------------------------------------------------------------------
  // Plan support
  // -----------------------------------------------------------------------

  hasPlan(): boolean {
    return this.data._plan != null;
  }

  appendPlanStep(step: PlanStep): void {
    if (!this.data._plan) {
      this.data._plan = { steps: [], confirm_command: "" };
    }
    this.data._plan.steps.push(step);
  }

  // -----------------------------------------------------------------------
  // Pipe ID generation
  // -----------------------------------------------------------------------

  static generatePipeId(): string {
    return `p-${randomBytes(4).toString("hex")}`;
  }

  // -----------------------------------------------------------------------
  // Output
  // -----------------------------------------------------------------------

  /** Write this envelope to stdout as a single JSON line. */
  emit(): void {
    process.stdout.write(this.toJson() + "\n");
  }
}
