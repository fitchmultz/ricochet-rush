import * as THREE from "three";
import {
  BRICK_COLUMNS,
  DEFAULT_DESIGNER_INTENT,
  type BoardDesignerIntent,
  type BrickKind,
  type GenerationSummary,
  type LevelBlueprint,
  type LevelRequest,
  type LevelResponse,
  fallbackLevel,
  nextDesignerSeed,
  resolveDesignerIntentForGeneration,
  levelGridDimensions,
  designerTargets,
  normalizeLevel
} from "../../shared/evolution";
import {
  BUILT_IN_PACKS,
  DAILY_PACK_ID,
  SAVED_DESIGNS_PACK_ID,
  type DailyProgressState,
  type PackProgressState,
  type SavedBoardEntry,
  blueprintFingerprint,
  boardCountForPack,
  getBuiltInPack,
  getNextBuiltInPack,
  localDateKey,
  markPackBoardCleared,
  materializeAuthoredBoard,
  materializeDailyBoard,
  previewRowsFromLevel,
  trimSavedBoards
} from "../../shared/boardPacks";
import { createBoardExportPayload, encodeBoardExport, parseBoardExport } from "../../shared/shareState";
import { gameEvent, gameEventsToStrings, type GameEventAudience, type GameEventRecord } from "../../shared/gameEvents";
import { clamp } from "../../shared/util";
import {
  DEFAULT_COSMETICS,
  DEFAULT_SETTINGS,
  SAVE_VERSION,
  type GameCosmetics,
  type GameSave,
  type GameSettings,
  type SavedBallState,
  type SavedBrick,
  type SavedRunStats,
  normalizeSaveState,
  normalizeSettings
} from "../../shared/saveState";
import type { HudApi, HudPackItem } from "../ui/hud";
import { clearEffectLayerChildren, MAX_IMPACT_RINGS, MAX_SCREEN_FLASHES, trimEffectChildren } from "./effects";
import { arenaPointToPercent } from "./scene";
import { createGameAudio, type GameAudioPlayOptions, type GameSoundKind } from "./gameAudio";
import { isLevelGenerationNetworkError, levelGenerationServerHint, requestGeneratedLevel } from "./levelApi";
import {
  calculatePaddleRebound,
  computeStuckBallLaunch,
  detectBrickContact,
  detectPaddleContact,
  normalizeLoopRiskVelocity,
  type LoopRiskVelocity,
  type LoopRiskVelocityInput,
  type PaddleRebound
} from "./physics";
import { penaltyPowerupPool, powerupToneFor, prizePowerupPool, type PowerupKind, type PowerupPoolInput, type PowerupTone } from "./powerups";
import { LAUNCH_LOSS_GRACE_SECONDS } from "./tuning";
import {
  BRICK_GAP,
  BRICK_HEIGHT,
  BRICK_TOP,
  BRICK_WIDTH,
  HEIGHT,
  MAX_BALL_SPEED,
  MAX_PADDLE_VELOCITY,
  MIN_COLLISION_X_RATIO,
  MIN_COLLISION_Y_RATIO,
  PADDLE_Y,
  WALL,
  WIDTH,
  bricksFitLevel,
  computeLevelLayout,
  materializeLevelBricks
} from "./gameArena";
import type {
  Ball,
  Brick,
  BoardContext,
  FloatingText,
  GamePhase,
  LaserBeam,
  LevelLayout,
  LoopCorrectionDebug,
  PaddleHitDebug,
  Powerup,
  RunStats,
  Spark,
  SparkBurstOptions,
  SummaryAction
} from "./gameEntityTypes";
import {
  BEST_SCORE_KEY,
  COSMETICS_KEY,
  DAILY_PROGRESS_KEY,
  DESIGNER_INTENT_KEY,
  PACK_PROGRESS_KEY,
  POWERUP_PRIMER_DISMISSED_KEY,
  SAVED_BOARDS_KEY,
  SAVED_BOARDS_MAX,
  SAVE_KEY,
  SETTINGS_KEY,
  SIDEBAR_COLLAPSED_KEY,
  actionControlTarget,
  isArenaPointerTarget,
  isEditableTarget,
  normalizeBoolean,
  normalizeCosmetics,
  normalizeDailyProgress,
  normalizeDesignerIntent,
  normalizePackProgress,
  normalizeSavedBoards,
  readBestScore,
  readJson,
  readSave,
  readSettings,
  toSavedBall,
  toSavedBrick,
  writeBestScore,
  writeJson
} from "./gameLocalStorage";
import {
  buildHudUpdateSignature,
  clampCosmetics,
  collectActivePowers,
  collectCosmeticOptions
} from "./gameHudBridge";
import { GameOverlay } from "./gameOverlay";
import { buildRunSummaryStats, collectPackItems, nextLevelCompleteStep, packNameFor } from "./gamePackCatalog";
import {
  authoredBoardRequestForSaved,
  boardThemeFor,
  brickAudioOptions,
  cloneLevelBlueprint,
  createRunStats,
  drawScoreCardPreview,
  formatRunDuration,
  fromSavedRunStats,
  pick,
  pickupLabelFor,
  powerupAudioOptions,
  powerupVisualFor,
  savedBoardIndexFromPackId,
  savedBoardPackId,
  soundForBrickDestroy,
  soundForPowerup,
  toSavedRunStats
} from "./gameRuntimeHelpers";
import type { PlayMode } from "./playSession";
import { blockPassiveMouseHover, playClockScale } from "./playSession";
import { chooseAutoPaddleTarget } from "./autoPaddleStrategy";
import {
  decayPaddleVelocity,
  keyboardPaddleDirection,
  keyboardPaddleTargetX,
  movePaddle,
  type PaddleMotionState
} from "./paddleControl";
import { GameSceneView, type SceneFrame } from "./gameSceneView";
import {
  BALL_TRAIL_MIN_SPEED,
  BRICK_BURST_SCALE,
  BRICK_VISUALS,
  COLORS,
  DEFAULT_SPARK_BURST,
  POWERUP_NAMES,
  POWER_DURATIONS
} from "./gameVisualConfig";

interface RicochetRushGameOptions {
  playMode?: PlayMode;
}

