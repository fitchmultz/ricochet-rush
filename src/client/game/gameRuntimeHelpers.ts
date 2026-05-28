import { SAVED_DESIGNS_PACK_ID } from "../../shared/boardPacks";
import type { LevelBlueprint, LevelRequest } from "../../shared/evolution";
import type { GameCosmetics, SavedRunStats } from "../../shared/saveState";
import { clamp } from "../../shared/util";
import type { Ball, BoardContext, BoardTheme, Brick, RunStats } from "./gameEntityTypes";
import { BOARD_THEMES, POWERUP_NAMES, POWERUP_VISUALS } from "./gameVisualConfig";
import type { GameAudioPlayOptions, GameSoundKind } from "./gameAudio";
import type { BrickKind } from "../../shared/evolution";
import type { PowerupKind, PowerupTone } from "./powerups";
import { powerupToneFor } from "./powerups";

export function pick<T>(items: readonly [T, ...T[]]): T;
export function pick<T>(items: readonly T[]): T;
export function pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("pick() requires at least one item.");
  return items[Math.floor(Math.random() * items.length)]!;
}

export function powerupVisualFor(kind: PowerupKind): (typeof POWERUP_VISUALS)[PowerupTone] {
  return POWERUP_VISUALS[powerupToneFor(kind)];
}

export function pickupLabelFor(kind: PowerupKind): string {
  const tone = powerupToneFor(kind);
  if (tone === "hazard") return `-${POWERUP_NAMES[kind]}`;
  if (tone === "volatile") return `! ${POWERUP_NAMES[kind]}`;
  return `+${POWERUP_NAMES[kind]}`;
}

export function pseudoRandom(index: number, salt: number): number {
  return fract(Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453);
}

export function fract(value: number): number {
  return value - Math.floor(value);
}

export function boardThemeFor(context: BoardContext): BoardTheme {
  if (context.source === "generated") return BOARD_THEMES.generated;
  return BOARD_THEMES[context.packId] ?? BOARD_THEMES.starter;
}

export function createRunStats(scoreAtRunStart: number, bestScoreAtRunStart: number): RunStats {
  const now = Date.now();
  return {
    runStartedAt: now,
    levelStartedAt: now,
    scoreAtRunStart,
    bestScoreAtRunStart,
    bricksBroken: 0,
    longestCombo: 1,
    powerupsCaught: 0,
    boardsCleared: 0
  };
}

export function toSavedRunStats(stats: RunStats): SavedRunStats {
  return { ...stats };
}

export function fromSavedRunStats(stats: SavedRunStats, score: number, bestScore: number): RunStats {
  return {
    ...createRunStats(score, bestScore),
    runStartedAt: stats.runStartedAt,
    levelStartedAt: stats.levelStartedAt,
    scoreAtRunStart: stats.scoreAtRunStart,
    bestScoreAtRunStart: stats.bestScoreAtRunStart,
    bricksBroken: stats.bricksBroken,
    longestCombo: stats.longestCombo,
    powerupsCaught: stats.powerupsCaught,
    boardsCleared: stats.boardsCleared
  };
}

export function paddleCosmetic(skin: GameCosmetics["paddleSkin"], highContrast: boolean) {
  if (highContrast) return { color: "#ffffff", emissive: "#ffe066", glow: "#ffe066", specular: "#ffffff", emissiveIntensity: 0.58 };
  if (skin === "gold") return { color: "#fff0a6", emissive: "#ffb000", glow: "#ffe066", specular: "#ffffff", emissiveIntensity: 0.64 };
  if (skin === "neon") return { color: "#dffcff", emissive: "#8e7dff", glow: "#b6fffa", specular: "#d6ff4d", emissiveIntensity: 0.56 };
  return { color: "#e9ffff", emissive: "#35f3ff", glow: "#7ef1ff", specular: "#ffffff", emissiveIntensity: 0.48 };
}

export function ballCosmeticColor(trail: GameCosmetics["ballTrail"], highContrast: boolean): string {
  if (highContrast) return "#ffffff";
  if (trail === "aurora") return "#b6fffa";
  if (trail === "comet") return "#ff9f43";
  return "#ffe066";
}

export function boardBackplateCosmetic(backplate: GameCosmetics["boardBackplate"], theme: BoardTheme, highContrast: boolean): BoardTheme {
  if (highContrast) return { scene: "#010307", floor: "#010307", wall: theme.wall, wallGlow: "#ffe066", rim: "#ffe066" };
  if (backplate === "midnight") return { scene: "#040414", floor: "#070920", wall: theme.wall, wallGlow: "#8e7dff", rim: "#b6fffa" };
  if (backplate === "sunrise") return { scene: "#160b10", floor: "#1b1013", wall: theme.wall, wallGlow: "#ff9f43", rim: "#ffe066" };
  return theme;
}

