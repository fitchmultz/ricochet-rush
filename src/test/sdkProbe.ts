import { BRICK_COLUMNS, BRICK_ROWS, MAX_BRICKS, MIN_BRICKS, type LevelRequest } from "../shared/evolution";
import { previewRowsFromLevel } from "../shared/boardPacks";
import { requestEvolution } from "../server/cursorAgent";

const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
if (!cursorApiKey) {
  console.log("sdk:probe skipped: CURSOR_API_KEY is not set.");
  process.exit(0);
}
process.env.CURSOR_API_KEY = cursorApiKey;
delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;

const request: LevelRequest = {
  level: 1,
  score: 0,
  lives: 3,
  clearedLevels: 0,
  recentEvents: ["P11 live SDK probe."],
  designer: {
    style: "open-lanes",
    difficulty: 2,
    density: 0.45,
    specialBias: 0.32,
    seed: "sdk-probe",
    brief: "simple symmetric wall with exactly fourteen columns per grid row"
  }
};

const result = await requestEvolution(request);
if (result.source !== "cursor-sdk") {
  throw new Error(`sdk:probe expected cursor-sdk source, got ${result.source}: ${result.warning ?? "no warning"}`);
}
if (!result.trace) throw new Error("sdk:probe expected trace evidence.");
if (result.trace.parseStatus !== "success") throw new Error(`sdk:probe expected successful parse, got ${result.trace.parseStatus}.`);
if (!result.trace.prompt.includes("Ricochet Rush")) throw new Error("sdk:probe trace prompt is missing expected game context.");
assertCompactGrid(result.trace.parsedOutput);
if (!result.summary || result.summary.source !== "cursor-sdk") throw new Error("sdk:probe expected public cursor-sdk summary.");
if (result.level.rows.length !== BRICK_ROWS || result.level.rows.some((row) => row.length !== BRICK_COLUMNS)) throw new Error("sdk:probe board dimensions are invalid.");
const brickCount = result.level.rows.flat().filter(Boolean).length;
if (brickCount < MIN_BRICKS || brickCount > MAX_BRICKS) throw new Error(`sdk:probe brick count ${brickCount} outside playable range.`);
const compactRows = previewRowsFromLevel(result.level);
if (compactRows.length !== BRICK_ROWS || compactRows.some((row) => row.length !== BRICK_COLUMNS)) throw new Error("sdk:probe compact grid preview is invalid.");
console.log(`sdk:probe passed: ${result.level.name} · ${brickCount} bricks · ${result.trace.durationMs}ms`);

function assertCompactGrid(parsedOutput: unknown) {
  if (!parsedOutput || typeof parsedOutput !== "object") throw new Error("sdk:probe expected parsed SDK output object.");
  const grid = (parsedOutput as { grid?: unknown }).grid;
  if (!Array.isArray(grid) || grid.length !== BRICK_ROWS) throw new Error("sdk:probe expected compact grid with 9 rows.");
  const allowed = /^[.bhopnlgftswmcx]{14}$/;
  for (const row of grid) {
    if (typeof row !== "string" || !allowed.test(row)) {
      throw new Error("sdk:probe compact grid rows must be 14-character glyph strings.");
    }
  }
}
