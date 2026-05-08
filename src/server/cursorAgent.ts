import { spawn } from "node:child_process";
import {
  BRICK_COLUMNS,
  BRICK_ROWS,
  CURSOR_MODEL,
  type ComposerAgentTrace,
  type GenerationSummary,
  type LevelBlueprint,
  type LevelRequest,
  type LevelResponse,
  describeDesignerIntent,
  fallbackLevel,
  normalizeDesignerIntent,
  normalizeLevel,
  designerStyleLabel
} from "../shared/evolution.js";

interface WorkerInvocationResult {
  parsed: unknown | null;
  parseStatus: "success" | "parse-failed" | "worker-failed";
  parseError?: string;
  rawOutput: string;
  rawError: string;
  startedAt: number;
  finishedAt: number;
  workerExitCode?: number | null;
}

export async function requestEvolution(request: LevelRequest): Promise<LevelResponse> {
  const requestJson = JSON.stringify(request);
  const prompt = buildPrompt(request);

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

  try {
    const workerResult = await runCursorWorker(request, prompt);
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
  const feedbackLines =
    designer.feedback.length > 0
      ? designer.feedback.map((entry) => `- ${entry.vote === "up" ? "Liked" : "Rejected"} ${entry.levelName} (${designerStyleLabel(entry.style)}, seed "${entry.seed}")`).join("\n")
      : "- No direct feedback yet.";
  return `You are the level designer for Ricochet Rush, a fast 3D brick-breaker with adaptive arcade boards.

Model contract:
- You are composer-2 in fast mode.
- Return only valid JSON. No markdown, no comments, no prose outside JSON.
- Generate a fresh playable level, not a generic rectangle and not a board that instantly clears.
- Make the level visually interesting in a 3D arcade arena: diagonals, holes, shields, weak spots, traps, rewards.
- Difficulty should rise, but the first ball must always have reachable targets.

Game rules:
- Grid is ${BRICK_COLUMNS} columns by ${BRICK_ROWS} rows.
- Brick kinds: basic, hard, bomb, prize, penalty, laser, grab, fire, thru, split, wide, slow, boss.
- basic hp 1, hard hp 2-4, boss hp 5-12, all other special bricks hp 1.
- null means empty space.
- Use at least 34 bricks and at most 86 bricks. This is mandatory; too few or too many bricks are rejected.
- Use bombs sparingly. Use powerup bricks enough to be fun.
- Leave some empty lanes for bank shots.

Visible design intent:
- Style: ${designerStyleLabel(designer.style)} (${designer.style}).
- Difficulty: ${designer.difficulty}/5.
- Target density: ${Math.round(designer.density * 100)}% of the board, still obeying the mandatory brick count.
- Special-brick bias: ${Math.round(designer.specialBias * 100)}%.
- Seed phrase: "${designer.seed}". Treat this as an arcade design motif, not random text to print.
- Intent summary: ${describeDesignerIntent(designer)}.

Recent player feedback:
${feedbackLines}

Current run:
${JSON.stringify(request, null, 2)}

Return this exact shape:
{
  "name": "short level name",
  "briefing": "one punchy sentence",
  "paddleHint": "one useful tactical hint",
  "speed": 1.0,
  "rows": [
    [null, {"kind":"basic","hp":1}]
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
  const brickCount = level.rows.flat().filter(Boolean).length;
  const sourceLabel = source === "cursor-sdk" ? "Cursor SDK" : "Local fallback";
  return {
    source,
    title: `${sourceLabel} board`,
    detail: `${sourceLabel} built ${level.name} from ${describeDesignerIntent(designer)}. Validation kept ${brickCount} playable bricks.`,
    chips: [
      designerStyleLabel(designer.style),
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
  if (/timed out/i.test(message)) return "Cursor SDK worker timed out.";
  if (/JSON/i.test(message)) return "Cursor SDK returned invalid JSON.";
  const firstLine = message.split("\n").find((line) => line.trim().length > 0)?.trim();
  return firstLine ? firstLine.slice(0, 140) : "Cursor SDK request failed.";
}

function runCursorWorker(request: LevelRequest, prompt: string): Promise<WorkerInvocationResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const worker = spawn(process.execPath, ["--import", "tsx", "src/server/cursorWorker.ts"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: WorkerInvocationResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timeout = setTimeout(() => {
      worker.kill("SIGTERM");
      finish({
        parsed: null,
        parseStatus: "worker-failed",
        parseError: "Cursor SDK worker timed out.",
        rawOutput: stdout,
        rawError: `Request prompt: ${prompt}\n${stderr}`.trim(),
        startedAt,
        finishedAt: Date.now(),
        workerExitCode: null
      });
    }, 90_000);

    worker.stdout.setEncoding("utf8");
    worker.stderr.setEncoding("utf8");
    worker.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    worker.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    worker.on("error", (error) => {
      clearTimeout(timeout);
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
      clearTimeout(timeout);
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
        const parsed = parseWorkerOutput(stdout);
        finish({
          parsed,
          parseStatus: "success",
          rawOutput: stdout,
          rawError: stderr,
          startedAt,
          finishedAt: Date.now()
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

    worker.stdin.end(JSON.stringify(request));
  });
}

export function parseWorkerOutput(stdout: string): unknown {
  for (const line of stdout
    .trim()
    .split(/\r?\n/)
    .reverse()) {
    const candidate = line.trim();
    if (candidate.startsWith("{") && candidate.endsWith("}")) {
      const parsed = JSON.parse(candidate);
      return extractParsedOutput(parsed);
    }
  }
  throw new Error("Cursor SDK worker did not return JSON.");
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
    workerExitCode: result.workerExitCode ?? null
  };
}

function truncateText(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}