export function cloneLevelBlueprint(level: LevelBlueprint): LevelBlueprint {
  return {
    name: level.name,
    briefing: level.briefing,
    paddleHint: level.paddleHint,
    speed: level.speed,
    rows: level.rows.map((row) => row.map((cell) => (cell ? { ...cell } : null)))
  };
}

export function authoredBoardRequestForSaved(request: LevelRequest): LevelRequest {
  return {
    level: request.level,
    score: request.score,
    lives: request.lives,
    clearedLevels: request.clearedLevels,
    recentEvents: request.recentEvents
  };
}

export function formatRunDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

export function savedBoardPackId(index: number): string {
  return `${SAVED_DESIGNS_PACK_ID}:${index}`;
}

export function savedBoardIndexFromPackId(packId: string): number | null {
  if (!packId.startsWith(`${SAVED_DESIGNS_PACK_ID}:`)) return null;
  const index = Number(packId.slice(SAVED_DESIGNS_PACK_ID.length + 1));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function drawScoreCardPreview(context: CanvasRenderingContext2D, rows: string[], x: number, y: number, cell: number) {
  const colors: Record<string, string> = {
    ".": "rgba(255,255,255,0.05)",
    b: "#4ecdc4",
    h: "#7d8ca3",
    o: "#ff5c5c",
    p: "#7bf1a8",
    x: "#b23a48",
    l: "#ff4d8d",
    f: "#ff7a2f",
    g: "#b6fffa",
    s: "#ffe066",
    w: "#7bf1a8",
    c: "#8e7dff",
    t: "#d6ff4d",
    B: "#ff9f43"
  };
  for (const [rowIndex, row] of rows.slice(0, 9).entries()) {
    for (const [columnIndex, glyph] of row.slice(0, 14).padEnd(14, ".").split("").entries()) {
      context.fillStyle = colors[glyph] ?? colors.b;
      context.fillRect(x + columnIndex * (cell + 2), y + rowIndex * (cell + 2), cell, cell * 0.72);
    }
  }
}

export function soundForBrickDestroy(kind: BrickKind): GameSoundKind {
  if (kind === "boss") return "bossBrick";
  if (kind === "hard") return "hardBrick";
  if (kind === "basic") return "brickDestroy";
  return "specialBrick";
}

export function brickAudioOptions(brick: Brick, combo: number, destroyed: boolean): GameAudioPlayOptions {
  const materialPitch: Record<BrickKind, number> = {
    basic: 1,
    hard: 0.72,
    bomb: 0.82,
    prize: 1.24,
    penalty: 0.86,
    laser: 1.36,
    grab: 1.18,
    fire: 0.98,
    thru: 1.3,
    split: 1.2,
    wide: 1.12,
    slow: 0.92,
    boss: 0.58
  };
  const hpRatio = brick.maxHp > 0 ? clamp(brick.hp / brick.maxHp, 0, 1) : 0;
  const comboLift = clamp((combo - 1) * 0.035, 0, 0.24);
  return {
    pitch: materialPitch[brick.kind] + comboLift + (destroyed ? 0.08 : 0),
    intensity: clamp(0.82 + (1 - hpRatio) * 0.24 + (destroyed ? 0.18 : 0) + comboLift * 0.5, 0.72, 1.34),
    rumble: brick.kind === "boss" ? 0.58 : brick.kind === "bomb" && destroyed ? 0.46 : brick.kind === "hard" ? 0.18 : 0
  };
}

export function soundForPowerup(kind: PowerupKind): GameSoundKind {
  if (kind === "extraLife") return "extraLife";
  if (kind === "levelWarp") return "levelWarp";
  const tone = powerupToneFor(kind);
  if (tone === "volatile") return "volatilePowerup";
  if (tone === "hazard") return "badPowerup";
  return "goodPowerup";
}

export function powerupAudioOptions(kind: PowerupKind): GameAudioPlayOptions {
  const tone = powerupToneFor(kind);
  if (tone === "volatile") return { pitch: 0.96, intensity: 1.12, rumble: 0.44 };
  if (tone === "hazard") return { pitch: 0.82, intensity: 1.04, rumble: 0.28 };
  return { pitch: kind === "extraLife" ? 1.16 : 1.04, intensity: 0.94 };
}
