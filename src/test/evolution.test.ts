import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BRICK_COLUMNS,
  BRICK_ROWS,
  CURSOR_MODEL,
  DEFAULT_DESIGNER_INTENT,
  MAX_BRICKS,
  MIN_BRICKS,
  fallbackLevel,
  designerTargets,
  normalizeDesignerIntent,
  normalizeLevel,
  normalizeLevelRequest,
  type LevelBlueprint,
  type LevelRequest
} from "../shared/evolution";
import {
  BUILT_IN_PACKS,
  SAVED_DESIGNS_PACK_ID,
  markPackBoardCleared,
  materializeAuthoredBoard,
  normalizePackProgress,
  normalizeSavedBoards,
  previewRowsFromLevel
} from "../shared/boardPacks";
import { DEFAULT_SETTINGS, SAVE_VERSION, normalizeSaveState, normalizeSettings } from "../shared/saveState";
import { createApiServer } from "../server/api";
import { buildGenerationSummary, buildPrompt, parseWorkerOutput, requestEvolution, runCursorWorker, summarizeLevelError } from "../server/cursorAgent";
import { parseLevelJsonFromCandidates } from "../server/levelJson";
import { appendAssistantTextChunk } from "../server/streamText";
import {
  calculatePaddleRebound,
  normalizeLoopRiskVelocity,
  penaltyPowerupPool,
  powerupToneFor,
  prizePowerupPool
} from "../client/game/RicochetRushGame";
import { MUSIC_MASTER_GAIN, MUSIC_MELODY_PEAK, createGameAudio } from "../client/game/gameAudio";
import { levelGenerationTimeoutMessage, requestGeneratedLevel } from "../client/game/levelApi";

const request: LevelRequest = {
  level: 4,
  score: 2400,
  lives: 2,
  clearedLevels: 3,
  recentEvents: ["Wall cleared."]
};

const SPECIAL_TEST_BRICKS = new Set(["bomb", "prize", "penalty", "laser", "grab", "fire", "thru", "split", "wide", "slow", "boss"]);

function countBricks(level: LevelBlueprint): number {
  return level.rows.flat().filter(Boolean).length;
}

function countSpecials(level: LevelBlueprint): number {
  return level.rows.flat().filter((brick) => brick && SPECIAL_TEST_BRICKS.has(brick.kind)).length;
}

function countHardBricks(level: LevelBlueprint): number {
  return level.rows.flat().filter((brick) => brick?.kind === "hard").length;
}

class FakeAudioParam {
  readonly exponentialRamps: number[] = [];
  value = 1;

  cancelScheduledValues(): void {}

  setValueAtTime(value: number): void {
    this.value = value;
  }

  exponentialRampToValueAtTime(value: number): void {
    this.value = value;
    this.exponentialRamps.push(value);
  }
}

class FakeGainNode {
  readonly gain = new FakeAudioParam();

  connect(): void {}

  disconnect(): void {}
}

class FakeOscillatorNode {
  readonly frequency = new FakeAudioParam();
  type: OscillatorType = "sine";

  connect(): void {}

  disconnect(): void {}

  addEventListener(): void {}

  start(): void {}

  stop(): void {}
}

class FakeAudioContext {
  readonly createdGains: FakeGainNode[] = [];
  readonly destination = {};
  currentTime = 0;
  state: AudioContextState = "running";

  createGain(): GainNode {
    const gain = new FakeGainNode();
    this.createdGains.push(gain);
    return gain as unknown as GainNode;
  }

