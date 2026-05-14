import { spawn } from "node:child_process";
import {
  BRICK_COLUMNS,
  BRICK_ROWS,
  CURSOR_MODEL,
  MAX_BRICKS,
  MIN_BRICKS,
  type ComposerAgentTrace,
  type ComposerStreamStats,
  type GenerationSummary,
  type LevelBlueprint,
  type LevelRequest,
  type LevelResponse,
  analyzeDesignerBrief,
  describeDesignerIntent,
  designerTargets,
  fallbackLevel,
  normalizeDesignerIntent,
  normalizeLevel
} from "../shared/evolution.js";

export interface WorkerInvocationResult {
  parsed: unknown | null;
  parseStatus: "success" | "parse-failed" | "worker-failed";
  parseError?: string;
  rawOutput: string;
  rawError: string;
  startedAt: number;
  finishedAt: number;
  workerExitCode?: number | null;
  streamStats?: ComposerStreamStats;
}

interface CursorWorkerEnvelope {
  parsed: unknown | null;
  parseStatus: "success" | "parse-failed";
  parseError?: string;
  rawOutput: string;
  streamError?: string;
  durationMs?: number;
  streamStats?: ComposerStreamStats;
}

const CURSOR_WORKER_TIMEOUT_MS = 60_000;
const CURSOR_WORKER_SIGKILL_GRACE_MS = 5_000;

interface CursorWorkerProcess {
  stdout: { setEncoding: (encoding: BufferEncoding) => void; on: (event: "data", listener: (chunk: string) => void) => unknown };
  stderr: { setEncoding: (encoding: BufferEncoding) => void; on: (event: "data", listener: (chunk: string) => void) => unknown };
  stdin: { end: (data: string) => unknown };
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill: (signal: NodeJS.Signals) => boolean;
}

interface RunCursorWorkerOptions {
  timeoutMs?: number;
  sigkillGraceMs?: number;
  spawnWorker?: () => CursorWorkerProcess;
}

export async function requestEvolution(request: LevelRequest): Promise<LevelResponse> {
  const requestJson = JSON.stringify(request);
  const prompt = buildPrompt(request);
  const apiKey = readCursorApiKey();

  if (process.env.RICOCHET_RUSH_FORCE_FALLBACK === "1") {
    const level = fallbackLevel(request);
    return {
      level,
      source: "fallback",
      model: CURSOR_MODEL,
      summary: buildGenerationSummary(request, level, "fallback", "Fallback mode is enabled."),
      warning: "Fallback forced by RICOCHET_RUSH_FORCE_FALLBACK."
    };
  }

  if (!apiKey) {
    const warning = "Cursor SDK authentication is unavailable.";
    const now = Date.now();
    const trace = toTrace(request, requestJson, prompt, {
      parsed: null,
      parseStatus: "worker-failed",
      parseError: warning,
      rawOutput: "",
      rawError: warning,
      startedAt: now,
      finishedAt: now,
      workerExitCode: null
    });
    const level = fallbackLevel(request);
    return {
      level,
      source: "fallback",
      model: CURSOR_MODEL,
      summary: buildGenerationSummary(request, level, "fallback", warning, trace),
      warning,
      trace
    };
  }

  try {
    const workerResult = await runCursorWorker(requestJson, apiKey);
    const trace = toTrace(request, requestJson, prompt, workerResult);

    if (workerResult.parseStatus === "success") {
      const level = normalizeLevel(workerResult.parsed, request);
      return {
        level,
        source: "cursor-sdk",
        model: CURSOR_MODEL,
        summary: buildGenerationSummary(request, level, "cursor-sdk", undefined, trace),
        trace
      };
    }
    const warning = summarizeLevelError(workerResult.parseError ?? "Cursor SDK worker failed.");
    const level = fallbackLevel(request);

    return {
      level,
      source: "fallback",
      model: CURSOR_MODEL,
      summary: buildGenerationSummary(request, level, "fallback", warning, trace),
      warning,
      trace
    };
  } catch (error) {
    const warning = summarizeLevelError(error);
    const level = fallbackLevel(request);
    return {
      level,
      source: "fallback",
      model: CURSOR_MODEL,
      summary: buildGenerationSummary(request, level, "fallback", warning),
      warning
    };
  }
}

