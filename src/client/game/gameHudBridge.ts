import { BUILT_IN_PACKS, previewRowsFromLevel, type DailyProgressState, type PackProgressState, type SavedBoardEntry } from "../../shared/boardPacks";
import type { BoardDesignerIntent, GenerationSummary, LevelBlueprint } from "../../shared/evolution";
import type { GameCosmetics, GameSettings } from "../../shared/saveState";
import type { GameEventRecord } from "../../shared/gameEvents";
import type { Ball } from "./gameEntityTypes";
import { POWER_DURATIONS } from "./gameVisualConfig";
import type { PowerupTone } from "./powerups";
import { powerupToneFor } from "./powerups";
import type { BoardContext, GamePhase } from "./gameEntityTypes";

export interface HudSnapshot {
  status?: string;
  phase: GamePhase;
  score: number;
  bestScore: number;
  lives: number;
  level: number;
  brickCount: number;
  combo: number;
  recentEvents: GameEventRecord[];
  announcement: string;
  loadingLevel: boolean;
  hasSave: boolean;
  sidebarCollapsed: boolean;
  laserTimer: number;
  grabTimer: number;
  balls: Ball[];
  paddleWidth: number;
  boardContext: BoardContext;
  designerIntent: BoardDesignerIntent;
  latestGenerationSummary?: GenerationSummary;
  powerupPrimerDismissed: boolean;
  settings: GameSettings;
  dailyProgress: DailyProgressState;
  packProgress: PackProgressState;
  savedBoards: SavedBoardEntry[];
  agentMode: {
    enabled: boolean;
    timeScale: number;
    paddleMode: "manual" | "auto";
  };
}

export function buildHudUpdateSignature(snapshot: HudSnapshot): string {
  const ballFire = Math.max(0, ...snapshot.balls.map((ball) => ball.fireTimer));
  const ballThru = Math.max(0, ...snapshot.balls.map((ball) => ball.thruTimer));
  const ballMega = Math.max(0, ...snapshot.balls.map((ball) => ball.megaTimer));
  return [
    snapshot.status ?? "",
    snapshot.phase,
    snapshot.score,
    snapshot.bestScore,
    snapshot.lives,
    snapshot.level,
    snapshot.brickCount,
    snapshot.combo.toFixed(2),
    snapshot.recentEvents.map((entry) => `${entry.audience}:${entry.text}`).join("|"),
    snapshot.announcement,
    snapshot.loadingLevel,
    snapshot.hasSave,
    snapshot.sidebarCollapsed,
    Math.ceil(snapshot.laserTimer),
    Math.ceil(snapshot.grabTimer),
    Math.ceil(ballFire),
    Math.ceil(ballThru),
    Math.ceil(ballMega),
    snapshot.paddleWidth,
    snapshot.boardContext.source,
    snapshot.boardContext.packId ?? "",
    snapshot.designerIntent.brief,
    snapshot.latestGenerationSummary?.title ?? "",
    snapshot.powerupPrimerDismissed,
    snapshot.settings.sfxVolume,
    snapshot.settings.musicVolume,
    snapshot.settings.particles,
    snapshot.settings.reducedMotion,
    snapshot.settings.highContrast,
    snapshot.agentMode.enabled,
    snapshot.agentMode.timeScale,
    snapshot.agentMode.paddleMode
  ].join("§");
}

export function collectCosmeticOptions(snapshot: Pick<HudSnapshot, "packProgress" | "dailyProgress" | "savedBoards" | "bestScore">) {
  const anyPackComplete = BUILT_IN_PACKS.some((pack) => (snapshot.packProgress[pack.id]?.cleared ?? 0) >= pack.boards.length);
  const dailyComplete = Object.values(snapshot.dailyProgress).some((progress) => progress.completed);
  const sharedOrSaved = snapshot.savedBoards.length > 0 || snapshot.bestScore >= 5000;
  return {
    paddleSkins: [
      { id: "classic" as const, label: "Classic Chrome", unlocked: true },
      { id: "neon" as const, label: "Neon Circuit - clear a pack or daily", unlocked: anyPackComplete || dailyComplete },
      { id: "gold" as const, label: "Gold Medal - keep a board or 5k best", unlocked: sharedOrSaved }
    ],
    ballTrails: [
      { id: "classic" as const, label: "Classic Spark", unlocked: true },
      { id: "comet" as const, label: "Comet - clear a pack or daily", unlocked: anyPackComplete || dailyComplete },
      { id: "aurora" as const, label: "Aurora - keep a board or 5k best", unlocked: sharedOrSaved }
    ],
    boardBackplates: [
      { id: "default" as const, label: "Default Arena", unlocked: true },
      { id: "midnight" as const, label: "Midnight Grid - clear a pack or daily", unlocked: anyPackComplete || dailyComplete },
      { id: "sunrise" as const, label: "Sunrise Vault - keep a board or 5k best", unlocked: sharedOrSaved }
    ]
  };
}

export function clampCosmetics(cosmetics: GameCosmetics, snapshot: Pick<HudSnapshot, "packProgress" | "dailyProgress" | "savedBoards" | "bestScore">): GameCosmetics {
  const options = collectCosmeticOptions(snapshot);
  return {
    paddleSkin: options.paddleSkins.some((option) => option.id === cosmetics.paddleSkin && option.unlocked) ? cosmetics.paddleSkin : "classic",
    ballTrail: options.ballTrails.some((option) => option.id === cosmetics.ballTrail && option.unlocked) ? cosmetics.ballTrail : "classic",
    boardBackplate: options.boardBackplates.some((option) => option.id === cosmetics.boardBackplate && option.unlocked) ? cosmetics.boardBackplate : "default"
  };
}

export function collectActivePowers(snapshot: Pick<HudSnapshot, "laserTimer" | "grabTimer" | "balls">) {
  const rows: { label: string; seconds: number; maxSeconds: number; tone: PowerupTone }[] = [];
  if (snapshot.laserTimer > 0) rows.push({ label: "Laser", seconds: Math.ceil(snapshot.laserTimer), maxSeconds: POWER_DURATIONS.Laser, tone: powerupToneFor("shootingPaddle") });
  if (snapshot.grabTimer > 0) rows.push({ label: "Grab", seconds: Math.ceil(snapshot.grabTimer), maxSeconds: POWER_DURATIONS.Grab, tone: powerupToneFor("grabPaddle") });
  if (snapshot.balls.length > 0) {
    const fire = Math.max(0, ...snapshot.balls.map((ball) => ball.fireTimer));
    const thru = Math.max(0, ...snapshot.balls.map((ball) => ball.thruTimer));
    const mega = Math.max(0, ...snapshot.balls.map((ball) => ball.megaTimer));
    if (fire > 0) rows.push({ label: "Fire", seconds: Math.ceil(fire), maxSeconds: POWER_DURATIONS.Fire, tone: powerupToneFor("fireball") });
    if (thru > 0) rows.push({ label: "Thru", seconds: Math.ceil(thru), maxSeconds: POWER_DURATIONS.Thru, tone: powerupToneFor("thruBrick") });
    if (mega > 0) rows.push({ label: "Mega", seconds: Math.ceil(mega), maxSeconds: POWER_DURATIONS.Mega, tone: powerupToneFor("megaBall") });
  }
  return rows.slice(0, 5);
}
