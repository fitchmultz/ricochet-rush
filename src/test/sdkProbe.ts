import {
  DEFAULT_DESIGNER_INTENT,
  designerGridDimensions,
  generationBrickBounds,
  type LevelRequest
} from "../shared/evolution";
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
    brief: "simple symmetric wall with open bank lanes"
  }
};

const maxAttempts = 5;
let lastError = "sdk:probe exhausted retries without a live Cursor SDK board.";

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    const result = await requestEvolution(request);
    assertProbeResult(result);
    const brickCount = result.level.rows.flat().filter(Boolean).length;
    const attemptNote = attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
    console.log(`sdk:probe passed${attemptNote}: ${result.level.name} · ${brickCount} bricks · ${result.trace!.durationMs}ms`);
    process.exit(0);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (attempt < maxAttempts) {
      console.warn(`sdk:probe attempt ${attempt}/${maxAttempts} failed: ${lastError}`);
    }
  }
}

throw new Error(lastError);

function assertProbeResult(result: Awaited<ReturnType<typeof requestEvolution>>) {
  const grid = designerGridDimensions();
  const bounds = generationBrickBounds(result.trace!.request.designer ?? DEFAULT_DESIGNER_INTENT);
  if (result.source !== "cursor-sdk") {
    throw new Error(`sdk:probe expected cursor-sdk source, got ${result.source}: ${result.warning ?? "no warning"}`);
  }
  if (!result.trace) throw new Error("sdk:probe expected trace evidence.");
  if (result.trace.parseStatus !== "success") throw new Error(`sdk:probe expected successful parse, got ${result.trace.parseStatus}.`);
  if (!result.trace.prompt.includes("Ricochet Rush")) throw new Error("sdk:probe trace prompt is missing expected game context.");
  assertCompactGrid(result.trace.parsedOutput, grid);
  if (!result.summary || result.summary.source !== "cursor-sdk") throw new Error("sdk:probe expected public cursor-sdk summary.");
  if (result.level.rows.length !== grid.rows || result.level.rows.some((row) => row.length !== grid.columns)) {
    throw new Error("sdk:probe board dimensions are invalid.");
  }
  const brickCount = result.level.rows.flat().filter(Boolean).length;
  if (brickCount < bounds.min || brickCount > bounds.max) throw new Error(`sdk:probe brick count ${brickCount} outside playable range.`);
  const compactRows = previewRowsFromLevel(result.level);
  if (compactRows.length !== grid.rows || compactRows.some((row) => row.length !== grid.columns)) {
    throw new Error("sdk:probe compact grid preview is invalid.");
  }
}

function assertCompactGrid(parsedOutput: unknown, grid: { columns: number; rows: number }) {
  if (!parsedOutput || typeof parsedOutput !== "object") throw new Error("sdk:probe expected parsed SDK output object.");
  const rawGrid = (parsedOutput as { grid?: unknown }).grid;
  if (!Array.isArray(rawGrid) || rawGrid.length < 1) throw new Error("sdk:probe expected compact grid rows.");
  const allowedGlyph = /^[.bhopnlgftswmcx]$/i;
  for (let y = 0; y < grid.rows; y += 1) {
    const sourceRow = typeof rawGrid[y] === "string" ? rawGrid[y] : "";
    const normalized = sourceRow.padEnd(grid.columns, ".").slice(0, grid.columns);
    for (const char of normalized) {
      if (!allowedGlyph.test(char)) {
        throw new Error(`sdk:probe compact grid row ${y} has unsupported glyph ${JSON.stringify(char)}.`);
      }
    }
  }
}
