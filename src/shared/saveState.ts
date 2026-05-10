import { normalizeLevel, type BrickKind, type LevelBlueprint } from "./evolution";

export const SAVE_VERSION = 3;

export interface GameSettings {
  ballSpeed: number;
  particles: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  sfx: boolean;
  music: boolean;
}

export interface SavedBrick {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: BrickKind;
  hp: number;
  maxHp: number;
}

export interface SavedBallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  stuck: boolean;
  stuckOffset: number;
  fireTimer: number;
  thruTimer: number;
  megaTimer: number;
}

export interface GameSave {
  version: typeof SAVE_VERSION;
  savedAt: string;
  level: number;
  clearedLevels: number;
  boardSource: "pack" | "generated";
  packId: string | null;
  packBoardIndex: number;
  score: number;
  bestScore: number;
  lives: number;
  combo: number;
  paddleWidth: number;
  levelBlueprint: LevelBlueprint;
  bricks: SavedBrick[];
  recentEvents: string[];
  laserTimer: number;
  grabTimer: number;
  explosionScale: number;
  balls: SavedBallState[] | null;
}

export const DEFAULT_SETTINGS: GameSettings = {
  ballSpeed: 1,
  particles: true,
  reducedMotion: false,
  highContrast: false,
  sfx: false,
  music: false
};

const BRICK_KINDS = new Set<BrickKind>(["basic", "hard", "bomb", "prize", "penalty", "laser", "grab", "fire", "thru", "split", "wide", "slow", "boss"]);

export function normalizeSettings(input: unknown): GameSettings {
  const raw = isRecord(input) ? input : {};
  const legacySound = booleanValue(raw.sound, DEFAULT_SETTINGS.sfx);
  return {
    ballSpeed: clamp(numberValue(raw.ballSpeed, DEFAULT_SETTINGS.ballSpeed), 0.8, 1.2),
    particles: booleanValue(raw.particles, DEFAULT_SETTINGS.particles),
    reducedMotion: booleanValue(raw.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
    highContrast: booleanValue(raw.highContrast, DEFAULT_SETTINGS.highContrast),
    sfx: booleanValue(raw.sfx, legacySound),
    music: booleanValue(raw.music, DEFAULT_SETTINGS.music)
  };
}

export function normalizeSaveState(input: unknown): GameSave | null {
  if (!isRecord(input) || !isRecord(input.levelBlueprint) || !Array.isArray(input.bricks)) return null;
  const rawVersion = input.version;
  if (rawVersion !== SAVE_VERSION && rawVersion !== 2 && rawVersion !== 1) return null;

  const level = positiveInteger(input.level);
  const score = nonNegativeInteger(input.score);
  const lives = positiveInteger(input.lives);
  if (level === null || score === null || lives === null) return null;

  const hasPowerSnapshot = rawVersion === SAVE_VERSION || rawVersion === 2;
  const laserTimer = hasPowerSnapshot ? clamp(numberValue(input.laserTimer, 0), 0, 120) : 0;
  const grabTimer = hasPowerSnapshot ? clamp(numberValue(input.grabTimer, 0), 0, 120) : 0;
  const explosionScale = hasPowerSnapshot ? clamp(numberValue(input.explosionScale, 1), 1, 2.5) : 1;

  let balls: SavedBallState[] | null = null;
  if (hasPowerSnapshot && Array.isArray(input.balls)) {
    const parsed = input.balls.map(normalizeSavedBall).filter((b): b is SavedBallState => b !== null);
    balls = parsed.length > 0 ? parsed.slice(0, 10) : null;
  }
  const boardSource = rawVersion === SAVE_VERSION && input.boardSource === "pack" ? "pack" : "generated";

  const levelBlueprint = normalizeLevel(input.levelBlueprint, { level, score, lives, clearedLevels: 0, recentEvents: [] });
  return {
    version: SAVE_VERSION,
    savedAt: stringValue(input.savedAt, new Date(0).toISOString()),
    level,
    clearedLevels: nonNegativeInteger(input.clearedLevels) ?? Math.max(0, level - 1),
    boardSource,
    packId: boardSource === "pack" && typeof input.packId === "string" && input.packId.trim().length > 0 ? input.packId.trim().slice(0, 80) : null,
    packBoardIndex: boardSource === "pack" ? nonNegativeInteger(input.packBoardIndex) ?? 0 : 0,
    score,
    bestScore: Math.max(score, nonNegativeInteger(input.bestScore) ?? score),
    lives,
    combo: clamp(numberValue(input.combo, 1), 1, 8),
    paddleWidth: clamp(numberValue(input.paddleWidth, 116), 58, 210),
    levelBlueprint,
    bricks: input.bricks.map(normalizeBrick).filter((brick): brick is SavedBrick => brick !== null),
    recentEvents: Array.isArray(input.recentEvents) ? input.recentEvents.filter((event): event is string => typeof event === "string").slice(0, 6) : [],
    laserTimer,
    grabTimer,
    explosionScale,
    balls
  };
}

function normalizeSavedBall(input: unknown): SavedBallState | null {
  if (!isRecord(input)) return null;
  const x = numberValue(input.x, Number.NaN);
  const y = numberValue(input.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    vx: clamp(numberValue(input.vx, 0), -2000, 2000),
    vy: clamp(numberValue(input.vy, 0), -2000, 2000),
    radius: clamp(numberValue(input.radius, 8), 5, 20),
    stuck: booleanValue(input.stuck, false),
    stuckOffset: clamp(numberValue(input.stuckOffset, 0), -400, 400),
    fireTimer: clamp(numberValue(input.fireTimer, 0), 0, 120),
    thruTimer: clamp(numberValue(input.thruTimer, 0), 0, 120),
    megaTimer: clamp(numberValue(input.megaTimer, 0), 0, 120)
  };
}

function normalizeBrick(input: unknown): SavedBrick | null {
  if (!isRecord(input)) return null;
  const x = numberValue(input.x, Number.NaN);
  const y = numberValue(input.y, Number.NaN);
  const width = numberValue(input.width, Number.NaN);
  const height = numberValue(input.height, Number.NaN);
  const hp = positiveInteger(input.hp);
  const maxHp = positiveInteger(input.maxHp);
  const kind = input.kind;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (typeof kind !== "string" || !BRICK_KINDS.has(kind as BrickKind)) return null;
  if (hp === null || maxHp === null) return null;
  return { x, y, width, height, kind: kind as BrickKind, hp, maxHp };
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, 140) : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
