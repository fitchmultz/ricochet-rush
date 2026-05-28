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
  normalizeDesignerIntent,
  normalizeLevel,
  nextDesignerSeed,
  normalizeLevelRequest,
  classifyDesignerBrief,
  designerTargetsForGeneration,
  generationBrickBounds,
  MAX_SILHOUETTE_BRICKS,
  MIN_SILHOUETTE_BRICKS,
  resolveDesignerIntentForGeneration,
  validateCreativeFidelity,
  DESIGNER_BRICK_COLUMNS,
  DESIGNER_BRICK_ROWS,
  MIN_DESIGNER_BRICKS,
  MAX_DESIGNER_BRICKS,
  type LevelRequest
} from "../shared/evolution";
import {
  BUILT_IN_PACKS,
  DAILY_PACK_ID,
  SAVED_DESIGNS_PACK_ID,
  localDateKey,
  markPackBoardCleared,
  materializeAuthoredBoard,
  materializeDailyBoard,
  normalizeDailyProgress,
  normalizePackProgress,
  normalizeSavedBoards,
  boardCountForPack,
  blueprintFingerprint,
  previewRowsFromLevel
} from "../shared/boardPacks";
import { gameEventsToStrings, normalizeGameEvents } from "../shared/gameEvents";
import { DEFAULT_COSMETICS, DEFAULT_SETTINGS, SAVE_VERSION, normalizeCosmetics, normalizeSaveState, normalizeSettings } from "../shared/saveState";
import { BOARD_EXPORT_VERSION, createBoardExportPayload, encodeBoardExport, parseBoardExport } from "../shared/shareState";
import { createApiServer } from "../server/api";
import { buildGenerationSummary, buildPrompt, parseWorkerOutput, requestEvolution, runCursorWorker, summarizeLevelError } from "../server/cursorAgent";
import { parseLevelJsonFromCandidates } from "../server/levelJson";
import { appendAssistantTextChunk } from "../server/streamText";
import { normalizeLoopRiskVelocity } from "../client/game/physics";
import { penaltyPowerupPool, powerupToneFor, prizePowerupPool } from "../client/game/powerups";
import { MUSIC_MASTER_GAIN, MUSIC_MELODY_PEAK, createGameAudio } from "../client/game/gameAudio";
import {
  isLevelGenerationNetworkError,
  levelGenerationServerHint,
  levelGenerationTimeoutMessage,
  requestGeneratedLevel
} from "../client/game/levelApi";

const request: LevelRequest = {
  level: 4,
  score: 2400,
  lives: 2,
  clearedLevels: 3,
  recentEvents: ["Wall cleared."]
};

const DESIGNER_ARCADE_GRID = [
  "....................",
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
  "...................."
];