  createOscillator(): OscillatorNode {
    return new FakeOscillatorNode() as unknown as OscillatorNode;
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
}

function withFakeAudioWindow<T>(run: (context: FakeAudioContext) => T): T {
  const originalWindow = "window" in globalThis ? window : undefined;
  let context: FakeAudioContext | null = null;
  class TestAudioContext extends FakeAudioContext {
    constructor() {
      super();
      context = this;
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: {
      AudioContext: TestAudioContext as unknown as typeof AudioContext,
      setInterval: ((handler: TimerHandler) => {
        if (typeof handler === "function") handler();
        return 1;
      }) as typeof window.setInterval,
      clearInterval: (() => undefined) as typeof window.clearInterval
    } as unknown as Window
  });
  try {
    const audio = createGameAudio();
    audio.setMusicVolume(1);
    audio.unlock();
    if (!context) throw new Error("Fake AudioContext was not created.");
    return run(context);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: originalWindow
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

async function withApiServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createApiServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API test server did not expose a TCP port.");
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe("Cursor SDK level generation contract", () => {
  it("pins composer-2 fast mode for level requests", () => {
    expect(CURSOR_MODEL).toEqual({
      id: "composer-2",
      params: [{ id: "mode", value: "fast" }]
    });
    expect(buildPrompt(request)).toContain("composer-2 in fast mode");
    expect(buildPrompt(request)).toContain("Ricochet Rush");
    expect(buildPrompt(request)).toContain(`${MIN_BRICKS} bricks and at most ${MAX_BRICKS} bricks`);
    expect(buildPrompt(request)).toContain("Do not calculate exact brick counts");
  });

  it("adds the board prompt and hidden tuning defaults to the Cursor prompt", () => {
    const prompt = buildPrompt({
      ...request,
      designer: {
        style: "bomb-chains",
        difficulty: 5,
        density: 0.7,
        specialBias: 0.8,
        seed: "left rail fireworks",
        brief: "left rail fireworks with bomb pockets"
      }
    });

    expect(prompt).toContain('Player board prompt:\n- "left rail fireworks with bomb pockets"');
    expect(prompt).toContain("Prompt locks: preferred brick kind=bomb");
    expect(prompt).toContain("Target about 86 bricks");
    expect(prompt).toContain("Target about 27 specials and 19 hard bricks");
    expect(prompt).toContain('wild difficulty, speed near');
    expect(prompt).toContain('seed "left rail fireworks"');
    expect(prompt).toContain('"level":4');
  });

  it("passes freeform board briefs through the Cursor prompt as high-priority design intent", () => {
    const prompt = buildPrompt({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        brief: "create a heart shaped board that has nothing but exploding blocks"
      }
    });

    expect(prompt).toContain('Player board prompt:\n- "create a heart shaped board that has nothing but exploding blocks"');
    expect(prompt).toContain("Prompt locks: shape=heart, exclusive occupied brick kind=bomb");
    expect(prompt).toContain("Priority order: prompt shape/material");
    expect(prompt).toContain("For \"exploding blocks\", use bomb bricks.");
    expect(prompt).toContain("Return exactly this compact shape");
    expect(prompt).toContain('"grid"');
  });

  it("does not collapse multi-component prompts into one preferred brick kind", () => {
    const prompt = buildPrompt({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        brief: "boss core with a hard shield ring and fire routes through the sides"
      }
    });

    expect(prompt).toContain('Player board prompt:\n- "boss core with a hard shield ring and fire routes through the sides"');
    expect(prompt).toContain("Prompt locks: shape=circle, components=boss,hard,fire");
    expect(prompt).toContain("Priority order: prompt shape/material");
  });

  it("normalizes board designer controls into safe prompt bounds", () => {
    const longBrief = "create a heart shaped board that has nothing but exploding blocks and make every lane feel dramatic ".repeat(3);
    const normalized = normalizeDesignerIntent({
      style: "bogus",
      difficulty: 99,
      density: 0.1,
      specialBias: 3,
      seed: "0123456789012345678901234567890123456789",
      brief: longBrief
    });
    expect(normalized).toMatchObject({
      style: "balanced",
      difficulty: 5,
      density: 0.34,
      specialBias: 1,
      seed: "012345678901234567890123456789012345"
    });
    expect(normalized.brief).toMatch(/^create a heart shaped board/);
    expect(normalized.brief.length).toBeLessThanOrEqual(183);
  });

  it("normalizes generated level JSON into a bounded brick grid", () => {
    const rows = Array.from({ length: BRICK_ROWS }, (_, row) =>
      Array.from({ length: BRICK_COLUMNS }, (_, column) => (row < 3 || (row === 3 && column < 2) ? { kind: "basic", hp: 1 } : null))
    );
    rows[0][1] = { kind: "hard", hp: 9 };
    rows[1][0] = { kind: "bogus", hp: 1 };
    rows[1][1] = { kind: "boss", hp: 50 };
    rows[1][2] = { kind: "thru", hp: 1 };
    rows[1][3] = { kind: "penalty", hp: 1 };

    const level = normalizeLevel(
      {
        name: "  Bomb Lattice  ",
        briefing: "Punch the weak middle.",
        paddleHint: "Bank off the left wall.",
        speed: 99,
        rows
      },
      request
    );

    expect(level.name).toBe("Bomb Lattice");
    expect(level.speed).toBe(1.85);
    expect(level.rows).toHaveLength(BRICK_ROWS);
    expect(level.rows[0]).toHaveLength(BRICK_COLUMNS);
    expect(level.rows[0][1]).toEqual({ kind: "hard", hp: 4 });
    expect(level.rows[1][0]).toBeNull();
    expect(level.rows[1][1]).toEqual({ kind: "boss", hp: 12 });
    expect(level.rows[1][2]).toEqual({ kind: "thru", hp: 1 });
    expect(level.rows[1][3]).toEqual({ kind: "penalty", hp: 1 });
  });

  it("keeps the game playable without Cursor auth by producing fallback levels", () => {
    const level = fallbackLevel(request);
    const bricks = level.rows.flat().filter(Boolean);
    expect(level.rows).toHaveLength(BRICK_ROWS);
    expect(level.rows[0]).toHaveLength(BRICK_COLUMNS);
    expect(bricks.length).toBeGreaterThanOrEqual(MIN_BRICKS);
    expect(bricks.length).toBeLessThanOrEqual(MAX_BRICKS);
  });

  it("lets fallback boards honor designer intent while staying playable", () => {
    const level = fallbackLevel({
      ...request,
      designer: {
        style: "boss-core",
        difficulty: 5,
        density: 0.78,
        specialBias: 0.9,
        seed: "center furnace",
        brief: ""
      }
    });
    const bricks = level.rows.flat().filter(Boolean);
    expect(level.name).toBe("Generated Sector 4");
    expect(level.briefing).toContain("center furnace");
    expect(bricks.length).toBeGreaterThanOrEqual(MIN_BRICKS);
    expect(bricks.length).toBeLessThanOrEqual(MAX_BRICKS);
    expect(level.rows.flat().some((brick) => brick?.kind === "boss")).toBe(true);
  });

  it("makes fallback density and specials track designer targets", () => {
    const sparse = fallbackLevel({
      ...request,
      designer: {
        style: "precision",
        difficulty: 2,
        density: 0.34,
        specialBias: 0,
        seed: "needle",
        brief: ""
      }
    });
    const dense = fallbackLevel({
      ...request,
      designer: {
        style: "bomb-chains",
        difficulty: 5,
        density: 0.82,
        specialBias: 1,
        seed: "fireworks",
        brief: ""
      }
    });
    const sparseTargets = designerTargets({ style: "precision", difficulty: 2, density: 0.34, specialBias: 0, seed: "needle", brief: "" }, request.level);
    const denseTargets = designerTargets({ style: "bomb-chains", difficulty: 5, density: 0.82, specialBias: 1, seed: "fireworks", brief: "" }, request.level);

    expect(countBricks(sparse)).toBe(sparseTargets.brickTarget);
    expect(countBricks(dense)).toBe(denseTargets.brickTarget);
    expect(countSpecials(dense)).toBeGreaterThan(countSpecials(sparse) + 20);
    expect(countHardBricks(dense)).toBeGreaterThan(countHardBricks(sparse));
  });

  it("honors freeform heart and exploding-block requests in local fallback boards", () => {
    const level = fallbackLevel({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        density: 0.52,
        specialBias: 1,
        brief: "create a heart shaped board that has nothing but exploding blocks"
      }
    });
    const rowCounts = level.rows.map((row) => row.filter(Boolean).length);
    const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);

    expect(rowCounts).toEqual([6, 10, 12, 14, 12, 10, 8, 6, 4]);
    expect(bricks).toHaveLength(82);
    expect(bricks.every((brick) => brick.kind === "bomb" && brick.hp === 1)).toBe(true);
    expect(level.name).toContain("Heart");
  });

