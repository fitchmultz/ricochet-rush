export const CURSOR_MODEL = {
  id: "composer-2",
  params: [{ id: "mode", value: "fast" }]
};

export const BRICK_COLUMNS = 14;
export const BRICK_ROWS = 9;
export const MIN_BRICKS = 34;
export const MAX_BRICKS = 86;

export type BrickKind =
  | "basic"
  | "hard"
  | "bomb"
  | "prize"
  | "penalty"
  | "laser"
  | "grab"
  | "fire"
  | "thru"
  | "split"
  | "wide"
  | "slow"
  | "boss";

export interface BrickSpec {
  kind: BrickKind;
  hp: number;
}

export type BrickCell = BrickSpec | null;

export interface LevelRequest {
  level: number;
  score: number;
  lives: number;
  clearedLevels: number;
  recentEvents: string[];
}

export interface LevelBlueprint {
  name: string;
  briefing: string;
  paddleHint: string;
  speed: number;
  rows: BrickCell[][];
}

export interface LevelResponse {
  level: LevelBlueprint;
  source: "cursor-sdk" | "fallback";
  model: typeof CURSOR_MODEL;
  warning?: string;
  trace?: ComposerAgentTrace;
}

export interface ComposerAgentTrace {
  request: LevelRequest;
  requestJson: string;
  prompt: string;
  rawOutput: string;
  rawError: string;
  parseStatus: "success" | "parse-failed" | "worker-failed";
  parseError?: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  workerExitCode?: number | null;
  parsedOutput?: unknown;
}

const BRICK_KINDS = new Set<BrickKind>([
  "basic",
  "hard",
  "bomb",
  "prize",
  "penalty",
  "laser",
  "grab",
  "fire",
  "thru",
  "split",
  "wide",
  "slow",
  "boss"
]);

export function normalizeLevel(input: unknown, request: LevelRequest): LevelBlueprint {
  const raw = isRecord(input) ? input : {};
  if (!Array.isArray(raw.rows)) return fallbackLevel(request);
  const rows = repairBrickCount(normalizeRows(raw.rows, request.level), request.level);
  return {
    name: stringValue(raw.name, `Sector ${request.level}`),
    briefing: stringValue(raw.briefing, "Break the wall before it learns your rhythm."),
    paddleHint: stringValue(raw.paddleHint, "Keep the ball angled. Flat returns are a trap."),
    speed: clamp(numberValue(raw.speed, 1 + request.level * 0.04), 0.85, 1.85),
    rows
  };
}

export function fallbackLevel(request: LevelRequest): LevelBlueprint {
  const rows: BrickCell[][] = [];
  for (let y = 0; y < BRICK_ROWS; y += 1) {
    const row: BrickCell[] = [];
    for (let x = 0; x < BRICK_COLUMNS; x += 1) {
      const edge = x === 0 || x === BRICK_COLUMNS - 1;
      const wave = (x * 3 + y * 5 + request.level) % 7;
      if (y > 6 || wave === 0) {
        row.push(null);
      } else if (edge && request.level > 2) {
        row.push({ kind: "hard", hp: 2 });
      } else if ((x + y + request.level) % 11 === 0) {
        row.push({ kind: "bomb", hp: 1 });
      } else if ((x * y + request.level) % 13 === 0) {
        row.push({ kind: "split", hp: 1 });
      } else if ((x + request.level) % 9 === 0) {
        row.push({ kind: "wide", hp: 1 });
      } else if ((x * 7 + y + request.level) % 17 === 0) {
        row.push({ kind: "laser", hp: 1 });
      } else if ((x + y * 4 + request.level) % 19 === 0) {
        row.push({ kind: "fire", hp: 1 });
      } else if ((x * 5 + y * 2 + request.level) % 23 === 0) {
        row.push({ kind: "grab", hp: 1 });
      } else if ((x * 11 + y + request.level) % 29 === 0) {
        row.push({ kind: "thru", hp: 1 });
      } else if ((x + y * 9 + request.level) % 31 === 0) {
        row.push({ kind: "prize", hp: 1 });
      } else if (request.level > 3 && (x * 13 + y * 3 + request.level) % 37 === 0) {
        row.push({ kind: "penalty", hp: 1 });
      } else {
        row.push({ kind: "basic", hp: 1 });
      }
    }
    rows.push(row);
  }

  if (request.level % 4 === 0) {
    rows[2][6] = { kind: "boss", hp: 5 + Math.floor(request.level / 2) };
    rows[2][7] = { kind: "boss", hp: 5 + Math.floor(request.level / 2) };
  }

  return {
    name: `Fallback Sector ${request.level}`,
    briefing: "The local generator built a wall with bombs, weapon bricks, and heavier corners.",
    paddleHint: "Break bomb bricks first to open routes.",
    speed: clamp(1 + request.level * 0.05, 0.95, 1.65),
    rows
  };
}

function normalizeRows(input: unknown, level: number): BrickCell[][] {
  if (!Array.isArray(input)) return fallbackLevel({ level, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] }).rows;
  const rows: BrickCell[][] = [];
  for (let y = 0; y < BRICK_ROWS; y += 1) {
    const sourceRow = Array.isArray(input[y]) ? input[y] : [];
    const row: BrickCell[] = [];
    for (let x = 0; x < BRICK_COLUMNS; x += 1) {
      row.push(normalizeBrick(sourceRow[x]));
    }
    rows.push(row);
  }
  return rows;
}

function normalizeBrick(input: unknown): BrickCell {
  if (input === null || input === 0 || input === false) return null;
  if (!isRecord(input)) return null;
  const kind = input.kind;
  if (typeof kind !== "string" || !BRICK_KINDS.has(kind as BrickKind)) return null;
  const hp = clamp(Math.round(numberValue(input.hp, kind === "hard" ? 2 : 1)), 1, kind === "boss" ? 12 : 4);
  return { kind: kind as BrickKind, hp };
}

function countBricks(rows: BrickCell[][]): number {
  return rows.flat().filter(Boolean).length;
}

function repairBrickCount(rows: BrickCell[][], level: number): BrickCell[][] {
  const repaired = rows.map((row) => [...row]);
  let count = countBricks(repaired);
  if (count > MAX_BRICKS) {
    for (let y = BRICK_ROWS - 1; y >= 0 && count > MAX_BRICKS; y -= 1) {
      for (let x = (y + level) % 2; x < BRICK_COLUMNS && count > MAX_BRICKS; x += 2) {
        const brick = repaired[y][x];
        if (!brick || brick.kind === "boss") continue;
        repaired[y][x] = null;
        count -= 1;
      }
    }
  }

  if (count < MIN_BRICKS) {
    for (let y = 0; y < BRICK_ROWS && count < MIN_BRICKS; y += 1) {
      for (let x = (y + level) % 3; x < BRICK_COLUMNS && count < MIN_BRICKS; x += 3) {
        if (repaired[y][x]) continue;
        const toughLane = level > 2 && (x + y + level) % 5 === 0;
        repaired[y][x] = toughLane ? { kind: "hard", hp: 2 } : { kind: "basic", hp: 1 };
        count += 1;
      }
    }
  }

  return repaired;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? trimForUi(value.trim(), 110) : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function trimForUi(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength + 1);
  const wordBreak = clipped.lastIndexOf(" ");
  const end = wordBreak > maxLength * 0.66 ? wordBreak : maxLength;
  return `${value.slice(0, end).trimEnd()}...`;
}
