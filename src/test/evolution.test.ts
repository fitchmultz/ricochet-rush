import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BRICK_COLUMNS,
  BRICK_ROWS,
  CURSOR_MODEL,
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
import { buildGenerationSummary, buildPrompt, parseWorkerOutput, requestEvolution, summarizeLevelError } from "../server/cursorAgent";
import {
  calculatePaddleRebound,
  normalizeLoopRiskVelocity,
  penaltyPowerupPool,
  powerupToneFor,
  prizePowerupPool
} from "../client/game/RicochetRushGame";

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
  });

  it("adds visible board designer intent and feedback to the Cursor prompt", () => {
    const prompt = buildPrompt({
      ...request,
      designer: {
        style: "bomb-chains",
        difficulty: 5,
        density: 0.7,
        specialBias: 0.8,
        seed: "left rail fireworks",
        feedback: [
          {
            vote: "down",
            levelName: "Flat Wall",
            style: "balanced",
            seed: "flat",
            recentEvents: ["Ball looped."]
          }
        ]
      }
    });

    expect(prompt).toContain("Style: Bomb chains");
    expect(prompt).toContain("Style goal: Linked bomb pockets");
    expect(prompt).toContain("Difficulty: 5/5");
    expect(prompt).toContain("Difficulty target: wild");
    expect(prompt).toContain("Target density: 70%");
    expect(prompt).toContain("Target brick count: about 86 bricks");
    expect(prompt).toContain("Special-brick mix: about 27 special bricks");
    expect(prompt).toContain("Hard-brick pressure: about 19 hard bricks");
    expect(prompt).toContain('Seed phrase: "left rail fireworks"');
    expect(prompt).toContain("Rejected Flat Wall");
  });

  it("normalizes board designer controls into safe prompt bounds", () => {
    expect(
      normalizeDesignerIntent({
        style: "bogus",
        difficulty: 99,
        density: 0.1,
        specialBias: 3,
        seed: "0123456789012345678901234567890123456789",
        feedback: [{ vote: "up", levelName: "Good", style: "precision", seed: "needle", recentEvents: ["Saved."] }]
      })
    ).toMatchObject({
      style: "balanced",
      difficulty: 5,
      density: 0.34,
      specialBias: 1,
      seed: "012345678901234567890123456789012345",
      feedback: [{ vote: "up", levelName: "Good", style: "precision", seed: "needle", recentEvents: ["Saved."] }]
    });
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
        feedback: []
      }
    });
    const bricks = level.rows.flat().filter(Boolean);
    expect(level.name).toBe("Boss core Sector 4");
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
        feedback: []
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
        feedback: []
      }
    });
    const sparseTargets = designerTargets({ style: "precision", difficulty: 2, density: 0.34, specialBias: 0, seed: "needle", feedback: [] }, request.level);
    const denseTargets = designerTargets({ style: "bomb-chains", difficulty: 5, density: 0.82, specialBias: 1, seed: "fireworks", feedback: [] }, request.level);

    expect(countBricks(sparse)).toBe(sparseTargets.brickTarget);
    expect(countBricks(dense)).toBe(denseTargets.brickTarget);
    expect(countSpecials(dense)).toBeGreaterThan(countSpecials(sparse) + 20);
    expect(countHardBricks(dense)).toBeGreaterThan(countHardBricks(sparse));
  });

  it("can force local fallback for deterministic playability smoke tests", async () => {
    process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";
    try {
      const response = await requestEvolution(request);
      expect(response.source).toBe("fallback");
      expect(response.warning).toContain("RICOCHET_RUSH_FORCE_FALLBACK");
      expect(response.summary?.title).toBe("Local fallback board");
      expect(response.summary?.detail).toContain("Validation kept");
    } finally {
      delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    }
  });

  it("repairs generated boards that would instantly clear", () => {
    const level = normalizeLevel({ rows: [[{ kind: "basic", hp: 1 }]] }, request);
    expect(level.name).toBe(`Sector ${request.level}`);
    expect(level.rows.flat().filter(Boolean).length).toBeGreaterThanOrEqual(MIN_BRICKS);
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
    expect(normalizeLevelRequest({ ...request, designer: { style: "bogus", difficulty: 99, density: 2, specialBias: -1, seed: "x", feedback: [] } })).toMatchObject({
      level: request.level,
      designer: {
        style: "balanced",
        difficulty: 5,
        density: 0.82,
        specialBias: 0,
        seed: "x"
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
  });

  it("passes CURSOR_API_KEY explicitly into the local Cursor SDK agent", () => {
    const workerSource = readFileSync(new URL("../server/cursorWorker.ts", import.meta.url), "utf8");
    expect(workerSource).toContain("process.env.CURSOR_API_KEY");
    expect(workerSource).toContain("apiKey,");
    expect(workerSource).toContain("Agent.create");
  });

  it("parses JSON even when the local Cursor SDK writes startup logs first", () => {
    expect(
      parseWorkerOutput(`01:50:29 INFO LocalCursorRulesService load completed meta={durationMs: 607}
{"name":"Generated","rows":[]}`)
    ).toEqual({
      name: "Generated",
      rows: []
    });
  });

  it("returns composer trace metadata for generation attempts", async () => {
    const originalApiKey = process.env.CURSOR_API_KEY;
    const originalFallback = process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    process.env.CURSOR_API_KEY = "";
    delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    try {
      const response = await requestEvolution({ ...request, level: 11 });
      expect(response.trace).toBeTruthy();
      expect(response.trace?.request.level).toBe(11);
      expect(response.trace?.requestJson).toContain("\"level\":11");
      expect(response.trace?.prompt).toContain("composer-2");
      expect(response.trace?.parseStatus).toMatch(/success|parse-failed|worker-failed/);
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

  it("builds a public generation summary without raw trace text", () => {
    const level = fallbackLevel(request);
    const summary = buildGenerationSummary(request, level, "fallback", "Cursor SDK authentication is unavailable.");
    expect(summary.title).toBe("Local fallback board");
    expect(summary.detail).toContain(level.name);
    expect(summary.detail).toContain("Validation kept");
    expect(summary.detail).toContain("Target was");
    expect(summary.warning).toBe("Cursor SDK authentication is unavailable.");
    expect(summary.detail).not.toContain("node_modules");
  });

  it("normalizes local settings into safe gameplay bounds", () => {
    expect(normalizeSettings({ ballSpeed: 4, particles: "yes", reducedMotion: true, highContrast: true })).toEqual({
      ...DEFAULT_SETTINGS,
      ballSpeed: 1.2,
      reducedMotion: true,
      highContrast: true,
      sfx: false,
      music: false
    });
    expect(normalizeSettings({ sound: true })).toEqual({
      ...DEFAULT_SETTINGS,
      sfx: true
    });
    expect(normalizeSettings({ ballSpeed: 0.1, particles: false })).toEqual({
      ...DEFAULT_SETTINGS,
      ballSpeed: 0.8,
      particles: false
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