  it("can force local fallback for deterministic playability smoke tests", async () => {
    process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";
    try {
      const response = await requestEvolution(request);
      expect(response.source).toBe("fallback");
      expect(response.warning).toContain("RICOCHET_RUSH_FORCE_FALLBACK");
      expect(response.summary?.title).toBe("Local backup board");
      expect(response.summary?.detail).toContain("final wall has");
    } finally {
      delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    }
  });

  it("repairs generated boards that would instantly clear", () => {
    const level = normalizeLevel({ rows: [[{ kind: "basic", hp: 1 }]] }, request);
    expect(level.name).toBe(`Sector ${request.level}`);
    expect(level.rows.flat().filter(Boolean).length).toBeGreaterThanOrEqual(MIN_BRICKS);
  });

  it("keeps explicit heart and all-bomb requests when normalizing Cursor output", () => {
    const level = normalizeLevel(
      {
        name: "Cursor Heart",
        rows: fallbackLevel(request).rows
      },
      {
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          brief: "heart shaped board with nothing but exploding blocks"
        }
      }
    );
    const rowCounts = level.rows.map((row) => row.filter(Boolean).length);
    const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
    expect(rowCounts).toEqual([6, 10, 12, 14, 12, 10, 8, 6, 4]);
    expect(bricks).toHaveLength(82);
    expect(bricks.every((brick) => brick.kind === "bomb")).toBe(true);
  });

  it("materializes compact Cursor grid drafts into canonical brick rows", () => {
    const level = normalizeLevel(
      {
        name: "Compact Heart",
        briefing: "Tiny JSON, big boom.",
        paddleHint: "Start on the lobe edge.",
        speed: 1.22,
        brick: "bomb",
        grid: ["...xxx..xxx...", "..xxxxxxxxxx..", ".xxxxxxxxxxxx.", "xxxxxxxxxxxxxx", ".xxxxxxxxxxxx.", "..xxxxxxxxxx..", "...xxxxxxxx...", "....xxxxxx....", ".....xxxx....."]
      },
      {
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          brief: "heart shaped board with nothing but exploding blocks"
        }
      }
    );
    const rowCounts = level.rows.map((row) => row.filter(Boolean).length);
    const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
    expect(level.name).toBe("Compact Heart");
    expect(rowCounts).toEqual([6, 10, 12, 14, 12, 10, 8, 6, 4]);
    expect(bricks).toHaveLength(82);
    expect(bricks.every((brick) => brick.kind === "bomb")).toBe(true);
  });

  it("lets compact grid codes override a leftover default brick value", () => {
    const level = normalizeLevel(
      {
        name: "Mixed Compact",
        brick: "basic",
        grid: ["bohx.........", "..............", "..............", "..............", "..............", "..............", "..............", "..............", ".............."]
      },
      request
    );
    const [basic, bomb, hard, filled] = level.rows[0] ?? [];

    expect(basic?.kind).toBe("basic");
    expect(bomb?.kind).toBe("bomb");
    expect(hard?.kind).toBe("hard");
    expect(filled?.kind).toBe("basic");
  });

  it("trims overstuffed generated boards without replacing the level identity", () => {
    const level = normalizeLevel(
      {
        name: "Packed Prism",
        rows: Array.from({ length: BRICK_ROWS }, () => Array.from({ length: BRICK_COLUMNS }, () => ({ kind: "basic", hp: 1 })))
      },
      request
    );
    expect(level.name).toBe("Packed Prism");
    expect(level.rows.flat().filter(Boolean).length).toBeLessThanOrEqual(MAX_BRICKS);
  });

  it("caps overstuffed boss boards instead of preserving an invalid count", () => {
    const level = normalizeLevel(
      {
        name: "Boss Flood",
        rows: Array.from({ length: BRICK_ROWS }, () => Array.from({ length: BRICK_COLUMNS }, () => ({ kind: "boss", hp: 12 })))
      },
      request
    );
    expect(level.name).toBe("Boss Flood");
    expect(level.rows.flat().filter(Boolean).length).toBe(MAX_BRICKS);
  });

  it("rejects malformed level requests at the API boundary", async () => {
    expect(normalizeLevelRequest({ ...request, level: "4" })).toBeNull();
    expect(normalizeLevelRequest({ ...request, recentEvents: ["ok", 3] })).toBeNull();
    expect(normalizeLevelRequest({ ...request, designer: { style: "bogus", difficulty: 99, density: 2, specialBias: -1, seed: "x", brief: "heart" } })).toMatchObject({
      level: request.level,
      designer: {
        style: "balanced",
        difficulty: 5,
        density: 0.82,
        specialBias: 0,
        seed: "x",
        brief: "heart"
      }
    });

    await withApiServer(async (baseUrl) => {
      const invalidRequest = await fetch(`${baseUrl}/api/level`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, level: "4" })
      });
      expect(invalidRequest.status).toBe(400);
      expect(await invalidRequest.json()).toEqual({ error: "Invalid level request." });

      const oversizedRequest = await fetch(`${baseUrl}/api/level`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, recentEvents: ["x".repeat(32_001)] })
      });
      expect(oversizedRequest.status).toBe(413);
      expect(await oversizedRequest.json()).toEqual({ error: "Request body too large." });

      const multibyteOversizedRequest = await fetch(`${baseUrl}/api/level`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, recentEvents: ["🙂".repeat(9_000)] })
      });
      expect(multibyteOversizedRequest.status).toBe(413);
      expect(await multibyteOversizedRequest.json()).toEqual({ error: "Request body too large." });
    });
  });

  it("trims generated UI copy at word boundaries", () => {
    const level = normalizeLevel(
      {
        rows: fallbackLevel(request).rows,
        paddleHint:
          "Angle off the wide empty diagonals to skim laser lines and pocket the corner prizes before the center hard ring starts controlling the board tempo."
      },
      request
    );
    expect(level.paddleHint).toBe("Angle off the wide empty diagonals to skim laser lines and pocket the corner prizes before the center hard...");
  });

  it("does not leak Cursor SDK stack traces in fallback warnings", () => {
    const warning = summarizeLevelError(new Error("ConnectError: [unknown] Error\n    at node_modules/@cursor/sdk/dist/index.js\ncause: AuthenticationError"));
    expect(warning).toBe("Cursor SDK authentication is unavailable.");
    expect(summarizeLevelError(new Error("[agent_busy] Agent already has an active run."))).toBe("Cursor SDK agent is busy.");
    expect(summarizeLevelError(new Error("[stream_buffer_overflow] Cloud agent message buffer overflow; consumer is too slow"))).toBe(
      "Cursor SDK stream buffer overflowed."
    );
    expect(summarizeLevelError(new Error("[invalid_model] Model 'nope' is not available"))).toBe("Cursor SDK model is unavailable.");
  });

  it("passes CURSOR_API_KEY explicitly into the local Cursor SDK agent", () => {
    const workerSource = readFileSync(new URL("../server/cursorWorker.ts", import.meta.url), "utf8");
    expect(workerSource).toContain("process.env.CURSOR_API_KEY");
    expect(workerSource).toContain("apiKey,");
    expect(workerSource).toContain("Agent.create");
    expect(workerSource).toContain("settingSources: []");
    expect(workerSource).toContain("run.stream");
    expect(workerSource).toContain("streamStats");
    expect(workerSource).toContain('process.once("SIGTERM"');
    expect(workerSource).toContain("Symbol.asyncDispose");
  });

  it("returns a timeout fallback result and terminates an unresponsive Cursor SDK worker", async () => {
    vi.useFakeTimers();
    const stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: BufferEncoding) => void };
    const stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: BufferEncoding) => void };
    stdout.setEncoding = vi.fn();
    stderr.setEncoding = vi.fn();
    const worker = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      stderr: typeof stderr;
      stdin: { end: (data: string) => unknown };
      kill: (signal: NodeJS.Signals) => boolean;
    };
    const endStdin = vi.fn((_: string) => {});
    const killWorker = vi.fn((_: NodeJS.Signals) => true);
    worker.stdout = stdout;
    worker.stderr = stderr;
    worker.stdin = { end: endStdin };
    worker.kill = killWorker;

    const resultPromise = runCursorWorker(JSON.stringify(request), "test-key", {
      timeoutMs: 25,
      sigkillGraceMs: 10,
      spawnWorker: () => worker
    });
    stdout.emit("data", "partial output");
    stderr.emit("data", "partial error");
    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(worker.stdin.end).toHaveBeenCalledWith(JSON.stringify(request));
    expect(worker.kill).toHaveBeenCalledWith("SIGTERM");
    expect(result).toMatchObject({
      parsed: null,
      parseStatus: "worker-failed",
      parseError: "Cursor SDK worker timed out.",
      rawOutput: "partial output",
      rawError: "partial error",
      workerExitCode: null
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(worker.kill).toHaveBeenCalledWith("SIGKILL");
    vi.useRealTimers();
  });

  it("parses JSON even when the local Cursor SDK writes startup logs first", () => {
    expect(
      parseWorkerOutput(`01:50:29 INFO LocalCursorRulesService load completed meta={durationMs: 607}
{"name":"Generated","rows":[]}`)
    ).toEqual({
      name: "Generated",
      rows: []
    });
    expect(
      parseWorkerOutput(
        JSON.stringify({
          parsed: { name: "Wrapped", grid: ["xxxx"] },
          parseStatus: "success",
          rawOutput: '{"name":"Wrapped","grid":["xxxx"]}'
        })
      )
    ).toEqual({ name: "Wrapped", grid: ["xxxx"] });
    expect(
      parseWorkerOutput(
        JSON.stringify({
          parsed: null,
          parseStatus: "parse-failed",
          parseError: "Cursor SDK returned invalid JSON.",
          rawOutput: "not level JSON"
        })
      )
    ).toBeNull();
  });

  it("parses the best Cursor SDK JSON candidate instead of relying on concatenated stream text", () => {
    const partial = '{"name":"Heart Bomb","grid":["xxxx"';
    const corruptedCombined = `${partial}{"name":"Heart Bomb","grid":["xxxx"]}`;
    const finalCandidate = '{"name":"Heart Bomb","briefing":"boom","paddleHint":"edge","speed":1.1,"brick":"bomb","grid":["xxxx"]}';

    expect(parseLevelJsonFromCandidates([partial, corruptedCombined, finalCandidate])).toMatchObject({
      parsed: {
        name: "Heart Bomb",
        grid: ["xxxx"]
      },
      jsonText: finalCandidate
    });
  });

  it("merges cumulative Cursor stream chunks without duplicating partial JSON", () => {
    let output = "";
    output = appendAssistantTextChunk(output, '{"name":"Heart","rows":[{"kind":"bomb","hp"');
    output = appendAssistantTextChunk(output, '{"name":"Heart","rows":[{"kind":"bomb","hp":1}]}');
    output = appendAssistantTextChunk(output, "");
    expect(output).toBe('{"name":"Heart","rows":[{"kind":"bomb","hp":1}]}');
    expect(JSON.parse(output)).toMatchObject({ name: "Heart" });
  });

  it("returns generation trace metadata for generation attempts", async () => {
    const originalApiKey = process.env.CURSOR_API_KEY;
    const originalFallback = process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    process.env.CURSOR_API_KEY = "";
    delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    try {
      const response = await requestEvolution({ ...request, level: 11 });
      expect(response.source).toBe("fallback");
      expect(response.warning).toBe("Cursor SDK authentication is unavailable.");
      expect(response.trace).toBeTruthy();
      expect(response.trace?.request.level).toBe(11);
      expect(response.trace?.requestJson).toContain("\"level\":11");
      expect(response.trace?.prompt).toContain("composer-2");
      expect(response.trace?.parseStatus).toBe("worker-failed");
      expect(response.trace?.parseError).toBe("Cursor SDK authentication is unavailable.");
      expect(response.trace?.rawOutput).toBeTypeOf("string");
      expect(response.trace?.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.CURSOR_API_KEY;
      } else {
        process.env.CURSOR_API_KEY = originalApiKey;
      }
      if (originalFallback === undefined) {
        delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
      } else {
        process.env.RICOCHET_RUSH_FORCE_FALLBACK = originalFallback;
      }
    }
  });

  it("times out stalled browser generation requests so gameplay can fall back", async () => {
    vi.useFakeTimers();
    try {
      const stalledFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }) as unknown as typeof fetch;

      const pendingRequest = requestGeneratedLevel(request, { fetcher: stalledFetch, timeoutMs: 100 });
      const timeoutExpectation = expect(pendingRequest).rejects.toThrow(levelGenerationTimeoutMessage(100));
      await vi.advanceTimersByTimeAsync(100);
      await timeoutExpectation;
      expect(stalledFetch).toHaveBeenCalledWith("/api/level", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds a public generation summary without raw trace text", () => {
    const level = fallbackLevel(request);
    const summary = buildGenerationSummary(request, level, "fallback", "Cursor SDK authentication is unavailable.");
    expect(summary.title).toBe("Local backup board");
    expect(summary.detail).toContain(level.name);
    expect(summary.detail).toContain("final wall has");
    expect(summary.detail).toContain("Target was");
    expect(summary.warning).toBe("Cursor SDK authentication is unavailable.");
    expect(summary.detail).not.toContain("node_modules");
  });

  it("normalizes local settings into safe gameplay bounds", () => {
    expect(normalizeSettings({ ballSpeed: 4, particles: "yes", reducedMotion: true, highContrast: true, sfxVolume: 4, musicVolume: -1 })).toEqual({
      ...DEFAULT_SETTINGS,
      reducedMotion: true,
      highContrast: true,
      sfxVolume: 1,
      musicVolume: 0
    });
    expect(normalizeSettings({ sound: true })).toEqual({
      ...DEFAULT_SETTINGS,
      sfxVolume: 1
    });
    expect(normalizeSettings({ sound: false })).toEqual({
      ...DEFAULT_SETTINGS,
      sfxVolume: 0
    });
    expect(normalizeSettings({ music: false })).toEqual({
      ...DEFAULT_SETTINGS,
      musicVolume: 0
    });
    expect(normalizeSettings({ ballSpeed: 0.1, particles: false, sfxVolume: 0.45, musicVolume: 0.65 })).toEqual({
      ...DEFAULT_SETTINGS,
      particles: false,
      sfxVolume: 0.45,
      musicVolume: 0.65
    });
  });

  it("normalizes saved run checkpoints and drops invalid brick records", () => {
    const level = fallbackLevel(request);
    const save = normalizeSaveState({
      version: 1,
      savedAt: "2026-05-08T14:00:00.000Z",
      level: 3,
      clearedLevels: 2,
      score: 1200,
      bestScore: 1800,
      lives: 2,
      combo: 12,
      paddleWidth: 999,
      levelBlueprint: level,
      bricks: [
        { x: 10, y: 20, width: 30, height: 12, kind: "basic", hp: 1, maxHp: 1 },
        { x: 10, y: 20, width: 30, height: 12, kind: "bogus", hp: 1, maxHp: 1 }
      ],
      recentEvents: ["Saved", 123, "Restored"]
    });

    expect(save?.version).toBe(SAVE_VERSION);
    expect(save?.combo).toBe(8);
    expect(save?.paddleWidth).toBe(210);
    expect(save?.laserTimer).toBe(0);
    expect(save?.grabTimer).toBe(0);
    expect(save?.explosionScale).toBe(1);
    expect(save?.balls).toBeNull();
    expect(save?.boardSource).toBe("generated");
    expect(save?.packId).toBeNull();
    expect(save?.packBoardIndex).toBe(0);
    expect(save?.bricks).toEqual([{ x: 10, y: 20, width: 30, height: 12, kind: "basic", hp: 1, maxHp: 1 }]);
    expect(save?.recentEvents).toEqual(["Saved", "Restored"]);
  });

  it("normalizes v2 checkpoints with ball snapshots and power timers", () => {
    const level = fallbackLevel(request);
    const save = normalizeSaveState({
      version: 2,
      savedAt: "2026-05-08T15:00:00.000Z",
      level: 2,
      clearedLevels: 1,
      score: 400,
      bestScore: 400,
      lives: 3,
      combo: 2,
      paddleWidth: 140,
      levelBlueprint: level,
      bricks: [{ x: 10, y: 20, width: 30, height: 12, kind: "basic", hp: 1, maxHp: 1 }],
      recentEvents: [],
      laserTimer: 900,
      grabTimer: -1,
      explosionScale: 4,
      balls: [
        {
          x: 100,
          y: 200,
          vx: 50,
          vy: -50,
          radius: 30,
          stuck: false,
          stuckOffset: 0,
          fireTimer: 200,
          thruTimer: 0,
          megaTimer: 0
        }
      ]
    });
    expect(save?.laserTimer).toBe(120);
    expect(save?.grabTimer).toBe(0);
    expect(save?.explosionScale).toBe(2.5);
    expect(save?.balls).toHaveLength(1);
    expect(save?.balls?.[0]?.radius).toBe(20);
    expect(save?.balls?.[0]?.fireTimer).toBe(120);
    expect(save?.boardSource).toBe("generated");
  });

  it("normalizes current checkpoints with pack board context", () => {
    const level = fallbackLevel(request);
    const save = normalizeSaveState({
      version: SAVE_VERSION,
      savedAt: "2026-05-08T16:00:00.000Z",
      level: 2,
      clearedLevels: 1,
      boardSource: "pack",
      packId: "classic",
      packBoardIndex: 1,
      score: 900,
      bestScore: 900,
      lives: 3,
      combo: 1,
      paddleWidth: 116,
      levelBlueprint: level,
      bricks: [{ x: 10, y: 20, width: 30, height: 12, kind: "basic", hp: 1, maxHp: 1 }],
      recentEvents: [],
      laserTimer: 0,
      grabTimer: 0,
      explosionScale: 1,
      balls: null
    });

    expect(save?.boardSource).toBe("pack");
    expect(save?.packId).toBe("classic");
    expect(save?.packBoardIndex).toBe(1);
  });
});

