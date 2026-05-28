import { describe, expect, it } from "vitest";
import {
  analyzeDesignerBrief,
  classifyDesignerBrief,
  DEFAULT_DESIGNER_INTENT,
  MAX_DESIGNER_BRICKS,
  MIN_DESIGNER_BRICKS,
  designerTargetsForGeneration,
  fallbackLevel,
  generationBrickBounds,
  validateCreativeFidelity,
  type LevelBlueprint,
  type LevelRequest
} from "../shared/evolution";

const request: LevelRequest = {
  level: 4,
  score: 2400,
  lives: 2,
  clearedLevels: 3,
  recentEvents: ["Wall cleared."]
};

const HEART_EMBEDDED_ROW_COUNTS = [0, 6, 10, 12, 14, 12, 10, 8, 6, 4, 0, 0];
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

describe("fallback level generation", () => {
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
    expect(bricks.length).toBeGreaterThanOrEqual(MIN_DESIGNER_BRICKS);
    expect(bricks.length).toBeLessThanOrEqual(MAX_DESIGNER_BRICKS);
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
    const sparseTargets = designerTargetsForGeneration({ style: "precision", difficulty: 2, density: 0.34, specialBias: 0, seed: "needle", brief: "" }, request.level);
    const denseTargets = designerTargetsForGeneration({ style: "bomb-chains", difficulty: 5, density: 0.82, specialBias: 1, seed: "fireworks", brief: "" }, request.level);

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

    expect(rowCounts).toEqual(HEART_EMBEDDED_ROW_COUNTS);
    expect(bricks).toHaveLength(82);
    expect(new Set(bricks.map((brick) => brick.kind))).toEqual(new Set(["bomb"]));
    expect(level.name).toContain("Heart");
  });

  it("allows filled shape prompts while preserving hollow or outline negative-space checks", () => {
    for (const brief of ["heart with only bombs", "circle with only bombs"]) {
      const level = fallbackLevel({
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          density: 0.36,
          specialBias: 1,
          brief,
          visualPreset: "icon"
        }
      });
      expect(validateCreativeFidelity(level, brief, "icon").ok, brief).toBe(true);
    }

    for (const brief of ["hollow circle with only bombs", "outline heart with only bombs", "hollow diamond with only bombs", "outline diamond with only bombs", "hollow triangle with only bombs"]) {
      const result = validateCreativeFidelity(
        fallbackLevel({
          ...request,
          designer: {
            ...DEFAULT_DESIGNER_INTENT,
            density: 0.36,
            specialBias: 1,
            brief,
            visualPreset: "icon"
          }
        }),
        brief,
        "icon"
      );
      expect(result.ok, brief).toBe(false);
      if (!result.ok) expect(result.reason, brief).toContain("open center space");
    }
  });

  it("keeps exclusive shaped fallback repairs on the requested kind", () => {
    expect(classifyDesignerBrief("draw + with only bombs").mode).toBe("silhouette");
    expect(classifyDesignerBrief("make + with only bombs").mode).toBe("silhouette");
    expect(analyzeDesignerBrief("no hard + only bombs").shape).toBeUndefined();
    expect(classifyDesignerBrief("no hard + only bombs").mode).toBe("arcade");

    for (const brief of ["x shape with only bombs", "x with only bombs", "make an x with only bombs", "draw + with only bombs", "make + with only bombs", "cross shape with only bombs", "triangle with only bombs"]) {
      const designer = {
        ...DEFAULT_DESIGNER_INTENT,
        density: 0.28,
        specialBias: 1,
        brief
      };
      const level = fallbackLevel({
        ...request,
        designer
      });
      const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
      const bounds = generationBrickBounds(designer);

      expect(classifyDesignerBrief(brief).mode, brief).toBe("silhouette");
      expect(bricks.length, brief).toBeGreaterThanOrEqual(bounds.min);
      expect(bricks.length, brief).toBeLessThanOrEqual(bounds.max);
      expect(new Set(bricks.map((brick) => brick.kind)), brief).toEqual(new Set(["bomb"]));
      expect(validateCreativeFidelity(level, brief, "arcade").ok, brief).toBe(true);
    }
  });

  it("avoids basic bricks in local fallback when the brief excludes them", () => {
    for (const brief of [
      "circle with no basic bricks",
      "circle with no basic bricks, no prizes, no wide, no split, no lasers, no grabs, no fire, no ghosts, no slow, no bombs"
    ]) {
      const level = fallbackLevel({
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          density: 0.36,
          specialBias: 1,
          brief,
          visualPreset: "icon"
        }
      });
      const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
      const excludedKinds = analyzeDesignerBrief(brief).excludedKinds;

      expect(bricks.length, brief).toBeGreaterThan(0);
      expect(bricks.some((brick) => brick.kind === "basic"), brief).toBe(false);
      expect(bricks.some((brick) => excludedKinds.includes(brick.kind)), brief).toBe(false);
    }
  });

  it("keeps localized eye fallback playable when non-feature constraints conflict", () => {
    const brief = "smiley face, no basic hard prizes wide split lasers grabs fire ghosts slow bosses penalties, no bombs outside eyes";
    const level = fallbackLevel({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        density: 0.36,
        specialBias: 1,
        brief,
        visualPreset: "icon"
      }
    });
    const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
    const bombCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "bomb" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));

    expect(validateCreativeFidelity(level, brief, "icon").ok).toBe(true);
    expect(bricks).toHaveLength(2);
    expect(new Set(bricks.map((brick) => brick.kind))).toEqual(new Set(["bomb"]));
    expect(bombCoordinates).toEqual(["5:2", "14:2"]);
  });

  it("keeps explicit boss-core fallback cells in the core", () => {
    for (const brief of ["boss core board", "boss-core board", "boss-core board with no core bombs", "boss-core board with no bomb core", "boss-core board with no exploding core"]) {
      const level = fallbackLevel({
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          style: "boss-core",
          density: 0.52,
          specialBias: 1,
          brief,
          visualPreset: "arcade"
        }
      });
      const coreCells = [level.rows[3]?.[9], level.rows[3]?.[10], level.rows[4]?.[9], level.rows[4]?.[10]];

      expect(validateCreativeFidelity(level, brief, "arcade").ok, brief).toBe(true);
      expect(coreCells.every((brick) => brick?.kind === "boss"), brief).toBe(true);
    }
  });

  it("drops boss-core requirements when bosses are explicitly excluded", () => {
    const brief = "boss-core board with no bosses";
    const level = fallbackLevel({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        style: "boss-core",
        density: 0.52,
        specialBias: 1,
        brief,
        visualPreset: "arcade"
      }
    });
    const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);

    expect(validateCreativeFidelity(level, brief, "arcade").ok).toBe(true);
    expect(bricks.some((brick) => brick.kind === "boss")).toBe(false);
  });

  it("keeps localized core bombs inside the core in local fallback", () => {
    const brief = "boss-core board with no bombs outside the core";
    const level = fallbackLevel({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        style: "boss-core",
        density: 0.78,
        specialBias: 1,
        brief,
        visualPreset: "arcade"
      }
    });
    const bombCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "bomb" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));

    expect(validateCreativeFidelity(level, brief, "arcade").ok).toBe(true);
    expect(bombCoordinates.sort()).toEqual(["10:3", "10:4", "9:3", "9:4"]);
  });

  it("applies required features even when another feature kind is localized", () => {
    for (const brief of ["no hard outside core and bomb eyes", "no hard outside core with bomb eyes", "hard-free outside core and bomb eyes", "no bombs outside eyes with hard core"]) {
      const level = fallbackLevel({
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          density: 0.52,
          specialBias: 1,
          brief,
          visualPreset: "icon"
        }
      });
      const bombCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "bomb" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));
      const hardCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "hard" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));

      expect(validateCreativeFidelity(level, brief, "icon").ok, brief).toBe(true);
      expect(bombCoordinates, brief).toEqual(expect.arrayContaining(["5:2", "14:2"]));
      expect(hardCoordinates, brief).toEqual(expect.arrayContaining(["9:3", "10:3", "9:4", "10:4"]));
    }
  });

  it("keeps combined eye and core bomb prompts in both feature regions", () => {
    for (const brief of ["no bombs outside eyes and core", "no bombs outside eyes with core bombs", "bomb eyes and bomb core", "eyes and core are bombs", "no bombs, but bomb eyes and bomb core", "no bombs; but bomb eyes and bomb core", "only bomb eyes and bomb core"]) {
      const level = fallbackLevel({
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          density: 0.52,
          specialBias: 1,
          brief,
          visualPreset: "icon"
        }
      });
      const bombCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "bomb" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));

      expect(validateCreativeFidelity(level, brief, "icon").ok, brief).toBe(true);
      expect(bombCoordinates, brief).toEqual(expect.arrayContaining(["5:2", "14:2", "9:3", "10:3", "9:4", "10:4"]));
    }
  });

  it("treats non-core-kind negation plus core bombs as bomb-core in local fallback", () => {
    for (const brief of ["no boss bricks but core bombs", "no hard except core bombs", "no bombs and no hard except core bombs"]) {
      const level = fallbackLevel({
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          style: "boss-core",
          density: 0.52,
          specialBias: 1,
          brief,
          visualPreset: "arcade"
        }
      });
      const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
      const bombCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "bomb" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));
      const excludedKinds = analyzeDesignerBrief(brief).excludedKinds;

      expect(validateCreativeFidelity(level, brief, "arcade").ok, brief).toBe(true);
      for (const excludedKind of excludedKinds) expect(bricks.some((brick) => brick.kind === excludedKind), brief).toBe(false);
      expect(bombCoordinates, brief).toEqual(expect.arrayContaining(["9:3", "10:3", "9:4", "10:4"]));
    }
  });

  it("honors required bomb eyes while avoiding excluded kinds in local fallback", () => {
    const brief = "make a smiley face with no hard bricks and explosive eyes";
    const level = fallbackLevel({
      ...request,
      designer: {
        ...DEFAULT_DESIGNER_INTENT,
        density: 0.36,
        specialBias: 1,
        brief,
        visualPreset: "icon"
      }
    });
    const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
    const bombCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "bomb" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));

    expect(validateCreativeFidelity(level, brief, "icon").ok).toBe(true);
    expect(bombCoordinates).toContain("5:2");
    expect(bombCoordinates).toContain("14:2");
    expect(bricks.some((brick) => brick.kind === "hard")).toBe(false);
  });

  it("keeps feature-scoped only-bomb prompts mixed in local fallback boards", () => {
    for (const brief of [
      "make a smiley face with only the eyes as exploding bricks",
      "make a smiley face using only bombs for the eyes",
      "make a smiley face using only exploding bricks for eyes",
      "make a smiley face where the eyes are only bombs",
      "make a smiley face with eyes only bombs",
      "make a smiley face where the eyes are bombs only",
      "make a smiley face where the eyes should use only bombs",
      "make a smiley face where the eyes are exclusively bombs",
      "make a smiley face with eyes that are bombs only",
      "make a smiley face with all bomb bricks for the eyes",
      "make a smiley face with exploding bricks only for the eyes",
      "make a smiley face with bomb eyes only",
      "make a smiley face with exploding eyes only",
      "make a smiley face with only exploding eyes",
      "use bombs for eyes only",
      "only use bombs for eyes",
      "only use exploding bricks for eyes",
      "eyes should only be bombs",
      "eyes should only use bombs",
      "eyes only use bombs",
      "make a smiley face with no hard + use bombs for eyes only",
      "make a smiley face with no hard + eyes should only be bombs",
      "make a smiley face with no hard and eyes should only use bombs",
      "make a smiley face with no hard + eyes only bombs",
      "make a smiley face with no hard or bombs outside the eyes",
      "make a smiley face with no hard and bombs outside the eyes",
      "make a smiley face with no hard bricks and no bombs except the eyes",
      "make a smiley face with no hard bricks and free of bombs except eyes",
      "make a smiley face with no hard bricks and bomb-free except eyes",
      "make a smiley face with no hard bricks with no bombs except eyes",
      "make a smiley face with no hard bricks with free of bombs except eyes",
      "make a smiley face with no hard bricks with bomb-free except eyes",
      "make a smiley face with hard-free with no bombs except eyes",
      "make a smiley face with hard-free and bomb-free except eyes",
      "make a smiley face with no bombs plus eyes should only be bombs",
      "make a smiley face with no bombs and eyes should only be bombs",
      "make a smiley face with no bombs with eyes should only be bombs",
      "make a smiley face with explosive eyes but no bombs elsewhere",
      "make a smiley face with no bombs outside the eyes",
      "make a smiley face with no bombs, except the eyes",
      "make a smiley face with no bombs; except the eyes",
      "make a smiley face that is bomb-free, except eyes",
      "make a smiley face with no exploding bricks outside the eyes",
      "make a smiley face with no bombs except on the eyes",
      "make a smiley face with no bombs except inside the eyes",
      "make a smiley face with no bombs except exploding eyes",
      "make a smiley face with no bombs except bomb eyes",
      "make a smiley face with no bombs but bomb eyes",
      "make a smiley face with no bombs but exploding eyes",
      "make a smiley face with no bombs apart from the eyes",
      "make a smiley face with no bombs other than the eyes",
      "make a smiley face that is bomb-free except the eyes",
      "make a smiley face that is bomb-free except on the eyes",
      "make a smiley face that is bomb-free except inside the eyes",
      "make a smiley face that is bomb-free outside the eyes",
      "make a smiley face that is free of bombs except in the eyes",
      "make a smiley face that is free of bombs except inside the eyes",
      "make a smiley face that is free of bombs apart from the eyes",
      "make a smiley face that is free of bombs outside the eyes",
      "make a smiley face with no hard bricks and no bombs outside the eyes",
      "make a smiley face with no basic bricks, no prizes, no wide, no split, no lasers, no grabs, no fire, no ghosts, no slow, no bombs outside the eyes",
      "make a smiley face with no hard bricks plus no bombs outside the eyes"
    ]) {
      const level = fallbackLevel({
        ...request,
        designer: {
          ...DEFAULT_DESIGNER_INTENT,
          density: 0.36,
          specialBias: 1,
          brief,
          visualPreset: "icon"
        }
      });
      const bricks = level.rows.flat().filter((brick): brick is NonNullable<typeof brick> => brick !== null);
      const kinds = new Set(bricks.map((brick) => brick.kind));

      const bombCoordinates = level.rows.flatMap((row, y) => row.map((brick, x) => (brick?.kind === "bomb" ? `${x}:${y}` : undefined)).filter((cell): cell is string => Boolean(cell)));

      const excludedKinds = analyzeDesignerBrief(brief).excludedKinds;

      expect(validateCreativeFidelity(level, brief, "icon").ok, brief).toBe(true);
      expect(bombCoordinates).toEqual(["5:2", "14:2"]);
      for (const excludedKind of excludedKinds) expect(kinds.has(excludedKind), brief).toBe(false);
      expect(kinds.has("bomb"), brief).toBe(true);
      expect([...kinds].some((kind) => kind !== "bomb"), brief).toBe(true);
    }
  });

});
