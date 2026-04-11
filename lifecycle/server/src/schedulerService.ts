import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { HttpError } from "./httpError";
import { db, lifecycleRoot, repository, workspaceRoot } from "./legacy";

type SchedulerPhase =
  | "idle"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
type SchedulerRunStatus = "running" | "succeeded" | "failed" | "interrupted";

interface SchedulerStartInput {
  runCount?: unknown;
  itemsPerRun?: unknown;
  gapMinutes?: unknown;
}

interface SchedulerRunRecord {
  runNumber: number;
  status: SchedulerRunStatus;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  summary: unknown;
  error: string | null;
  stderrTail: string;
}

interface SchedulerPersistedRunItem {
  id: string | number;
  schedulerRunId: string | number;
  workerRunId: string | number | null;
  runNumber: number;
  status: SchedulerRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  stderrTail: string | null;
  summary: unknown;
}

interface SchedulerPersistedRun {
  id: string | number;
  status: SchedulerPhase;
  totalRuns: number;
  completedRuns: number;
  itemsPerRun: number;
  gapMinutes: number;
  currentRun: number | null;
  startedAt: string | null;
  activeRunStartedAt: string | null;
  nextRunAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  lastError: string | null;
  summary: unknown;
  items: SchedulerPersistedRunItem[];
}

interface SchedulerState {
  schedulerRunId: string | number | null;
  running: boolean;
  phase: SchedulerPhase;
  totalRuns: number;
  completedRuns: number;
  currentRun: number | null;
  itemsPerRun: number;
  gapMinutes: number;
  startedAt: string | null;
  activeRunStartedAt: string | null;
  nextRunAt: string | null;
  finishedAt: string | null;
  cancelRequested: boolean;
  lastResult: unknown;
  lastError: string | null;
  history: SchedulerRunRecord[];
  persistedRuns: SchedulerPersistedRun[];
}

interface SearchBatchOutcome {
  summary: unknown;
  exitCode: number | null;
  signal: string | null;
  stderrTail: string;
}

const MAX_LOG_TAIL_BYTES = 20_000;
const MAX_HISTORY_ITEMS = 20;
const PERSISTED_HISTORY_LIMIT = 20;

const {
  createSchedulerRun,
  createSchedulerRunItem,
  fetchSchedulerRuns,
  finishSchedulerRunItem,
  markInterruptedSchedulerRuns,
  updateSchedulerRun,
} = repository;
const { query, withTransaction } = db;

let state: SchedulerState = createIdleState();
let waitTimer: NodeJS.Timeout | null = null;
let resolveWait: (() => void) | null = null;
let activeChild: ChildProcess | null = null;
let shuttingDown = false;