describe("Ricochet Rush curated board packs", () => {
  it("materializes every authored board through the shared level validator", () => {
    for (const pack of BUILT_IN_PACKS) {
      expect(pack.boards.length).toBeGreaterThanOrEqual(3);
      for (let index = 0; index < pack.boards.length; index += 1) {
        const level = materializeAuthoredBoard(pack.id, index, { ...request, level: index + 1, clearedLevels: index });
        expect(level, `${pack.id} board ${index + 1}`).toBeTruthy();
        const brickCount = level?.rows.flat().filter(Boolean).length ?? 0;
        expect(level?.rows).toHaveLength(BRICK_ROWS);
        expect(level?.rows[0]).toHaveLength(BRICK_COLUMNS);
        expect(brickCount).toBeGreaterThanOrEqual(MIN_BRICKS);
        expect(brickCount).toBeLessThanOrEqual(MAX_BRICKS);
      }
    }
  });

  it("unlocks the next built-in pack after the previous pack is cleared", () => {
    let progress = normalizePackProgress(null, 0);
    expect(progress.starter?.unlocked).toBe(true);
    expect(progress.classic?.unlocked).toBe(false);

    progress = markPackBoardCleared(progress, "starter", 2, 3200, 0);

    expect(progress.starter?.cleared).toBe(3);
    expect(progress.starter?.bestScore).toBe(3200);
    expect(progress.classic?.unlocked).toBe(true);
  });

  it("keeps generated board saves in a replayable local pack shape", () => {
    const level = fallbackLevel(request);
    const saved = normalizeSavedBoards([
      {
        id: "kept-board",
        createdAt: "2026-05-08T17:00:00.000Z",
        levelName: "Kept Board",
        levelBlueprint: level
      }
    ]);
    const progress = normalizePackProgress({ [SAVED_DESIGNS_PACK_ID]: { cleared: 0, bestScore: 0, unlocked: false } }, saved.length);

    expect(saved).toHaveLength(1);
    expect(progress[SAVED_DESIGNS_PACK_ID]?.unlocked).toBe(true);
    expect(previewRowsFromLevel(saved[0]!.levelBlueprint)).toHaveLength(BRICK_ROWS);
  });
});