export class RicochetRushGame {
  private readonly mount: HTMLDivElement;
  private readonly hud: HudApi;
  private readonly sceneView: GameSceneView;
  private readonly gameOverlay: GameOverlay;
  private readonly playMode: PlayMode;
  private readonly overlay = document.createElement("div");
  private readonly effectsLayer = document.createElement("div");
  private readonly keys = new Set<string>();
  private readonly balls: Ball[] = [];
  private readonly powerups: Powerup[] = [];
  private readonly sparks: Spark[] = [];
  private readonly floatingTexts: FloatingText[] = [];
  private readonly laserBeams: LaserBeam[] = [];
  private readonly brickImpactTimers = new Map<Brick, number>();
  private bricks: Brick[] = [];
  private levelBlueprint: LevelBlueprint = fallbackLevel({ level: 1, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] });
  private levelLayout: LevelLayout = computeLevelLayout(fallbackLevel({ level: 1, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] }));
  private levelSourcePrompt = "Default Ricochet board prompt";
  private settings: GameSettings = DEFAULT_SETTINGS;
  private cosmetics: GameCosmetics = DEFAULT_COSMETICS;
  private phase: GamePhase = "loading";
  private lastTime = 0;
  private paddleX = WIDTH / 2;
  private paddleWidth = 116;
  private level = 1;
  private clearedLevels = 0;
  private score = 0;
  private bestScore = 0;
  private lives = 3;
  private combo = 1;
  private runStats: RunStats = createRunStats(0, 0);
  private laserTimer = 0;
  private laserCooldown = 0;
  private grabTimer = 0;
  private explosionScale = 1;
  private noBallTimer = 0;
  private launchLossGraceTimer = 0;
  private hudUpdateSignature = "";
  private readonly fireExplodedThisTick = new Set<string>();
  private readonly impactRingTimeouts: number[] = [];
  private readonly screenFlashTimeouts: number[] = [];
  private loadingLevel = false;
  private hasSave = false;
  private autosaveSuppressed = false;
  private lastCheckpointAt = 0;
  private recentEvents: GameEventRecord[] = [gameEvent("Break the wall. Catch powerups. Clear the board.")];
  private announcement = "Break the wall. Catch powerups. Clear the board.";
  private latestAgentTrace?: LevelResponse["trace"];
  private sidebarCollapsed = false;
  private lastKeyboardAt = 0;
  private lastPointerAt = 0;
  private paddleVelocityX = 0;
  private lastPaddleHit: PaddleHitDebug | null = null;
  private lastLoopCorrection: LoopCorrectionDebug | null = null;
  private nextFloatingTextId = 1;
  private lastStreakToneAt = 0;
  private boardShakeTimer = 0;
  private boardShakeStrength = 0;
  private paddleFlashTimer = 0;
  private levelClearFlashTimer = 0;
  private lifeFlashTimer = 0;
  private readonly audio = createGameAudio();
  private savedBoards: SavedBoardEntry[] = [];
  private dailyProgress: DailyProgressState = normalizeDailyProgress(null);
  private packProgress: PackProgressState = normalizePackProgress(null, 0);
  private boardContext: BoardContext = { source: "pack", packId: "starter", boardIndex: 0 };
  private designerIntent: BoardDesignerIntent = DEFAULT_DESIGNER_INTENT;
  private powerupPrimerDismissed = false;
  private latestGenerationSummary?: GenerationSummary;

  constructor(mount: HTMLDivElement, hud: HudApi, options: RicochetRushGameOptions = {}) {
    this.mount = mount;
    this.hud = hud;
    this.playMode = options.playMode ?? "normal";
    this.settings = readSettings();
    this.cosmetics = readJson(COSMETICS_KEY, normalizeCosmetics) ?? DEFAULT_COSMETICS;
    this.savedBoards = readJson(SAVED_BOARDS_KEY, normalizeSavedBoards) ?? [];
    this.dailyProgress = readJson(DAILY_PROGRESS_KEY, normalizeDailyProgress) ?? normalizeDailyProgress(null);
    this.packProgress =
      readJson(PACK_PROGRESS_KEY, (input) => normalizePackProgress(input, this.savedBoards.length)) ?? normalizePackProgress(null, this.savedBoards.length);
    this.bestScore = Math.max(readBestScore(), readSave()?.bestScore ?? 0);
    this.cosmetics = clampCosmetics(this.cosmetics, this.hudSnapshot());
    const storedDesignerIntent = readJson(DESIGNER_INTENT_KEY, normalizeDesignerIntent);
    this.designerIntent = {
      ...DEFAULT_DESIGNER_INTENT,
      brief: storedDesignerIntent?.brief ?? DEFAULT_DESIGNER_INTENT.brief,
      visualPreset: storedDesignerIntent?.visualPreset ?? DEFAULT_DESIGNER_INTENT.visualPreset
    };
    this.sidebarCollapsed = readJson(SIDEBAR_COLLAPSED_KEY, normalizeBoolean) ?? false;
    this.powerupPrimerDismissed = readJson(POWERUP_PRIMER_DISMISSED_KEY, normalizeBoolean) ?? false;
    this.sceneView = new GameSceneView(mount);
    this.gameOverlay = new GameOverlay({
      mount,
      overlay: this.overlay,
      closeToolPanel: () => this.hud.closeToolPanel()
    });
    this.sceneView.setupRenderer();
    this.sceneView.setupScene();
    this.sceneView.installPowerupAtlas(
      () => this.pushEvent("Power-up icons are ready.", "technical"),
      () => this.pushEvent("Power-up icons switched to simple gems.", "technical")
    );
    this.bindHudActions();
    this.applySidebarClass();
  }

  start() {
    this.sceneView.renderer.domElement.dataset.testid = "ricochet-rush-canvas";
    this.sceneView.renderer.domElement.tabIndex = 0;
    this.sceneView.renderer.domElement.setAttribute("role", "application");
    this.updateCanvasLabel();
    this.effectsLayer.className = "game-effects";
    this.effectsLayer.setAttribute("aria-hidden", "true");
    this.overlay.className = "game-overlay";
    this.overlay.setAttribute("aria-live", "polite");
    this.mount.replaceChildren(this.sceneView.renderer.domElement, this.effectsLayer, this.overlay);
    this.bindInput();
    const save = readSave();
    if (save) {
      this.restoreSave(save);
      this.pushEvent("Saved run restored.", "technical");
      this.showLevelReadyOverlay("Saved run restored.");
    } else {
      this.startPack("starter", "Starter pack loaded.");
    }
    this.applySettingsClass();
    switch (this.playMode) {
      case "agent-auto":
        this.pushEvent("Debug auto paddle enabled at normal speed.", "technical");
        break;
      case "agent-manual":
        this.pushEvent("Agent mode enabled: game clock slowed for interactive agent play.", "technical");
        break;
      case "normal":
        break;
      default: {
        const unreachable: never = this.playMode;
        throw unreachable;
      }
    }
    this.audio.setSfxVolume(this.settings.sfxVolume);
    this.audio.setMusicVolume(this.settings.musicVolume);
    window.requestAnimationFrame(this.loop);
  }

  debugSnapshot() {
    return {
      phase: this.phase,
      score: this.score,
      bestScore: this.bestScore,
      lives: this.lives,
      level: this.level,
      bricks: this.bricks.length,
      balls: this.balls.map((ball) => ({ x: ball.x, y: ball.y, vx: ball.vx, vy: ball.vy, stuck: ball.stuck })),
      powerups: this.powerups.map((powerup) => ({
        x: powerup.x,
        y: powerup.y,
        kind: powerup.kind,
        tone: powerupToneFor(powerup.kind),
        label: POWERUP_NAMES[powerup.kind]
      })),
      paddleX: this.paddleX,
      paddleWidth: this.paddleWidth,
      paddleVelocityX: this.paddleVelocityX,
      lastPaddleHit: this.lastPaddleHit,
      lastLoopCorrection: this.lastLoopCorrection,
      hasSave: this.hasSave,
      boardSource: this.boardContext.source,
      currentPackId: this.boardContext.packId,
      packBoardIndex: this.boardContext.boardIndex,
      boardTheme: boardThemeFor(this.boardContext),
      packProgress: this.packProgress,
      dailyProgress: this.dailyProgress,
      todayKey: localDateKey(),
      activeDailyKey: this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.resolvedDailyDateKey() : null,
      runStats: buildRunSummaryStats("debug", this.score, this.bestScore, this.runStats),
      designerIntent: this.designerIntent,
      generationSummary: this.latestGenerationSummary,
      settings: this.settings,
      playMode: this.playMode,
      cosmetics: this.cosmetics,
      cosmeticOptions: collectCosmeticOptions(this.hudSnapshot()),
      audio: this.audio.debugSnapshot(),
      effects: {
        sparks: this.sparks.length,
        impactRings: this.effectsLayer.querySelectorAll(".impact-ring").length,
        screenFlashes: this.effectsLayer.querySelectorAll(".screen-flash").length
      },
      powerupPrimerDismissed: this.powerupPrimerDismissed,
      recentEvents: gameEventsToStrings(this.recentEvents),
      announcement: this.announcement
    };
  }

  debugStageVisualSmokeState() {
    this.powerups.splice(
      0,
      this.powerups.length,
      { x: 320, y: 330, vy: 0, kind: "expandPaddle" },
      { x: 480, y: 330, vy: 0, kind: "shrinkPaddle" },
      { x: 640, y: 330, vy: 0, kind: "eightBall" }
    );
    this.laserTimer = 7;
    this.grabTimer = 10;
    this.combo = 2.6;
    if (this.balls[0]) this.balls[0].fireTimer = 8;
    this.addFloatingText(320, 430, "+Expand paddle", "powerupReward");
    this.addFloatingText(480, 430, "-Shrink paddle", "powerupHazard");
    this.addFloatingText(640, 430, "! Eight ball", "powerupVolatile");
    this.addFloatingText(WIDTH / 2, 380, "Streak x2.6", "combo");
    this.emitComboFeedback(WIDTH / 2, 380, this.combo);
    this.emitPowerupCatchBurst({ x: 320, y: PADDLE_Y - 18, vy: 0, kind: "expandPaddle" }, "#7bf1a8");
    this.refreshHud();
  }

  debugAudioIdentitySmokeState() {
    const sampleBrick: Brick = { x: 0, y: 0, width: BRICK_WIDTH, height: BRICK_HEIGHT, kind: "boss", hp: 2, maxHp: 4 };
    this.audio.play("paddle", this.settings.sfxVolume, { intensity: 1.08, pitch: 1.05 });
    this.audio.play("hardBrick", this.settings.sfxVolume, brickAudioOptions({ ...sampleBrick, kind: "hard", hp: 1, maxHp: 3 }, 2.4, false));
    this.audio.play("streak", this.settings.sfxVolume, { pitch: 1.35, intensity: 0.94, streak: 3.2 });
    this.audio.play("explosion", this.settings.sfxVolume, { intensity: 1.12, rumble: 0.7 });
    this.audio.play("volatilePowerup", this.settings.sfxVolume, powerupAudioOptions("eightBall"));
  }


  private bindInput() {
    const unlockAudio = () => {
      this.audio.unlock();
    };
    window.addEventListener("pointerdown", unlockAudio, { passive: true });
    window.addEventListener("keydown", unlockAudio);
    window.addEventListener("keydown", (event) => {
      if (isEditableTarget(event.target)) return;
      this.keys.add(event.code);
      if (event.code === "Space" || event.code === "Enter") {
        const actionControl = actionControlTarget(event.target);
        event.preventDefault();
        if (actionControl) {
          actionControl.click();
          return;
        }
        this.handlePrimaryAction();
      }
      if (event.code === "KeyN" && this.phase !== "loading") {
        event.preventDefault();
        void this.fetchLevel("You requested a generated replacement wall.");
      }
      if (event.code === "KeyP") {
        event.preventDefault();
        this.togglePause();
      }
      if (event.code === "Escape") {
        event.preventDefault();
        this.handleEscape();
      }
    });
    window.addEventListener("keyup", (event) => {
      if (isEditableTarget(event.target)) return;
      this.keys.delete(event.code);
    });
    const applyPointerPaddle = (clientX: number) => {
      const now = performance.now();
      if (now < this.lastKeyboardAt) return;
      const rect = this.sceneView.renderer.domElement.getBoundingClientRect();
      const nextX = ((clientX - rect.left) / rect.width) * WIDTH;
      const realElapsed = this.lastPointerAt > 0 ? (now - this.lastPointerAt) / 1000 : 1 / 60;
      const elapsedSeconds = realElapsed * playClockScale(this.playMode);
      this.lastPointerAt = now;
      this.applyPaddleMotion(movePaddle(this.paddleMotionState(), nextX, elapsedSeconds));
    };
    let activeTouchPointerId: number | null = null;
    const stage = this.mount.closest<HTMLElement>(".stage");
    this.sceneView.renderer.domElement.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" && blockPassiveMouseHover(this.playMode)) return;
      applyPointerPaddle(event.clientX);
    });
    this.sceneView.renderer.domElement.addEventListener("pointerdown", (event) => {
      applyPointerPaddle(event.clientX);
      if (event.pointerType === "touch") {
        event.preventDefault();
        return;
      }
      this.handlePrimaryAction();
    });
    stage?.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch" || !isArenaPointerTarget(event.target)) return;
      event.preventDefault();
      activeTouchPointerId = event.pointerId;
      try {
        stage.setPointerCapture?.(event.pointerId);
      } catch {
        // Synthetic smoke-test events and some embedded browsers may not expose an active capture target.
      }
      applyPointerPaddle(event.clientX);
    });
    stage?.addEventListener("pointermove", (event) => {
      if (event.pointerType !== "touch" || activeTouchPointerId !== event.pointerId) return;
      event.preventDefault();
      applyPointerPaddle(event.clientX);
    });
    const releaseTouchPointer = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || activeTouchPointerId !== event.pointerId) return;
      event.preventDefault();
      activeTouchPointerId = null;
      try {
        if (stage?.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture?.(event.pointerId);
      } catch {
        // Capture may already be released by the browser.
      }
    };
    stage?.addEventListener("pointerup", releaseTouchPointer);
    stage?.addEventListener("pointercancel", releaseTouchPointer);
    this.bindTouchControls();
  }

  private bindTouchControls() {
    const shell = this.mount.closest<HTMLElement>(".shell");
    if (!shell) return;
    const bindDirection = (action: "left" | "right", code: "ArrowLeft" | "ArrowRight") => {
      const button = shell.querySelector<HTMLButtonElement>(`[data-touch-action="${action}"]`);
      if (!button) return;
      const press = (event: Event) => {
        event.preventDefault();
        this.keys.add(code);
        this.lastKeyboardAt = performance.now();
        this.sceneView.renderer.domElement.focus({ preventScroll: true });
      };
      const release = (event: Event) => {
        event.preventDefault();
        this.keys.delete(code);
      };
      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    };
    bindDirection("left", "ArrowLeft");
    bindDirection("right", "ArrowRight");
    shell.querySelector<HTMLButtonElement>('[data-touch-action="primary"]')?.addEventListener("click", (event) => {
      event.preventDefault();
      this.sceneView.renderer.domElement.focus({ preventScroll: true });
      this.handlePrimaryAction();
    });
    shell.querySelector<HTMLButtonElement>('[data-touch-action="pause"]')?.addEventListener("click", (event) => {
      event.preventDefault();
      this.sceneView.renderer.domElement.focus({ preventScroll: true });
      this.togglePause();
    });
  }

  private bindHudActions() {
    this.hud.setActions({
      requestBoard: () => void this.fetchLevel("You asked the Board Designer to redesign this board."),
      saveBoardToPack: () => {
        this.saveCurrentBoardToPack();
      },
      resetProgress: () => {
        this.confirmClearSave();
      },
      selectPack: (packId) => {
        this.selectPack(packId);
      },
      updateDesigner: (intent) => {
        this.updateDesignerIntent(intent);
      },
      dismissPowerupPrimer: () => {
        this.dismissPowerupPrimer();
      },
      updateSettings: (settings) => {
        this.settings = normalizeSettings(settings);
        writeJson(SETTINGS_KEY, this.settings);
        this.applySettingsClass();
        this.applyBoardTheme();
        this.audio.setSfxVolume(this.settings.sfxVolume);
        this.audio.setMusicVolume(this.settings.musicVolume);
        this.refreshHud("Settings updated.");
      },
      updateCosmetics: (cosmetics) => {
        this.cosmetics = clampCosmetics(normalizeCosmetics(cosmetics), this.hudSnapshot());
        writeJson(COSMETICS_KEY, this.cosmetics);
        this.applyBoardTheme();
        this.refreshHud("Cosmetics updated.");
      },
      toggleSidebar: () => {
        this.setSidebarCollapsed(!this.sidebarCollapsed);
      },
      exportBoard: () => this.exportCurrentBoard(),
      importBoard: (text) => this.importSharedBoard(text),
      renderScoreCard: () => this.renderScoreCard()
    });
  }

  private loop = (time: number) => {
    const realDelta = Math.min((time - this.lastTime) / 1000 || 0, 0.03);
    this.lastTime = time;
    this.update(realDelta * playClockScale(this.playMode));
    this.render();
    window.requestAnimationFrame(this.loop);
  };

  private update(delta: number) {
    this.fireExplodedThisTick.clear();
    this.updatePaddle(delta);
    this.updateFeedback(delta);
    if (this.phase !== "playing") {
      this.updateSparks(delta * 0.35);
      this.updateFloatingTexts(delta * 0.45);
      this.refreshHud();
      return;
    }

    this.laserTimer = Math.max(0, this.laserTimer - delta);
    this.laserCooldown = Math.max(0, this.laserCooldown - delta);
    this.grabTimer = Math.max(0, this.grabTimer - delta);
    this.launchLossGraceTimer = Math.max(0, this.launchLossGraceTimer - delta);
    this.updateLaser(delta);

    for (const ball of this.balls) {
      if (ball.stuck) {
        ball.x = clamp(this.paddleX + ball.stuckOffset, WALL + ball.radius, WIDTH - WALL - ball.radius);
        ball.y = PADDLE_Y - 18;
        continue;
      }
      ball.fireTimer = Math.max(0, ball.fireTimer - delta);
      ball.thruTimer = Math.max(0, ball.thruTimer - delta);
      ball.megaTimer = Math.max(0, ball.megaTimer - delta);
      ball.radius = ball.megaTimer > 0 ? 14 : Math.max(5, ball.radius);
      const previousX = ball.x;
      const previousY = ball.y;
      ball.x += ball.vx * delta;
      ball.y += ball.vy * delta;
      const wallHit = this.collideWalls(ball);
      this.collidePaddle(ball);
      this.collideBricks(ball, wallHit ? ball.x : previousX, wallHit ? ball.y : previousY);
    }

    this.updatePowerups(delta);
    this.updateSparks(delta);
    this.updateFloatingTexts(delta);
    this.balls.splice(0, this.balls.length, ...this.balls.filter((ball) => ball.y < HEIGHT + 80));
    if (this.balls.length === 0) {
      this.noBallTimer += delta;
      if (this.noBallTimer >= 0.22 && this.launchLossGraceTimer <= 0) this.loseLife();
    } else {
      this.noBallTimer = 0;
    }
    if (this.bricks.length === 0) this.completeLevel();
    else this.saveCheckpoint();
    this.refreshHud();
  }

  private updatePaddle(delta: number) {
    const direction = keyboardPaddleDirection(this.keys);
    if (direction !== 0) this.lastKeyboardAt = performance.now();

    let nextState: PaddleMotionState;
    if (direction !== 0) {
      nextState = movePaddle(this.paddleMotionState(), keyboardPaddleTargetX(this.paddleMotionState(), direction, delta), delta);
    } else if (this.playMode === "agent-auto" && this.phase === "playing") {
      const target = chooseAutoPaddleTarget({
        balls: this.balls,
        bricks: this.bricks,
        powerups: this.powerups,
        paddleX: this.paddleX,
        paddleWidth: this.paddleWidth
      });
      nextState =
        target.kind === "idle"
          ? { ...this.paddleMotionState(), paddleVelocityX: 0 }
          : movePaddle(this.paddleMotionState(), target.x, 0, { snap: true });
    } else {
      nextState = { ...this.paddleMotionState(), paddleVelocityX: decayPaddleVelocity(this.paddleVelocityX, delta) };
    }

    this.applyPaddleMotion(nextState);
    for (const ball of this.balls) {
      if (ball.stuck) {
        ball.x = clamp(this.paddleX + ball.stuckOffset, WALL + ball.radius, WIDTH - WALL - ball.radius);
        ball.y = PADDLE_Y - 18;
      }
    }
  }

  private paddleMotionState(): PaddleMotionState {
    return {
      paddleX: this.paddleX,
      paddleWidth: this.paddleWidth,
      paddleVelocityX: this.paddleVelocityX
    };
  }

  private applyPaddleMotion(state: PaddleMotionState) {
    this.paddleX = state.paddleX;
    this.paddleWidth = state.paddleWidth;
    this.paddleVelocityX = state.paddleVelocityX;
  }

  private handlePrimaryAction() {
    if (this.phase === "loading") return;
    if (this.phase === "levelComplete") {
      void this.continueToNextLevel();
      return;
    }
    if (this.phase === "gameOver") {
      void this.restartRun();
      return;
    }
    const wasPaused = this.phase === "ready" && this.balls.some((ball) => !ball.stuck);
    this.phase = "playing";
    this.hideOverlay();
    this.scrollStageIntoView();
    this.launchBalls();
    if (wasPaused) this.audio.play("resume", this.settings.sfxVolume);
  }

  private togglePause() {
    if (this.phase === "playing") {
      this.phase = "ready";
      this.showOverlay("Paused", "The board is frozen. Press Space, Enter, or Continue to resume.", "Continue", () => this.handlePrimaryAction());
      this.pushEvent("Paused.");
      this.audio.play("pause", this.settings.sfxVolume);
    } else if (this.phase === "ready" && this.balls.some((ball) => !ball.stuck)) {
      this.phase = "playing";
      this.hideOverlay();
      this.scrollStageIntoView();
      this.pushEvent("Resumed.");
      this.audio.play("resume", this.settings.sfxVolume);
    }
  }

  private handleEscape() {
    if (this.phase === "playing") {
      this.togglePause();
      return;
    }
    const secondaryButton = this.overlay.querySelector<HTMLButtonElement>("[data-overlay-secondary]");
    if (secondaryButton) secondaryButton.click();
  }

  private confirmClearSave() {
    if (!this.hasSave || this.loadingLevel) return;
    const previousPhase = this.phase;
    if (this.phase === "playing") this.phase = "ready";
    this.showOverlay(
      "Clear Saved Run?",
      "This removes the local checkpoint for this run and resets cosmetic selections. Your current best score stays on this device.",
      "Clear Save",
      () => {
        this.autosaveSuppressed = true;
        localStorage.removeItem(SAVE_KEY);
        localStorage.removeItem(COSMETICS_KEY);
        this.cosmetics = DEFAULT_COSMETICS;
        this.applyBoardTheme();
        this.hasSave = false;
        this.bestScore = Math.max(this.bestScore, this.score);
        writeBestScore(this.bestScore);
        this.pushEvent("Saved run cleared.");
        this.hideOverlay();
        if (previousPhase === "playing") this.phase = "playing";
        this.refreshHud("Saved run cleared.");
      },
      false,
      "Cancel",
      () => {
        this.hideOverlay();
        if (previousPhase === "playing") this.phase = "playing";
        this.refreshHud();
      }
    );
  }

  private startPack(packId: string, event: string) {
    if (packId === DAILY_PACK_ID) {
      this.startDailyBoard(localDateKey(), event);
      return;
    }
    if (!this.canPlayPack(packId)) return;
    this.level = 1;
    this.clearedLevels = 0;
    this.score = 0;
    this.lives = 3;
    this.combo = 1;
    this.runStats = createRunStats(this.score, this.bestScore);
    this.latestAgentTrace = undefined;
    this.autosaveSuppressed = false;
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    const nextIndex = this.nextBoardIndexForPack(packId);
    this.loadPackBoard(packId, nextIndex, event);
  }

  private selectPack(packId: string) {
    if (this.loadingLevel) return;
    const savedIndex = savedBoardIndexFromPackId(packId);
    if (savedIndex !== null) {
      this.startSavedBoard(savedIndex);
      return;
    }
    if (packId === DAILY_PACK_ID) {
      this.startDailyBoard();
      return;
    }
    if (!this.canPlayPack(packId)) return;
    const packName = packNameFor(packId);
    this.startPack(packId, `${packName} loaded.`);
  }

  private startDailyBoard(dateKey = localDateKey(), event = `Today's local board ${dateKey} loaded.`) {
    this.level = 1;
    this.clearedLevels = this.dailyProgress[dateKey]?.completed ? 1 : 0;
    this.score = 0;
    this.lives = 3;
    this.combo = 1;
    this.runStats = createRunStats(this.score, this.bestScore);
    this.latestAgentTrace = undefined;
    this.autosaveSuppressed = false;
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    this.loadLevel(materializeDailyBoard(dateKey), event, undefined, undefined, {
      source: "pack",
      packId: DAILY_PACK_ID,
      boardIndex: 0,
      dailyDateKey: dateKey
    });
  }

  private startSavedBoard(index: number) {
    const saved = this.savedBoards[index];
    if (!saved) return;
    this.level = index + 1;
    this.clearedLevels = Math.min(index, this.packProgress[SAVED_DESIGNS_PACK_ID]?.cleared ?? 0);
    this.score = 0;
    this.lives = 3;
    this.combo = 1;
    this.runStats = createRunStats(this.score, this.bestScore);
    this.latestAgentTrace = undefined;
    this.autosaveSuppressed = false;
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    this.loadLevel(saved.levelBlueprint, `${saved.levelName} replay loaded from Saved Designs.`, undefined, undefined, {
      source: "pack",
      packId: SAVED_DESIGNS_PACK_ID,
      boardIndex: index
    });
  }

  private resolvedDailyDateKey(): string {
    if (this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID) {
      return this.boardContext.dailyDateKey ?? localDateKey();
    }
    return localDateKey();
  }

  private loadPackBoard(packId: string, boardIndex: number, event: string) {
    const level = this.materializePackBoard(packId, boardIndex);
    if (!level) return;
    this.level = boardIndex + 1;
    this.clearedLevels = boardIndex;
    this.latestAgentTrace = undefined;
    const dailyDateKey = packId === DAILY_PACK_ID ? this.resolvedDailyDateKey() : undefined;
    this.loadLevel(level, event, undefined, undefined, { source: "pack", packId, boardIndex, dailyDateKey });
  }

  private materializePackBoard(packId: string, boardIndex: number): LevelBlueprint | null {
    const request = { ...this.levelRequest(), level: boardIndex + 1, clearedLevels: boardIndex };
    if (packId === SAVED_DESIGNS_PACK_ID) {
      const saved = this.savedBoards[boardIndex];
      return saved ? normalizeLevel(saved.levelBlueprint, authoredBoardRequestForSaved(request)) : null;
    }
    return materializeAuthoredBoard(packId, boardIndex, request);
  }

  private canPlayPack(packId: string): boolean {
    if (packId === DAILY_PACK_ID) return true;
    const total = boardCountForPack(packId, this.savedBoards.length);
    return total > 0 && this.packProgress[packId]?.unlocked === true;
  }

  private nextBoardIndexForPack(packId: string): number {
    const total = boardCountForPack(packId, this.savedBoards.length);
    if (total <= 0) return 0;
    const cleared = this.packProgress[packId]?.cleared ?? 0;
    return cleared >= total ? 0 : clamp(Math.floor(cleared), 0, total - 1);
  }

  private updateDailyProgress(score: number, completed: boolean) {
    if (this.boardContext.source !== "pack" || this.boardContext.packId !== DAILY_PACK_ID) return;
    const dateKey = this.boardContext.dailyDateKey ?? localDateKey();
    const current = this.dailyProgress[dateKey] ?? { bestScore: 0, completed: false };
    this.dailyProgress = {
      ...this.dailyProgress,
      [dateKey]: {
        bestScore: Math.max(current.bestScore, score),
        completed: current.completed || completed
      }
    };
    writeJson(DAILY_PROGRESS_KEY, this.dailyProgress);
  }

  private updateSavedBoardBestScore(boardIndex: number, score: number) {
    const saved = this.savedBoards[boardIndex];
    if (!saved || score <= saved.bestScore) return;
    this.savedBoards = this.savedBoards.map((entry, index) => (index === boardIndex ? { ...entry, bestScore: Math.max(entry.bestScore, score) } : entry));
    writeJson(SAVED_BOARDS_KEY, this.savedBoards);
  }

  private saveCurrentBoardToPack() {
    if (this.boardContext.source !== "generated" || this.loadingLevel) return;
    const levelBlueprint = cloneLevelBlueprint(this.levelBlueprint);
    if (this.currentGeneratedBoardSaved()) {
      this.showSavedBoardConfirmation(levelBlueprint.name, false);
      return;
    }

    const now = new Date();
    const entry: SavedBoardEntry = {
      id: `saved-${now.getTime()}`,
      createdAt: now.toISOString(),
      levelName: levelBlueprint.name,
      levelBlueprint,
      sourcePrompt: this.levelSourcePrompt || "Default Ricochet board prompt",
      bestScore: 0
    };
    this.savedBoards = trimSavedBoards([entry, ...this.savedBoards], SAVED_BOARDS_MAX);
    writeJson(SAVED_BOARDS_KEY, this.savedBoards);
    this.packProgress = normalizePackProgress(this.packProgress, this.savedBoards.length);
    writeJson(PACK_PROGRESS_KEY, this.packProgress);
    this.pushEvent(`${levelBlueprint.name} saved to Saved Designs.`);
    this.showSavedBoardConfirmation(levelBlueprint.name, true);
  }

  private currentGeneratedBoardSaved() {
    if (this.boardContext.source !== "generated") return false;
    const currentFingerprint = blueprintFingerprint(this.levelBlueprint);
    return this.savedBoards.some((board) => blueprintFingerprint(board.levelBlueprint) === currentFingerprint);
  }

  private showSavedBoardConfirmation(levelName: string, newlySaved: boolean) {
    const status = newlySaved ? "Board saved to Saved Designs." : "Board is already in Saved Designs.";
    if (newlySaved) this.addFloatingText(WIDTH / 2, HEIGHT / 2 - 74, "Board saved", "status");
    this.announce(status);
    if (this.phase === "levelComplete") {
      this.showRunSummaryOverlay("clear", {
        title: newlySaved ? "Board Saved" : "Board Already Saved",
        body: `${levelName} is in Saved Designs. Open Boards whenever you want to replay it.`,
        actions: [
          { label: "Continue", primary: true, action: () => void this.continueToNextLevel() },
          { label: "Replay Run", action: () => void this.restartRun() },
          { label: "View Saved Boards", action: () => this.openBoardPicker() }
        ]
      });
    }
    this.refreshHud(status);
  }

  private updateDesignerIntent(intent: BoardDesignerIntent) {
    const normalized = normalizeDesignerIntent(intent);
    this.designerIntent = {
      ...DEFAULT_DESIGNER_INTENT,
      brief: normalized.brief,
      visualPreset: normalized.visualPreset
    };
    writeJson(DESIGNER_INTENT_KEY, this.designerIntent);
    this.refreshHud("Designer intent updated.");
  }

  private exportCurrentBoard(): string {
    return encodeBoardExport(createBoardExportPayload(this.levelBlueprint, this.levelSourcePrompt || this.designerIntent.brief || "Shared Ricochet board"));
  }

  private importSharedBoard(text: string): { ok: boolean; message: string } {
    const result = parseBoardExport(text);
    if (!result.ok || !result.level) return { ok: false, message: result.message };
    this.level = 1;
    this.clearedLevels = 0;
    this.score = 0;
    this.lives = 3;
    this.combo = 1;
    this.runStats = createRunStats(this.score, this.bestScore);
    this.autosaveSuppressed = false;
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    this.loadLevel(result.level, result.message, undefined, undefined, { source: "generated", packId: null, boardIndex: 0 }, result.sourcePrompt);
    return { ok: true, message: result.message };
  }

  private async renderScoreCard(): Promise<{ ok: boolean; message: string; dataUrl?: string }> {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, message: "Score card unavailable in this browser." };
    const stats = buildRunSummaryStats(this.phase === "levelComplete" ? "clear" : "gameOver", this.score, this.bestScore, this.runStats);
    const previewRows = previewRowsFromLevel(this.levelBlueprint);
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#09121e");
    gradient.addColorStop(1, "#05070c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(126, 241, 255, 0.18)";
    context.fillRect(38, 38, 884, 464);
    context.fillStyle = "#06101a";
    context.fillRect(48, 48, 864, 444);
    context.fillStyle = "#7ef1ff";
    context.font = "700 28px sans-serif";
    context.fillText("Ricochet Rush", 80, 98);
    context.fillStyle = "#ffffff";
    context.font = "900 54px sans-serif";
    context.fillText(this.levelBlueprint.name.slice(0, 28), 80, 160);
    context.fillStyle = "#ffe066";
    context.font = "900 72px sans-serif";
    context.fillText(this.score.toLocaleString(), 80, 246);
    context.fillStyle = "#c8d4d1";
    context.font = "700 24px sans-serif";
    context.fillText(`Best ${this.bestScore.toLocaleString()} · Level ${this.level}`, 80, 286);
    context.font = "700 20px sans-serif";
    for (const [index, stat] of stats.slice(2, 7).entries()) {
      const y = 336 + index * 32;
      context.fillStyle = "#7ef1ff";
      context.fillText(stat.label, 80, y);
      context.fillStyle = "#ffffff";
      context.fillText(stat.value, 300, y);
    }
    drawScoreCardPreview(context, previewRows, 604, 132, 20);
    context.fillStyle = "#9fb5b5";
    context.font = "700 18px sans-serif";
    context.fillText("Public-safe local PNG · no account or upload", 604, 424);
    return { ok: true, message: "Score card rendered locally.", dataUrl: canvas.toDataURL("image/png") };
  }

  private loadLevel(
    level: LevelBlueprint,
    event: string,
    trace?: LevelResponse["trace"],
    summary?: GenerationSummary,
    context: BoardContext = this.boardContext,
    sourcePrompt = context.source === "generated" ? this.designerIntent.brief || "Default Ricochet board prompt" : ""
  ) {
    this.autosaveSuppressed = false;
    this.boardContext = context;
    this.applyBoardTheme();
    this.latestGenerationSummary = context.source === "generated" ? summary : undefined;
    this.levelSourcePrompt = context.source === "generated" ? sourcePrompt : "";
    this.levelBlueprint = level;
    this.levelLayout = computeLevelLayout(level);
    this.bricks = materializeLevelBricks(level, this.levelLayout);
    this.runStats.levelStartedAt = Date.now();
    this.powerups.splice(0);
    this.sparks.splice(0);
    this.laserBeams.splice(0);
    this.paddleWidth = 116;
    this.combo = 1;
    this.laserTimer = 0;
    this.grabTimer = 0;
    this.noBallTimer = 0;
    this.launchLossGraceTimer = 0;
    this.hudUpdateSignature = "";
    this.clearTransientEffects();
    this.explosionScale = 1;
    this.lastPaddleHit = null;
    this.lastLoopCorrection = null;
    this.phase = "ready";
    this.resetBall();
    this.pushEvent(event);
    this.saveCheckpoint(undefined, true);
    this.showLevelReadyOverlay(event);
    this.latestAgentTrace = trace;
    this.refreshHud(level.briefing);
  }

  private restoreSave(save: GameSave) {
    this.latestAgentTrace = undefined;
    const restoredContext: BoardContext =
      save.boardSource === "pack" && save.packId
        ? { source: "pack", packId: save.packId, boardIndex: save.packBoardIndex, dailyDateKey: save.dailyDateKey ?? undefined }
        : { source: "generated", packId: null, boardIndex: 0 };
    this.boardContext = restoredContext;
    this.applyBoardTheme();
    this.level = save.level;
    this.clearedLevels = save.clearedLevels;
    this.score = save.score;
    this.bestScore = save.bestScore;
    this.lives = save.lives;
    this.combo = save.combo;
    this.runStats = fromSavedRunStats(save.runStats, save.score, save.bestScore);
    this.paddleWidth = save.paddleWidth;
    const restoredPackLevel = restoredContext.source === "pack" ? this.materializePackBoard(restoredContext.packId, restoredContext.boardIndex) : null;
    const restoredLevel = restoredPackLevel ?? save.levelBlueprint;
    const savedBricksFitLevel = save.bricks.length > 0 && bricksFitLevel(save.bricks, restoredLevel);
    this.levelBlueprint = restoredLevel;
    this.levelLayout = computeLevelLayout(restoredLevel);
    this.levelSourcePrompt = save.levelSourcePrompt;
    this.bricks = savedBricksFitLevel ? save.bricks.map((brick) => ({ ...brick })) : materializeLevelBricks(restoredLevel, this.levelLayout);
    this.recentEvents = save.recentEvents.length > 0 ? [...save.recentEvents] : this.recentEvents;
    this.phase = "ready";
    this.hasSave = true;
    this.lastPaddleHit = null;
    this.lastLoopCorrection = null;
    this.laserTimer = save.laserTimer;
    this.grabTimer = save.grabTimer;
    this.explosionScale = clamp(save.explosionScale, 1, 2.5);
    if (save.balls && save.balls.length > 0) {
      this.balls.splice(
        0,
        this.balls.length,
        ...save.balls.map((ball) => ({
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
        }))
      );
    } else {
      this.resetBall();
    }
    if (!savedBricksFitLevel && this.bricks.length > 0) {
      this.saveCheckpoint("Saved board rebuilt.", true, "technical");
    }
    this.refreshHud("Saved run restored.");
  }

  private resetBall() {
    this.balls.splice(0, this.balls.length, {
      x: this.paddleX,
      y: PADDLE_Y - 18,
      vx: 210,
      vy: -390 * this.levelBlueprint.speed,
      radius: 8,
      stuck: true,
      stuckOffset: 0,
      fireTimer: 0,
      thruTimer: 0,
      megaTimer: 0
    });
  }

  private launchBalls() {
    let launched = false;
    for (const ball of this.balls) {
      if (!ball.stuck) continue;
      const launch = computeStuckBallLaunch({
        stuckOffset: ball.stuckOffset,
        paddleWidth: this.paddleWidth,
        paddleVelocityX: this.paddleVelocityX,
        storedVx: ball.vx,
        speedMultiplier: this.levelBlueprint.speed
      });
      ball.stuck = false;
      ball.stuckOffset = 0;
      ball.vx = launch.vx;
      ball.vy = launch.vy;
      launched = true;
    }
    if (launched) this.launchLossGraceTimer = LAUNCH_LOSS_GRACE_SECONDS;
  }

  private collideWalls(ball: Ball) {
    let hitSideWall = false;
    let hitTopWall = false;
    if (ball.x - ball.radius < WALL) {
      ball.x = WALL + ball.radius;
      ball.vx = Math.abs(ball.vx);
      hitSideWall = true;
    }
    if (ball.x + ball.radius > WIDTH - WALL) {
      ball.x = WIDTH - WALL - ball.radius;
      ball.vx = -Math.abs(ball.vx);
      hitSideWall = true;
    }
    if (ball.y - ball.radius < WALL) {
      ball.y = WALL + ball.radius;
      ball.vy = Math.abs(ball.vy);
      hitTopWall = true;
    }
    if (hitSideWall) this.normalizeBallForLoopRisk(ball, "wall", { minYRatio: MIN_COLLISION_Y_RATIO, fallbackYSign: ball.vy || 1 });
    if (hitTopWall) this.normalizeBallForLoopRisk(ball, "wall", { minXRatio: MIN_COLLISION_X_RATIO, fallbackXSign: ball.vx || 1 });
    return hitSideWall || hitTopWall;
  }

  private collidePaddle(ball: Ball) {
    const paddleLeft = this.paddleX - this.paddleWidth / 2;
    const paddleRight = this.paddleX + this.paddleWidth / 2;
    const contact = detectPaddleContact({
      ballX: ball.x,
      ballY: ball.y,
      ballRadius: ball.radius,
      ballVy: ball.vy,
      paddleCenterX: this.paddleX,
      paddleWidth: this.paddleWidth,
      paddleY: PADDLE_Y,
      topTolerance: 8,
      bottomTolerance: 12
    });
    if (!contact) return;
    const hit = contact.hitZone;
    if (this.grabTimer > 0) {
      const catchX = clamp(ball.x, paddleLeft + ball.radius, paddleRight - ball.radius);
      ball.stuck = true;
      ball.stuckOffset = clamp(catchX - this.paddleX, -this.paddleWidth / 2 + ball.radius, this.paddleWidth / 2 - ball.radius);
      ball.x = catchX;
      ball.y = PADDLE_Y - 18;
      this.pushEvent("Grab paddle caught the ball.");
      this.audio.play("grab", this.settings.sfxVolume);
      return;
    }
    const rebound = calculatePaddleRebound({
      hitZone: hit,
      paddleVelocityX: this.paddleVelocityX,
      incomingVx: ball.vx,
      incomingVy: ball.vy
    });
    ball.vx = rebound.vx;
    ball.vy = rebound.vy;
    this.lastPaddleHit = { ...rebound, hitZone: hit, paddleVelocityX: this.paddleVelocityX };
    ball.y = PADDLE_Y - 10 - ball.radius;
    this.launchLossGraceTimer = 0;
    this.audio.play(Math.abs(hit) > 0.72 ? "paddleEdge" : "paddle", this.settings.sfxVolume, {
      intensity: 0.88 + Math.min(0.36, Math.abs(this.paddleVelocityX) / MAX_PADDLE_VELOCITY),
      pitch: 0.94 + Math.abs(hit) * 0.16
    });
    this.paddleFlashTimer = 0.16;
    this.shakeBoard(0.08, 1.6);
    this.combo = Math.max(1, this.combo - 0.15);
  }

  private collideBricks(ball: Ball, previousX: number, previousY: number) {
    const maxSteps = 32;
    for (let step = 0; step < maxSteps; step += 1) {
      let hit: { brick: Brick; axis: "x" | "y"; travelT: number } | null = null;
      for (const candidate of this.bricks) {
        const contact = detectBrickContact({
          previousX,
          previousY,
          ballX: ball.x,
          ballY: ball.y,
          ballRadius: ball.radius,
          brickX: candidate.x,
          brickY: candidate.y,
          brickWidth: candidate.width,
          brickHeight: candidate.height
        });
        if (contact && (!hit || contact.travelT < hit.travelT)) hit = { brick: candidate, ...contact };
      }
      if (!hit) return;

      const { brick } = hit;
      const piercing = ball.thruTimer > 0 || ball.fireTimer > 0 || ball.megaTimer > 0;
      if (!piercing) {
        if (hit.axis === "x") {
          ball.vx *= -1;
          this.normalizeBallForLoopRisk(ball, "brick", { minYRatio: MIN_COLLISION_Y_RATIO, fallbackYSign: ball.vy || 1 });
        } else {
          ball.vy *= -1;
          this.normalizeBallForLoopRisk(ball, "brick", { minXRatio: MIN_COLLISION_X_RATIO, fallbackXSign: ball.vx || Math.sign(ball.x - (brick.x + brick.width / 2)) || 1 });
        }
      }
      this.hitBrick(brick);
      if (ball.fireTimer > 0) {
        const brickKey = `${brick.x}:${brick.y}`;
        if (!this.fireExplodedThisTick.has(brickKey)) {
          this.fireExplodedThisTick.add(brickKey);
          this.explode(brick);
        }
      }
      if (!piercing) return;
      if (hit.axis === "x") {
        ball.x = ball.vx >= 0 ? brick.x + brick.width + ball.radius + 0.5 : brick.x - ball.radius - 0.5;
      } else {
        ball.y = ball.vy >= 0 ? brick.y + brick.height + ball.radius + 0.5 : brick.y - ball.radius - 0.5;
      }
      previousX = ball.x;
      previousY = ball.y;
    }
  }

  private normalizeBallForLoopRisk(ball: Ball, source: LoopCorrectionDebug["source"], input: Omit<LoopRiskVelocityInput, "vx" | "vy">) {
    const beforeVx = ball.vx;
    const beforeVy = ball.vy;
    const corrected = normalizeLoopRiskVelocity({ ...input, vx: ball.vx, vy: ball.vy });
    if (!corrected.changed) return;
    ball.vx = corrected.vx;
    ball.vy = corrected.vy;
    this.lastLoopCorrection = {
      ...corrected,
      source,
      axis: input.minXRatio ? "x" : "y",
      beforeVx,
      beforeVy
    };
  }

  private hitBrick(brick: Brick) {
    brick.hp -= 1;
    const destroyed = brick.hp <= 0;
    this.brickImpactTimers.set(brick, destroyed ? 0.24 : 0.18);
    this.emitBrickBurst(brick, destroyed);
    if (brick.kind === "boss") {
      this.shakeBoard(destroyed ? 0.26 : 0.16, destroyed ? 4.4 : 2.4);
      this.emitImpactRing(brick.x + brick.width / 2, brick.y + brick.height / 2, COLORS.boss, "boss");
    }
    if (brick.hp > 0) {
      this.audio.play(brick.kind === "hard" || brick.kind === "boss" ? "hardBrick" : "brickChip", this.settings.sfxVolume, brickAudioOptions(brick, this.combo, false));
      if (brick.kind === "boss") this.audio.play("bossDamage", this.settings.sfxVolume, { intensity: 1.06, rumble: 0.46 });
      return;
    }
    this.audio.play(soundForBrickDestroy(brick.kind), this.settings.sfxVolume, brickAudioOptions(brick, this.combo, true));
    this.bricks = this.bricks.filter((candidate) => candidate !== brick);
    this.runStats.bricksBroken += 1;
    const points = Math.round(40 * this.combo * (brick.kind === "boss" ? 5 : brick.maxHp));
    this.score += points;
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    this.combo = Math.min(8, this.combo + 0.22);
    this.runStats.longestCombo = Math.max(this.runStats.longestCombo, this.combo);
    const centerX = brick.x + brick.width / 2;
    const centerY = brick.y + brick.height / 2;
    this.addFloatingText(centerX, centerY, `+${points}`, "score");
    if (this.combo >= 2) {
      this.addFloatingText(centerX, centerY - 28, `Streak x${this.combo.toFixed(1)}`, "combo");
      this.emitComboFeedback(centerX, centerY - 12, this.combo);
      this.playStreakTone(this.combo);
    }
    this.shakeBoard(brick.kind === "boss" ? 0.2 : 0.1, brick.kind === "boss" ? 3.6 : 1.35);
    this.resolveBrickPrize(brick);
    this.saveCheckpoint();
  }

  private resolveBrickPrize(brick: Brick) {
    if (brick.kind === "bomb") {
      this.explode(brick);
      return;
    }
    if (brick.kind === "wide") this.dropPowerup(brick, "expandPaddle");
    if (brick.kind === "slow") this.dropPowerup(brick, "slowBall");
    if (brick.kind === "split") this.dropPowerup(brick, "splitBall");
    if (brick.kind === "laser") this.dropPowerup(brick, "shootingPaddle");
    if (brick.kind === "grab") this.dropPowerup(brick, "grabPaddle");
    if (brick.kind === "fire") this.dropPowerup(brick, "fireball");
    if (brick.kind === "thru") this.dropPowerup(brick, "thruBrick");
    if (brick.kind === "prize") this.dropPowerup(brick, pick(prizePowerupPool(this.powerupPoolInput())));
    if (brick.kind === "penalty") this.dropPowerup(brick, pick(penaltyPowerupPool(this.powerupPoolInput())));
    if (brick.kind === "boss") this.dropPowerup(brick, pick(["shootingPaddle", "megaBall", "eightBall"]));
  }

  private explode(source: Brick) {
    const centerX = source.x + source.width / 2;
    const centerY = source.y + source.height / 2;
    this.emitSparks(centerX, centerY, "#ff5c5c", 58, { minSpeed: 120, maxSpeed: 360, minSize: 4.8, maxSize: 8.6, ring: true, gravity: 150 });
    this.emitImpactRing(centerX, centerY, "#ff5c5c", "blast");
    this.emitScreenFlash("#ff5c5c", 0.2);
    this.audio.play("explosion", this.settings.sfxVolume, { intensity: 1.12, rumble: 0.7 });
    this.shakeBoard(0.24, 5.2);
    const blast = this.bricks.filter(
      (brick) => Math.abs(brick.x - source.x) < BRICK_WIDTH * 1.8 * this.explosionScale && Math.abs(brick.y - source.y) < BRICK_HEIGHT * 2 * this.explosionScale
    );
    for (const brick of blast) {
      brick.hp = 0;
      this.score += 24;
    }
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    this.runStats.bricksBroken += blast.length;
    this.bricks = this.bricks.filter((brick) => brick.hp > 0);
    this.saveCheckpoint();
  }

  private dropPowerup(brick: Brick, kind: PowerupKind) {
    const speed = 138 + Math.min(42, this.level * 4 + this.clearedLevels * 2);
    this.powerups.push({ x: brick.x + brick.width / 2, y: brick.y + brick.height / 2, vy: speed, kind });
  }

  private updatePowerups(delta: number) {
    for (const powerup of this.powerups) {
      powerup.y += powerup.vy * delta;
      const caught = powerup.y > PADDLE_Y - 16 && powerup.y < PADDLE_Y + 24 && Math.abs(powerup.x - this.paddleX) < this.paddleWidth / 2 + 18;
      if (caught) {
        const visual = powerupVisualFor(powerup.kind);
        this.runStats.powerupsCaught += 1;
        this.emitPowerupCatchBurst(powerup, visual.spark);
        this.audio.play(soundForPowerup(powerup.kind), this.settings.sfxVolume, powerupAudioOptions(powerup.kind));
        this.paddleFlashTimer = 0.24;
        this.addFloatingText(powerup.x, PADDLE_Y - 38, pickupLabelFor(powerup.kind), visual.floatingKind);
        this.applyPowerup(powerup.kind);
        powerup.y = HEIGHT + 100;
      }
    }
    this.powerups.splice(0, this.powerups.length, ...this.powerups.filter((powerup) => powerup.y < HEIGHT + 60));
  }

  private powerupPoolInput(): PowerupPoolInput {
    return {
      level: this.level,
      clearedLevels: this.clearedLevels,
      combo: this.combo
    };
  }

  private emitBrickBurst(brick: Brick, destroyed: boolean) {
    const burst = BRICK_BURST_SCALE[brick.kind];
    const hpRatio = brick.maxHp > 0 ? clamp(brick.hp / brick.maxHp, 0, 1) : 0;
    const damageBoost = destroyed ? 1 : 1 + (1 - hpRatio) * 0.45;
    const count = Math.round((destroyed ? burst.crumble : burst.chip) * damageBoost);
    const centerX = brick.x + brick.width / 2;
    const centerY = brick.y + brick.height / 2;
    this.emitSparks(centerX, centerY, COLORS[brick.kind], count, {
      minSpeed: 64 * burst.speed,
      maxSpeed: (destroyed ? 330 : 210) * burst.speed,
      minLife: destroyed ? 0.42 : 0.28,
      maxLife: destroyed ? 0.88 : 0.62,
      minSize: 3.4 * burst.size,
      maxSize: (destroyed ? 8.2 : 5.6) * burst.size,
      gravity: brick.kind === "slow" || brick.kind === "hard" ? 260 : 190,
      ring: destroyed && burst.ring
    });
    if (destroyed && burst.ring) {
      this.emitImpactRing(centerX, centerY, COLORS[brick.kind], brick.kind === "boss" ? "boss" : "blast");
      this.emitScreenFlash(COLORS[brick.kind], brick.kind === "boss" ? 0.18 : 0.14);
    }
  }

  private emitComboFeedback(x: number, y: number, combo: number) {
    const intensity = clamp((combo - 2) / 6, 0, 1);
    this.emitSparks(x, y, "#7ef1ff", Math.round(12 + intensity * 18), {
      minSpeed: 90,
      maxSpeed: 250 + intensity * 120,
      minLife: 0.36,
      maxLife: 0.74,
      minSize: 4.4,
      maxSize: 7.4 + intensity * 2,
      gravity: 80,
      ring: true
    });
    this.emitImpactRing(x, y, "#7ef1ff", "combo");
    if (combo >= 3) this.emitScreenFlash("#7ef1ff", 0.12 + intensity * 0.08);
  }

  private playStreakTone(combo: number) {
    const now = performance.now();
    if (now - this.lastStreakToneAt < 135) return;
    this.lastStreakToneAt = now;
    const normalizedCombo = clamp((combo - 2) / 6, 0, 1);
    this.audio.play("streak", this.settings.sfxVolume, {
      pitch: 1 + normalizedCombo * 0.72,
      intensity: 0.74 + normalizedCombo * 0.38,
      streak: combo
    });
  }

  private emitPowerupCatchBurst(powerup: Powerup, color: string) {
    const tone = powerupToneFor(powerup.kind);
    this.emitSparks(powerup.x, PADDLE_Y - 8, color, tone === "volatile" ? 34 : 26, {
      minSpeed: 86,
      maxSpeed: tone === "volatile" ? 310 : 240,
      minLife: 0.34,
      maxLife: 0.78,
      minSize: 4.2,
      maxSize: tone === "hazard" ? 7.2 : 6.4,
      gravity: 120,
      ring: true
    });
    this.emitImpactRing(powerup.x, PADDLE_Y - 8, color, "powerup");
    this.triggerHaptic(tone === "volatile" ? [16, 28, 22] : tone === "hazard" ? [28, 22, 28] : 18);
  }

  private emitImpactRing(x: number, y: number, color: string, kind: "brick" | "blast" | "boss" | "combo" | "powerup") {
    if (!this.settings.particles || this.settings.reducedMotion) return;
    trimEffectChildren(this.effectsLayer, ".impact-ring", MAX_IMPACT_RINGS);
    const node = document.createElement("div");
    node.className = `impact-ring is-${kind}`;
    node.style.setProperty("--impact-color", color);
    const position = arenaPointToPercent(x, y);
    node.style.left = position.left;
    node.style.top = position.top;
    this.effectsLayer.append(node);
    const timeout = window.setTimeout(() => node.remove(), 720);
    this.impactRingTimeouts.push(timeout);
  }

  private emitScreenFlash(color: string, opacity: number) {
    if (!this.settings.particles || this.settings.reducedMotion) return;
    trimEffectChildren(this.effectsLayer, ".screen-flash", MAX_SCREEN_FLASHES);
    const node = document.createElement("div");
    node.className = "screen-flash";
    node.style.setProperty("--flash-color", color);
    node.style.setProperty("--flash-opacity", String(opacity));
    this.effectsLayer.append(node);
    const timeout = window.setTimeout(() => node.remove(), 360);
    this.screenFlashTimeouts.push(timeout);
  }

  private clearTransientEffects() {
    for (const timeout of this.impactRingTimeouts) window.clearTimeout(timeout);
    for (const timeout of this.screenFlashTimeouts) window.clearTimeout(timeout);
    this.impactRingTimeouts.splice(0);
    this.screenFlashTimeouts.splice(0);
    clearEffectLayerChildren(this.effectsLayer);
    this.fireExplodedThisTick.clear();
  }

  private triggerHaptic(pattern: number | number[]) {
    if (this.settings.reducedMotion) return;
    const hapticNavigator = navigator as unknown as { vibrate?: (pattern: number | number[]) => boolean };
    if (typeof hapticNavigator.vibrate === "function") hapticNavigator.vibrate(pattern);
  }

  private applyPowerup(kind: PowerupKind) {
    if (kind === "expandPaddle") {
      this.paddleWidth = clamp(this.paddleWidth + 46, 86, 210);
      this.pushEvent("Paddle widened.");
    }
    if (kind === "shrinkPaddle") {
      this.paddleWidth = clamp(this.paddleWidth - 36, 58, 210);
      this.pushEvent("Paddle shrank.");
    }
    if (kind === "superShrink") {
      this.paddleWidth = 58;
      this.pushEvent("Super shrink hit the paddle.");
    }
    if (kind === "slowBall") {
      this.scaleBalls(0.78);
      this.pushEvent("Ball speed softened.");
    }
    if (kind === "fastBall") {
      this.scaleBalls(1.32);
      this.pushEvent("Fast ball.");
    }
    if (kind === "splitBall") {
      this.spawnExtraBalls(2);
      this.pushEvent("Multiball unleashed.");
    }
    if (kind === "eightBall") {
      this.spawnExtraBalls(8 - this.balls.length);
      this.pushEvent("Eight ball chaos.");
    }
    if (kind === "megaBall") {
      for (const ball of this.balls) {
        ball.megaTimer = Math.max(ball.megaTimer, POWER_DURATIONS.Mega);
        ball.radius = 14;
      }
      this.pushEvent("Mega ball armed.");
    }
    if (kind === "fireball") {
      for (const ball of this.balls) ball.fireTimer = Math.max(ball.fireTimer, POWER_DURATIONS.Fire);
      this.pushEvent("Fireball burns through the wall.");
    }
    if (kind === "thruBrick") {
      for (const ball of this.balls) ball.thruTimer = Math.max(ball.thruTimer, POWER_DURATIONS.Thru);
      this.pushEvent("Thru-brick ball enabled.");
    }
    if (kind === "shootingPaddle") {
      this.laserTimer = Math.max(this.laserTimer, POWER_DURATIONS.Laser);
      this.pushEvent("Shooting paddle armed.");
    }
    if (kind === "grabPaddle") {
      this.grabTimer = Math.max(this.grabTimer, POWER_DURATIONS.Grab);
      this.pushEvent("Grab paddle online.");
    }
    if (kind === "extraLife") {
      this.lives += 1;
      this.pushEvent("Extra life.");
    }
    if (kind === "levelWarp") {
      this.pushEvent("Level warp opened.");
      this.completeLevel();
    }
    if (kind === "zapBricks") {
      this.zapBricks(10);
      this.pushEvent("Lightning zapped the board.");
    }
    if (kind === "fallingBricks") {
      this.fallBricks();
      this.pushEvent("Falling bricks.");
    }
    if (kind === "setOffExploding") {
      for (const brick of [...this.bricks].filter((candidate) => candidate.kind === "bomb")) this.explode(brick);
      this.pushEvent("Explosives set off.");
    }
    if (kind === "expandExploding") {
      this.explosionScale = 2.3;
      this.pushEvent("Explosions expanded.");
    }
    if (kind === "killPaddle") {
      if (this.balls.length > 1) {
        this.balls.pop();
        this.pushEvent("Kill paddle removed one ball.");
      } else {
        this.pushEvent("Kill paddle.");
        this.loseLife();
      }
    }
    if (kind === "shrinkBall") {
      for (const ball of this.balls) ball.radius = 5;
      this.pushEvent("Shrink ball.");
    }
  }

  private updateSparks(delta: number) {
    let write = 0;
    for (let read = 0; read < this.sparks.length; read += 1) {
      const spark = this.sparks[read];
      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
      spark.vx *= Math.max(0.72, 1 - delta * 0.7);
      spark.vy += spark.gravity * delta;
      spark.life -= delta;
      if (spark.life <= 0) continue;
      if (write !== read) this.sparks[write] = spark;
      write += 1;
    }
    this.sparks.length = write;
  }

  private updateFloatingTexts(delta: number) {
    let write = 0;
    for (let read = 0; read < this.floatingTexts.length; read += 1) {
      const text = this.floatingTexts[read];
      text.life -= delta;
      if (text.life <= 0) continue;
      if (write !== read) this.floatingTexts[write] = text;
      write += 1;
    }
    this.floatingTexts.length = write;
  }

  private updateFeedback(delta: number) {
    this.boardShakeTimer = Math.max(0, this.boardShakeTimer - delta);
    if (this.boardShakeTimer === 0) this.boardShakeStrength = 0;
    this.paddleFlashTimer = Math.max(0, this.paddleFlashTimer - delta);
    this.levelClearFlashTimer = Math.max(0, this.levelClearFlashTimer - delta);
    this.lifeFlashTimer = Math.max(0, this.lifeFlashTimer - delta);
    for (const [brick, timer] of this.brickImpactTimers) {
      const nextTimer = timer - delta;
      if (nextTimer <= 0 || !this.bricks.includes(brick)) this.brickImpactTimers.delete(brick);
      else this.brickImpactTimers.set(brick, nextTimer);
    }
  }

  private addFloatingText(x: number, y: number, text: string, kind: FloatingText["kind"]) {
    const duration = kind === "combo" ? 0.95 : kind.startsWith("powerup") ? 0.9 : 0.75;
    if (this.floatingTexts.length >= 24) {
      this.floatingTexts.splice(0, this.floatingTexts.length - 23);
    }
    this.floatingTexts.push({
      id: this.nextFloatingTextId,
      x,
      y,
      text,
      life: duration,
      duration,
      kind
    });
    this.nextFloatingTextId += 1;
  }

  private shakeBoard(duration: number, strength: number) {
    if (this.settings.reducedMotion) return;
    this.boardShakeTimer = Math.max(this.boardShakeTimer, duration);
    this.boardShakeStrength = this.boardShakeTimer > 0 ? Math.max(this.boardShakeStrength, strength) : strength;
  }

  private loseLife() {
    if (this.phase !== "playing") return;
    this.lives -= 1;
    this.combo = 1;
    this.noBallTimer = 0;
    this.launchLossGraceTimer = 0;
    this.audio.play("loseLife", this.settings.sfxVolume);
    this.lifeFlashTimer = 0.45;
    this.shakeBoard(0.18, 3.2);
    if (this.lives <= 0) {
      this.phase = "gameOver";
      this.powerups.splice(0);
      this.laserBeams.splice(0);
      if (this.boardContext.source === "pack" && this.boardContext.packId === SAVED_DESIGNS_PACK_ID) this.updateSavedBoardBestScore(this.boardContext.boardIndex, this.score);
      this.updateDailyProgress(this.score, false);
      localStorage.removeItem(SAVE_KEY);
      this.hasSave = false;
      this.pushEvent("Run ended.");
      this.announce("Game over.");
      this.audio.play("gameOver", this.settings.sfxVolume);
      this.triggerHaptic([38, 34, 48]);
      this.showRunSummaryOverlay("gameOver", {
        title: "Game Over",
        body: "Run complete. Review the haul, then jump back in or choose a board pack.",
        actions: [
          { label: "Retry Run", primary: true, action: () => void this.restartRun() },
          { label: "Choose Board", action: () => this.openBoardPicker() },
          { label: "Share Hook Soon", disabled: true, action: () => undefined }
        ]
      });
      this.refreshHud("Game over. Summary ready.");
      return;
    }
    this.phase = "ready";
    this.resetBall();
    this.pushEvent("Ball lost. Space to launch.");
    this.announce(`Ball lost. ${this.lives} lives remain.`);
    this.saveCheckpoint();
    this.showOverlay("Ball Lost", `${this.lives} lives remain. Aim before you relaunch.`, "Launch", () => this.handlePrimaryAction());
  }

  private completeLevel() {
    if (this.phase === "levelComplete" || this.phase === "loading" || this.phase === "gameOver") return;
    const completedContext = this.boardContext;
    this.phase = "levelComplete";
    this.clearedLevels += 1;
    this.runStats.boardsCleared += 1;
    const bonus = 500 + this.lives * 100 + Math.round(this.combo * 60);
    this.score += bonus;
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    if (completedContext.source === "pack") {
      if (completedContext.packId === DAILY_PACK_ID) {
        this.updateDailyProgress(this.score, true);
      } else {
        this.packProgress = markPackBoardCleared(this.packProgress, completedContext.packId, completedContext.boardIndex, this.score, this.savedBoards.length);
        if (completedContext.packId === SAVED_DESIGNS_PACK_ID) this.updateSavedBoardBestScore(completedContext.boardIndex, this.score);
        writeJson(PACK_PROGRESS_KEY, this.packProgress);
      }
    }
    this.powerups.splice(0);
    this.laserBeams.splice(0);
    this.pushEvent(`Level ${this.level} cleared. Bonus ${bonus} pts.`);
    this.announce(`Level ${this.level} cleared. Bonus ${bonus} points.`);
    this.addFloatingText(WIDTH / 2, HEIGHT / 2, `+${bonus} clear`, "status");
    this.levelClearFlashTimer = 0.8;
    this.audio.play("levelClear", this.settings.sfxVolume);
    this.triggerHaptic([18, 24, 18]);
    this.shakeBoard(0.28, 2.6);
    this.saveCheckpoint("Level checkpoint saved.", false, "technical");
    const nextStep = nextLevelCompleteStep(completedContext, this.level, this.packProgress, this.savedBoards.length);
    const actions: SummaryAction[] = [
      { label: nextStep.actionLabel, primary: true, action: () => void this.continueToNextLevel() },
      { label: "Retry Run", action: () => void this.restartRun() },
      { label: "Choose Board", action: () => this.openBoardPicker() }
    ];
    if (completedContext.source === "generated") {
      const savedAlready = this.currentGeneratedBoardSaved();
      actions.splice(1, 0, { label: savedAlready ? "Saved in Boards" : "Keep Board", disabled: savedAlready, action: () => this.saveCurrentBoardToPack() });
    }
    actions.push({ label: "Share Hook Soon", disabled: true, action: () => undefined });
    this.showRunSummaryOverlay("clear", {
      title: "Level Cleared",
      body: nextStep.body,
      actions
    });
    this.refreshHud(`${nextStep.status} Summary ready.`);
  }

  private async continueToNextLevel() {
    if (this.phase !== "levelComplete") return;
    const clearedBoardName = this.levelBlueprint.name;
    this.pushEvent(`Cleared ${clearedBoardName}. Designing the next wall.`);
    if (this.boardContext.source === "pack") {
      const { packId, boardIndex } = this.boardContext;
      const nextIndex = boardIndex + 1;
      const total = boardCountForPack(packId, this.savedBoards.length);
      if (nextIndex < total) {
        this.loadPackBoard(packId, nextIndex, `${packNameFor(packId)} board ${nextIndex + 1} loaded.`);
        return;
      }
      const nextPack = getNextBuiltInPack(packId);
      if (nextPack && this.packProgress[nextPack.id]?.unlocked) {
        this.startPack(nextPack.id, `${nextPack.name} unlocked.`);
        return;
      }
    }
    this.level += 1;
    await this.fetchLevel("Wall cleared. Designing the next board.");
  }

  private async restartRun() {
    const activePackId = this.boardContext.source === "pack" ? this.boardContext.packId : null;
    const activeDailyDateKey = this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.resolvedDailyDateKey() : null;
    this.level = 1;
    this.clearedLevels = 0;
    this.score = 0;
    this.lives = 3;
    this.combo = 1;
    this.runStats = createRunStats(this.score, this.bestScore);
    this.autosaveSuppressed = false;
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    if (activePackId === DAILY_PACK_ID && activeDailyDateKey) {
      this.startDailyBoard(activeDailyDateKey, `New run. Replaying Today's Board ${activeDailyDateKey}.`);
      return;
    }
    if (activePackId && this.canPlayPack(activePackId)) {
      this.startPack(activePackId, `New run. Replaying ${packNameFor(activePackId)}.`);
      return;
    }
    await this.fetchLevel("New run. Rebuilding Level 1.");
  }

  private async fetchLevel(event: string) {
    this.phase = "loading";
    this.loadingLevel = true;
    this.pushEvent(event);
    this.showLoadingOverlay(`Generating Level ${this.level}`, "The game is paused while a playable wall is prepared.");
    this.refreshHud("Designer is shaping a playable wall.");
    const previousFingerprint = blueprintFingerprint(this.levelBlueprint);
    const sourcePrompt = this.designerIntent.brief || "Default Ricochet board prompt";
    const maxAttempts = 3;
    let lastError = "Level generation failed.";

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        this.prepareDesignerForGeneration();
        const request = this.levelRequest();
        try {
          const result = await requestGeneratedLevel(request);
          if (result.source === "fallback" && attempt < maxAttempts) {
            lastError = result.warning ?? "Board designer used local backup instead of Cursor SDK.";
            this.pushEvent(`${lastError} Retrying with a fresh seed.`, "technical");
            continue;
          }
          const fingerprint = blueprintFingerprint(result.level);
          if (fingerprint === previousFingerprint && attempt < maxAttempts) {
            lastError = "Designer returned the same wall layout; retrying with a fresh seed.";
            this.pushEvent(lastError, "technical");
            continue;
          }
          const sourceEvent = `${result.level.name} is ready.`;
          if (result.source === "fallback" && result.warning) {
            this.pushEvent(result.warning, "technical");
          }
          this.loadLevel(result.level, sourceEvent, result.trace, result.summary, { source: "generated", packId: null, boardIndex: 0 }, sourcePrompt);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "unknown error";
          if (attempt < maxAttempts && !isLevelGenerationNetworkError(error)) {
            this.pushEvent(`Generation attempt ${attempt} failed. Retrying.`, "technical");
            continue;
          }
          const fallback = fallbackLevel(request);
          const warning = isLevelGenerationNetworkError(error)
            ? `${levelGenerationServerHint()} (${lastError})`
            : lastError;
          this.loadLevel(fallback, `${fallback.name} is ready.`, undefined, this.localGenerationSummary(fallback, warning, request.designer), {
            source: "generated",
            packId: null,
            boardIndex: 0
          }, sourcePrompt);
          return;
        }
      }

      const request = this.levelRequest();
      const fallback = fallbackLevel(request);
      this.loadLevel(fallback, `${fallback.name} is ready.`, undefined, this.localGenerationSummary(fallback, lastError, request.designer), {
        source: "generated",
        packId: null,
        boardIndex: 0
      }, sourcePrompt);
    } finally {
      this.loadingLevel = false;
      this.refreshHud();
    }
  }

  private prepareDesignerForGeneration() {
    const request = this.levelRequest();
    this.designerIntent = {
      ...this.designerIntent,
      seed: nextDesignerSeed(this.designerIntent.seed, request)
    };
  }

  private levelRequest(): LevelRequest {
    return {
      level: this.level,
      score: this.score,
      lives: this.lives,
      clearedLevels: this.clearedLevels,
      recentEvents: gameEventsToStrings(this.recentEvents.filter((event) => event.audience === "player")).slice(0, 5),
      designer: resolveDesignerIntentForGeneration({
        ...this.designerIntent,
        seed: this.designerIntent.seed
      })
    };
  }

  private localGenerationSummary(level: LevelBlueprint, reason: string, designer: BoardDesignerIntent = this.designerIntent): GenerationSummary {
    const brickCount = level.rows.flat().filter(Boolean).length;
    const targets = designerTargets(designer, this.level);
    const serverOffline = reason.includes("npm run dev") || reason.includes("/api/level");
    const promptLabel = designer.brief.trim()
      ? `your prompt: "${designer.brief.trim().slice(0, 88)}${designer.brief.trim().length > 88 ? "…" : ""}"`
      : "the default arcade brief";
    return {
      source: "fallback",
      title: serverOffline ? `Local backup · ${level.name}` : `Local backup · ${level.name}`,
      detail: serverOffline
        ? `${reason} Local backup built "${level.name}" for ${promptLabel} so you can keep playing offline. Target was ${targets.brickTarget} bricks with about ${targets.specialTarget} specials; final wall has ${brickCount} playable bricks.`
        : `Local backup built "${level.name}" for ${promptLabel}. Target was ${targets.brickTarget} bricks with about ${targets.specialTarget} specials; final wall has ${brickCount} playable bricks.`,
      chips: [
        designer.brief ? `prompt: ${designer.brief.trim().slice(0, 56)}${designer.brief.trim().length > 56 ? "…" : ""}` : "default prompt",
        `difficulty ${designer.difficulty}/5`,
        `${Math.round(designer.density * 100)}% density`,
        `${Math.round(designer.specialBias * 100)}% specials`
      ],
      warning: reason
    };
  }


  private refreshHud(status?: string) {
    const signature = buildHudUpdateSignature(this.hudSnapshot(status));
    if (!status && signature === this.hudUpdateSignature) return;
    this.hudUpdateSignature = signature;
    this.updateCanvasLabel();
    this.hud.update({
      score: this.score,
      bestScore: this.bestScore,
      lives: this.lives,
      level: this.level,
      bricks: this.bricks.length,
      combo: this.combo,
      status: status ?? this.recentEvents[0]?.text ?? "",
      levelName: this.levelBlueprint.name,
      hint: this.levelBlueprint.paddleHint,
      pending: this.loadingLevel,
      hasSave: this.hasSave,
      announcement: this.announcement,
      agentTrace: this.latestAgentTrace,
      sidebarCollapsed: this.sidebarCollapsed,
      settings: this.settings,
      playMode: this.playMode,
      cosmetics: this.cosmetics,
      cosmeticOptions: collectCosmeticOptions(this.hudSnapshot()),
      activePowers: collectActivePowers(this.hudSnapshot()),
      powerupPrimerDismissed: this.powerupPrimerDismissed,
      packs: collectPackItems(this.packHudSnapshot()),
      canSaveBoard: this.boardContext.source === "generated" && this.bricks.length > 0 && !this.currentGeneratedBoardSaved(),
      boardSource: this.boardContext.source,
      designer: {
        intent: this.designerIntent,
        generationSummary: this.latestGenerationSummary,
        previewRows: this.boardContext.source === "generated" ? previewRowsFromLevel(this.levelBlueprint) : []
      },
      events: this.recentEvents
    });
  }




  private pushEvent(event: string, audience: GameEventAudience = "player") {
    this.recentEvents.unshift(gameEvent(event, audience));
    this.recentEvents.splice(6);
  }

  private dismissPowerupPrimer() {
    this.powerupPrimerDismissed = true;
    writeJson(POWERUP_PRIMER_DISMISSED_KEY, true);
    this.pushEvent("Power-up primer dismissed.");
    this.refreshHud("Power-up primer dismissed.");
  }

  private announce(message: string) {
    this.announcement = message;
  }

  private saveCheckpoint(event?: string, force = false, audience: GameEventAudience = "player") {
    const now = performance.now();
    if (!force && !event && now - this.lastCheckpointAt < 1000) return;
    this.lastCheckpointAt = now;
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    if (this.bricks.length === 0 || this.autosaveSuppressed) {
      localStorage.removeItem(SAVE_KEY);
      this.hasSave = false;
      if (event) this.pushEvent(event, audience);
      return;
    }
    const save: GameSave = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      level: this.level,
      clearedLevels: this.clearedLevels,
      boardSource: this.boardContext.source,
      packId: this.boardContext.packId,
      packBoardIndex: this.boardContext.boardIndex,
      dailyDateKey: this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.resolvedDailyDateKey() : null,
      score: this.score,
      bestScore: this.bestScore,
      lives: this.lives,
      combo: this.combo,
      paddleWidth: this.paddleWidth,
      levelBlueprint: this.levelBlueprint,
      levelSourcePrompt: this.levelSourcePrompt,
      bricks: this.bricks.map(toSavedBrick),
      recentEvents: event ? [gameEvent(event, audience), ...this.recentEvents].slice(0, 6) : this.recentEvents,
      laserTimer: this.laserTimer,
      grabTimer: this.grabTimer,
      explosionScale: this.explosionScale,
      balls: this.balls.length > 0 ? this.balls.map(toSavedBall) : null,
      runStats: toSavedRunStats(this.runStats)
    };
    writeJson(SAVE_KEY, save);
    this.hasSave = true;
    if (event) this.pushEvent(event, audience);
  }

  private applySettingsClass() {
    const shell = this.mount.closest<HTMLElement>(".shell");
    shell?.classList.toggle("is-high-contrast", this.settings.highContrast);
    shell?.classList.toggle("is-reduced-motion", this.settings.reducedMotion);
  }

  private setSidebarCollapsed(collapsed: boolean) {
    this.sidebarCollapsed = collapsed;
    this.applySidebarClass();
    writeJson(SIDEBAR_COLLAPSED_KEY, this.sidebarCollapsed);
    this.refreshHud();
  }

  private applySidebarClass() {
    const shell = this.mount.closest<HTMLElement>(".shell");
    if (!shell) return;
    shell.classList.toggle("is-sidebar-collapsed", this.sidebarCollapsed);
  }


  private emitSparks(x: number, y: number, color: string, count: number, options: Partial<SparkBurstOptions> = {}) {
    if (!this.settings.particles || this.settings.reducedMotion) return;
    const burst = { ...DEFAULT_SPARK_BURST, ...options };
    for (let index = 0; index < count; index += 1) {
      const angle = burst.ring ? (index / Math.max(1, count)) * Math.PI * 2 + (Math.random() - 0.5) * 0.32 : Math.random() * Math.PI * 2;
      const speed = burst.minSpeed + Math.random() * (burst.maxSpeed - burst.minSpeed);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: burst.minLife + Math.random() * (burst.maxLife - burst.minLife),
        color,
        gravity: burst.gravity,
        size: burst.minSize + Math.random() * (burst.maxSize - burst.minSize)
      });
    }
  }

  private updateLaser(delta: number) {
    for (const beam of this.laserBeams) {
      beam.life -= delta;
    }
    this.laserBeams.splice(0, this.laserBeams.length, ...this.laserBeams.filter((beam) => beam.life > 0));
    if (this.laserTimer <= 0 || this.laserCooldown > 0) return;
    this.laserCooldown = 0.26;
    for (const x of [this.paddleX - this.paddleWidth * 0.34, this.paddleX + this.paddleWidth * 0.34]) {
      this.fireLaser(x);
    }
  }

  private scaleBalls(scale: number) {
    for (const ball of this.balls) {
      ball.vx = clamp(ball.vx * scale, -860, 860);
      ball.vy = clamp(ball.vy * scale, -860, 860);
    }
  }

  private spawnExtraBalls(count: number) {
    if (count <= 0) return;
    const sources =
      this.balls.length > 0
        ? this.balls
        : [{ x: this.paddleX, y: PADDLE_Y - 18, vx: 190, vy: -420, radius: 8, stuck: false, stuckOffset: 0, fireTimer: 0, thruTimer: 0, megaTimer: 0 }];
    const spawned: Ball[] = [];
    for (let index = 0; index < count; index += 1) {
      const source = sources[index % sources.length];
      const angle = -Math.PI * (0.18 + ((index + 1) / (count + 2)) * 0.64);
      const speed = clamp(Math.hypot(source.vx, source.vy), 420, 720);
      spawned.push({
        ...source,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        stuck: false,
        stuckOffset: 0
      });
    }
    this.balls.push(...spawned.slice(0, Math.max(0, 10 - this.balls.length)));
  }

  private zapBricks(count: number) {
    const targets = [...this.bricks].sort(() => Math.random() - 0.5).slice(0, count);
    for (const brick of targets) {
      this.emitSparks(brick.x + brick.width / 2, brick.y + brick.height / 2, "#d6ff4d", 18);
      this.score += 18;
    }
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    this.runStats.bricksBroken += targets.length;
    this.bricks = this.bricks.filter((brick) => !targets.includes(brick));
    this.saveCheckpoint();
  }

  private fallBricks() {
    const maxY = PADDLE_Y - BRICK_HEIGHT * 3;
    for (const brick of this.bricks) {
      brick.y = Math.min(maxY, brick.y + BRICK_HEIGHT + BRICK_GAP);
    }
  }

  private fireLaser(x: number) {
    this.laserBeams.push({ x, life: 0.09 });
    this.audio.play("laser", this.settings.sfxVolume);
    const target = this.bricks
      .filter((brick) => x >= brick.x && x <= brick.x + brick.width)
      .sort((a, b) => b.y - a.y)
      .at(0);
    if (!target) return;
    this.hitBrick(target);
  }

  private packHudSnapshot() {
    return {
      boardContext: this.boardContext,
      dailyProgress: this.dailyProgress,
      packProgress: this.packProgress,
      savedBoards: this.savedBoards
    };
  }

  private hudSnapshot(status?: string) {
    return {
      status,
      phase: this.phase,
      score: this.score,
      bestScore: this.bestScore,
      lives: this.lives,
      level: this.level,
      brickCount: this.bricks.length,
      combo: this.combo,
      recentEvents: this.recentEvents,
      announcement: this.announcement,
      loadingLevel: this.loadingLevel,
      hasSave: this.hasSave,
      sidebarCollapsed: this.sidebarCollapsed,
      laserTimer: this.laserTimer,
      grabTimer: this.grabTimer,
      balls: this.balls,
      paddleWidth: this.paddleWidth,
      boardContext: this.boardContext,
      designerIntent: this.designerIntent,
      latestGenerationSummary: this.latestGenerationSummary,
      powerupPrimerDismissed: this.powerupPrimerDismissed,
      settings: this.settings,
      playMode: this.playMode,
      dailyProgress: this.dailyProgress,
      packProgress: this.packProgress,
      savedBoards: this.savedBoards
    };
  }

  private sceneFrame(): SceneFrame {
    return {
      bricks: this.bricks,
      balls: this.balls,
      powerups: this.powerups,
      laserBeams: this.laserBeams,
      sparks: this.sparks,
      floatingTexts: this.floatingTexts,
      paddleX: this.paddleX,
      paddleWidth: this.paddleWidth,
      paddleFlashTimer: this.paddleFlashTimer,
      lifeFlashTimer: this.lifeFlashTimer,
      laserTimer: this.laserTimer,
      boardContext: this.boardContext,
      cosmetics: this.cosmetics,
      settings: this.settings,
      brickImpactTimers: this.brickImpactTimers,
      boardShakeTimer: this.boardShakeTimer,
      boardShakeStrength: this.boardShakeStrength,
      levelClearFlashTimer: this.levelClearFlashTimer,
      phaseLabel: this.phase,
      level: this.level,
      lives: this.lives
    };
  }

  private render() {
    this.sceneView.render(this.sceneFrame(), this.effectsLayer);
  }

  private updateCanvasLabel() {
    this.sceneView.updateCanvasLabel(this.sceneFrame());
  }

  private applyBoardTheme() {
    this.sceneView.applyBoardTheme(this.sceneFrame());
  }

  private showOverlay(
    title: string,
    body: string,
    actionLabel?: string,
    action?: () => void,
    busy = false,
    secondaryLabel?: string,
    secondaryAction?: () => void
  ) {
    this.gameOverlay.show(title, body, actionLabel, action, busy, secondaryLabel, secondaryAction);
  }

  private hideOverlay() {
    this.gameOverlay.hide();
  }

  private showLoadingOverlay(title: string, body: string) {
    this.gameOverlay.showLoading(title, body);
  }

  private showLevelReadyOverlay(event: string) {
    this.gameOverlay.showLevelReady(
      `Level ${this.level}: ${this.levelBlueprint.name}`,
      `${this.levelBlueprint.briefing} ${event.includes("backup") || event.includes("fallback") ? "Local backup handled this board; the wall is still playable." : ""}`,
      () => this.handlePrimaryAction()
    );
  }

  private showRunSummaryOverlay(mode: "clear" | "gameOver", content: { title: string; body: string; actions: SummaryAction[] }) {
    this.gameOverlay.showRunSummary(mode, content, buildRunSummaryStats(mode, this.score, this.bestScore, this.runStats));
  }

  private openBoardPicker() {
    this.hideOverlay();
    this.mount.closest<HTMLElement>(".shell")?.querySelector<HTMLButtonElement>('[data-tool-panel="packs"]')?.click();
    this.refreshHud("Choose a board pack.");
  }

  private scrollStageIntoView() {
    this.gameOverlay.scrollStageIntoView();
  }

}

export { LAUNCH_LOSS_GRACE_SECONDS } from "./tuning";
export { calculatePaddleRebound, computeStuckBallLaunch, detectBrickContact, normalizeLoopRiskVelocity } from "./physics";
export type { BrickContact, BrickContactInput, LoopRiskVelocity, LoopRiskVelocityInput, PaddleRebound, PaddleReboundInput, StuckBallLaunchInput } from "./physics";
export { penaltyPowerupPool, powerupToneFor, prizePowerupPool } from "./powerups";
export type { PowerupKind, PowerupPoolInput, PowerupTone } from "./powerups";