function createIdleState(): SchedulerState {
  return {
    schedulerRunId: null,
    running: false,
    phase: "idle",
    totalRuns: 0,
    completedRuns: 0,
    currentRun: null,
    itemsPerRun: 0,
    gapMinutes: 0,
    startedAt: null,
    activeRunStartedAt: null,
    nextRunAt: null,
    finishedAt: null,
    cancelRequested: false,
    lastResult: null,
    lastError: null,
    history: [],
    persistedRuns: [],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeInteger(
  value: unknown,
  field: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${field} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function normalizeStartInput(input: SchedulerStartInput) {
  const runCount = normalizeInteger(input.runCount, "runCount", 1, 1, 50);
  return {
    runCount,
    itemsPerRun: normalizeInteger(input.itemsPerRun, "itemsPerRun", 5, 1, 50),
    gapMinutes: runCount > 1 ? normalizeInteger(input.gapMinutes, "gapMinutes", 10, 1, 1440) : 0,
  };
}

function appendTail(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString("utf8")}`.slice(-MAX_LOG_TAIL_BYTES);
}

function parseJsonSummary(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.lastIndexOf("\n{");
    if (objectStart >= 0) {
      try {
        return JSON.parse(trimmed.slice(objectStart + 1));
      } catch {
        return trimmed.slice(-MAX_LOG_TAIL_BYTES);
      }
    }
    return trimmed.slice(-MAX_LOG_TAIL_BYTES);
  }
}

function extractWorkerRunId(summary: unknown): number | null {
  if (!summary || typeof summary !== "object" || !("workerRunId" in summary)) {
    return null;
  }
  const parsed = Number((summary as { workerRunId?: unknown }).workerRunId);
  return Number.isInteger(parsed) ? parsed : null;
}

function mapPersistedRunItem(row: any): SchedulerPersistedRunItem {
  return {
    id: row.id,
    schedulerRunId: row.scheduler_run_id,
    workerRunId: row.worker_run_id || null,
    runNumber: row.run_number,
    status: row.status,
    startedAt: isoOrNull(row.started_at),
    finishedAt: isoOrNull(row.finished_at),
    durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
    exitCode: row.exit_code,
    signal: row.signal,
    error: row.error,
    stderrTail: row.stderr_tail,
    summary: row.summary,
  };
}

function mapPersistedRun(row: any): SchedulerPersistedRun {
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    id: row.id,
    status: row.status,
    totalRuns: row.total_runs,
    completedRuns: row.completed_runs,
    itemsPerRun: row.items_per_run,
    gapMinutes: row.gap_minutes,
    currentRun: row.current_run,
    startedAt: isoOrNull(row.started_at),
    activeRunStartedAt: isoOrNull(row.active_run_started_at),
    nextRunAt: isoOrNull(row.next_run_at),
    finishedAt: isoOrNull(row.finished_at),
    cancelRequested: Boolean(row.cancel_requested),
    lastError: row.last_error,
    summary: row.summary,
    items: items.map(mapPersistedRunItem),
  };
}

async function fetchPersistedHistory(): Promise<SchedulerPersistedRun[]> {
  const rows = await fetchSchedulerRuns({ query }, PERSISTED_HISTORY_LIMIT);
  return rows.map(mapPersistedRun);
}

async function snapshot(): Promise<SchedulerState> {
  return {
    ...state,
    history: state.history.map((record) => ({ ...record })),
    persistedRuns: await fetchPersistedHistory(),
  };
}

function finishWaiting(): void {
  if (waitTimer) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
  if (resolveWait) {
    const resolver = resolveWait;
    resolveWait = null;
    resolver();
  }
}

function waitForNextRun(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    resolveWait = () => {
      resolveWait = null;
      resolve();
    };
    waitTimer = setTimeout(() => {
      waitTimer = null;
      if (resolveWait) {
        const resolver = resolveWait;
        resolveWait = null;
        resolver();
      }
    }, delayMs);
  });
}

function trackHistory(record: SchedulerRunRecord): SchedulerRunRecord {
  state.history = [record, ...state.history].slice(0, MAX_HISTORY_ITEMS);
  return record;
}

async function runSearchBatch(
  schedulerRunItemId: string | number,
  runNumber: number,
  itemsPerRun: number,
): Promise<SearchBatchOutcome> {
  const startedAt = nowIso();
  const runRecord = trackHistory({
    runNumber,
    status: "running",
    startedAt,
    finishedAt: null,
    exitCode: null,
    signal: null,
    summary: null,
    error: null,
    stderrTail: "",
  });

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(
      process.execPath,
      [path.join(lifecycleRoot, "search_batch.js"), "--limit", String(itemsPerRun)],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          TARS_LIFECYCLE_SEARCH_BATCH_SIZE: String(itemsPerRun),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeChild = child;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendTail(stderr, chunk);
      runRecord.stderrTail = stderr;
    });

    child.once("error", async (error) => {
      if (settled) return;
      settled = true;
      if (activeChild === child) activeChild = null;
      runRecord.status = "failed";
      runRecord.finishedAt = nowIso();
      runRecord.error = error.message;
      runRecord.stderrTail = stderr;
      if (!shuttingDown) {
        await withTransaction((client: any) => finishSchedulerRunItem(client, schedulerRunItemId, {
          status: "failed",
          error: error.message,
          stderrTail: stderr,
        })).catch(() => {});
      }
      reject(error);
    });

    child.once("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      if (activeChild === child) activeChild = null;
      const summary = parseJsonSummary(stdout);
      const workerRunId = extractWorkerRunId(summary);
      const failed = code !== 0;
      const message = failed
        ? `Search batch run ${runNumber} failed with exit code ${code ?? "null"}${signal ? ` (${signal})` : ""}.`
        : null;

      runRecord.finishedAt = nowIso();
      runRecord.exitCode = code;
      runRecord.signal = signal;
      runRecord.summary = summary;
      runRecord.stderrTail = stderr;
      runRecord.status = failed ? "failed" : "succeeded";
      runRecord.error = message;

      if (!shuttingDown) {
        await withTransaction((client: any) => finishSchedulerRunItem(client, schedulerRunItemId, {
          status: failed ? "failed" : "succeeded",
          workerRunId,
          exitCode: code,
          signal,
          error: message,
          stderrTail: stderr,
          summary: {
            result: summary,
          },
        })).catch(() => {});
      }

      if (failed) {
        reject(new Error(`${message}${stderr ? `\n${stderr.slice(-2000)}` : ""}`));
        return;
      }

      resolve({
        summary,
        exitCode: code,
        signal,
        stderrTail: stderr,
      });
    });
  });
}

async function runSchedulerLoop(schedulerRunId: string | number): Promise<void> {
  try {
    for (let runNumber = 1; runNumber <= state.totalRuns; runNumber += 1) {
      if (state.cancelRequested) break;

      const activeRunStartedAt = nowIso();
      state.phase = "running";
      state.currentRun = runNumber;
      state.activeRunStartedAt = activeRunStartedAt;
      state.nextRunAt = null;

      const item = await withTransaction((client: any) => Promise.all([
        updateSchedulerRun(client, schedulerRunId, {
          status: "running",
          currentRun: runNumber,
          activeRunStartedAt,
          nextRunAt: null,
          lastError: null,
          summary: {
            phase: "running",
          },
        }),
        createSchedulerRunItem(client, {
          schedulerRunId,
          runNumber,
          status: "running",
          summary: {
            itemsPerRun: state.itemsPerRun,
          },
        }),
      ])).then(([, createdItem]: any[]) => createdItem);

      const outcome = await runSearchBatch(item.id, runNumber, state.itemsPerRun);
      state.lastResult = outcome.summary;
      state.lastError = null;
      state.completedRuns = runNumber;
      state.activeRunStartedAt = null;

      await withTransaction((client: any) => updateSchedulerRun(client, schedulerRunId, {
        completedRuns: runNumber,
        currentRun: null,
        activeRunStartedAt: null,
        lastError: null,
        summary: {
          lastResult: outcome.summary,
        },
      }));

      if (state.cancelRequested || runNumber >= state.totalRuns) break;

      const nextRunAt = new Date(Date.now() + state.gapMinutes * 60_000).toISOString();
      state.phase = "waiting";
      state.nextRunAt = nextRunAt;
      await withTransaction((client: any) => updateSchedulerRun(client, schedulerRunId, {
        status: "waiting",
        currentRun: null,
        activeRunStartedAt: null,
        nextRunAt,
        summary: {
          phase: "waiting",
        },
      }));
      await waitForNextRun(state.gapMinutes * 60_000);
    }

    state.running = false;
    state.phase = state.cancelRequested ? "cancelled" : "completed";
    state.currentRun = null;
    state.activeRunStartedAt = null;
    state.nextRunAt = null;
    state.finishedAt = nowIso();

    await withTransaction((client: any) => updateSchedulerRun(client, schedulerRunId, {
      status: state.phase,
      completedRuns: state.completedRuns,
      currentRun: null,
      activeRunStartedAt: null,
      nextRunAt: null,
      markFinished: true,
      cancelRequested: state.cancelRequested,
      lastError: state.lastError,
      summary: {
        lastResult: state.lastResult,
      },
    }));
  } catch (error) {
    state.running = false;
    state.phase = state.cancelRequested ? "cancelled" : "failed";
    state.currentRun = null;
    state.activeRunStartedAt = null;
    state.nextRunAt = null;
    state.finishedAt = nowIso();
    state.lastError = error instanceof Error ? error.message : String(error);

    await withTransaction((client: any) => updateSchedulerRun(client, schedulerRunId, {
      status: state.phase,
      completedRuns: state.completedRuns,
      currentRun: null,
      activeRunStartedAt: null,
      nextRunAt: null,
      markFinished: true,
      cancelRequested: state.cancelRequested,
      lastError: state.lastError,
      summary: {
        lastError: state.lastError,
      },
    })).catch(() => {});
  } finally {
    finishWaiting();
  }
}

export async function initializeSchedulerHistory(): Promise<void> {
  await withTransaction((client: any) => markInterruptedSchedulerRuns(client));
}

export async function getSchedulerStatus(): Promise<SchedulerState> {
  return snapshot();
}

export async function startScheduler(input: SchedulerStartInput = {}): Promise<SchedulerState> {
  if (state.running) {
    throw new HttpError(409, "Scheduler is already running.");
  }

  const options = normalizeStartInput(input);
  const schedulerRun = await withTransaction((client: any) => createSchedulerRun(client, {
    status: "running",
    totalRuns: options.runCount,
    completedRuns: 0,
    itemsPerRun: options.itemsPerRun,
    gapMinutes: options.gapMinutes,
    currentRun: null,
    summary: {
      source: "dashboard",
    },
  }));

  state = {
    ...createIdleState(),
    schedulerRunId: schedulerRun.id,
    running: true,
    phase: "running",
    totalRuns: schedulerRun.total_runs,
    itemsPerRun: schedulerRun.items_per_run,
    gapMinutes: schedulerRun.gap_minutes,
    startedAt: isoOrNull(schedulerRun.started_at),
  };

  void runSchedulerLoop(schedulerRun.id);
  return snapshot();
}

export async function cancelScheduler(): Promise<SchedulerState> {
  if (!state.running) {
    return snapshot();
  }

  state.cancelRequested = true;
  if (state.schedulerRunId) {
    await withTransaction((client: any) => updateSchedulerRun(client, state.schedulerRunId, {
      cancelRequested: true,
      summary: {
        cancelRequestedAt: nowIso(),
      },
    }));
  }

  if (state.phase === "waiting") {
    finishWaiting();
  }

  return snapshot();
}

export async function shutdownScheduler(): Promise<void> {
  shuttingDown = true;
  state.cancelRequested = true;
  finishWaiting();
  await withTransaction((client: any) => markInterruptedSchedulerRuns(client)).catch(() => {});

  if (activeChild && !activeChild.killed) {
    activeChild.kill("SIGTERM");
  }
}