describe("Ricochet Rush paddle feel", () => {
  it("keeps center paddle hits from becoming vertical dead loops", () => {
    const rebound = calculatePaddleRebound({
      hitZone: 0,
      paddleVelocityX: 0,
      incomingVx: 0,
      incomingVy: 480
    });

    expect(Math.abs(rebound.vx)).toBeGreaterThanOrEqual(rebound.speed * 0.18);
    expect(rebound.vy).toBeLessThan(0);
  });

  it("lets paddle movement add controlled spin to center hits", () => {
    const left = calculatePaddleRebound({
      hitZone: 0,
      paddleVelocityX: -620,
      incomingVx: 160,
      incomingVy: 480
    });
    const right = calculatePaddleRebound({
      hitZone: 0,
      paddleVelocityX: 620,
      incomingVx: -160,
      incomingVy: 480
    });

    expect(left.vx).toBeLessThan(0);
    expect(right.vx).toBeGreaterThan(0);
    expect(Math.abs(left.vx)).toBeLessThan(left.speed * 0.84 + 0.001);
    expect(Math.abs(right.vx)).toBeLessThan(right.speed * 0.84 + 0.001);
  });
});

describe("Ricochet Rush collision consistency", () => {
  it("nudges near-vertical wall and brick bounces out of dead loops without changing speed", () => {
    const corrected = normalizeLoopRiskVelocity({
      vx: 0,
      vy: 520,
      minXRatio: 0.16,
      fallbackXSign: -1
    });

    expect(corrected.changed).toBe(true);
    expect(corrected.vx).toBeLessThan(0);
    expect(Math.abs(corrected.vx)).toBeGreaterThanOrEqual(corrected.speed * 0.16);
    expect(Math.hypot(corrected.vx, corrected.vy)).toBeCloseTo(corrected.speed, 5);
  });

  it("nudges near-horizontal side bounces out of dead loops without changing speed", () => {
    const corrected = normalizeLoopRiskVelocity({
      vx: -520,
      vy: 3,
      minYRatio: 0.16,
      fallbackYSign: 1
    });

    expect(corrected.changed).toBe(true);
    expect(corrected.vy).toBeGreaterThan(0);
    expect(Math.abs(corrected.vy)).toBeGreaterThanOrEqual(corrected.speed * 0.16);
    expect(Math.hypot(corrected.vx, corrected.vy)).toBeCloseTo(corrected.speed, 5);
  });
});

