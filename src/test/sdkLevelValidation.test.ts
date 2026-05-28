import { describe, expect, it } from "vitest";
import { buildPrompt } from "../server/cursorAgent";
import {
  analyzeDesignerBrief,
  DEFAULT_DESIGNER_INTENT,
  DESIGNER_BRICK_COLUMNS,
  DESIGNER_BRICK_ROWS,
  MIN_RAW_SDK_BRICKS,
  MIN_DESIGNER_BRICKS,
  designerBriefConstraintMode,
  fallbackLevel,
  resolveDesignerIntentForGeneration,
  validateAndNormalizeSdkLevel,
  type LevelRequest
} from "../shared/evolution";

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

const DESIGNER_LANE_GRID = [
  "....................",
  "..xxxx....xxxx......",
  ".xxxxx....xxxxx.....",
  ".xxxxxx..xxxxxx.....",
  "..xxxxxx..xxxxxx....",
  "..xxxx....xxxx......",
  "...xxx....xxx.......",
  "....xx....xx........",
  ".....xx..xx.........",
  "......xxxx..........",
  ".......xx...........",
  "...................."
];

describe("SDK level validation", () => {
  it("rejects sparse SDK grids before accepting composer output", () => {
    const sparse = validateAndNormalizeSdkLevel(
      {
        name: "Too Sparse",
        briefing: "Not enough bricks.",
        paddleHint: "Retry.",
        grid: ["xxxx", "..............", "..............", "..............", "..............", "..............", "..............", "..............", ".............."]
      },
      request
    );
    expect(sparse.ok).toBe(false);
    if (sparse.ok) return;
    expect(sparse.reason).toContain("too sparse");
    expect(sparse.rawBrickCount).toBeLessThan(MIN_RAW_SDK_BRICKS);
  });

  it("accepts complete compact SDK grids for composer-2.5 responses", () => {
    const valid = validateAndNormalizeSdkLevel(
      {
        name: "Lane Vault",
        briefing: "Open the side channels first.",
        paddleHint: "Bank off the left wall.",
        speed: 1.05,
        brick: "basic",
        grid: DESIGNER_ARCADE_GRID
      },
      request
    );
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.level.name).toBe("Lane Vault");
    expect(valid.rawBrickCount).toBeGreaterThanOrEqual(MIN_RAW_SDK_BRICKS);
  });

  it("preserves composer SDK layouts instead of applying fallback shape stencils", () => {
    const validated = validateAndNormalizeSdkLevel(
      {
        name: "Composer Lanes",
        briefing: "Bank the open channels.",
        paddleHint: "Stay shallow.",
        speed: 1.05,
        brick: "basic",
        grid: DESIGNER_LANE_GRID
      },
      {
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "arcade",
          brief: "open lane wall with side channels"
        }
      }
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.level.rows.map((row) => row.filter(Boolean).length)).toEqual([0, 8, 10, 12, 12, 8, 6, 4, 4, 4, 2, 0]);
    expect(validated.level.rows.flat().filter(Boolean).length).toBeGreaterThanOrEqual(MIN_DESIGNER_BRICKS);
  });

  it("rejects overfilled silhouette SDK boards for retry", () => {
    const dense = validateAndNormalizeSdkLevel(
      {
        name: "Blob",
        briefing: "Too dense.",
        paddleHint: "Retry.",
        speed: 1,
        brick: "basic",
        grid: Array.from({ length: DESIGNER_BRICK_ROWS }, () => "x".repeat(DESIGNER_BRICK_COLUMNS))
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "icon",
          brief: "make a smiley face and the eyes are exploding bricks"
        })
      }
    );
    expect(dense.ok).toBe(false);
    if (dense.ok) return;
    expect(dense.reason).toMatch(/overfilled|outside 42-91/);
  });

  it("accepts required eye bombs when the SDK draws readable eyes off the canonical coordinates", () => {
    const grid = Array.from({ length: DESIGNER_BRICK_ROWS }, () => Array.from({ length: DESIGNER_BRICK_COLUMNS }, () => "."));
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 4; x <= 15; x += 1) grid[y][x] = "b";
    }
    grid[1][4] = "o";
    grid[1][15] = "o";

    const validated = validateAndNormalizeSdkLevel(
      {
        name: "Readable Eyes",
        briefing: "Bombs mark the eyes.",
        paddleHint: "Aim for the eyes.",
        speed: 1,
        grid: grid.map((row) => row.join(""))
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "icon",
          brief: "make a smiley face and the eyes are exploding bricks"
        })
      }
    );

    expect(validated.ok).toBe(true);
  });

  it("rejects SDK localized-eye boards with bombs outside the eye positions", () => {
    const grid = Array.from({ length: DESIGNER_BRICK_ROWS }, () => Array.from({ length: DESIGNER_BRICK_COLUMNS }, () => "."));
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 4; x <= 15; x += 1) grid[y][x] = "b";
    }
    grid[2][5] = "o";
    grid[2][14] = "o";
    grid[8][1] = "o";
    grid[8][18] = "o";

    const validated = validateAndNormalizeSdkLevel(
      {
        name: "Bad Eyes",
        briefing: "Too many bombs.",
        paddleHint: "Retry.",
        speed: 1,
        grid: grid.map((row) => row.join(""))
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "icon",
          brief: "make a smiley face with no bombs outside the eyes"
        })
      }
    );

    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.reason).toContain("only in the eyes");
  });

  it("rejects boss-core SDK boards that omit boss core when core bombs are forbidden", () => {
    for (const brief of ["no bomb core", "no exploding core"]) {
      const validated = validateAndNormalizeSdkLevel(
        {
          name: "Missing Core",
          briefing: "No boss core was generated.",
          paddleHint: "Retry.",
          speed: 1,
          brick: "basic",
          grid: DESIGNER_ARCADE_GRID
        },
        {
          ...request,
          designer: resolveDesignerIntentForGeneration({
            ...DEFAULT_DESIGNER_INTENT,
            style: "boss-core",
            visualPreset: "arcade",
            brief
          })
        }
      );

      expect(validated.ok, brief).toBe(false);
      if (!validated.ok) expect(validated.reason, brief).toContain("boss bricks at the core");
      expect(buildPrompt({ ...request, designer: { ...DEFAULT_DESIGNER_INTENT, style: "boss-core", brief } })).toContain("Preserve the boss core");
    }
  });

  it("relaxes SDK sparse checks for legal feature-only constrained boards", () => {
    const grid = Array.from({ length: DESIGNER_BRICK_ROWS }, () => Array.from({ length: DESIGNER_BRICK_COLUMNS }, () => "."));
    grid[2][5] = "o";
    grid[2][14] = "o";

    const prompt = "smiley face, no basic hard prizes wide split lasers grabs fire ghosts slow bosses penalties, no bombs outside eyes";
    expect(designerBriefConstraintMode(analyzeDesignerBrief(prompt))).toBe("feature-only");

    const validated = validateAndNormalizeSdkLevel(
      {
        name: "Bomb Eyes",
        briefing: "Only the eyes can explode.",
        paddleHint: "Aim for the eyes.",
        speed: 1,
        grid: grid.map((row) => row.join(""))
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "icon",
          brief: prompt
        })
      }
    );

    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.rawBrickCount).toBe(2);
  });

  it("rejects SDK localized-core boards with bombs outside the core positions", () => {
    const grid = Array.from({ length: DESIGNER_BRICK_ROWS }, () => Array.from({ length: DESIGNER_BRICK_COLUMNS }, () => "."));
    for (let y = 1; y <= 7; y += 1) {
      for (let x = 5; x <= 14; x += 1) grid[y][x] = "b";
    }
    grid[3][9] = "o";
    grid[3][10] = "o";
    grid[4][9] = "o";
    grid[4][10] = "o";
    grid[0][17] = "o";

    const validated = validateAndNormalizeSdkLevel(
      {
        name: "Bad Core",
        briefing: "Too many bombs.",
        paddleHint: "Retry.",
        speed: 1,
        grid: grid.map((row) => row.join(""))
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "arcade",
          brief: "boss-core board with no bombs outside the core"
        })
      }
    );

    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.reason).toContain("only in the core");

    const sparseCoreGrid = grid.map((row) => [...row]);
    sparseCoreGrid[3][10] = "b";
    sparseCoreGrid[4][9] = "b";
    sparseCoreGrid[4][10] = "b";
    sparseCoreGrid[0][17] = "b";
    const missingCore = validateAndNormalizeSdkLevel(
      {
        name: "Sparse Core",
        briefing: "Not enough core bombs.",
        paddleHint: "Retry.",
        speed: 1,
        grid: sparseCoreGrid.map((row) => row.join(""))
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "arcade",
          brief: "boss-core board with exploding core"
        })
      }
    );
    expect(missingCore.ok).toBe(false);
    if (missingCore.ok) return;
    expect(missingCore.reason).toContain("requires bomb bricks at the core positions");
  });

  it("rejects SDK boards with excluded brick kinds", () => {
    const grid = Array.from({ length: DESIGNER_BRICK_ROWS }, () => Array.from({ length: DESIGNER_BRICK_COLUMNS }, () => "."));
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 4; x <= 15; x += 1) grid[y][x] = "b";
    }
    grid[2][5] = "o";
    grid[2][14] = "o";
    grid[4][10] = "h";

    const validated = validateAndNormalizeSdkLevel(
      {
        name: "Hard Eyes",
        briefing: "Hard brick should be rejected.",
        paddleHint: "Retry.",
        speed: 1,
        grid: grid.map((row) => row.join(""))
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "icon",
          brief: "make a smiley face with no hard bricks plus no bombs outside the eyes"
        })
      }
    );

    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.reason).toContain("excludes hard");
  });

  it("rejects SDK boards that omit a preferred requested kind", () => {
    const grid = DESIGNER_LANE_GRID;
    const validated = validateAndNormalizeSdkLevel(
      {
        name: "No Bombs",
        briefing: "Forgot the bombs.",
        paddleHint: "Retry.",
        speed: 1,
        brick: "basic",
        grid
      },
      {
        ...request,
        designer: resolveDesignerIntentForGeneration({
          ...DEFAULT_DESIGNER_INTENT,
          visualPreset: "icon",
          brief: "make a face with exploding blocks"
        })
      }
    );

    expect(validated.ok).toBe(false);
    if (validated.ok) return;
    expect(validated.reason).toContain("asks for bomb bricks");
  });

  it("accepts global-exclusive bomb boards when local or negated wording is also present", () => {
    for (const prompt of ["all occupied bricks are bombs and only the eyes are bombs", "no hard bricks and only bombs", "avoid hard bricks and use only bombs", "no hard bricks plus only bombs", "avoid hard bricks plus use only bombs", "no hard + only bombs", "avoid hard + use only bombs"]) {
      const validated = validateAndNormalizeSdkLevel(
        {
          name: "All Bombs",
          briefing: "Every cell explodes.",
          paddleHint: "Chain the wall.",
          speed: 1,
          brick: "bomb",
          grid: DESIGNER_ARCADE_GRID
        },
        { ...request, designer: { ...DEFAULT_DESIGNER_INTENT, brief: prompt } }
      );
      expect(validated.ok, prompt).toBe(true);
      const fallback = fallbackLevel({ ...request, designer: { ...DEFAULT_DESIGNER_INTENT, brief: prompt } });
      const fallbackBricks = fallback.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
      expect(fallbackBricks.length, prompt).toBeGreaterThan(0);
      expect(fallbackBricks.every((brick) => brick.kind === "bomb"), prompt).toBe(true);
    }
  });

});
