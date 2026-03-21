/**
 * Shared pipe orchestration modules — re-exports.
 *
 * Import from here: import { Envelope, Tier, ... } from "./shared/index.js";
 */

export { Envelope, type EnvelopeData, type EnvelopeShape, type PlanStep, type Plan } from "./envelope.js";
export { Tier, needsConfirmation, shouldExecute, shouldSkipForPlan, buildPlanEnvelope } from "./confirm.js";
export { isPiped, parseStdin, mergeInputs, checkRequiredFields, readStdin, type ParseResult, type PipeFieldSpec } from "./pipe.js";
export { TRANSITIONS, isValidTransition, transitionError } from "./transitions.js";
export { makeIdempotencyKey, checkIdempotency, recordIdempotency } from "./idempotency.js";
export { defaultFormat, formatTable, formatEnvelope } from "./format.js";
export { validatePipeline, type PipeContract, type StageResult, type ValidationResult } from "./compatibility.js";
export { createTraceSpan, formatSpanName, extractPipeMetadata, correlationId, emitTraceSpan, type PipeSpan, type PipeMetadata } from "./trace.js";
export { validateCommand, isValidationError, getRegistry, getCommandNames, getCommandTier, getCommandBinary, getSchema, type CommandName, type CommandInput, type ValidatedCommand, type ValidationError } from "./command-schema.js";
export { attachSafetyLayerAndParse, makeFmt, stub, today, type Dispatcher } from "./cli-harness.js";
export { verify, type Expectation, type FieldCheck, type Divergence, type VerifyResult } from "./verify.js";
