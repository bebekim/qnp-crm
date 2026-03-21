import { sql } from "drizzle-orm";
import { connect } from "../db/connection.js";
import { ok, type CommandResult } from "../types.js";

export interface JobRun {
  id: string;
  taskId: string;
  taskPrompt: string | null;
  groupFolder: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  status: string;
  result: string | null;
  error: string | null;
}

interface JobHistoryOpts {
  task?: string;
  status?: string;
  from?: string;
  limit?: number;
}

export async function jobsHistory(opts: JobHistoryOpts): Promise<CommandResult<JobRun[]>> {
  const db = connect();
  const limit = opts.limit ?? 50;

  const conditions: string[] = [];
  if (opts.task) {
    conditions.push(`task_id = '${opts.task.replace(/'/g, "''")}'`);
  }
  if (opts.status) {
    conditions.push(`status = '${opts.status.replace(/'/g, "''")}'`);
  }
  if (opts.from) {
    conditions.push(`started_at >= '${opts.from}'::timestamptz`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows: any[] = await db.execute(sql.raw(`
    SELECT id::text, task_id, task_prompt, group_folder,
           started_at, completed_at, duration_ms, status, result, error
    FROM job_runs
    ${whereClause}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `));

  const runs: JobRun[] = rows.map((r) => ({
    id: String(r.id),
    taskId: r.task_id,
    taskPrompt: r.task_prompt ? (r.task_prompt.length > 100 ? r.task_prompt.slice(0, 100) + "..." : r.task_prompt) : null,
    groupFolder: r.group_folder,
    startedAt: new Date(r.started_at).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    durationMs: r.duration_ms ? parseInt(r.duration_ms, 10) : null,
    status: r.status,
    result: r.result ? (r.result.length > 200 ? r.result.slice(0, 200) + "..." : r.result) : null,
    error: r.error,
  }));

  const result = ok(runs);

  if (runs.length > 0) {
    const errorCount = runs.filter(r => r.status === "error").length;
    const successCount = runs.filter(r => r.status === "success").length;
    result.hints.push(`${successCount} success, ${errorCount} error${errorCount !== 1 ? "s" : ""} in last ${runs.length} runs`);
  } else {
    result.hints.push("No job runs recorded yet");
  }

  return result;
}
