import { BRICK_COLUMNS, BRICK_ROWS, normalizeLevel, type BrickKind, type LevelBlueprint, type LevelRequest } from "./evolution";
import { previewRowsFromLevel } from "./boardPacks";
import { isRecord } from "./util";

export const BOARD_EXPORT_VERSION = 1;
export const BOARD_EXPORT_APP = "ricochet-rush";

export interface BoardExportPayload {
  app: typeof BOARD_EXPORT_APP;
  version: typeof BOARD_EXPORT_VERSION;
  exportedAt: string;
  sourcePrompt: string;
  board: LevelBlueprint;
  previewRows: string[];
}

export interface BoardImportResult {
  ok: boolean;
  level?: LevelBlueprint;
  sourcePrompt?: string;
  message: string;
}

const IMPORT_REQUEST: LevelRequest = { level: 1, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] };

export function createBoardExportPayload(level: LevelBlueprint, sourcePrompt: string, exportedAt = new Date().toISOString()): BoardExportPayload {
  const board = cloneLevel(level);
  return {
    app: BOARD_EXPORT_APP,
    version: BOARD_EXPORT_VERSION,
    exportedAt,
    sourcePrompt: sourcePrompt.trim().slice(0, 180) || "Shared Ricochet board",
    board,
    previewRows: previewRowsFromLevel(board)
  };
}

export function encodeBoardExport(payload: BoardExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function parseBoardExport(input: string): BoardImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return { ok: false, message: "Import rejected: board JSON is not valid." };
  }
  if (!isRecord(raw)) return { ok: false, message: "Import rejected: export must be an object." };
  if (raw.app !== BOARD_EXPORT_APP) return { ok: false, message: "Import rejected: this is not a Ricochet Rush board export." };
  if (raw.version !== BOARD_EXPORT_VERSION) return { ok: false, message: "Import rejected: unsupported board export version." };
  if (!isRecord(raw.board)) return { ok: false, message: "Import rejected: missing board payload." };
  if (!isStrictLevelBlueprint(raw.board)) return { ok: false, message: "Import rejected: board rows or brick data were invalid." };
  const sourcePrompt = typeof raw.sourcePrompt === "string" && raw.sourcePrompt.trim().length > 0 ? raw.sourcePrompt.trim().slice(0, 180) : "Imported shared board";
  try {
    return {
      ok: true,
      level: normalizeLevel(raw.board, IMPORT_REQUEST),
      sourcePrompt,
      message: "Imported shared board. Review it, then launch or keep it."
    };
  } catch {
    return { ok: false, message: "Import rejected: board rows or brick data were invalid." };
  }
}

const EXPORT_BRICK_KINDS = new Set<BrickKind>(["basic", "hard", "bomb", "prize", "penalty", "laser", "grab", "fire", "thru", "split", "wide", "slow", "boss"]);

function isStrictLevelBlueprint(value: Record<string, unknown>): boolean {
  if (typeof value.name !== "string" || value.name.trim().length === 0) return false;
  if (typeof value.briefing !== "string" || value.briefing.trim().length === 0) return false;
  if (typeof value.paddleHint !== "string" || value.paddleHint.trim().length === 0) return false;
  if (typeof value.speed !== "number" || !Number.isFinite(value.speed) || value.speed < 0.65 || value.speed > 1.8) return false;
  if (!Array.isArray(value.rows) || value.rows.length < 1) return false;
  const columns = Array.isArray(value.rows[0]) ? value.rows[0].length : 0;
  if (columns < 1) return false;
  let brickCount = 0;
  for (const row of value.rows) {
    if (!Array.isArray(row) || row.length !== columns) return false;
    for (const cell of row) {
      if (cell === null) continue;
      if (!isRecord(cell)) return false;
      if (typeof cell.kind !== "string" || !EXPORT_BRICK_KINDS.has(cell.kind as BrickKind)) return false;
      if (typeof cell.hp !== "number" || !Number.isFinite(cell.hp) || !Number.isInteger(cell.hp) || cell.hp < 1 || cell.hp > 12) return false;
      brickCount += 1;
    }
  }
  return brickCount > 0;
}

function cloneLevel(level: LevelBlueprint): LevelBlueprint {
  return {
    name: level.name,
    briefing: level.briefing,
    paddleHint: level.paddleHint,
    speed: level.speed,
    rows: level.rows.map((row) => row.map((cell) => (cell ? { ...cell } : null)))
  };
}

