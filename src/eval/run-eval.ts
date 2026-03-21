#!/usr/bin/env npx tsx
/**
 * LLM Evaluation Runner — Pipe Composition
 *
 * Runs the evaluation dataset against a live LLM (Claude) and scores
 * the agent's pipe composition. Results are optionally sent to Langfuse
 * as a dataset experiment for regression tracking.
 *
 * Usage:
 *   # Unit mode (no LLM, validates expected commands)
 *   npx tsx src/eval/run-eval.ts
 *
 *   # LLM mode (requires ANTHROPIC_API_KEY)
 *   EVAL_LLM=1 npx tsx src/eval/run-eval.ts
 *
 *   # LLM mode with Langfuse scoring
 *   EVAL_LLM=1 LANGFUSE_SECRET_KEY=... LANGFUSE_PUBLIC_KEY=... npx tsx src/eval/run-eval.ts
 *
 * Environment variables:
 *   EVAL_LLM=1                — enable LLM evaluation (default: unit mode)
 *   ANTHROPIC_API_KEY         — required for LLM mode
 *   LANGFUSE_SECRET_KEY       — optional: send scores to Langfuse
 *   LANGFUSE_PUBLIC_KEY       — optional: send scores to Langfuse
 *   LANGFUSE_BASE_URL         — optional: Langfuse endpoint
 */

import {
  EVAL_DATASET,
  parsePipeCommand,
  validatePipeShape,
  scoreComposition,
  type EvalScore,
} from "./pipe-eval.js";

// ---------------------------------------------------------------------------
// Unit mode — validate expected commands
// ---------------------------------------------------------------------------

async function runUnitMode(): Promise<EvalScore[]> {
  console.log("Running in UNIT mode (no LLM calls)\n");

  const scores: EvalScore[] = [];

  for (const evalCase of EVAL_DATASET) {
    if (!evalCase.expectedCommand) {
      console.log(`  [SKIP] ${evalCase.id} — no expected command`);
      continue;
    }

    const score = scoreComposition(evalCase, evalCase.expectedCommand);
    scores.push(score);

    const status = score.passed ? "✓" : "✗";
    console.log(
      `  [${status}] ${evalCase.id} — score: ${score.score.toFixed(1)}`,
    );
    if (!score.passed) {
      for (const err of score.errors) {
        console.log(`      ${err}`);
      }
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// LLM mode — send prompts to Claude, capture tool uses
// ---------------------------------------------------------------------------

async function runLlmMode(): Promise<EvalScore[]> {
  console.log("Running in LLM mode\n");

  // Dynamic import to avoid hard dependency
  let Anthropic: any;
  try {
    const mod = await import("@anthropic-ai/sdk");
    Anthropic = mod.default;
  } catch {
    console.error("ERROR: @anthropic-ai/sdk not installed. Run: npm install @anthropic-ai/sdk");
    process.exit(1);
  }

  const client = new Anthropic();
  const scores: EvalScore[] = [];

  // Load SKILL.md as system context
  const fs = await import("node:fs");
  const path = await import("node:path");

  let skillMd = "";
  const skillPath = path.join(process.cwd(), "nanoclaw-skill", "container", "skills", "qnp-crm", "SKILL.md");
  try {
    skillMd = fs.readFileSync(skillPath, "utf-8");
  } catch {
    console.warn("WARN: Could not load SKILL.md — agent may not know pipe patterns");
  }

  for (const evalCase of EVAL_DATASET) {
    console.log(`  Evaluating: ${evalCase.id}...`);

    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: [
          "You are the NanoClaw CRM agent. You compose qnp-crm pipe commands.",
          "Respond ONLY with the exact qnp-crm pipe command you would run. No explanation.",
          "Use | to pipe commands. Include --confirm on WRITE/RECEIPT tier commands.",
          skillMd ? `\n\nSKILL.md reference:\n${skillMd}` : "",
        ].join("\n"),
        messages: [{ role: "user", content: evalCase.prompt }],
      });

      // Extract the command from the response
      const text = response.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");

      // Find the qnp-crm command in the response
      const commandMatch = text.match(/qnp-crm\s+\w+\s+.+/);
      const actualCommand = commandMatch ? commandMatch[0].trim() : text.trim();

      const score = scoreComposition(evalCase, actualCommand);
      scores.push(score);

      const status = score.passed ? "✓" : "✗";
      console.log(`  [${status}] ${evalCase.id} — score: ${score.score.toFixed(1)}`);
      if (!score.passed) {
        console.log(`      Expected: ${evalCase.expectedCommand}`);
        console.log(`      Got:      ${actualCommand}`);
        for (const err of score.errors) {
          console.log(`      ${err}`);
        }
      }
    } catch (err: any) {
      console.error(`  [ERROR] ${evalCase.id}: ${err.message}`);
      scores.push({
        caseId: evalCase.id,
        passed: false,
        score: 0,
        errors: [err.message],
        actualCommand: "",
      });
    }
  }

  return scores;
}

// ---------------------------------------------------------------------------
// Langfuse scoring
// ---------------------------------------------------------------------------

async function reportToLangfuse(scores: EvalScore[]): Promise<void> {
  if (!process.env.LANGFUSE_SECRET_KEY || !process.env.LANGFUSE_PUBLIC_KEY) {
    return;
  }

  console.log("\nReporting scores to Langfuse...");

  try {
    const { startActiveObservation } = await import("@langfuse/tracing");

    for (const score of scores) {
      await startActiveObservation(`eval:${score.caseId}`, async (span: any) => {
        span.update({
          input: { caseId: score.caseId },
          output: {
            passed: score.passed,
            score: score.score,
            errors: score.errors,
            actualCommand: score.actualCommand,
          },
          metadata: {
            evalType: "pipe-composition",
            dataset: "qnp-crm-pipe-eval",
          },
        });
      });
    }

    console.log(`  Reported ${scores.length} scores to Langfuse`);
  } catch (err: any) {
    console.warn(`  Failed to report to Langfuse: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("qnp-crm Pipe Composition Eval\n");

  const isLlmMode = process.env.EVAL_LLM === "1";
  const scores = isLlmMode ? await runLlmMode() : await runUnitMode();

  // Summary
  const passed = scores.filter((s) => s.passed).length;
  const total = scores.length;
  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / total;

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passed}/${total} passed (avg score: ${avgScore.toFixed(2)})`);

  // Report to Langfuse if configured
  await reportToLangfuse(scores);

  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