export function buildPrompt(request: LevelRequest): string {
  const designer = normalizeDesignerIntent(request.designer);
  const targets = designerTargets(designer, request.level);
  const playerPrompt = designer.brief || "None.";
  const requestContext = {
    level: request.level,
    score: request.score,
    lives: request.lives,
    clearedLevels: request.clearedLevels,
    recentEvents: request.recentEvents.slice(0, 3)
  };
  return `You are the level designer for Ricochet Rush, a fast 3D brick-breaker with adaptive arcade boards.

Fast contract:
- You are composer-2 in fast mode.
- Return one compact JSON object only. No markdown, comments, prose, tool calls, shell commands, file inspection, or helper code.
- Keep the full response under 1,000 characters.
- Do not calculate exact brick counts. Do not verify with code. Pick a strong playable approximation and return immediately.
- The server validates, repairs, and rejects unsafe boards, so do not spend time proving the grid.
- Generate a fresh playable level, not a generic rectangle and not a board that instantly clears.
- Make the level visually interesting in a 3D arcade arena: diagonals, holes, shields, weak spots, traps, rewards.
- Difficulty should rise, but the first ball must always have reachable targets.

Game rules:
- Grid is ${BRICK_COLUMNS} columns by ${BRICK_ROWS} rows.
- Brick kinds: basic, hard, bomb, prize, penalty, laser, grab, fire, thru, split, wide, slow, boss.
- basic hp 1, hard hp 2-4, boss hp 5-12, all other special bricks hp 1.
- Use exactly 9 grid strings. Each string must be exactly 14 characters. "." means empty.
- If every occupied brick is the same kind, set "brick" to that kind and use "x" for occupied cells.
- For mixed grids, omit "brick" and use codes: b basic, h hard, o bomb, p prize, n penalty, l laser, g grab, f fire, t thru, s split, w wide, m slow, c boss.
- Use at least ${MIN_BRICKS} bricks and at most ${MAX_BRICKS} bricks. This is mandatory; too few or too many bricks are rejected.
- Target about ${targets.brickTarget} bricks, but any count inside ${MIN_BRICKS}-${MAX_BRICKS} is acceptable if the motif is clear.
- Target about ${targets.specialTarget} specials and ${targets.hardTarget} hard bricks only when that does not fight the prompt.
- Use bombs sparingly unless the player prompt explicitly asks for bombs, exploding blocks, or all-bomb boards.
- Leave some empty lanes for bank shots.

Player board prompt:
- ${JSON.stringify(playerPrompt)}
- Prompt locks: ${describePromptLocks(designer.brief)}.
- Priority order: prompt shape/material, playable lanes, rough tuning. Exact density, special count, and hard count are soft.
- If the prompt says "only", "all", "nothing but", or equivalent, every occupied brick must use that requested brick kind.
- For "exploding blocks", use bomb bricks.

Tuning:
- ${targets.difficultyLabel} difficulty, speed near ${targets.speedTarget.toFixed(2)}, seed "${designer.seed}".
- Intent: ${describeDesignerIntent(designer)}.
- Run context: ${JSON.stringify(requestContext)}.

Return exactly this compact shape:
{
  "name": "short level name",
  "briefing": "one punchy sentence",
  "paddleHint": "one useful tactical hint",
  "speed": 1.0,
  "brick": "basic",
  "grid": [
    "..............",
    "..xxxx..xxxx..",
    ".xxxxxxxxxxxx.",
    ".xxxxxxxxxxxx.",
    "..xxxxxxxxxx..",
    "...xxxxxxxx...",
    "....xxxxxx....",
    ".....xxxx.....",
    ".............."
  ]
}`;
}

export function buildGenerationSummary(
  request: LevelRequest,
  level: LevelBlueprint,
  source: LevelResponse["source"],
  warning?: string,
  trace?: ComposerAgentTrace
): GenerationSummary {
  const designer = normalizeDesignerIntent(request.designer);
  const targets = designerTargets(designer, request.level);
  const brickCount = level.rows.flat().filter(Boolean).length;
  const sourceLabel = source === "cursor-sdk" ? "Board designer" : "Local backup";
  return {
    source,
    title: `${sourceLabel} board`,
    detail: `${sourceLabel} built ${level.name} from ${describeDesignerIntent(designer)}. Target was ${targets.brickTarget} bricks with about ${targets.specialTarget} specials; final wall has ${brickCount} playable bricks.`,
    chips: [
      designer.brief ? "prompt" : "default prompt",
      `difficulty ${designer.difficulty}/5`,
      `${Math.round(designer.density * 100)}% density`,
      `${Math.round(designer.specialBias * 100)}% specials`,
      trace ? `${trace.durationMs}ms` : "local"
    ],
    warning
  };
}

