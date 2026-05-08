export const CURSOR_MODEL = {
  id: "composer-2",
  params: [{ id: "mode", value: "fast" }]
};

export const BRICK_COLUMNS = 14;
export const BRICK_ROWS = 9;
export const MIN_BRICKS = 34;
export const MAX_BRICKS = 86;

export const DESIGNER_STYLES = ["balanced", "open-lanes", "bomb-chains", "precision", "boss-core"] as const;

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

export type DesignerStyle = (typeof DESIGNER_STYLES)[number];

export type DesignerVote = "up" | "down";

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
  designer?: BoardDesignerIntent;
}

export interface BoardDesignerFeedback {
  vote: DesignerVote;
  levelName: string;
  style: DesignerStyle;
  seed: string;
  recentEvents: string[];
  createdAt?: string;
}

export interface BoardDesignerIntent {
  style: DesignerStyle;
  difficulty: number;
  density: number;
  specialBias: number;
  seed: string;
  feedback: BoardDesignerFeedback[];
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
  summary?: GenerationSummary;
  warning?: string;
  trace?: ComposerAgentTrace;
}

export interface GenerationSummary {
  source: "cursor-sdk" | "fallback";
  title: string;
  detail: string;
  chips: string[];
  warning?: string;
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

export interface DesignerTargets {
  brickTarget: number;
  specialTarget: number;
  hardTarget: number;
  speedTarget: number;
  difficultyLabel: string;
  styleGoal: string;
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

export const DEFAULT_DESIGNER_INTENT: BoardDesignerIntent = {
  style: "balanced",
  difficulty: 3,
  density: 0.52,
  specialBias: 0.45,
  seed: "fresh-angle",
  feedback: []
};

const STYLE_LABELS: Record<DesignerStyle, string> = {
  balanced: "Balanced",
  "open-lanes": "Open lanes",
  "bomb-chains": "Bomb chains",
  precision: "Precision",
  "boss-core": "Boss core"
};

const STYLE_GOALS: Record<DesignerStyle, string> = {
  balanced: "A readable mix of lanes, shields, rewards, and light risk.",
  "open-lanes": "Two or three clean bank lanes with rewards around the openings.",
  "bomb-chains": "Linked bomb pockets that can open routes without making the board unfair.",
  precision: "Narrow aim windows, deliberate shields, and rewards for controlled angles.",
  "boss-core": "A reachable center core with boss bricks, shields, and power routes."
};

const DIFFICULTY_LABELS = ["soft", "steady", "sharp", "hot", "wild"] as const;

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

export function normalizeDesignerIntent(input: unknown): BoardDesignerIntent {
  const raw = isRecord(input) ? input : {};
  const rawStyle = raw.style;
  const style: DesignerStyle = typeof rawStyle === "string" && isDesignerStyle(rawStyle) ? rawStyle : DEFAULT_DESIGNER_INTENT.style;
  return {
    style,
    difficulty: clamp(Math.round(numberValue(raw.difficulty, DEFAULT_DESIGNER_INTENT.difficulty)), 1, 5),
    density: clamp(numberValue(raw.density, DEFAULT_DESIGNER_INTENT.density), 0.34, 0.82),
    specialBias: clamp(numberValue(raw.specialBias, DEFAULT_DESIGNER_INTENT.specialBias), 0, 1),
    seed: stringValue(raw.seed, DEFAULT_DESIGNER_INTENT.seed).slice(0, 36),
    feedback: Array.isArray(raw.feedback) ? raw.feedback.map(normalizeDesignerFeedback).filter((entry): entry is BoardDesignerFeedback => entry !== null).slice(0, 6) : []
  };
}

export function designerStyleLabel(style: DesignerStyle): string {
  return STYLE_LABELS[style];
}

export function designerStyleGoal(style: DesignerStyle): string {
  return STYLE_GOALS[style];
}

export function designerTargets(intentInput: unknown, level = 1): DesignerTargets {
  const intent = normalizeDesignerIntent(intentInput);
  const brickTarget = clamp(Math.round(BRICK_COLUMNS * BRICK_ROWS * intent.density), MIN_BRICKS, MAX_BRICKS);
  const specialRatio = 0.06 + intent.specialBias * 0.32;
  const difficultyRatio = 0.05 + intent.difficulty * 0.035;
  return {
    brickTarget,
    specialTarget: clamp(Math.round(brickTarget * specialRatio), intent.specialBias > 0 ? 2 : 0, Math.max(2, Math.round(brickTarget * 0.42))),
    hardTarget: clamp(Math.round(brickTarget * difficultyRatio), 1, Math.max(2, Math.round(brickTarget * 0.28))),
    speedTarget: clamp(0.9 + level * 0.035 + intent.difficulty * 0.06, 0.95, 1.75),
    difficultyLabel: DIFFICULTY_LABELS[intent.difficulty - 1] ?? "sharp",
    styleGoal: designerStyleGoal(intent.style)
  };
}

export function describeDesignerIntent(intentInput: unknown): string {
  const intent = normalizeDesignerIntent(intentInput);
  const targets = designerTargets(intent);
  const difficulty = targets.difficultyLabel;
  return `${designerStyleLabel(intent.style)} / ${difficulty} / ${Math.round(intent.density * 100)}% density / ${Math.round(intent.specialBias * 100)}% specials`;
}

export function fallbackLevel(request: LevelRequest): LevelBlueprint {
  const designer = normalizeDesignerIntent(request.designer);
  const targets = designerTargets(designer, request.level);
  const rows = buildFallbackRows(request, designer);

  return {
    name: `${designerStyleLabel(designer.style)} Sector ${request.level}`,
    briefing: `Local designer built a ${designerStyleLabel(designer.style).toLowerCase()} wall from the "${designer.seed}" seed.`,
    paddleHint: hintForDesignerStyle(designer.style),
    speed: targets.speedTarget,
    rows: repairBrickCount(rows, request.level)
  };
}

function buildFallbackRows(request: LevelRequest, designer: BoardDesignerIntent): BrickCell[][] {
  const rows = Array.from({ length: BRICK_ROWS }, () => Array.from({ length: BRICK_COLUMNS }, () => null as BrickCell));
  const targets = designerTargets(designer, request.level);
  const seed = hashText(`${request.level}:${request.score}:${designer.style}:${designer.seed}`);
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = 0; y < BRICK_ROWS - 2; y += 1) {
    for (let x = 0; x < BRICK_COLUMNS; x += 1) {
      if (designer.style === "open-lanes" && y > 0 && (x === 2 || x === 11)) continue;
      if (designer.style === "precision" && y > 0 && Math.abs(x - 6.5) > 4 && (x + y + seed) % 3 === 0) continue;
      const centerBias = designer.style === "boss-core" ? Math.abs(x - 6.5) * 17 + y * 5 : 0;
      candidates.push({ x, y, score: hashNumber(seed, x, y) + centerBias });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const selected = candidates.slice(0, targets.brickTarget);
  const specialCells = new Set(
    [...selected]
      .sort((a, b) => hashNumber(seed + 1_037, a.x, a.y) - hashNumber(seed + 1_037, b.x, b.y))
      .slice(0, targets.specialTarget)
      .map(cellKey)
  );
  const hardCells = new Set(
    [...selected]
      .filter((cell) => !specialCells.has(cellKey(cell)))
      .sort((a, b) => hashNumber(seed + 2_071, a.x, a.y) - hashNumber(seed + 2_071, b.x, b.y))
      .slice(0, targets.hardTarget)
      .map(cellKey)
  );

  for (const cell of selected) {
    const key = cellKey(cell);
    if (specialCells.has(key)) {
      rows[cell.y][cell.x] = { kind: pickSpecialKind(designer.style, seed, cell.x, cell.y), hp: 1 };
    } else if (hardCells.has(key)) {
      rows[cell.y][cell.x] = { kind: "hard", hp: clamp(1 + Math.ceil(designer.difficulty / 2), 2, 4) };
    } else {
      rows[cell.y][cell.x] = { kind: "basic", hp: 1 };
    }
  }

  if (designer.style === "boss-core" || (request.level % 5 === 0 && designer.difficulty >= 4)) {
    for (const [x, y] of [
      [6, 2],
      [7, 2],
      [6, 3],
      [7, 3]
    ]) {
      rows[y][x] = { kind: "boss", hp: clamp(4 + designer.difficulty + Math.floor(request.level / 4), 5, 12) };
    }
  }
  return rows;
}

function cellKey(cell: { x: number; y: number }): string {
  return `${cell.x}:${cell.y}`;
}

function pickSpecialKind(style: DesignerStyle, seed: number, x: number, y: number): BrickKind {
  const pools: Record<DesignerStyle, BrickKind[]> = {
    balanced: ["prize", "wide", "split", "laser", "bomb", "slow", "grab", "fire", "thru"],
    "open-lanes": ["wide", "slow", "grab", "split", "prize", "thru"],
    "bomb-chains": ["bomb", "bomb", "fire", "split", "laser", "prize", "penalty"],
    precision: ["thru", "grab", "slow", "laser", "prize"],
    "boss-core": ["fire", "laser", "thru", "split", "bomb", "prize", "penalty"]
  };
  const pool = pools[style];
  return pool[hashNumber(seed, x + 13, y + 29) % pool.length] ?? "prize";
}

function hintForDesignerStyle(style: DesignerStyle): string {
  if (style === "open-lanes") return "Use the open columns for long banks before chasing rewards.";
  if (style === "bomb-chains") return "Trigger bombs from the side so the blast opens a safe route.";
  if (style === "precision") return "Hold a shallow angle and work through the narrow windows.";
  if (style === "boss-core") return "Save fire, laser, or thru power for the center core.";
  return "Open a lane first, then chase powerups when the return angle is safe.";
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

function isDesignerStyle(value: string): value is DesignerStyle {
  return DESIGNER_STYLES.includes(value as DesignerStyle);
}

function normalizeDesignerFeedback(input: unknown): BoardDesignerFeedback | null {
  if (!isRecord(input)) return null;
  const vote = input.vote === "up" || input.vote === "down" ? input.vote : null;
  if (!vote) return null;
  const rawStyle = input.style;
  return {
    vote,
    levelName: stringValue(input.levelName, "Generated Board").slice(0, 80),
    style: typeof rawStyle === "string" && isDesignerStyle(rawStyle) ? rawStyle : DEFAULT_DESIGNER_INTENT.style,
    seed: stringValue(input.seed, DEFAULT_DESIGNER_INTENT.seed).slice(0, 36),
    recentEvents: Array.isArray(input.recentEvents) ? input.recentEvents.filter((event): event is string => typeof event === "string").slice(0, 4) : [],
    createdAt: typeof input.createdAt === "string" ? input.createdAt : undefined
  };
}

function trimForUi(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength + 1);
  const wordBreak = clipped.lastIndexOf(" ");
  const end = wordBreak > maxLength * 0.66 ? wordBreak : maxLength;
  return `${value.slice(0, end).trimEnd()}...`;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashNumber(seed: number, x: number, y: number): number {
  let hash = seed ^ Math.imul(x + 101, 374761393) ^ Math.imul(y + 151, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return (hash ^ (hash >>> 16)) >>> 0;
}