const HEART_EMBEDDED_ROW_COUNTS = [0, 6, 10, 12, 14, 12, 10, 8, 6, 4, 0, 0];
const DESIGNER_PAD = ".".repeat(DESIGNER_BRICK_COLUMNS);

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
  it("pins composer-2.5 fast mode for level requests", () => {
    expect(CURSOR_MODEL).toEqual({
      id: "composer-2.5",
      params: [{ id: "fast", value: "true" }]
    });
    expect(buildPrompt(request)).toContain("composer-2.5 in fast mode");
    expect(buildPrompt(request)).toContain("Ricochet Rush");
    expect(buildPrompt(request)).toContain(`${MIN_DESIGNER_BRICKS} bricks and at most ${MAX_DESIGNER_BRICKS} bricks`);
    expect(buildPrompt(request)).toContain("20 columns by 12 rows");
    expect(buildPrompt(request)).toContain("Do not calculate exact brick counts");
    expect(buildPrompt(request)).toContain("Never reuse a previous board name");
    expect(buildPrompt({ ...request, recentEvents: ["Cleared Blast Monolith.", "Designing the next wall."] })).toContain("Blast Monolith");
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
    expect(prompt).toContain("Brief guidance:");
    expect(prompt).toContain("Target about 164 bricks");
    expect(prompt).toContain("Target about 52 specials and 37 hard bricks");
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
    expect(prompt).toContain("Brief guidance:");
    expect(prompt).toContain("Every occupied brick must be bomb.");
    expect(prompt).toContain("Silhouette mode");
    expect(prompt).toContain("prefer 42-91 bricks");
    expect(prompt).toContain('"grid"');
  });

  it("uses icon preset density and mixed-grid example for silhouette prompts", () => {
    const prompt = buildPrompt({
      ...request,
      designer: resolveDesignerIntentForGeneration({
        ...DEFAULT_DESIGNER_INTENT,
        visualPreset: "icon",
        brief: "make a smiley face with only the eyes as exploding bricks"
      })
    });

    expect(prompt).toContain("Visual preset: icon / silhouette");
    expect(prompt).toContain("Exploding eyes should be bomb (o) cells");
    expect(prompt).toContain("Feature coordinates are fixed on the 20x12 grid: eyes bomb cells at (x=5, y=2) and (x=14, y=2).");
    expect(prompt).toContain("apply that kind only to the named feature");
    expect(prompt).not.toContain("Every occupied brick must be bomb.");
    expect(prompt).not.toContain('"brick": "basic"');
    expect(prompt).toContain(".....o........o.....");
    expect(prompt).toContain("Creative/silhouette prompt");
    expect(prompt).not.toContain("Target about 125 bricks");
  });

  it("keeps global-exclusive bomb prompt guidance ahead of local eye wording", () => {
    const prompt = buildPrompt({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        brief: "all occupied bricks are bombs and only the eyes are bombs"
      }
    });

    expect(prompt).toContain("Every occupied brick must be bomb.");
    expect(prompt).toContain("Exploding or bomb feature wording follows the global exclusive brick rule above.");
    expect(prompt).not.toContain("Exploding eyes should be bomb (o) cells at the eye positions only.");
    expect(prompt).not.toContain("at those features only unless the prompt says all bricks explode");
  });

  it("distinguishes required eye bombs from generic bomb prompts in Cursor guidance", () => {
    const eyePrompt = buildPrompt({
      ...request,
      designer: { ...DEFAULT_DESIGNER_INTENT, visualPreset: "icon", brief: "make a smiley face and the eyes are exploding bricks" }
    });
    expect(eyePrompt).toContain("Ensure both eye positions are bomb (o) cells");
    expect(eyePrompt).toContain("other bomb cells are allowed");
    expect(eyePrompt).not.toContain("Use bomb (o) bricks only at the named bomb feature positions");

    const corePrompt = buildPrompt({
      ...request,
      designer: { ...DEFAULT_DESIGNER_INTENT, visualPreset: "arcade", brief: "boss-core board with exploding core" }
    });
    expect(corePrompt).toContain("Ensure all core positions are bomb (o) cells");
    expect(corePrompt).not.toContain("Ensure both eye positions are bomb");

    const localizedNoBasicPrompt = buildPrompt({
      ...request,
      designer: { ...DEFAULT_DESIGNER_INTENT, visualPreset: "icon", brief: "make a smiley face with no basic bricks and eyes should only be bombs" }
    });
    expect(localizedNoBasicPrompt).toContain("Do not use these brick kinds: basic.");
    expect(localizedNoBasicPrompt).toContain("fill the rest with non-excluded playable or mixed bricks");
    expect(localizedNoBasicPrompt).not.toContain("fill the rest with basic");

    const constrainedFeatureOnlyPrompt = buildPrompt({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        visualPreset: "icon",
        brief: "smiley face, no basic hard prizes wide split lasers grabs fire ghosts slow bosses penalties, no bombs outside eyes"
      }
    });
    expect(constrainedFeatureOnlyPrompt).toContain("no legal non-feature fill kind");
    expect(constrainedFeatureOnlyPrompt).toContain("leave all other cells \".\"");
    expect(constrainedFeatureOnlyPrompt).toContain("leave every non-feature cell empty");
    expect(constrainedFeatureOnlyPrompt).not.toContain("at least 42");
    expect(constrainedFeatureOnlyPrompt).not.toContain("fill the rest with non-excluded playable or mixed bricks");

    const mixedFeaturePrompt = buildPrompt({
      ...request,
      designer: { ...DEFAULT_DESIGNER_INTENT, visualPreset: "icon", brief: "no bombs outside eyes with hard core" }
    });
    expect(mixedFeaturePrompt).toContain("Use bomb only for the named eyes feature positions");
    expect(mixedFeaturePrompt).toContain("Ensure these additional feature positions are set: core=hard");
    expect(mixedFeaturePrompt).toContain("Ensure these non-bomb feature positions are set: core=hard");

    const genericPrompt = buildPrompt({
      ...request,
      designer: { ...DEFAULT_DESIGNER_INTENT, visualPreset: "icon", brief: "make a face with exploding blocks" }
    });
    expect(genericPrompt).toContain("Include bomb (o) bricks in the wall");
    expect(genericPrompt).not.toContain("at those features only");
  });

  it("uses arcade density targets for non-creative briefs", () => {
    const prompt = buildPrompt({
      ...request,
      designer: { ...DEFAULT_DESIGNER_INTENT, visualPreset: "arcade", brief: "left rail fireworks with bomb pockets" }
    });
    expect(prompt).toContain("Arcade mode");
    expect(classifyDesignerBrief("left rail fireworks with bomb pockets", "arcade").mode).toBe("arcade");
  });

  it("does not treat shield ring wording as a forced circle shape in brief guidance", () => {
    const prompt = buildPrompt({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        brief: "boss core with a hard shield ring and fire routes through the sides"
      }
    });

    expect(prompt).toContain('Player board prompt:\n- "boss core with a hard shield ring and fire routes through the sides"');
    expect(prompt).not.toContain("shape=circle");
    expect(prompt).toContain("Brief guidance:");
    expect(prompt).toContain("Use mixed grid codes");
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
    expect(level.rows).toHaveLength(DESIGNER_BRICK_ROWS);
    expect(level.rows[0]).toHaveLength(DESIGNER_BRICK_COLUMNS);
    expect(bricks.length).toBeGreaterThanOrEqual(MIN_DESIGNER_BRICKS);
    expect(bricks.length).toBeLessThanOrEqual(MAX_DESIGNER_BRICKS);
  });

  it("rotates designer seeds between generation requests", () => {
    const first = nextDesignerSeed(DEFAULT_DESIGNER_INTENT.seed, request, 1);
    const second = nextDesignerSeed(first, { ...request, level: request.level + 1, clearedLevels: request.clearedLevels + 1 }, 2);
    expect(first).not.toBe(DEFAULT_DESIGNER_INTENT.seed);
    expect(second).not.toBe(first);
  });

  it("changes fallback layouts when level and seed advance", () => {
    const first = fallbackLevel({ ...request, level: 1, designer: { ...DEFAULT_DESIGNER_INTENT, seed: "fresh-angle" } });
    const second = fallbackLevel({
      ...request,
      level: 2,
      score: request.score + 500,
      clearedLevels: 1,
      designer: { ...DEFAULT_DESIGNER_INTENT, seed: nextDesignerSeed("fresh-angle", { ...request, level: 2, clearedLevels: 1 }) }
    });
    expect(blueprintFingerprint(first)).not.toBe(blueprintFingerprint(second));
  });

  it("detects unreachable level API network failures", () => {
    expect(isLevelGenerationNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isLevelGenerationNetworkError(new Error("Level generation failed with 500"))).toBe(false);
    expect(levelGenerationServerHint()).toContain("npm run dev");
  });

  it("lowers density for icon preset and silhouette briefs", () => {
    const icon = resolveDesignerIntentForGeneration({
      ...DEFAULT_DESIGNER_INTENT,
      visualPreset: "icon",
      brief: "logo outline"
    });
    expect(icon.density).toBeLessThanOrEqual(0.4);
    expect(classifyDesignerBrief("make a smiley face", "icon").mode).toBe("silhouette");
    expect(classifyDesignerBrief("make a smiley face", "arcade").mode).toBe("silhouette");
    const tuned = resolveDesignerIntentForGeneration({
      ...DEFAULT_DESIGNER_INTENT,
      visualPreset: "arcade",
      brief: "make a smiley face and the eyes are exploding bricks"
    });
    expect(tuned.density).toBeLessThanOrEqual(0.32);
    const bounds = generationBrickBounds(tuned);
    expect(bounds.min).toBe(MIN_SILHOUETTE_BRICKS);
    expect(bounds.max).toBe(MAX_SILHOUETTE_BRICKS);
    const targets = designerTargetsForGeneration(tuned, 1);
    expect(targets.brickTarget).toBeLessThanOrEqual(MAX_SILHOUETTE_BRICKS);
  });

  it("validates creative fidelity for smiley bomb-eye prompts", () => {
    const level = {
      name: "Grin",
      briefing: "Pop the eyes.",
      paddleHint: "Bank shots.",
      speed: 1,
      rows: Array.from({ length: DESIGNER_BRICK_ROWS }, (_, y) =>
        Array.from({ length: DESIGNER_BRICK_COLUMNS }, (_, x) => {
          if (y === 2 && (x === 5 || x === 14)) return { kind: "bomb", hp: 1 } as const;
          if (y === 3 && x >= 5 && x <= 14) return { kind: "basic", hp: 1 } as const;
          return null;
        })
      )
    };

    expect(validateCreativeFidelity(level, "make a smiley face and the eyes are exploding bricks", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face with only the eyes as exploding bricks", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face using only bombs for the eyes", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face using only exploding bricks for eyes", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face where the eyes are only bombs", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face with eyes only bombs", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face where the eyes are bombs only", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face where the eyes should use only bombs", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face where the eyes are exclusively bombs", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face with eyes that are bombs only", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face with bomb eyes only", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(level, "make a smiley face with exploding eyes only", "icon").ok).toBe(true);

    const extraBombLevel = {
      ...level,
      rows: level.rows.map((row, y) => row.map((brick, x) => (y === 8 && (x === 1 || x === 18) ? ({ kind: "bomb", hp: 1 } as const) : brick)))
    };
    expect(validateCreativeFidelity(extraBombLevel, "make a smiley face with bomb eyes only", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(extraBombLevel, "make a smiley face with no bombs outside the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(extraBombLevel, "only use bombs for eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(extraBombLevel, "eyes should only be bombs", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(extraBombLevel, "eyes should only use bombs", "icon").ok).toBe(false);

    const misplacedBombLevel = {
      ...level,
      rows: level.rows.map((row, y) =>
        row.map((brick, x) => {
          if (brick?.kind === "bomb") return { kind: "basic", hp: 1 } as const;
          if (y === 8 && (x === 1 || x === 18)) return { kind: "bomb", hp: 1 } as const;
          return brick;
        })
      )
    };
    expect(validateCreativeFidelity(misplacedBombLevel, "make a smiley face with bomb eyes only", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(misplacedBombLevel, "make a smiley face and the eyes are exploding bricks", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(misplacedBombLevel, "make a smiley face with explosive eyes", "icon").ok).toBe(false);

    const extraRequiredBombLevel = {
      ...level,
      rows: level.rows.map((row, y) => row.map((brick, x) => (y === 8 && (x === 1 || x === 18) ? ({ kind: "bomb", hp: 1 } as const) : brick)))
    };
    expect(validateCreativeFidelity(extraRequiredBombLevel, "make a smiley face and the eyes are exploding bricks", "icon").ok).toBe(true);

    const noBombLevel = {
      ...level,
      rows: level.rows.map((row) => row.map((brick) => (brick?.kind === "bomb" ? { kind: "basic", hp: 1 } as const : brick)))
    };
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with explosive eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with no bombs", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face without explosive eyes", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with no bombs outside the mouth", "icon").ok).toBe(true);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with no bombs except the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with no bombs except on the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with no bombs except inside the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with no bombs outside the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face with no exploding bricks outside the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face that is bomb-free except the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face that is bomb-free except on the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face that is bomb-free except inside the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face that is free of bombs except in the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face that is free of bombs except inside the eyes", "icon").ok).toBe(false);
    expect(validateCreativeFidelity(noBombLevel, "make a smiley face that is free of bombs outside the eyes", "icon").ok).toBe(false);
  });

  it("rejects mixed brick kinds when the prompt asks for only bombs", () => {
    const result = validateCreativeFidelity(
      {
        name: "Mixed Bombs",
        briefing: "Not exclusive enough.",
        paddleHint: "Bank shots.",
        speed: 1,
        rows: Array.from({ length: DESIGNER_BRICK_ROWS }, (_, y) =>
          Array.from({ length: DESIGNER_BRICK_COLUMNS }, (_, x) => {
            if (y === 1 && x === 1) return { kind: "bomb", hp: 1 } as const;
            if (y === 1 && x === 2) return { kind: "basic", hp: 1 } as const;
            return null;
          })
        )
      },
      "heart shape with only bomb bricks",
      "icon"
    );
    expect(result).toEqual({ ok: false, reason: "Prompt requires every occupied brick to be bomb." });
  });

  it("retries composer-2.5 generation before falling back", async () => {
    const originalApiKey = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "test-key";
    delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    let calls = 0;
    try {
      const response = await requestEvolution(request, {
        maxAttempts: 3,
        resolveModel: async () => CURSOR_MODEL,
        runWorker: async () => {
          calls += 1;
          if (calls < 3) {
            return {
              parsed: null,
              parseStatus: "parse-failed",
              parseError: "Cursor SDK returned invalid JSON.",
              rawOutput: "not json",
              rawError: "",
              startedAt: Date.now(),
              finishedAt: Date.now()
            };
          }
          return {
            parsed: {
              name: "Retry Win",
              briefing: "Third attempt worked.",
              paddleHint: "Stay shallow.",
              speed: 1.1,
              brick: "basic",
              grid: DESIGNER_ARCADE_GRID
            },
            parseStatus: "success",
            rawOutput: "{}",
            rawError: "",
            startedAt: Date.now(),
            finishedAt: Date.now()
          };
        }
      });
      expect(calls).toBe(3);
      expect(response.source).toBe("cursor-sdk");
      expect(response.level.name).toBe("Retry Win");
    } finally {
      if (originalApiKey === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = originalApiKey;
    }
  });

  it("can force local fallback for deterministic playability smoke tests", async () => {
    process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";
    try {
      const response = await requestEvolution(request);
      expect(response.source).toBe("fallback");
      expect(response.warning).toContain("RICOCHET_RUSH_FORCE_FALLBACK");
      expect(response.summary?.title).toContain("Local backup");
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
    expect(rowCounts).toEqual(HEART_EMBEDDED_ROW_COUNTS);
    expect(bricks).toHaveLength(82);
    expect(new Set(bricks.map((brick) => brick.kind))).toEqual(new Set(["bomb"]));
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
    expect(rowCounts).toEqual(HEART_EMBEDDED_ROW_COUNTS);
    expect(bricks).toHaveLength(82);
    expect(new Set(bricks.map((brick) => brick.kind))).toEqual(new Set(["bomb"]));
  });

  it("lets compact grid codes override a leftover default brick value", () => {
    const level = normalizeLevel(
      {
        name: "Mixed Compact",
        brick: "basic",
        grid: ["bohx................", `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`, `${DESIGNER_PAD}`]
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
    expect(workerSource).toContain("readCursorModelSelectionFromEnv");
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
      expect(response.trace?.prompt).toContain("composer-2.5");
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
    expect(summary.title).toContain("Local backup");
    expect(summary.title).toContain(level.name);
    expect(summary.detail).toContain(level.name);
    expect(summary.detail).toContain("default arcade brief");
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

  it("normalizes local cosmetic choices", () => {
    expect(normalizeCosmetics({ paddleSkin: "gold", ballTrail: "aurora", boardBackplate: "sunrise" })).toEqual({
      paddleSkin: "gold",
      ballTrail: "aurora",
      boardBackplate: "sunrise"
    });
    expect(normalizeCosmetics({ paddleSkin: "physics-boost", ballTrail: "bad", boardBackplate: "bad" })).toEqual(DEFAULT_COSMETICS);
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
    expect(save?.recentEvents).toEqual([
      { text: "Saved", audience: "player" },
      { text: "Restored", audience: "player" }
    ]);
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
      packId: "daily",
      packBoardIndex: 0,
      dailyDateKey: "2026-05-18",
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
    expect(save?.packId).toBe("daily");
    expect(save?.packBoardIndex).toBe(0);
    expect(save?.dailyDateKey).toBe("2026-05-18");
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

  it("keeps generated-board prompts from rewriting authored pack boards", () => {
    const level = materializeAuthoredBoard("starter", 1, {
      ...request,
      level: 2,
      clearedLevels: 1,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        brief: "heart shape, only bomb bricks"
      }
    });

    expect(level?.name).toBe("Starter Wave");
    expect(level?.rows.map((row) => row.filter(Boolean).length)).toEqual([10, 6, 10, 4, 10, 4, 0, 0, 0]);
    expect(new Set(level?.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null).map((brick) => brick.kind))).toEqual(
      new Set(["basic", "wide", "split", "prize", "hard"])
    );
  });

  it("materializes the same daily board for a local date key", () => {
    const first = materializeDailyBoard("2026-05-18");
    const second = materializeDailyBoard("2026-05-18");
    const other = materializeDailyBoard("2026-05-19");

    expect(localDateKey(new Date(2026, 4, 18))).toBe("2026-05-18");
    expect(first.name).toBe("Today's Board 2026-05-18");
    expect(previewRowsFromLevel(first)).toEqual(previewRowsFromLevel(second));
    expect(previewRowsFromLevel(first)).not.toEqual(previewRowsFromLevel(other));
    expect(boardCountForPack(DAILY_PACK_ID, 0)).toBe(1);
  });

  it("normalizes local daily progress by date", () => {
    const progress = normalizeDailyProgress({
      "2026-05-18": { bestScore: 1200, completed: true },
      bad: { bestScore: 999, completed: true }
    });

    expect(progress["2026-05-18"]).toEqual({ bestScore: 1200, completed: true });
    expect(progress.bad).toBeUndefined();
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
    expect(saved[0]?.sourcePrompt).toBe("Saved from generated board");
    expect(saved[0]?.bestScore).toBe(0);
    expect(progress[SAVED_DESIGNS_PACK_ID]?.unlocked).toBe(true);
    expect(previewRowsFromLevel(saved[0]!.levelBlueprint)).toHaveLength(DESIGNER_BRICK_ROWS);
  });

  it("exports and imports public-safe versioned board JSON", () => {
    const level = fallbackLevel(request);
    const payload = createBoardExportPayload(level, "share prompt", "2026-05-18T00:00:00.000Z");
    const encoded = encodeBoardExport(payload);
    const parsed = parseBoardExport(encoded);

    expect(payload.version).toBe(BOARD_EXPORT_VERSION);
    expect(encoded).toContain('"app": "ricochet-rush"');
    expect(parsed.ok).toBe(true);
    expect(parsed.level?.name).toBe(level.name);
    expect(parsed.sourcePrompt).toBe("share prompt");
    expect(parsed.level?.rows).toHaveLength(DESIGNER_BRICK_ROWS);
  });

  it("rejects malformed or unsupported board exports without normalizing them", () => {
    const valid = JSON.parse(encodeBoardExport(createBoardExportPayload(fallbackLevel(request), "share prompt"))) as { board: { rows: Array<Array<null | { kind: string; hp: number }>> } };
    const fractionalHp = structuredClone(valid);
    fractionalHp.board.rows[0]![0] = { kind: "basic", hp: 1.5 };
    const badKind = structuredClone(valid);
    badKind.board.rows[0]![0] = { kind: "unknown", hp: 1 };

    expect(parseBoardExport("not json")).toMatchObject({ ok: false });
    expect(parseBoardExport(JSON.stringify({ app: "ricochet-rush", version: BOARD_EXPORT_VERSION, board: {} }))).toMatchObject({ ok: false, message: expect.stringContaining("invalid") });
    expect(parseBoardExport(JSON.stringify({ app: "ricochet-rush", version: BOARD_EXPORT_VERSION, board: { name: "Bad", briefing: "Bad", paddleHint: "Bad", speed: 1, rows: [] } }))).toMatchObject({ ok: false });
    expect(parseBoardExport(JSON.stringify(fractionalHp))).toMatchObject({ ok: false });
    expect(parseBoardExport(JSON.stringify(badKind))).toMatchObject({ ok: false });
    expect(parseBoardExport(JSON.stringify({ app: "ricochet-rush", version: 999, board: {} }))).toMatchObject({ ok: false, message: expect.stringContaining("unsupported") });
    expect(parseBoardExport(JSON.stringify({ app: "other", version: BOARD_EXPORT_VERSION, board: {} }))).toMatchObject({ ok: false, message: expect.stringContaining("not a Ricochet") });
  });
});

describe("game event records", () => {
  it("normalizes legacy string events and typed audience records", () => {
    const events = normalizeGameEvents(["Starter pack loaded.", { text: "Checkpoint saved.", audience: "technical" }]);
    expect(events[0]?.audience).toBe("player");
    expect(events[1]?.audience).toBe("technical");
    expect(gameEventsToStrings(events)).toEqual(["Starter pack loaded.", "Checkpoint saved."]);
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
