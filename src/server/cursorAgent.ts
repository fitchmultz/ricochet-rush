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
  classifyDesignerBrief,
  describeDesignerIntent,
  designerTargets,
  designerTargetsForGeneration,
  fallbackLevel,
  generationBrickBounds,
  nextDesignerSeed,
  normalizeDesignerIntent,
  normalizeLevel,
  normalizeLevelRequest,
  resolveDesignerIntentForGeneration,
  validateAndNormalizeSdkLevel,
  CURSOR_EVOLUTION_MAX_ATTEMPTS,
  CURSOR_GENERATION_BUDGET_MS,
  CURSOR_WORKER_TIMEOUT_MS,
  DESIGNER_BRICK_COLUMNS,
  DESIGNER_BRICK_ROWS
} from "../shared/evolution.js";
import { isRecord } from "../shared/util.js";

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

export { CURSOR_EVOLUTION_MAX_ATTEMPTS, CURSOR_GENERATION_BUDGET_MS } from "../shared/evolution.js";

const CURSOR_WORKER_SIGKILL_GRACE_MS = 5_000;
const MAX_EVOLUTION_ATTEMPTS = CURSOR_EVOLUTION_MAX_ATTEMPTS;

export interface RequestEvolutionOptions {
  maxAttempts?: number;
  runWorker?: typeof runCursorWorker;
}

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

export async function requestEvolution(request: LevelRequest, options: RequestEvolutionOptions = {}): Promise<LevelResponse> {
  const maxAttempts = clampAttempts(options.maxAttempts ?? MAX_EVOLUTION_ATTEMPTS);
  const invokeWorker = options.runWorker ?? runCursorWorker;
  const resolvedRequest: LevelRequest = {
    ...request,
    designer: resolveDesignerIntentForGeneration(request.designer)
  };
  const prompt = buildPrompt(resolvedRequest);
  const apiKey = readCursorApiKey();

  if (process.env.RICOCHET_RUSH_FORCE_FALLBACK === "1") {
    const level = fallbackLevel(resolvedRequest);
    return {
      level,
      source: "fallback",
      model: CURSOR_MODEL,
      summary: buildGenerationSummary(resolvedRequest, level, "fallback", "Fallback mode is enabled."),
      warning: "Fallback forced by RICOCHET_RUSH_FORCE_FALLBACK."
    };
  }

  if (!apiKey) {
    const warning = "Cursor SDK authentication is unavailable.";
    const requestJson = JSON.stringify(resolvedRequest);
    const now = Date.now();
    const trace = toTrace(resolvedRequest, requestJson, prompt, {
      parsed: null,
      parseStatus: "worker-failed",
      parseError: warning,
      rawOutput: "",
      rawError: warning,
      startedAt: now,
      finishedAt: now,
      workerExitCode: null
    });
    const level = fallbackLevel(resolvedRequest);
    return {
      level,
      source: "fallback",
      model: CURSOR_MODEL,
      summary: buildGenerationSummary(resolvedRequest, level, "fallback", warning, trace),
      warning,
      trace
    };
  }

  const attemptFailures: string[] = [];
  let lastTrace: ComposerAgentTrace | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptRequest = evolutionAttemptRequest(resolvedRequest, attempt);
    const attemptJson = JSON.stringify(attemptRequest);
    const attemptPrompt = buildPrompt(attemptRequest);

    try {
      const workerResult = await invokeWorker(attemptJson, apiKey);
      lastTrace = toTrace(attemptRequest, attemptJson, attemptPrompt, workerResult);

      if (workerResult.parseStatus !== "success") {
        const warning = summarizeLevelError(workerResult.parseError ?? "Cursor SDK worker failed.");
        attemptFailures.push(`attempt ${attempt}: ${warning}`);
        continue;
      }

      const validated = validateAndNormalizeSdkLevel(workerResult.parsed, attemptRequest);
      if (!validated.ok) {
        attemptFailures.push(`attempt ${attempt}: ${validated.reason}`);
        continue;
      }

      return {
        level: validated.level,
        source: "cursor-sdk",
        model: CURSOR_MODEL,
        summary: buildGenerationSummary(attemptRequest, validated.level, "cursor-sdk", undefined, lastTrace),
        trace: lastTrace
      };
    } catch (error) {
      const warning = summarizeLevelError(error);
      attemptFailures.push(`attempt ${attempt}: ${warning}`);
    }
  }

  const warning = summarizeEvolutionFailures(attemptFailures);
  const level = fallbackLevel(resolvedRequest);
  return {
    level,
    source: "fallback",
    model: CURSOR_MODEL,
    summary: buildGenerationSummary(resolvedRequest, level, "fallback", warning, lastTrace),
    warning,
    trace: lastTrace
  };
}