export function summarizeLevelError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/unauthenticated|authentication|api key|required for cloud operations/i.test(message)) {
    return "Cursor SDK authentication is unavailable.";
  }
  if (/agent[_ -]?busy|active run/i.test(message)) return "Cursor SDK agent is busy.";
  if (/stream_buffer_overflow|message buffer overflow/i.test(message)) return "Cursor SDK stream buffer overflowed.";
  if (/invalid_model|model .*not available|model id is required/i.test(message)) return "Cursor SDK model is unavailable.";
  if (/timed out/i.test(message)) return "Cursor SDK worker timed out.";
  if (/JSON/i.test(message)) return "Cursor SDK returned invalid JSON.";
  const firstLine = message.split("\n").find((line) => line.trim().length > 0)?.trim();
  return firstLine ? firstLine.slice(0, 140) : "Cursor SDK request failed.";
}

function readCursorApiKey(): string | undefined {
  const value = process.env.CURSOR_API_KEY?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function runCursorWorker(requestJson: string, apiKey: string, options: RunCursorWorkerOptions = {}): Promise<WorkerInvocationResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? CURSOR_WORKER_TIMEOUT_MS;
    const sigkillGraceMs = options.sigkillGraceMs ?? CURSOR_WORKER_SIGKILL_GRACE_MS;
    const startedAt = Date.now();
    const worker: CursorWorkerProcess = options.spawnWorker
      ? options.spawnWorker()
      : spawn(process.execPath, ["--import", "tsx", "src/server/cursorWorker.ts"], {
          cwd: process.cwd(),
          env: {
            ...process.env,
            CURSOR_API_KEY: apiKey
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let killTimeout: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = (includeKillTimeout = true): void => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (includeKillTimeout && killTimeout) {
        clearTimeout(killTimeout);
        killTimeout = undefined;
      }
    };

    const finish = (result: WorkerInvocationResult, options: { keepKillTimeout?: boolean } = {}): void => {
      if (settled) return;
      settled = true;
      clearTimers(!options.keepKillTimeout);
      resolve(result);
    };

    timeout = setTimeout(() => {
      timeout = undefined;
      worker.kill("SIGTERM");
      killTimeout = setTimeout(() => {
        worker.kill("SIGKILL");
      }, sigkillGraceMs);
      killTimeout.unref?.();
      finish({
        parsed: null,
        parseStatus: "worker-failed",
        parseError: "Cursor SDK worker timed out.",
        rawOutput: stdout,
        rawError: stderr.trim(),
        startedAt,
        finishedAt: Date.now(),
        workerExitCode: null
      }, { keepKillTimeout: true });
    }, timeoutMs);

    worker.stdout.setEncoding("utf8");
    worker.stderr.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    worker.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    worker.on("error", (error) => {
      clearTimers();
      finish({
        parsed: null,
        parseStatus: "worker-failed",
        parseError: error.message,
        rawOutput: stdout,
        rawError: `${stderr}\n${error.message}`.trim(),
        startedAt,
        finishedAt: Date.now()
      });
    });
    worker.on("close", (code) => {
      clearTimers();
      if (settled) return;
      if (code !== 0) {
        finish({
          parsed: null,
          parseStatus: "worker-failed",
          parseError: stderr.trim() || `Cursor SDK worker exited with ${code}.`,
          rawOutput: stdout,
          rawError: stderr,
          startedAt,
          finishedAt: Date.now(),
          workerExitCode: code
        });
        return;
      }
      try {
        const envelope = parseWorkerEnvelope(stdout);
        const streamNote = envelope.streamError ? `Stream warning: ${envelope.streamError}` : "";
        finish({
          parsed: envelope.parsed,
          parseStatus: envelope.parseStatus,
          parseError: envelope.parseError,
          rawOutput: envelope.rawOutput || stdout,
          rawError: [stderr.trim(), streamNote].filter(Boolean).join("\n"),
          startedAt,
          finishedAt: Date.now(),
          streamStats: envelope.streamStats
        });
      } catch (error) {
        finish({
          parsed: null,
          parseStatus: "parse-failed",
          parseError: error instanceof Error ? error.message : String(error),
          rawOutput: stdout,
          rawError: stderr,
          startedAt,
          finishedAt: Date.now()
        });
      }
    });

    worker.stdin.end(requestJson);
  });
}

