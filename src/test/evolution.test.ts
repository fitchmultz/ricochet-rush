import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRICK_COLUMNS, BRICK_ROWS, CURSOR_MODEL, MAX_BRICKS, MIN_BRICKS, fallbackLevel, normalizeLevel, type LevelRequest } from "../shared/evolution";
import { DEFAULT_SETTINGS, SAVE_VERSION, normalizeSaveState, normalizeSettings } from "../shared/saveState";
import { buildPrompt, parseWorkerOutput, requestEvolution, summarizeLevelError } from "../server/cursorAgent";
import { trimComposerArchive, type ComposerGeneratedLevelEntry } from "../client/game/RicochetRushGame";

const request: LevelRequest = {
  level: 4,
  score: 2400,
  lives: 2,
  clearedLevels: 3,
  recentEvents: ["Wall cleared."]
};

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

  it("can force local fallback for deterministic playability smoke tests", async () => {
    process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";
    try {
      const response = await requestEvolution(request);
      expect(response.source).toBe("fallback");
      expect(response.warning).toContain("RICOCHET_RUSH_FORCE_FALLBACK");
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

  it("bounds composer archive shape and ordering for persistence", () => {
    const levelTemplate = fallbackLevel(request);
    const now = Date.now();
    const entries: ComposerGeneratedLevelEntry[] = Array.from({ length: 55 }, (_, index) => ({
      createdAt: new Date(now - index).toISOString(),
      level: index + 1,
      score: index * 10,
      lives: 3,
      clearedLevels: index,
      levelName: `Generated ${index}`,
      model: CURSOR_MODEL,
      levelBlueprint: levelTemplate
    }));
    const bounded = trimComposerArchive(entries);
    expect(bounded).toHaveLength(50);
    expect(bounded[0]).toEqual(entries[0]);
    expect(bounded.at(-1)?.level).toBe(50);
  });

  it("normalizes local settings into safe gameplay bounds", () => {
    expect(normalizeSettings({ ballSpeed: 4, particles: "yes", reducedMotion: true, highContrast: true })).toEqual({
      ...DEFAULT_SETTINGS,
      ballSpeed: 1.2,
      reducedMotion: true,
      highContrast: true,
      sound: false
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
  });
});