export function buildPrompt(request: LevelRequest): string {
  const designer = resolveDesignerIntentForGeneration(request.designer);
  const targets = designerTargetsForGeneration(designer, request.level);
  const bounds = generationBrickBounds(designer);
  const classification = classifyDesignerBrief(designer.brief, designer.visualPreset);
  const playerPrompt = designer.brief || "None.";
  const requestContext = {
    level: request.level,
    score: request.score,
    lives: request.lives,
    clearedLevels: request.clearedLevels,
    recentEvents: request.recentEvents.slice(0, 3)
  };
  const previousBoardNames = clearedBoardNamesFromEvents(request.recentEvents);
  const avoidNames = previousBoardNames.length > 0 ? previousBoardNames.join(", ") : "none";
  const silhouetteMode = classification.mode === "silhouette";
  const exampleGrid = silhouetteMode ? SILHOUETTE_EXAMPLE_GRID : ARCADE_EXAMPLE_GRID;
  const brickRules = silhouetteMode
    ? [
        `- Creative/silhouette prompt: prefer ${bounds.min}-${bounds.max} bricks so the player prompt motif stays readable.`,
        `- Hard limits: at least ${bounds.min} and at most ${bounds.max} bricks. Do not pad into a solid mass.`,
        "- Match the player brief shape literally (face, logo, letter, object). Empty cells are part of the design."
      ]
    : [
        `- Use at least ${bounds.min} bricks and at most ${bounds.max} bricks.`,
        `- Target about ${targets.brickTarget} bricks when that fits the prompt.`
      ];
  const gridModeRules = silhouetteMode
    ? [
        "- Silhouette mode: prioritize readable outline and negative space over brick count.",
        "- Use a mixed grid with codes when the prompt assigns special bricks to specific features (eyes, mouth, core, accents).",
        "- Leave the center mostly empty when the prompt implies a face, logo, icon, or outline.",
        "- Do not fill the board into a solid blob; the motif must read from the playfield view.",
        "- The player brief overrides arcade wall habits, density targets, and style presets."
      ]
    : [
        "- Arcade mode: build a playable wall with lanes, shields, and rewards.",
        "- Uniform basic grids with \"brick\":\"basic\" and \"x\" cells are fine when the prompt does not require mixed kinds."
      ];

  return `You are the level designer for Ricochet Rush, a fast 3D brick-breaker with adaptive arcade boards.

Fast contract:
- You are composer-2.5 in fast mode.
- Return one compact JSON object only. No markdown, comments, prose, tool calls, shell commands, file inspection, or helper code.
- Keep the full response under 1,000 characters.
- Do not calculate exact brick counts. Do not verify with code. Pick a strong playable approximation and return immediately.
- The server rejects sparse, invalid, off-brief, or overfilled silhouette boards and will retry, so return a complete grid on the first try.
- Generate a fresh playable level that matches the player prompt. Avoid generic symmetric ovals unless the prompt asks for one.
- Make the level visually interesting in a 3D arcade arena: diagonals, holes, shields, weak spots, traps, rewards.
- Difficulty should rise, but the first ball must always have reachable targets.
- Never reuse a previous board name from this run. Previous names to avoid: ${avoidNames}.
- If a previous board was just cleared, change both the motif and the brick layout noticeably.

Game rules:
- Grid is ${DESIGNER_BRICK_COLUMNS} columns by ${DESIGNER_BRICK_ROWS} rows.
- Brick kinds: basic, hard, bomb, prize, penalty, laser, grab, fire, thru, split, wide, slow, boss.
- basic hp 1, hard hp 2-4, boss hp 5-12, all other special bricks hp 1.
- Use exactly ${DESIGNER_BRICK_ROWS} grid strings. Each string must be exactly ${DESIGNER_BRICK_COLUMNS} characters. Count every row before returning; pad with "." on the right or trim to ${DESIGNER_BRICK_COLUMNS}.
- If every occupied brick is the same kind, set "brick" to that kind and use "x" for occupied cells.
- For mixed grids, omit "brick" and use codes: b basic, h hard, o bomb, p prize, n penalty, l laser, g grab, f fire, t thru, s split, w wide, m slow, c boss.
${brickRules.join("\n")}
- Target about ${targets.specialTarget} specials and ${targets.hardTarget} hard bricks only when that does not fight the prompt.
- Use bombs sparingly unless the player prompt explicitly asks for bombs, exploding blocks, or bomb features.
- Leave some empty lanes for bank shots when the prompt allows it.
${gridModeRules.join("\n")}

Player board prompt:
- ${JSON.stringify(playerPrompt)}
- Brief guidance: ${describeBriefGuidance(designer.brief, designer.visualPreset)}.
- Priority order: player brief layout and motif, readable silhouette, playable lanes, rough tuning.
- If the prompt says "only", "all", "nothing but", or equivalent, every occupied brick must use that requested brick kind.
- For "exploding blocks" or "exploding eyes", use bomb (o) bricks at those features only unless the prompt says all bricks explode.

Tuning:
- ${targets.difficultyLabel} difficulty, speed near ${targets.speedTarget.toFixed(2)}, seed "${designer.seed}".
- Visual preset: ${designer.visualPreset === "icon" ? "icon / silhouette" : "arcade wall"}.
- Intent: ${describeDesignerIntent(designer)}.
- Run context: ${JSON.stringify(requestContext)}.

Return exactly this compact shape:
{
  "name": "short level name",
  "briefing": "one punchy sentence",
  "paddleHint": "one useful tactical hint",
  "speed": 1.0,
  ${exampleGrid}
}`;
}