export function parseWorkerOutput(stdout: string): unknown {
  return parseWorkerEnvelope(stdout).parsed;
}

function parseWorkerEnvelope(stdout: string): CursorWorkerEnvelope {
  for (const line of stdout
    .trim()
    .split(/\r?\n/)
    .reverse()) {
    const candidate = line.trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      const parsed = JSON.parse(candidate);
      if (isRecord(parsed) && "parseStatus" in parsed) return normalizeWorkerEnvelope(parsed, candidate);
      return {
        parsed: extractParsedOutput(parsed),
        parseStatus: "success",
        rawOutput: candidate
      };
    }
  }
  throw new Error("Cursor SDK worker did not return JSON.");
}

function normalizeWorkerEnvelope(payload: Record<string, unknown>, fallbackRawOutput: string): CursorWorkerEnvelope {
  const parseStatus = payload.parseStatus === "parse-failed" ? "parse-failed" : "success";
  return {
    parsed: "parsed" in payload ? payload.parsed : null,
    parseStatus,
    parseError: typeof payload.parseError === "string" ? payload.parseError : undefined,
    rawOutput: typeof payload.rawOutput === "string" ? payload.rawOutput : fallbackRawOutput,
    streamError: typeof payload.streamError === "string" ? payload.streamError : undefined,
    durationMs: typeof payload.durationMs === "number" && Number.isFinite(payload.durationMs) ? payload.durationMs : undefined,
    streamStats: normalizeStreamStats(payload.streamStats)
  };
}

function extractParsedOutput(payload: unknown): unknown {
  if (isRecord(payload) && "parsed" in payload) {
    return payload.parsed;
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describePromptLocks(brief: string): string {
  const analysis = analyzeDesignerBrief(brief);
  const locks: string[] = [];
  if (analysis.shape) locks.push(`shape=${analysis.shape}`);
  if (analysis.exclusiveKind) locks.push(`exclusive occupied brick kind=${analysis.exclusiveKind}`);
  else if (analysis.preferredKind) locks.push(`preferred brick kind=${analysis.preferredKind}`);
  else if (analysis.mentionedKinds.length > 1) locks.push(`components=${analysis.mentionedKinds.join(",")}`);
  return locks.length > 0 ? locks.join(", ") : "none";
}

function normalizeStreamStats(input: unknown): ComposerStreamStats | undefined {
  if (!isRecord(input)) return undefined;
  const firstToolCalls = Array.isArray(input.firstToolCalls)
    ? input.firstToolCalls.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
    : [];
  return {
    requestEvents: numberStat(input.requestEvents),
    statusEvents: numberStat(input.statusEvents),
    thinkingEvents: numberStat(input.thinkingEvents),
    assistantEvents: numberStat(input.assistantEvents),
    toolCallEvents: numberStat(input.toolCallEvents),
    taskEvents: numberStat(input.taskEvents),
    systemEvents: numberStat(input.systemEvents),
    userEvents: numberStat(input.userEvents),
    otherEvents: numberStat(input.otherEvents),
    firstToolCalls
  };
}

function numberStat(input: unknown): number {
  return typeof input === "number" && Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
}

function toTrace(
  request: LevelRequest,
  requestJson: string,
  prompt: string,
  result: WorkerInvocationResult
): ComposerAgentTrace {
  return {
    request,
    requestJson,
    prompt,
    parsedOutput: result.parseStatus === "success" ? result.parsed : undefined,
    rawOutput: truncateText(result.rawOutput, 40_000),
    rawError: truncateText(result.rawError, 10_000),
    parseStatus: result.parseStatus,
    parseError: result.parseError ? truncateText(result.parseError, 1_000) : undefined,
    durationMs: Math.max(0, result.finishedAt - result.startedAt),
    startedAt: new Date(result.startedAt).toISOString(),
    finishedAt: new Date(result.finishedAt).toISOString(),
    workerExitCode: result.workerExitCode ?? null,
    streamStats: result.streamStats
  };
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
