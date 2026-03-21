import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, createMockDbConfig, type MockDbConfig } from "../test-helpers.js";

let mockCfg: MockDbConfig;

vi.mock("../db/connection.js", async () => {
  const schema = await import("../db/schema.js");
  return {
    connect: () => createMockDb(mockCfg),
    audit: vi.fn().mockResolvedValue(undefined),
    performer: () => "cli:test",
    schema,
  };
});

const { jobsHistory } = await import("./history.js");

describe("jobs history", () => {
  beforeEach(() => {
    mockCfg = createMockDbConfig();
  });

  it("returns empty array when no job runs", async () => {
    mockCfg.executeResults = [];

    const result = await jobsHistory({});

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.hints.some(h => h.includes("No job runs"))).toBe(true);
  });

  it("returns job run entries", async () => {
    mockCfg.executeResults = [
      {
        id: "1",
        task_id: "task-001",
        task_prompt: "Check donations",
        group_folder: "test-group",
        started_at: "2026-03-15T10:00:00Z",
        completed_at: "2026-03-15T10:01:00Z",
        duration_ms: "60000",
        status: "success",
        result: "Completed OK",
        error: null,
      },
    ];

    const result = await jobsHistory({});

    expect(result.ok).toBe(true);
    expect(result.data.length).toBe(1);
    expect(result.data[0].taskId).toBe("task-001");
    expect(result.data[0].taskPrompt).toBe("Check donations");
    expect(result.data[0].status).toBe("success");
    expect(result.data[0].durationMs).toBe(60000);
    expect(result.data[0].error).toBeNull();
  });

  it("returns error job runs", async () => {
    mockCfg.executeResults = [
      {
        id: "2",
        task_id: "task-002",
        task_prompt: "Backup database",
        group_folder: "main",
        started_at: "2026-03-15T09:00:00Z",
        completed_at: "2026-03-15T09:00:05Z",
        duration_ms: "5000",
        status: "error",
        result: null,
        error: "Connection refused",
      },
    ];

    const result = await jobsHistory({});

    expect(result.ok).toBe(true);
    expect(result.data[0].status).toBe("error");
    expect(result.data[0].error).toBe("Connection refused");
    expect(result.data[0].result).toBeNull();
  });

  it("truncates long task prompts", async () => {
    const longPrompt = "A".repeat(200);
    mockCfg.executeResults = [
      {
        id: "3",
        task_id: "task-003",
        task_prompt: longPrompt,
        group_folder: "main",
        started_at: "2026-03-15T08:00:00Z",
        completed_at: "2026-03-15T08:05:00Z",
        duration_ms: "300000",
        status: "success",
        result: null,
        error: null,
      },
    ];

    const result = await jobsHistory({});

    expect(result.ok).toBe(true);
    expect(result.data[0].taskPrompt!.length).toBeLessThanOrEqual(103); // 100 + "..."
    expect(result.data[0].taskPrompt!.endsWith("...")).toBe(true);
  });

  it("truncates long results", async () => {
    const longResult = "B".repeat(300);
    mockCfg.executeResults = [
      {
        id: "4",
        task_id: "task-004",
        task_prompt: "Test",
        group_folder: "main",
        started_at: "2026-03-15T07:00:00Z",
        completed_at: null,
        duration_ms: null,
        status: "success",
        result: longResult,
        error: null,
      },
    ];

    const result = await jobsHistory({});

    expect(result.ok).toBe(true);
    expect(result.data[0].result!.length).toBeLessThanOrEqual(203); // 200 + "..."
    expect(result.data[0].result!.endsWith("...")).toBe(true);
  });

  it("handles null completed_at and duration_ms", async () => {
    mockCfg.executeResults = [
      {
        id: "5",
        task_id: "task-005",
        task_prompt: null,
        group_folder: null,
        started_at: "2026-03-15T06:00:00Z",
        completed_at: null,
        duration_ms: null,
        status: "error",
        result: null,
        error: "Timeout",
      },
    ];

    const result = await jobsHistory({});

    expect(result.ok).toBe(true);
    expect(result.data[0].completedAt).toBeNull();
    expect(result.data[0].durationMs).toBeNull();
    expect(result.data[0].taskPrompt).toBeNull();
    expect(result.data[0].groupFolder).toBeNull();
  });

  it("accepts task filter option", async () => {
    mockCfg.executeResults = [];

    const result = await jobsHistory({ task: "task-001" });

    expect(result.ok).toBe(true);
    // Filter is applied in SQL, mock returns empty
  });

  it("accepts status filter option", async () => {
    mockCfg.executeResults = [];

    const result = await jobsHistory({ status: "error" });

    expect(result.ok).toBe(true);
  });

  it("accepts from date filter option", async () => {
    mockCfg.executeResults = [];

    const result = await jobsHistory({ from: "2026-03-01" });

    expect(result.ok).toBe(true);
  });

  it("accepts limit option", async () => {
    mockCfg.executeResults = [];

    const result = await jobsHistory({ limit: 10 });

    expect(result.ok).toBe(true);
  });

  it("hints show success/error counts", async () => {
    mockCfg.executeResults = [
      {
        id: "1", task_id: "t1", task_prompt: "A", group_folder: "g",
        started_at: "2026-03-15T10:00:00Z", completed_at: "2026-03-15T10:01:00Z",
        duration_ms: "60000", status: "success", result: null, error: null,
      },
      {
        id: "2", task_id: "t2", task_prompt: "B", group_folder: "g",
        started_at: "2026-03-15T09:00:00Z", completed_at: "2026-03-15T09:00:05Z",
        duration_ms: "5000", status: "error", result: null, error: "fail",
      },
    ];

    const result = await jobsHistory({});

    expect(result.ok).toBe(true);
    expect(result.hints.some(h => h.includes("1 success") && h.includes("1 error"))).toBe(true);
  });

  it("defaults limit to 50", async () => {
    mockCfg.executeResults = [];

    const result = await jobsHistory({});

    // Function should run without error using default limit of 50
    expect(result.ok).toBe(true);
  });
});