const DESIGNER_PAD = ".".repeat(DESIGNER_BRICK_COLUMNS);

const ARCADE_EXAMPLE_GRID = `"brick": "basic",
  "grid": [
    "${DESIGNER_PAD}",
    "..xxxxxxxxxxxxxx....",
    ".xxxxxxxxxxxxxxxx...",
    ".xxxxxxxxxxxxxxxx...",
    "..xxxxxxxxxxxxxx....",
    "...xxxxxxxxxxxx.....",
    "....xxxxxxxxxx......",
    ".....xxxxxxxx.......",
    "......xxxxxx........",
    ".......xxxx.........",
    "........xx..........",
    "${DESIGNER_PAD}"
  ]`;

const SILHOUETTE_EXAMPLE_GRID = `"grid": [
    "${DESIGNER_PAD}",
    "....bb........oo....",
    "....bb........oo....",
    "...bb..........bb...",
    "..bbbbbbbbbbbbbb....",
    "...bbbbbbbbbbbb.....",
    "....bbbb..bbbb......",
    ".....bbbbbb.........",
    "......bbbb..........",
    ".......bb...........",
    "........b...........",
    "${DESIGNER_PAD}"
  ]`;

export function buildGenerationSummary(
  request: LevelRequest,
  level: LevelBlueprint,
  source: LevelResponse["source"],
  warning?: string,
  trace?: ComposerAgentTrace
): GenerationSummary {
  const designer = resolveDesignerIntentForGeneration(request.designer);
  const targets = designerTargetsForGeneration(designer, request.level);
  const brickCount = level.rows.flat().filter(Boolean).length;
  const sourceLabel = source === "cursor-sdk" ? "Board designer" : "Local backup";
  const classification = classifyDesignerBrief(designer.brief, designer.visualPreset);
  const modeLabel = designer.visualPreset === "icon" || classification.mode === "silhouette" ? "icon/silhouette" : "arcade";
  const promptLabel = designer.brief.trim()
    ? `your prompt: "${designer.brief.trim().slice(0, 88)}${designer.brief.trim().length > 88 ? "…" : ""}"`
    : "the default arcade brief";
  const fidelityNote =
    classification.mode === "silhouette"
      ? "Silhouette rules were applied so the wall should read like the brief."
      : "Arcade wall layout.";
  return {
    source,
    title: `${sourceLabel} · ${level.name}`,
    detail: `${sourceLabel} built "${level.name}" for ${promptLabel}. ${fidelityNote} ${source === "cursor-sdk" ? "Composer layout preserved." : "Local template backup."} Target was ${targets.brickTarget} bricks with about ${targets.specialTarget} specials; final wall has ${brickCount} playable bricks.`,
    chips: [
      designer.brief ? `prompt: ${designer.brief.trim().slice(0, 56)}${designer.brief.trim().length > 56 ? "…" : ""}` : "default prompt",
      modeLabel,
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
          // Pass the resolved API key explicitly so the worker subprocess does not depend on shell-inherited env.
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
      try {
        const parsed = JSON.parse(candidate);
        if (isRecord(parsed) && "parseStatus" in parsed) return normalizeWorkerEnvelope(parsed, candidate);
        return {
          parsed: extractParsedOutput(parsed),
          parseStatus: "success",
          rawOutput: candidate
        };
      } catch {
        continue;
      }
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

function clampAttempts(value: number): number {
  if (!Number.isFinite(value)) return MAX_EVOLUTION_ATTEMPTS;
  return Math.max(1, Math.min(5, Math.floor(value)));
}

function evolutionAttemptRequest(request: LevelRequest, attempt: number): LevelRequest {
  const base = resolveDesignerIntentForGeneration(request.designer);
  if (attempt <= 1) {
    return { ...request, designer: base };
  }
  return {
    ...request,
    designer: {
      ...base,
      seed: nextDesignerSeed(base.seed, request, attempt * 9_973)
    }
  };
}

function summarizeEvolutionFailures(failures: string[]): string {
  if (failures.length === 0) return "Cursor SDK request failed after retries.";
  const last = failures[failures.length - 1]?.replace(/^attempt \d+:\s*/, "") ?? "Cursor SDK request failed.";
  if (failures.length === 1) return last;
  return `${last} (${failures.length} composer-2.5 attempts).`;
}

function clearedBoardNamesFromEvents(events: string[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    const cleared = event.match(/^Cleared\s+(.+?)\.\s/i) ?? event.match(/^Cleared\s+(.+?)\.$/i);
    if (cleared?.[1]) names.add(cleared[1].trim());
  }
  return [...names].slice(0, 4);
}

function describeBriefGuidance(brief: string, visualPreset: "arcade" | "icon" = "arcade"): string {
  if (!brief.trim()) return "Follow the default arcade wall guidance.";
  const classification = classifyDesignerBrief(brief, visualPreset);
  const analysis = analyzeDesignerBrief(brief);
  const hints: string[] = [];
  if (classification.mode === "silhouette") {
    hints.push("Treat this as a silhouette or icon prompt with readable outline and negative space.");
  }
  if (analysis.exclusiveKind) {
    hints.push(`Every occupied brick must be ${analysis.exclusiveKind}.`);
  } else if (analysis.mentionedKinds.length > 1) {
    hints.push(`Use mixed grid codes. Mentioned kinds: ${analysis.mentionedKinds.join(", ")}. Place specials only where the prompt implies.`);
  } else if (analysis.preferredKind) {
    hints.push(`Use ${analysis.preferredKind} only for the feature the prompt calls for; fill the rest with basic unless mixed grid is clearer.`);
  }
  if (/\b(eyes?)\b/i.test(brief) && analysis.mentionedKinds.includes("bomb")) {
    hints.push("Exploding eyes should be bomb (o) cells at the eye positions only.");
  }
  return hints.length > 0 ? hints.join(" ") : "Follow the player brief literally for layout, motif, and brick placement.";
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
