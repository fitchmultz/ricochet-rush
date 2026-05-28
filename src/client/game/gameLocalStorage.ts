import {
  DEFAULT_SETTINGS,
  type GameCosmetics,
  type GameSave,
  type GameSettings,
  type SavedBallState,
  type SavedBrick,
  normalizeCosmetics,
  normalizeSaveState,
  normalizeSettings
} from "../../shared/saveState";
import { normalizeDesignerIntent } from "../../shared/evolution";
import { normalizeDailyProgress, normalizePackProgress, normalizeSavedBoards } from "../../shared/boardPacks";

export const SAVE_KEY = "ricochet-rush-save";
export const SETTINGS_KEY = "ricochet-rush-settings";
export const COSMETICS_KEY = "ricochet-rush-cosmetics";
export const SIDEBAR_COLLAPSED_KEY = "ricochet-rush-sidebar-collapsed";
export const BEST_SCORE_KEY = "ricochet-rush-best-score";
export const PACK_PROGRESS_KEY = "ricochet-rush-pack-progress";
export const DAILY_PROGRESS_KEY = "ricochet-rush-daily-progress";
export const SAVED_BOARDS_KEY = "ricochet-rush-saved-boards";
export const SAVED_BOARDS_MAX = 24;
export const DESIGNER_INTENT_KEY = "ricochet-rush-designer-intent";
export const POWERUP_PRIMER_DISMISSED_KEY = "ricochet-rush-powerup-primer-dismissed";

export function readJson<T>(key: string, normalize: (value: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch (error) {
    warnStorageFailure("read", key, error);
    return null;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    warnStorageFailure("write", key, error);
  }
}

export function warnStorageFailure(operation: "read" | "write", key: string, error: unknown) {
  const reason = error instanceof DOMException || error instanceof Error ? error.name : "unknown error";
  console.warn(`Ricochet Rush could not ${operation} local state ${key}: ${reason}.`);
}

export function readSave(): GameSave | null {
  return readJson(SAVE_KEY, normalizeSaveState);
}

export function readSettings(): GameSettings {
  const storedSettings = readJson(SETTINGS_KEY, normalizeSettingsObject);
  return storedSettings ? normalizeSettings(storedSettings) : { ...DEFAULT_SETTINGS, reducedMotion: prefersReducedMotion() };
}

export function normalizeSettingsObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function readBestScore(): number {
  const value = Number(localStorage.getItem(BEST_SCORE_KEY));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function writeBestScore(score: number) {
  writeJson(BEST_SCORE_KEY, Math.max(0, Math.round(score)));
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function actionControlTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>("button:not(:disabled), a[href], [role='button']:not([aria-disabled='true'])");
}

export function isArenaPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest("button, input, textarea, select, .panel, .tool-panel, .game-overlay, .touch-controls");
}

export function toSavedBall(ball: {
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
}): SavedBallState {
  return {
    x: ball.x,
    y: ball.y,
    vx: ball.vx,
    vy: ball.vy,
    radius: ball.radius,
    stuck: ball.stuck,
    stuckOffset: ball.stuckOffset,
    fireTimer: ball.fireTimer,
    thruTimer: ball.thruTimer,
    megaTimer: ball.megaTimer
  };
}

export function toSavedBrick(brick: {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: SavedBrick["kind"];
  hp: number;
  maxHp: number;
}): SavedBrick {
  return {
    x: brick.x,
    y: brick.y,
    width: brick.width,
    height: brick.height,
    kind: brick.kind,
    hp: brick.hp,
    maxHp: brick.maxHp
  };
}

export { normalizeCosmetics, normalizeDesignerIntent, normalizeDailyProgress, normalizePackProgress, normalizeSavedBoards };