describe("Ricochet Rush power-up balance", () => {
  it("keeps early prize and penalty pools readable, then opens risk as boards progress", () => {
    const earlyPrize = prizePowerupPool({ level: 1, clearedLevels: 0, combo: 1 });
    const latePrize = prizePowerupPool({ level: 7, clearedLevels: 4, combo: 1 });
    const earlyPenalty = penaltyPowerupPool({ level: 1, clearedLevels: 0, combo: 1 });
    const latePenalty = penaltyPowerupPool({ level: 7, clearedLevels: 4, combo: 1 });

    expect(earlyPrize).toContain("expandPaddle");
    expect(earlyPrize).not.toContain("levelWarp");
    expect(latePrize).toContain("levelWarp");
    expect(earlyPenalty).toContain("shrinkPaddle");
    expect(earlyPenalty).not.toContain("killPaddle");
    expect(latePenalty).toContain("killPaddle");
  });

  it("adds stronger prize options for high-combo play", () => {
    const lowCombo = prizePowerupPool({ level: 2, clearedLevels: 0, combo: 1 });
    const highCombo = prizePowerupPool({ level: 2, clearedLevels: 0, combo: 3.2 });

    expect(lowCombo).not.toContain("megaBall");
    expect(highCombo).toContain("megaBall");
    expect(highCombo).not.toContain("eightBall");
  });

  it("classifies power-ups into readable reward, hazard, and volatile tones", () => {
    expect(powerupToneFor("expandPaddle")).toBe("reward");
    expect(powerupToneFor("shrinkPaddle")).toBe("hazard");
    expect(powerupToneFor("eightBall")).toBe("volatile");
  });
});

describe("Ricochet Rush audio", () => {
  it("keeps default music above the effectively silent mix floor", () => {
    withFakeAudioWindow((context) => {
      const musicGain = context.createdGains[0];
      expect(musicGain?.gain.exponentialRamps).toContain(MUSIC_MASTER_GAIN);
      expect(MUSIC_MASTER_GAIN * MUSIC_MELODY_PEAK).toBeGreaterThanOrEqual(0.008);
    });
  });
});
