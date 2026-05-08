import * as THREE from "three";
import {
  BRICK_COLUMNS,
  BRICK_ROWS,
  DEFAULT_DESIGNER_INTENT,
  type BoardDesignerFeedback,
  type BoardDesignerIntent,
  type BrickKind,
  type DesignerVote,
  type GenerationSummary,
  type LevelBlueprint,
  type LevelRequest,
  type LevelResponse,
  fallbackLevel,
  normalizeDesignerIntent,
  normalizeLevel
} from "../../shared/evolution";
import {
  BUILT_IN_PACKS,
  SAVED_DESIGNS_PACK_ID,
  type PackProgressState,
  type SavedBoardEntry,
  boardCountForPack,
  getBuiltInPack,
  getNextBuiltInPack,
  markPackBoardCleared,
  materializeAuthoredBoard,
  normalizePackProgress,
  normalizeSavedBoards,
  previewRowsFromLevel,
  trimSavedBoards
} from "../../shared/boardPacks";
import {
  DEFAULT_SETTINGS,
  SAVE_VERSION,
  type GameSave,
  type GameSettings,
  type SavedBallState,
  type SavedBrick,
  normalizeSaveState,
  normalizeSettings
} from "../../shared/saveState";
import type { HudApi, HudPackItem } from "../ui/hud";
import { createGameAudio } from "./gameAudio";

interface Ball {
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

interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: BrickKind;
  hp: number;
  maxHp: number;
}

type PowerupKind =
  | "expandPaddle"
  | "shrinkPaddle"
  | "superShrink"
  | "splitBall"
  | "eightBall"
  | "megaBall"
  | "slowBall"
  | "fastBall"
  | "fireball"
  | "thruBrick"
  | "shootingPaddle"
  | "grabPaddle"
  | "extraLife"
  | "levelWarp"
  | "zapBricks"
  | "fallingBricks"
  | "setOffExploding"
  | "expandExploding"
  | "killPaddle"
  | "shrinkBall";

interface Powerup {
  x: number;
  y: number;
  vy: number;
  kind: PowerupKind;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  life: number;
  duration: number;
  kind: "score" | "combo" | "status";
}

export interface ComposerGeneratedLevelEntry {
  createdAt: string;
  level: number;
  score: number;
  lives: number;
  clearedLevels: number;
  levelName: string;
  model: LevelResponse["model"];
  levelBlueprint: LevelBlueprint;
  summary?: GenerationSummary;
  trace?: LevelResponse["trace"];
}

interface LaserBeam {
  x: number;
  life: number;
}

export interface PaddleReboundInput {
  hitZone: number;
  paddleVelocityX: number;
  incomingVx: number;
  incomingVy: number;
}

export interface PaddleRebound {
  vx: number;
  vy: number;
  speed: number;
}

export interface LoopRiskVelocityInput {
  vx: number;
  vy: number;
  minXRatio?: number;
  minYRatio?: number;
  fallbackXSign?: number;
  fallbackYSign?: number;
}

export interface LoopRiskVelocity {
  vx: number;
  vy: number;
  speed: number;
  changed: boolean;
}

interface PaddleHitDebug extends PaddleRebound {
  hitZone: number;
  paddleVelocityX: number;
}

interface LoopCorrectionDebug extends LoopRiskVelocity {
  source: "wall" | "brick";
  axis: "x" | "y";
  beforeVx: number;
  beforeVy: number;
}

type GamePhase = "loading" | "ready" | "playing" | "levelComplete" | "gameOver";

type BoardContext =
  | { source: "pack"; packId: string; boardIndex: number }
  | { source: "generated"; packId: null; boardIndex: 0 };

const WIDTH = 960;
const HEIGHT = 640;
const WALL = 18;
const BRICK_GAP = 5;
const BRICK_TOP = 72;
const BRICK_WIDTH = (WIDTH - WALL * 2 - BRICK_GAP * (BRICK_COLUMNS - 1)) / BRICK_COLUMNS;
const BRICK_HEIGHT = 28;
const PADDLE_Y = HEIGHT - 52;
const PADDLE_SPEED = 620;
const MAX_PADDLE_VELOCITY = 920;
const PADDLE_ACCELERATION = 1.018;
const PADDLE_EDGE_INFLUENCE = 0.74;
const PADDLE_SPIN_INFLUENCE = 0.22;
const LAUNCH_SIDE_SPEED = 190;
const LAUNCH_OFFSET_INFLUENCE = 300;
const LAUNCH_SPIN_INFLUENCE = 0.1;
const LAUNCH_UPWARD_SPEED = 410;
const MIN_BALL_SPEED = 420;
const MAX_BALL_SPEED = 860;
const MAX_LAUNCH_SPEED = 760;
const MIN_REBOUND_X_RATIO = 0.18;
const MAX_REBOUND_X_RATIO = 0.84;
const MIN_COLLISION_X_RATIO = 0.16;
const MIN_COLLISION_Y_RATIO = 0.16;
const POWERUP_ATLAS_COLUMNS = 5;
const POWERUP_ATLAS_ROWS = 4;
const SAVE_KEY = "ricochet-rush-save";
const SETTINGS_KEY = "ricochet-rush-settings";
const SIDEBAR_COLLAPSED_KEY = "ricochet-rush-sidebar-collapsed";
const BEST_SCORE_KEY = "ricochet-rush-best-score";
const COMPOSER_LEVEL_ARCHIVE_KEY = "ricochet-rush-composer-level-archive";
const COMPOSER_LEVEL_ARCHIVE_MAX = 50;
const PACK_PROGRESS_KEY = "ricochet-rush-pack-progress";
const SAVED_BOARDS_KEY = "ricochet-rush-saved-boards";
const SAVED_BOARDS_MAX = 24;
const DESIGNER_INTENT_KEY = "ricochet-rush-designer-intent";
const DESIGNER_FEEDBACK_KEY = "ricochet-rush-designer-feedback";
const DESIGNER_FEEDBACK_MAX = 8;
const POWER_DURATIONS: Record<string, number> = {
  Laser: 8,
  Grab: 12,
  Fire: 10,
  Thru: 10,
  Mega: 12
};

const COLORS: Record<BrickKind, string> = {
  basic: "#4ecdc4",
  hard: "#7d8ca3",
  bomb: "#ff5c5c",
  prize: "#7bf1a8",
  penalty: "#b23a48",
  laser: "#ff4d8d",
  grab: "#b6fffa",
  fire: "#ff7a2f",
  thru: "#d6ff4d",
  split: "#ffe066",
  wide: "#7bf1a8",
  slow: "#8e7dff",
  boss: "#ff9f43"
};

const POWERUP_ORDER: PowerupKind[] = [
  "expandPaddle",
  "shrinkPaddle",
  "superShrink",
  "splitBall",
  "eightBall",
  "megaBall",
  "slowBall",
  "fastBall",
  "fireball",
  "thruBrick",
  "shootingPaddle",
  "grabPaddle",
  "extraLife",
  "levelWarp",
  "zapBricks",
  "fallingBricks",
  "setOffExploding",
  "expandExploding",
  "killPaddle",
  "shrinkBall"
];

const POWERUP_NAMES: Record<PowerupKind, string> = {
  expandPaddle: "Expand paddle",
  shrinkPaddle: "Shrink paddle",
  superShrink: "Super shrink",
  splitBall: "Split ball",
  eightBall: "Eight ball",
  megaBall: "Mega ball",
  slowBall: "Slow ball",
  fastBall: "Fast ball",
  fireball: "Fireball",
  thruBrick: "Thru-brick",
  shootingPaddle: "Shooting paddle",
  grabPaddle: "Grab paddle",
  extraLife: "Extra life",
  levelWarp: "Level warp",
  zapBricks: "Zap bricks",
  fallingBricks: "Falling bricks",
  setOffExploding: "Set off bombs",
  expandExploding: "Bigger blasts",
  killPaddle: "Kill paddle",
  shrinkBall: "Shrink ball"
};

const POSITIVE_POWERUPS: PowerupKind[] = [
  "expandPaddle",
  "splitBall",
  "eightBall",
  "megaBall",
  "slowBall",
  "fireball",
  "thruBrick",
  "shootingPaddle",
  "grabPaddle",
  "extraLife",
  "levelWarp",
  "zapBricks",
  "setOffExploding",
  "expandExploding"
];
const NEGATIVE_POWERUPS: PowerupKind[] = ["shrinkPaddle", "superShrink", "fastBall", "fallingBricks", "killPaddle", "shrinkBall"];

export class RicochetRushGame {
  private readonly mount: HTMLDivElement;
  private readonly hud: HudApi;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 1, 1800);
  private readonly board = new THREE.Group();
  private readonly bricksGroup = new THREE.Group();
  private readonly ballsGroup = new THREE.Group();
  private readonly powerupsGroup = new THREE.Group();
  private readonly lasersGroup = new THREE.Group();
  private readonly sparksGroup = new THREE.Group();
  private readonly overlay = document.createElement("div");
  private readonly effectsLayer = document.createElement("div");
  private readonly keys = new Set<string>();
  private readonly balls: Ball[] = [];
  private readonly powerups: Powerup[] = [];
  private readonly sparks: Spark[] = [];
  private readonly floatingTexts: FloatingText[] = [];
  private readonly laserBeams: LaserBeam[] = [];
  private readonly brickMeshes = new Map<Brick, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  private readonly ballMeshes = new Map<Ball, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  private readonly powerupObjects = new Map<Powerup, THREE.Object3D>();
  private readonly laserObjects = new Map<LaserBeam, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>();
  private readonly brickImpactTimers = new Map<Brick, number>();
  private readonly floatingTextNodes = new Map<number, HTMLDivElement>();
  private readonly brickGeometry = new THREE.BoxGeometry(BRICK_WIDTH, BRICK_HEIGHT, 22, 2, 2, 1);
  private readonly paddleGeometry = new THREE.BoxGeometry(1, 1, 1, 3, 1, 1);
  private readonly ballGeometry = new THREE.SphereGeometry(1, 28, 18);
  private readonly fallbackPowerupGeometry = new THREE.BoxGeometry(38, 24, 10, 2, 1, 1);
  private readonly brickMaterials = new Map<BrickKind, THREE.MeshStandardMaterial>();
  private readonly powerupMaterials = new Map<PowerupKind, THREE.SpriteMaterial>();
  private readonly paddleMesh = new THREE.Mesh(
    this.paddleGeometry,
    new THREE.MeshStandardMaterial({ color: "#e9ffff", emissive: "#35f3ff", emissiveIntensity: 0.45, metalness: 0.82, roughness: 0.18 })
  );
  private readonly fallbackPowerupMaterial = new THREE.MeshStandardMaterial({
    color: "#ffe066",
    emissive: "#ff5c5c",
    emissiveIntensity: 0.45,
    metalness: 0.5,
    roughness: 0.25
  });
  private sparksPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
  private bricks: Brick[] = [];
  private levelBlueprint: LevelBlueprint = fallbackLevel({ level: 1, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] });
  private settings: GameSettings = DEFAULT_SETTINGS;
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
  private laserTimer = 0;
  private laserCooldown = 0;
  private grabTimer = 0;
  private explosionScale = 1;
  private noBallTimer = 0;
  private loadingLevel = false;
  private hasSave = false;
  private lastCheckpointAt = 0;
  private recentEvents: string[] = ["Break the wall. Catch powerups. Clear the board."];
  private announcement = "Break the wall. Catch powerups. Clear the board.";
  private latestAgentTrace?: LevelResponse["trace"];
  private sidebarCollapsed = false;
  private lastKeyboardAt = 0;
  private lastPointerAt = 0;
  private paddleVelocityX = 0;
  private lastPaddleHit: PaddleHitDebug | null = null;
  private lastLoopCorrection: LoopCorrectionDebug | null = null;
  private nextFloatingTextId = 1;
  private boardShakeTimer = 0;
  private boardShakeStrength = 0;
  private paddleFlashTimer = 0;
  private levelClearFlashTimer = 0;
  private lifeFlashTimer = 0;
  private previouslyFocusedElement: HTMLElement | null = null;
  private readonly audio = createGameAudio();
  private savedBoards: SavedBoardEntry[] = [];
  private packProgress: PackProgressState = normalizePackProgress(null, 0);
  private boardContext: BoardContext = { source: "pack", packId: "starter", boardIndex: 0 };
  private designerIntent: BoardDesignerIntent = DEFAULT_DESIGNER_INTENT;
  private designerFeedback: BoardDesignerFeedback[] = [];
  private currentBoardVote: DesignerVote | null = null;
  private latestGenerationSummary?: GenerationSummary;

  constructor(mount: HTMLDivElement, hud: HudApi) {
    this.mount = mount;
    this.hud = hud;
    this.settings = readSettings();
    this.savedBoards = readJson(SAVED_BOARDS_KEY, normalizeSavedBoards) ?? [];
    this.packProgress =
      readJson(PACK_PROGRESS_KEY, (input) => normalizePackProgress(input, this.savedBoards.length)) ?? normalizePackProgress(null, this.savedBoards.length);
    this.designerFeedback = readJson(DESIGNER_FEEDBACK_KEY, normalizeDesignerFeedbackList) ?? [];
    this.designerIntent = {
      ...(readJson(DESIGNER_INTENT_KEY, normalizeDesignerIntent) ?? DEFAULT_DESIGNER_INTENT),
      feedback: this.designerFeedback
    };
    this.sidebarCollapsed = readJson(SIDEBAR_COLLAPSED_KEY, normalizeBoolean) ?? false;
    this.bestScore = Math.max(readBestScore(), readSave()?.bestScore ?? 0);
    this.setupRenderer();
    this.setupScene();
    this.loadPowerupAtlas();
    this.bindHudActions();
    this.applySidebarClass();
  }

  start() {
    this.renderer.domElement.dataset.testid = "ricochet-rush-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute("role", "application");
    this.updateCanvasLabel();
    this.effectsLayer.className = "game-effects";
    this.effectsLayer.setAttribute("aria-hidden", "true");
    this.overlay.className = "game-overlay";
    this.overlay.setAttribute("aria-live", "polite");
    this.mount.replaceChildren(this.renderer.domElement, this.effectsLayer, this.overlay);
    this.bindInput();
    const save = readSave();
    if (save) {
      this.restoreSave(save);
      this.pushEvent("Saved run restored.");
      this.showLevelReadyOverlay("Saved run restored.");
    } else {
      this.startPack("starter", "Starter pack loaded.");
    }
    this.applySettingsClass();
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
      paddleX: this.paddleX,
      paddleWidth: this.paddleWidth,
      paddleVelocityX: this.paddleVelocityX,
      lastPaddleHit: this.lastPaddleHit,
      lastLoopCorrection: this.lastLoopCorrection,
      hasSave: this.hasSave,
      boardSource: this.boardContext.source,
      currentPackId: this.boardContext.packId,
      packBoardIndex: this.boardContext.boardIndex,
      packProgress: this.packProgress,
      designerIntent: this.designerIntent,
      designerFeedback: this.designerFeedback,
      currentBoardVote: this.currentBoardVote,
      generationSummary: this.latestGenerationSummary,
      settings: this.settings,
      recentEvents: this.recentEvents,
      announcement: this.announcement
    };
  }

  private setupRenderer() {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(WIDTH, HEIGHT, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color("#050910");
    this.camera.position.set(0, -48, 980);
    this.camera.lookAt(0, 0, 0);
  }

  private setupScene() {
    this.board.rotation.x = -0.08;
    this.scene.add(this.board);
    this.board.add(this.bricksGroup, this.ballsGroup, this.powerupsGroup, this.lasersGroup, this.sparksGroup, this.paddleMesh);

    const ambient = new THREE.AmbientLight("#b8d4ff", 1.25);
    const key = new THREE.DirectionalLight("#ffffff", 2.35);
    key.position.set(-260, 300, 780);
    key.castShadow = true;
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    const rim = new THREE.PointLight("#ff4d8d", 1.6, 900);
    rim.position.set(460, 120, 320);
    this.scene.add(ambient, key, rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH - WALL * 2, HEIGHT - WALL * 2),
      new THREE.MeshStandardMaterial({ color: "#07111d", metalness: 0.35, roughness: 0.58 })
    );
    floor.position.set(0, 0, -20);
    floor.receiveShadow = true;
    this.board.add(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: "#18263a", emissive: "#4ecdc4", emissiveIntensity: 0.22, metalness: 0.74, roughness: 0.2 });
    const topWall = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 18, 34), wallMaterial);
    topWall.position.copy(toWorld(WIDTH / 2, WALL / 2, 4));
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(18, HEIGHT - WALL, 34), wallMaterial);
    leftWall.position.copy(toWorld(WALL / 2, HEIGHT / 2, 4));
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(18, HEIGHT - WALL, 34), wallMaterial);
    rightWall.position.copy(toWorld(WIDTH - WALL / 2, HEIGHT / 2, 4));
    const bottomWall = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 18, 18), wallMaterial);
    bottomWall.position.copy(toWorld(WIDTH / 2, HEIGHT - WALL / 2, -2));
    this.board.add(topWall, leftWall, rightWall, bottomWall);

    const starGeometry = new THREE.BufferGeometry();
    const stars = new Float32Array(180 * 3);
    for (let index = 0; index < 180; index += 1) {
      stars[index * 3] = Math.random() * WIDTH - WIDTH / 2;
      stars[index * 3 + 1] = Math.random() * HEIGHT - HEIGHT / 2;
      stars[index * 3 + 2] = -36 - Math.random() * 38;
    }
    starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    this.board.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: "#8aefff", size: 1.8, transparent: true, opacity: 0.48 })));

    for (const kind of Object.keys(COLORS) as BrickKind[]) {
      const color = COLORS[kind];
      this.brickMaterials.set(
        kind,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: kind === "boss" ? 0.45 : 0.24,
          metalness: kind === "hard" || kind === "boss" ? 0.82 : 0.48,
          roughness: 0.22
        })
      );
    }
    this.paddleMesh.castShadow = true;
    this.paddleMesh.receiveShadow = true;
  }

  private loadPowerupAtlas() {
    new THREE.TextureLoader().load(
      "/assets/powerups.png",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        for (const kind of POWERUP_ORDER) {
          const index = POWERUP_ORDER.indexOf(kind);
          const map = texture.clone();
          map.colorSpace = THREE.SRGBColorSpace;
          map.repeat.set(1 / POWERUP_ATLAS_COLUMNS, 1 / POWERUP_ATLAS_ROWS);
          map.offset.set((index % POWERUP_ATLAS_COLUMNS) / POWERUP_ATLAS_COLUMNS, 1 - (Math.floor(index / POWERUP_ATLAS_COLUMNS) + 1) / POWERUP_ATLAS_ROWS);
          map.needsUpdate = true;
          this.powerupMaterials.set(kind, new THREE.SpriteMaterial({ map, color: "#ffffff", transparent: false }));
        }
        this.pushEvent("Generated power-up atlas loaded.");
      },
      undefined,
      () => this.pushEvent("Power-up art failed to load; fallback gems are active.")
    );
  }

  private bindInput() {
    window.addEventListener("keydown", (event) => {
      this.keys.add(event.code);
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
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
      this.keys.delete(event.code);
    });
    const applyPointerPaddle = (clientX: number) => {
      const now = performance.now();
      if (now < this.lastKeyboardAt) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const nextX = ((clientX - rect.left) / rect.width) * WIDTH;
      const elapsedSeconds = this.lastPointerAt > 0 ? (now - this.lastPointerAt) / 1000 : 1 / 60;
      this.lastPointerAt = now;
      this.setPaddleX(nextX, elapsedSeconds);
    };
    this.renderer.domElement.addEventListener("pointermove", (event) => {
      applyPointerPaddle(event.clientX);
    });
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      applyPointerPaddle(event.clientX);
      this.handlePrimaryAction();
    });
  }

  private bindHudActions() {
    this.hud.setActions({
      requestBoard: () => void this.fetchLevel("You asked composer-2 to redesign this board."),
      saveBoardToPack: () => {
        this.saveCurrentBoardToPack();
      },
      saveNow: () => {
        this.saveCheckpoint("Run saved.");
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
      rateBoard: (vote) => {
        this.rateCurrentBoard(vote);
      },
      updateSettings: (settings) => {
        this.settings = normalizeSettings(settings);
        writeJson(SETTINGS_KEY, this.settings);
        this.applySettingsClass();
        this.refreshHud("Settings updated.");
      },
      toggleSidebar: () => {
        this.setSidebarCollapsed(!this.sidebarCollapsed);
      }
    });
  }

  private loop = (time: number) => {
    const delta = Math.min((time - this.lastTime) / 1000 || 0, 0.03);
    this.lastTime = time;
    this.update(delta);
    this.render();
    window.requestAnimationFrame(this.loop);
  };

  private update(delta: number) {
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
      ball.x += ball.vx * delta * this.settings.ballSpeed;
      ball.y += ball.vy * delta * this.settings.ballSpeed;
      this.collideWalls(ball);
      this.collidePaddle(ball);
      this.collideBricks(ball);
    }

    this.updatePowerups(delta);
    this.updateSparks(delta);
    this.updateFloatingTexts(delta);
    this.balls.splice(0, this.balls.length, ...this.balls.filter((ball) => ball.y < HEIGHT + 80));
    if (this.balls.length === 0) {
      this.noBallTimer += delta;
      if (this.noBallTimer >= 0.22) this.loseLife();
    } else {
      this.noBallTimer = 0;
    }
    if (this.bricks.length === 0) this.completeLevel();
    else this.saveCheckpoint();
    this.refreshHud();
  }

  private updatePaddle(delta: number) {
    const direction = Number(this.keys.has("ArrowRight") || this.keys.has("KeyD")) - Number(this.keys.has("ArrowLeft") || this.keys.has("KeyA"));
    if (direction !== 0) this.lastKeyboardAt = performance.now();
    if (direction !== 0) {
      this.setPaddleX(this.paddleX + direction * PADDLE_SPEED * delta, delta);
    } else {
      this.paddleVelocityX *= Math.max(0, 1 - delta * 12);
      if (Math.abs(this.paddleVelocityX) < 1) this.paddleVelocityX = 0;
    }
    for (const ball of this.balls) {
      if (ball.stuck) {
        ball.x = clamp(this.paddleX + ball.stuckOffset, WALL + ball.radius, WIDTH - WALL - ball.radius);
        ball.y = PADDLE_Y - 18;
      }
    }
  }

  private setPaddleX(nextX: number, elapsedSeconds: number) {
    const previousX = this.paddleX;
    this.paddleX = clamp(nextX, WALL + this.paddleWidth / 2, WIDTH - WALL - this.paddleWidth / 2);
    const rawVelocity = elapsedSeconds > 0 ? (this.paddleX - previousX) / elapsedSeconds : 0;
    this.paddleVelocityX = clamp(rawVelocity, -MAX_PADDLE_VELOCITY, MAX_PADDLE_VELOCITY);
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
    this.launchBalls();
    if (wasPaused) this.audio.play("resume", this.settings.sound);
  }

  private togglePause() {
    if (this.phase === "playing") {
      this.phase = "ready";
      this.showOverlay("Paused", "The board is frozen. Press Space, Enter, or Continue to resume.", "Continue", () => this.handlePrimaryAction());
      this.pushEvent("Paused.");
      this.audio.play("pause", this.settings.sound);
    } else if (this.phase === "ready" && this.balls.some((ball) => !ball.stuck)) {
      this.phase = "playing";
      this.hideOverlay();
      this.pushEvent("Resumed.");
      this.audio.play("resume", this.settings.sound);
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
      "This removes the local checkpoint for this run. Your current best score stays on this device.",
      "Clear Save",
      () => {
        localStorage.removeItem(SAVE_KEY);
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
    if (!this.canPlayPack(packId)) return;
    this.level = 1;
    this.clearedLevels = 0;
    this.score = 0;
    this.lives = 3;
    this.combo = 1;
    this.latestAgentTrace = undefined;
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    const nextIndex = this.nextBoardIndexForPack(packId);
    this.loadPackBoard(packId, nextIndex, event);
  }

  private selectPack(packId: string) {
    if (this.loadingLevel || !this.canPlayPack(packId)) return;
    const packName = this.packNameFor(packId);
    this.startPack(packId, `${packName} loaded.`);
  }

  private loadPackBoard(packId: string, boardIndex: number, event: string) {
    const level = this.materializePackBoard(packId, boardIndex);
    if (!level) return;
    this.level = boardIndex + 1;
    this.clearedLevels = boardIndex;
    this.latestAgentTrace = undefined;
    this.loadLevel(level, event, undefined, undefined, { source: "pack", packId, boardIndex });
  }

  private materializePackBoard(packId: string, boardIndex: number): LevelBlueprint | null {
    const request = { ...this.levelRequest(), level: boardIndex + 1, clearedLevels: boardIndex };
    if (packId === SAVED_DESIGNS_PACK_ID) {
      const saved = this.savedBoards[boardIndex];
      return saved ? normalizeLevel(saved.levelBlueprint, request) : null;
    }
    return materializeAuthoredBoard(packId, boardIndex, request);
  }

  private canPlayPack(packId: string): boolean {
    const total = boardCountForPack(packId, this.savedBoards.length);
    return total > 0 && this.packProgress[packId]?.unlocked === true;
  }

  private nextBoardIndexForPack(packId: string): number {
    const total = boardCountForPack(packId, this.savedBoards.length);
    if (total <= 0) return 0;
    const cleared = this.packProgress[packId]?.cleared ?? 0;
    return cleared >= total ? 0 : clamp(Math.floor(cleared), 0, total - 1);
  }

  private saveCurrentBoardToPack() {
    if (this.boardContext.source !== "generated" || this.loadingLevel) return;
    const levelBlueprint = normalizeLevel(this.levelBlueprint, this.levelRequest());
    const now = new Date();
    const entry: SavedBoardEntry = {
      id: `saved-${now.getTime()}`,
      createdAt: now.toISOString(),
      levelName: levelBlueprint.name,
      levelBlueprint
    };
    this.savedBoards = trimSavedBoards([entry, ...this.savedBoards], SAVED_BOARDS_MAX);
    writeJson(SAVED_BOARDS_KEY, this.savedBoards);
    this.packProgress = normalizePackProgress(this.packProgress, this.savedBoards.length);
    writeJson(PACK_PROGRESS_KEY, this.packProgress);
    this.pushEvent(`${levelBlueprint.name} saved to Saved Designs.`);
    this.refreshHud("Board saved to Saved Designs.");
  }

  private updateDesignerIntent(intent: BoardDesignerIntent) {
    this.designerIntent = {
      ...normalizeDesignerIntent(intent),
      feedback: this.designerFeedback
    };
    writeJson(DESIGNER_INTENT_KEY, { ...this.designerIntent, feedback: [] });
    this.refreshHud("Designer intent updated.");
  }

  private rateCurrentBoard(vote: DesignerVote) {
    if (this.boardContext.source !== "generated" || this.loadingLevel) return;
    const feedback: BoardDesignerFeedback = {
      vote,
      levelName: this.levelBlueprint.name,
      style: this.designerIntent.style,
      seed: this.designerIntent.seed,
      recentEvents: this.recentEvents.slice(0, 4),
      createdAt: new Date().toISOString()
    };
    this.currentBoardVote = vote;
    this.designerFeedback = [feedback, ...this.designerFeedback.filter((entry) => entry.levelName !== feedback.levelName)].slice(0, DESIGNER_FEEDBACK_MAX);
    this.designerIntent = { ...this.designerIntent, feedback: this.designerFeedback };
    writeJson(DESIGNER_FEEDBACK_KEY, this.designerFeedback);
    this.pushEvent(vote === "up" ? "Designer feedback saved: more like this." : "Designer feedback saved: avoid this shape.");
    this.refreshHud(vote === "up" ? "Feedback saved for the next design." : "Designer will steer away next time.");
  }

  private loadLevel(
    level: LevelBlueprint,
    event: string,
    trace?: LevelResponse["trace"],
    summary?: GenerationSummary,
    context: BoardContext = this.boardContext
  ) {
    this.boardContext = context;
    this.currentBoardVote = null;
    this.latestGenerationSummary = context.source === "generated" ? summary : undefined;
    this.levelBlueprint = level;
    this.bricks = [];
    this.powerups.splice(0);
    this.sparks.splice(0);
    this.laserBeams.splice(0);
    this.paddleWidth = 116;
    this.combo = 1;
    this.laserTimer = 0;
    this.grabTimer = 0;
    this.noBallTimer = 0;
    this.explosionScale = 1;
    this.lastPaddleHit = null;
    this.lastLoopCorrection = null;
    for (let row = 0; row < BRICK_ROWS; row += 1) {
      for (let column = 0; column < BRICK_COLUMNS; column += 1) {
        const spec = level.rows[row]?.[column];
        if (!spec) continue;
        this.bricks.push({
          x: WALL + column * (BRICK_WIDTH + BRICK_GAP),
          y: BRICK_TOP + row * (BRICK_HEIGHT + BRICK_GAP),
          width: BRICK_WIDTH,
          height: BRICK_HEIGHT,
          kind: spec.kind,
          hp: spec.hp,
          maxHp: spec.hp
        });
      }
    }
    this.phase = "ready";
    this.resetBall();
    this.pushEvent(event);
    this.saveCheckpoint(undefined, true);
    this.showLevelReadyOverlay(event);
    this.latestAgentTrace = trace;
    this.refreshHud(level.briefing);
  }

  private saveComposerGeneratedLevel(result: LevelResponse) {
    if (result.source !== "cursor-sdk") return;
    const archive = readJson(COMPOSER_LEVEL_ARCHIVE_KEY, normalizeComposerArchive) ?? [];
    const next: ComposerGeneratedLevelEntry = {
      createdAt: new Date().toISOString(),
      level: this.level,
      score: this.score,
      lives: this.lives,
      clearedLevels: this.clearedLevels,
      levelName: result.level.name,
      model: result.model,
      levelBlueprint: result.level,
      summary: result.summary,
      trace: result.trace
    };
    const updated = trimComposerArchive([next, ...archive]);
    writeJson(COMPOSER_LEVEL_ARCHIVE_KEY, updated);
  }

  private restoreSave(save: GameSave) {
    this.latestAgentTrace = undefined;
    this.boardContext =
      save.boardSource === "pack" && save.packId
        ? { source: "pack", packId: save.packId, boardIndex: save.packBoardIndex }
        : { source: "generated", packId: null, boardIndex: 0 };
    this.level = save.level;
    this.clearedLevels = save.clearedLevels;
    this.score = save.score;
    this.bestScore = save.bestScore;
    this.lives = save.lives;
    this.combo = save.combo;
    this.paddleWidth = save.paddleWidth;
    this.levelBlueprint = save.levelBlueprint;
    this.bricks = save.bricks.map((brick) => ({ ...brick }));
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
    for (const ball of this.balls) {
      if (ball.stuck) {
        const offset = clamp(ball.stuckOffset / (this.paddleWidth / 2), -1, 1);
        const fallbackX = Math.abs(ball.vx) > 60 ? Math.sign(ball.vx) * LAUNCH_SIDE_SPEED : LAUNCH_SIDE_SPEED;
        const launchSpeed = clamp(Math.hypot(fallbackX, LAUNCH_UPWARD_SPEED * this.levelBlueprint.speed), MIN_BALL_SPEED, MAX_LAUNCH_SPEED);
        const desiredVx = (Math.abs(offset) > 0.08 ? LAUNCH_OFFSET_INFLUENCE * offset : fallbackX) + this.paddleVelocityX * LAUNCH_SPIN_INFLUENCE;
        const launch = upwardVelocity(launchSpeed, desiredVx, Math.sign(desiredVx) || Math.sign(ball.vx) || 1);
        ball.stuck = false;
        ball.stuckOffset = 0;
        ball.vx = launch.vx;
        ball.vy = launch.vy;
      }
    }
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
  }

  private collidePaddle(ball: Ball) {
    const paddleLeft = this.paddleX - this.paddleWidth / 2;
    const paddleRight = this.paddleX + this.paddleWidth / 2;
    if (ball.vy <= 0 || ball.y + ball.radius < PADDLE_Y - 8 || ball.y - ball.radius > PADDLE_Y + 12) return;
    if (ball.x < paddleLeft || ball.x > paddleRight) return;
    const hit = clamp((ball.x - this.paddleX) / (this.paddleWidth / 2), -1, 1);
    if (this.grabTimer > 0) {
      const catchX = clamp(ball.x, paddleLeft + ball.radius, paddleRight - ball.radius);
      ball.stuck = true;
      ball.stuckOffset = clamp(catchX - this.paddleX, -this.paddleWidth / 2 + ball.radius, this.paddleWidth / 2 - ball.radius);
      ball.x = catchX;
      ball.y = PADDLE_Y - 18;
      this.pushEvent("Grab paddle caught the ball.");
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
    this.audio.play("paddle", this.settings.sound);
    this.paddleFlashTimer = 0.16;
    this.shakeBoard(0.08, 1.6);
    this.combo = Math.max(1, this.combo - 0.15);
  }

  private collideBricks(ball: Ball) {
    const maxSteps = 32;
    for (let step = 0; step < maxSteps; step += 1) {
      const brick = this.bricks.find((candidate) => circleRect(ball, candidate));
      if (!brick) return;

      const overlapX = Math.min(ball.x + ball.radius - brick.x, brick.x + brick.width - (ball.x - ball.radius));
      const overlapY = Math.min(ball.y + ball.radius - brick.y, brick.y + brick.height - (ball.y - ball.radius));
      const piercing = ball.thruTimer > 0 || ball.fireTimer > 0 || ball.megaTimer > 0;
      if (!piercing) {
        if (overlapX < overlapY) {
          ball.vx *= -1;
          this.normalizeBallForLoopRisk(ball, "brick", { minYRatio: MIN_COLLISION_Y_RATIO, fallbackYSign: ball.vy || 1 });
        } else {
          ball.vy *= -1;
          this.normalizeBallForLoopRisk(ball, "brick", { minXRatio: MIN_COLLISION_X_RATIO, fallbackXSign: ball.vx || Math.sign(ball.x - (brick.x + brick.width / 2)) || 1 });
        }
      }
      this.hitBrick(brick);
      if (ball.fireTimer > 0) this.explode(brick);
      if (!piercing) return;
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
    if (brick.hp > 0) this.audio.play("brickChip", this.settings.sound);
    this.brickImpactTimers.set(brick, 0.16);
    this.emitSparks(brick.x + brick.width / 2, brick.y + brick.height / 2, COLORS[brick.kind], 12);
    if (brick.hp > 0) return;
    this.audio.play("brickDestroy", this.settings.sound);
    this.bricks = this.bricks.filter((candidate) => candidate !== brick);
    const points = Math.round(40 * this.combo * (brick.kind === "boss" ? 5 : brick.maxHp));
    this.score += points;
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    this.combo = Math.min(8, this.combo + 0.22);
    this.addFloatingText(brick.x + brick.width / 2, brick.y + brick.height / 2, `+${points}`, "score");
    if (this.combo >= 2) this.addFloatingText(brick.x + brick.width / 2, brick.y + brick.height / 2 - 24, `x${this.combo.toFixed(1)}`, "combo");
    this.shakeBoard(brick.kind === "boss" ? 0.14 : 0.08, brick.kind === "boss" ? 2.4 : 1.1);
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
    if (brick.kind === "prize") this.dropPowerup(brick, pick(POSITIVE_POWERUPS));
    if (brick.kind === "penalty") this.dropPowerup(brick, pick(NEGATIVE_POWERUPS));
    if (brick.kind === "boss") this.dropPowerup(brick, pick(["shootingPaddle", "megaBall", "eightBall"]));
  }

  private explode(source: Brick) {
    this.emitSparks(source.x + source.width / 2, source.y + source.height / 2, "#ff5c5c", 32);
    this.audio.play("explosion", this.settings.sound);
    this.shakeBoard(0.2, 4.2);
    const blast = this.bricks.filter(
      (brick) => Math.abs(brick.x - source.x) < BRICK_WIDTH * 1.8 * this.explosionScale && Math.abs(brick.y - source.y) < BRICK_HEIGHT * 2 * this.explosionScale
    );
    for (const brick of blast) {
      brick.hp = 0;
      this.score += 24;
    }
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    this.bricks = this.bricks.filter((brick) => brick.hp > 0);
    this.saveCheckpoint();
  }

  private dropPowerup(brick: Brick, kind: PowerupKind) {
    this.powerups.push({ x: brick.x + brick.width / 2, y: brick.y + brick.height / 2, vy: 150, kind });
  }

  private updatePowerups(delta: number) {
    for (const powerup of this.powerups) {
      powerup.y += powerup.vy * delta;
      const caught = powerup.y > PADDLE_Y - 16 && powerup.y < PADDLE_Y + 24 && Math.abs(powerup.x - this.paddleX) < this.paddleWidth / 2 + 18;
      if (caught) {
        this.emitSparks(this.paddleX, PADDLE_Y - 6, "#ffe066", 10);
        this.audio.play("powerup", this.settings.sound);
        this.paddleFlashTimer = 0.2;
        this.applyPowerup(powerup.kind);
        powerup.y = HEIGHT + 100;
      }
    }
    this.powerups.splice(0, this.powerups.length, ...this.powerups.filter((powerup) => powerup.y < HEIGHT + 60));
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
        ball.megaTimer = 12;
        ball.radius = 14;
      }
      this.pushEvent("Mega ball armed.");
    }
    if (kind === "fireball") {
      for (const ball of this.balls) ball.fireTimer = 10;
      this.pushEvent("Fireball burns through the wall.");
    }
    if (kind === "thruBrick") {
      for (const ball of this.balls) ball.thruTimer = 10;
      this.pushEvent("Thru-brick ball enabled.");
    }
    if (kind === "shootingPaddle") {
      this.laserTimer = 8;
      this.pushEvent("Shooting paddle armed.");
    }
    if (kind === "grabPaddle") {
      this.grabTimer = 12;
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
    for (const spark of this.sparks) {
      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
      spark.vy += 220 * delta;
      spark.life -= delta;
    }
    this.sparks.splice(0, this.sparks.length, ...this.sparks.filter((spark) => spark.life > 0));
  }

  private updateFloatingTexts(delta: number) {
    for (const text of this.floatingTexts) {
      text.life -= delta;
    }
    this.floatingTexts.splice(0, this.floatingTexts.length, ...this.floatingTexts.filter((text) => text.life > 0));
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
    this.floatingTexts.push({
      id: this.nextFloatingTextId,
      x,
      y,
      text,
      life: 0.75,
      duration: 0.75,
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
    this.audio.play("loseLife", this.settings.sound);
    this.lifeFlashTimer = 0.45;
    this.shakeBoard(0.18, 3.2);
    if (this.lives <= 0) {
      this.phase = "gameOver";
      this.powerups.splice(0);
      this.laserBeams.splice(0);
      localStorage.removeItem(SAVE_KEY);
      this.hasSave = false;
      this.pushEvent("Run ended.");
      this.announce("Game over.");
      this.audio.play("gameOver", this.settings.sound);
      this.showOverlay("Game Over", `Final score ${this.score}. Restart at Level 1 with a fresh generated board.`, "Restart", () => void this.restartRun());
      this.refreshHud("Game over.");
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
    const bonus = 500 + this.lives * 100 + Math.round(this.combo * 60);
    this.score += bonus;
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    if (completedContext.source === "pack") {
      this.packProgress = markPackBoardCleared(this.packProgress, completedContext.packId, completedContext.boardIndex, this.score, this.savedBoards.length);
      writeJson(PACK_PROGRESS_KEY, this.packProgress);
    }
    this.powerups.splice(0);
    this.laserBeams.splice(0);
    this.pushEvent(`Level ${this.level} cleared. Bonus ${bonus} pts.`);
    this.announce(`Level ${this.level} cleared. Bonus ${bonus} points.`);
    this.addFloatingText(WIDTH / 2, HEIGHT / 2, `+${bonus} clear`, "status");
    this.levelClearFlashTimer = 0.8;
    this.audio.play("levelClear", this.settings.sound);
    this.shakeBoard(0.28, 2.6);
    this.saveCheckpoint("Level checkpoint saved.");
    const nextStep = this.nextLevelCompleteStep(completedContext);
    this.showOverlay(
      "Level Cleared",
      nextStep.body,
      nextStep.actionLabel,
      () => void this.continueToNextLevel()
    );
    this.refreshHud(nextStep.status);
  }

  private async continueToNextLevel() {
    if (this.phase !== "levelComplete") return;
    if (this.boardContext.source === "pack") {
      const { packId, boardIndex } = this.boardContext;
      const nextIndex = boardIndex + 1;
      const total = boardCountForPack(packId, this.savedBoards.length);
      if (nextIndex < total) {
        this.loadPackBoard(packId, nextIndex, `${this.packNameFor(packId)} board ${nextIndex + 1} loaded.`);
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
    this.level = 1;
    this.clearedLevels = 0;
    this.score = 0;
    this.lives = 3;
    this.combo = 1;
    localStorage.removeItem(SAVE_KEY);
    this.hasSave = false;
    if (activePackId && this.canPlayPack(activePackId)) {
      this.startPack(activePackId, `New run. Replaying ${this.packNameFor(activePackId)}.`);
      return;
    }
    await this.fetchLevel("New run. Rebuilding Level 1.");
  }

  private async fetchLevel(event: string) {
    this.phase = "loading";
    this.loadingLevel = true;
    this.pushEvent(event);
    this.showLoadingOverlay(`Generating Level ${this.level}`, "The game is paused while a playable wall is prepared.");
    this.refreshHud("Generating next level...");
    try {
      const response = await fetch("/api/level", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.levelRequest())
      });
      if (!response.ok) throw new Error(`Level generation failed with ${response.status}`);
      const result = (await response.json()) as LevelResponse;
      const publicWarning = result.summary?.warning ?? result.warning;
      const sourceEvent =
        result.source === "cursor-sdk"
          ? `Generated ${result.level.name}.`
          : `Local fallback generated ${result.level.name}${publicWarning ? ` (${publicWarning})` : ""}.`;
      if (result.source === "cursor-sdk") this.saveComposerGeneratedLevel(result);
      this.loadLevel(result.level, sourceEvent, result.trace, result.summary, { source: "generated", packId: null, boardIndex: 0 });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      const fallback = fallbackLevel(this.levelRequest());
      this.loadLevel(fallback, "Local fallback generated a level after API failure.", undefined, this.localGenerationSummary(fallback, reason), {
        source: "generated",
        packId: null,
        boardIndex: 0
      });
    } finally {
      this.loadingLevel = false;
      this.refreshHud();
    }
  }

  private levelRequest(): LevelRequest {
    return {
      level: this.level,
      score: this.score,
      lives: this.lives,
      clearedLevels: this.clearedLevels,
      recentEvents: this.recentEvents.slice(0, 5),
      designer: {
        ...this.designerIntent,
        feedback: this.designerFeedback
      }
    };
  }

  private localGenerationSummary(level: LevelBlueprint, reason: string): GenerationSummary {
    const brickCount = level.rows.flat().filter(Boolean).length;
    return {
      source: "fallback",
      title: "Local fallback board",
      detail: `Local fallback built ${level.name} from the current designer intent. Validation kept ${brickCount} playable bricks.`,
      chips: [
        this.designerIntent.style,
        `difficulty ${this.designerIntent.difficulty}/5`,
        `${Math.round(this.designerIntent.density * 100)}% density`,
        `${Math.round(this.designerIntent.specialBias * 100)}% specials`
      ],
      warning: reason
    };
  }

  private nextLevelCompleteStep(context: BoardContext): { body: string; actionLabel: string; status: string } {
    if (context.source === "pack") {
      const total = boardCountForPack(context.packId, this.savedBoards.length);
      if (context.boardIndex + 1 < total) {
        return {
          body: `Continue to board ${context.boardIndex + 2} in ${this.packNameFor(context.packId)}.`,
          actionLabel: "Next Board",
          status: "Level cleared. Next pack board is ready."
        };
      }
      const nextPack = getNextBuiltInPack(context.packId);
      if (nextPack && this.packProgress[nextPack.id]?.unlocked) {
        return {
          body: `${this.packNameFor(context.packId)} complete. Continue into ${nextPack.name}.`,
          actionLabel: "Next Pack",
          status: `${nextPack.name} unlocked.`
        };
      }
      return {
        body: `${this.packNameFor(context.packId)} complete. Continue to a generated board.`,
        actionLabel: "Generate Board",
        status: `${this.packNameFor(context.packId)} complete.`
      };
    }
    return {
      body: `The board is frozen. Continue when you want composer-2 to generate Level ${this.level + 1}.`,
      actionLabel: "Continue",
      status: "Level cleared. Continue when ready."
    };
  }

  private packNameFor(packId: string): string {
    if (packId === SAVED_DESIGNS_PACK_ID) return "Saved Designs";
    return getBuiltInPack(packId)?.name ?? "Board Pack";
  }

  private collectPackItems(): HudPackItem[] {
    const builtInItems = BUILT_IN_PACKS.map((pack) => {
      const progress = this.packProgress[pack.id] ?? { cleared: 0, bestScore: 0, unlocked: pack.id === "starter" };
      const previewIndex = progress.cleared >= pack.boards.length ? 0 : clamp(progress.cleared, 0, pack.boards.length - 1);
      return {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        progressLabel: progress.unlocked ? `${progress.cleared}/${pack.boards.length} cleared` : "locked",
        bestScore: progress.bestScore,
        unlocked: progress.unlocked,
        active: this.boardContext.source === "pack" && this.boardContext.packId === pack.id,
        empty: false,
        previewRows: [...pack.boards[previewIndex].pattern]
      };
    });
    const savedProgress = this.packProgress[SAVED_DESIGNS_PACK_ID] ?? { cleared: 0, bestScore: 0, unlocked: this.savedBoards.length > 0 };
    const savedPreview = this.savedBoards[0] ? previewRowsFromLevel(this.savedBoards[0].levelBlueprint) : [];
    return [
      ...builtInItems,
      {
        id: SAVED_DESIGNS_PACK_ID,
        name: "Saved Designs",
        description: "Generated boards you kept for replay.",
        progressLabel: this.savedBoards.length > 0 ? `${savedProgress.cleared}/${this.savedBoards.length} cleared` : "empty",
        bestScore: savedProgress.bestScore,
        unlocked: this.savedBoards.length > 0,
        active: this.boardContext.source === "pack" && this.boardContext.packId === SAVED_DESIGNS_PACK_ID,
        empty: this.savedBoards.length === 0,
        previewRows: savedPreview
      }
    ];
  }

  private refreshHud(status?: string) {
    this.updateCanvasLabel();
    this.hud.update({
      score: this.score,
      bestScore: this.bestScore,
      lives: this.lives,
      level: this.level,
      bricks: this.bricks.length,
      combo: this.combo,
      status: status ?? this.recentEvents[0] ?? "",
      levelName: this.levelBlueprint.name,
      hint: this.levelBlueprint.paddleHint,
      pending: this.loadingLevel,
      hasSave: this.hasSave,
      announcement: this.announcement,
      agentTrace: this.latestAgentTrace,
      sidebarCollapsed: this.sidebarCollapsed,
      settings: this.settings,
      activePowers: this.collectActivePowers(),
      packs: this.collectPackItems(),
      canSaveBoard: this.boardContext.source === "generated" && this.bricks.length > 0,
      canRateBoard: this.boardContext.source === "generated" && this.bricks.length > 0,
      boardSource: this.boardContext.source,
      designer: {
        intent: this.designerIntent,
        feedbackCount: this.designerFeedback.length,
        currentVote: this.currentBoardVote,
        generationSummary: this.latestGenerationSummary
      },
      events: this.recentEvents
    });
  }

  private updateCanvasLabel() {
    this.renderer.domElement.setAttribute(
      "aria-label",
      `Ricochet Rush. ${this.phase}. Level ${this.level}. ${this.lives} lives. ${this.bricks.length} bricks remain.`
    );
  }

  private collectActivePowers(): { label: string; seconds: number; maxSeconds: number }[] {
    const rows: { label: string; seconds: number; maxSeconds: number }[] = [];
    if (this.laserTimer > 0) rows.push({ label: "Laser", seconds: Math.ceil(this.laserTimer), maxSeconds: POWER_DURATIONS.Laser });
    if (this.grabTimer > 0) rows.push({ label: "Grab", seconds: Math.ceil(this.grabTimer), maxSeconds: POWER_DURATIONS.Grab });
    if (this.balls.length > 0) {
      const fire = Math.max(0, ...this.balls.map((ball) => ball.fireTimer));
      const thru = Math.max(0, ...this.balls.map((ball) => ball.thruTimer));
      const mega = Math.max(0, ...this.balls.map((ball) => ball.megaTimer));
      if (fire > 0) rows.push({ label: "Fire", seconds: Math.ceil(fire), maxSeconds: POWER_DURATIONS.Fire });
      if (thru > 0) rows.push({ label: "Thru", seconds: Math.ceil(thru), maxSeconds: POWER_DURATIONS.Thru });
      if (mega > 0) rows.push({ label: "Mega", seconds: Math.ceil(mega), maxSeconds: POWER_DURATIONS.Mega });
    }
    return rows.slice(0, 5);
  }

  private pushEvent(event: string) {
    this.recentEvents.unshift(event);
    this.recentEvents.splice(6);
  }

  private announce(message: string) {
    this.announcement = message;
  }

  private saveCheckpoint(event?: string, force = false) {
    const now = performance.now();
    if (!force && !event && now - this.lastCheckpointAt < 1000) return;
    this.lastCheckpointAt = now;
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    const save: GameSave = {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      level: this.level,
      clearedLevels: this.clearedLevels,
      boardSource: this.boardContext.source,
      packId: this.boardContext.packId,
      packBoardIndex: this.boardContext.boardIndex,
      score: this.score,
      bestScore: this.bestScore,
      lives: this.lives,
      combo: this.combo,
      paddleWidth: this.paddleWidth,
      levelBlueprint: this.levelBlueprint,
      bricks: this.bricks.map(toSavedBrick),
      recentEvents: event ? [event, ...this.recentEvents].slice(0, 6) : this.recentEvents,
      laserTimer: this.laserTimer,
      grabTimer: this.grabTimer,
      explosionScale: this.explosionScale,
      balls: this.balls.length > 0 ? this.balls.map(toSavedBall) : null
    };
    writeJson(SAVE_KEY, save);
    this.hasSave = true;
    if (event) this.pushEvent(event);
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

  private render() {
    this.syncBricks();
    this.syncPaddle();
    this.syncBalls();
    this.syncPowerups();
    this.syncLasers();
    this.syncSparks();
    this.syncFloatingTexts();
    const shake = this.boardShakeTimer > 0 && !this.settings.reducedMotion ? (Math.random() - 0.5) * this.boardShakeStrength : 0;
    this.board.rotation.z = this.settings.reducedMotion ? 0 : Math.sin(performance.now() / 3600) * 0.006 + shake * 0.002;
    this.board.position.x = shake;
    this.board.position.y = this.levelClearFlashTimer > 0 && !this.settings.reducedMotion ? Math.sin(performance.now() / 38) * 1.2 : 0;
    this.renderer.render(this.scene, this.camera);
  }

  private syncBricks() {
    for (const [brick, mesh] of this.brickMeshes) {
      if (!this.bricks.includes(brick)) {
        this.bricksGroup.remove(mesh);
        mesh.material.dispose();
        this.brickMeshes.delete(brick);
      }
    }
    for (const brick of this.bricks) {
      let mesh = this.brickMeshes.get(brick);
      if (!mesh) {
        const template = this.brickMaterials.get(brick.kind) ?? this.brickMaterials.get("basic");
        if (!template) continue;
        const material = template.clone();
        mesh = new THREE.Mesh(this.brickGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.brickMeshes.set(brick, mesh);
        this.bricksGroup.add(mesh);
      }
      const material = mesh.material;
      const baseIntensity = brick.kind === "boss" ? 0.45 : 0.24;
      const hpRatio = brick.maxHp > 0 ? brick.hp / brick.maxHp : 1;
      const impact = clamp((this.brickImpactTimers.get(brick) ?? 0) / 0.16, 0, 1);
      material.emissiveIntensity = baseIntensity * (0.38 + 0.62 * hpRatio) + impact * 0.85;
      mesh.position.copy(toWorld(brick.x + brick.width / 2, brick.y + brick.height / 2, brick.kind === "boss" ? 22 : 10));
      const punch = this.settings.reducedMotion ? 0 : impact * 0.06;
      mesh.scale.set(1 + punch, 1 + punch, brick.kind === "boss" ? 1.75 : 1 + (brick.hp / brick.maxHp) * 0.35 + punch);
      mesh.rotation.z = brick.kind === "bomb" && !this.settings.reducedMotion ? Math.sin(performance.now() / 180) * 0.035 : 0;
    }
  }

  private syncPaddle() {
    const flash = clamp(this.paddleFlashTimer / 0.2, 0, 1);
    this.paddleMesh.scale.set(this.paddleWidth, 16 + flash * 2, this.laserTimer > 0 ? 28 : 20 + flash * 8);
    this.paddleMesh.position.copy(toWorld(this.paddleX, PADDLE_Y + 7, 36));
    this.paddleMesh.material.emissiveIntensity = 0.45 + flash * 0.8 + (this.lifeFlashTimer > 0 ? 0.35 : 0);
  }

  private syncBalls() {
    for (const [ball, mesh] of this.ballMeshes) {
      if (!this.balls.includes(ball)) {
        this.ballsGroup.remove(mesh);
        this.ballMeshes.delete(ball);
      }
    }
    for (const ball of this.balls) {
      let mesh = this.ballMeshes.get(ball);
      if (!mesh) {
        const material = new THREE.MeshStandardMaterial({
          color: "#fff7cc",
          emissive: ball.fireTimer > 0 ? "#ff5c5c" : "#ffe066",
          emissiveIntensity: 0.55,
          metalness: 0.92,
          roughness: 0.12
        });
        mesh = new THREE.Mesh(this.ballGeometry, material);
        mesh.castShadow = true;
        this.ballMeshes.set(ball, mesh);
        this.ballsGroup.add(mesh);
      }
      mesh.position.copy(toWorld(ball.x, ball.y, 52));
      mesh.scale.setScalar(ball.radius);
      if (!this.settings.reducedMotion) {
        mesh.rotation.x += 0.08;
        mesh.rotation.y += 0.055;
      }
      const material = mesh.material;
      material.emissive.set(ball.fireTimer > 0 ? "#ff5c5c" : ball.thruTimer > 0 ? "#d6ff4d" : "#ffe066");
      material.emissiveIntensity = ball.megaTimer > 0 ? 0.85 : 0.55;
    }
  }

  private syncPowerups() {
    for (const [powerup, object] of this.powerupObjects) {
      if (!this.powerups.includes(powerup)) {
        this.powerupsGroup.remove(object);
        this.powerupObjects.delete(powerup);
      }
    }
    for (const powerup of this.powerups) {
      let object = this.powerupObjects.get(powerup);
      if (!object) {
        const material = this.powerupMaterials.get(powerup.kind);
        object = material ? new THREE.Sprite(material) : new THREE.Mesh(this.fallbackPowerupGeometry, this.fallbackPowerupMaterial);
        object.userData.label = POWERUP_NAMES[powerup.kind];
        this.powerupObjects.set(powerup, object);
        this.powerupsGroup.add(object);
      }
      object.position.copy(toWorld(powerup.x, powerup.y, 62));
      object.scale.set(object instanceof THREE.Sprite ? 44 : 1, object instanceof THREE.Sprite ? 30 : 1, 1);
      object.rotation.z = this.settings.reducedMotion ? 0 : Math.sin(performance.now() / 200 + powerup.x) * 0.08;
    }
  }

  private syncLasers() {
    for (const [beam, line] of this.laserObjects) {
      if (!this.laserBeams.includes(beam)) {
        line.geometry.dispose();
        this.lasersGroup.remove(line);
        this.laserObjects.delete(beam);
      }
    }
    for (const beam of this.laserBeams) {
      let line = this.laserObjects.get(beam);
      if (!line) {
        const start = toWorld(beam.x, PADDLE_Y, 72);
        const end = toWorld(beam.x, WALL + 6, 72);
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#ff5c5c", transparent: true, opacity: 0.9 }));
        this.laserObjects.set(beam, line);
        this.lasersGroup.add(line);
      }
      line.material.opacity = clamp(beam.life * 10, 0, 1);
    }
  }

  private syncSparks() {
    if (this.sparksPoints) {
      this.sparksPoints.geometry.dispose();
      this.sparksGroup.remove(this.sparksPoints);
      this.sparksPoints = null;
    }
    if (this.sparks.length === 0) return;
    const positions = new Float32Array(this.sparks.length * 3);
    const colors = new Float32Array(this.sparks.length * 3);
    for (const [index, spark] of this.sparks.entries()) {
      const position = toWorld(spark.x, spark.y, 78);
      positions[index * 3] = position.x;
      positions[index * 3 + 1] = position.y;
      positions[index * 3 + 2] = position.z;
      const color = new THREE.Color(spark.color);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.sparksPoints = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 4, vertexColors: true, transparent: true, opacity: 0.9 }));
    this.sparksGroup.add(this.sparksPoints);
  }

  private syncFloatingTexts() {
    for (const [id, node] of this.floatingTextNodes) {
      if (!this.floatingTexts.some((text) => text.id === id)) {
        node.remove();
        this.floatingTextNodes.delete(id);
      }
    }
    for (const text of this.floatingTexts) {
      let node = this.floatingTextNodes.get(text.id);
      if (!node) {
        node = document.createElement("div");
        node.className = `floating-text is-${text.kind}`;
        node.textContent = text.text;
        this.floatingTextNodes.set(text.id, node);
        this.effectsLayer.append(node);
      }
      const progress = 1 - text.life / text.duration;
      const lift = this.settings.reducedMotion ? 0 : progress * 34;
      node.style.left = `${(text.x / WIDTH) * 100}%`;
      node.style.top = `${((text.y - lift) / HEIGHT) * 100}%`;
      node.style.opacity = String(clamp(text.life / text.duration, 0, 1));
      node.style.transform = `translate(-50%, -50%) scale(${this.settings.reducedMotion ? 1 : 1 + (1 - progress) * 0.08})`;
    }
  }

  private emitSparks(x: number, y: number, color: string, count: number) {
    if (!this.settings.particles) return;
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 180;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3 + Math.random() * 0.45,
        color
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
    this.audio.play("laser", this.settings.sound);
    const target = this.bricks
      .filter((brick) => x >= brick.x && x <= brick.x + brick.width)
      .sort((a, b) => b.y - a.y)
      .at(0);
    if (!target) return;
    this.hitBrick(target);
  }

  private showLevelReadyOverlay(event: string) {
    this.showOverlay(
      `Level ${this.level}: ${this.levelBlueprint.name}`,
      `${this.levelBlueprint.briefing} ${event.includes("fallback") ? "Fallback generation is active, but the wall is still playable." : ""}`,
      "Launch",
      () => this.handlePrimaryAction()
    );
  }

  private showLoadingOverlay(title: string, body: string) {
    this.showOverlay(title, body, undefined, undefined, true);
  }

  private showOverlay(title: string, body: string, actionLabel?: string, action?: () => void, busy = false, secondaryLabel?: string, secondaryAction?: () => void) {
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.overlay.classList.add("is-visible");
    this.overlay.innerHTML = `
      <div class="overlay-card" role="dialog" aria-modal="true" aria-label="${escapeAttribute(title)}">
        <div class="overlay-kicker">${busy ? "Generating" : "Ricochet Rush"}</div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(body)}</p>
        ${
          actionLabel
            ? `<div class="overlay-actions"><button type="button" data-overlay-action>${escapeHtml(actionLabel)}</button>${
                secondaryLabel ? `<button type="button" class="secondary" data-overlay-secondary>${escapeHtml(secondaryLabel)}</button>` : ""
              }</div>`
            : `<div class="loader-bar"><span></span></div>`
        }
      </div>
    `;
    const button = this.overlay.querySelector<HTMLButtonElement>("[data-overlay-action]");
    const secondaryButton = this.overlay.querySelector<HTMLButtonElement>("[data-overlay-secondary]");
    if (button && action) button.addEventListener("click", action, { once: true });
    if (secondaryButton && secondaryAction) secondaryButton.addEventListener("click", secondaryAction, { once: true });
    button?.focus({ preventScroll: true });
  }

  private hideOverlay() {
    this.overlay.classList.remove("is-visible");
    this.overlay.innerHTML = "";
    if (this.previouslyFocusedElement?.isConnected) this.previouslyFocusedElement.focus({ preventScroll: true });
    this.previouslyFocusedElement = null;
  }
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

function circleRect(ball: Ball, brick: Brick): boolean {
  const nearestX = clamp(ball.x, brick.x, brick.x + brick.width);
  const nearestY = clamp(ball.y, brick.y, brick.y + brick.height);
  return (ball.x - nearestX) ** 2 + (ball.y - nearestY) ** 2 < ball.radius ** 2;
}

function toWorld(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x - WIDTH / 2, HEIGHT / 2 - y, z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculatePaddleRebound(input: PaddleReboundInput): PaddleRebound {
  const speed = clamp(Math.hypot(input.incomingVx, input.incomingVy) * PADDLE_ACCELERATION, MIN_BALL_SPEED, MAX_BALL_SPEED);
  const hitZone = clamp(input.hitZone, -1, 1);
  const paddleVelocityX = clamp(input.paddleVelocityX, -MAX_PADDLE_VELOCITY, MAX_PADDLE_VELOCITY);
  const desiredVx = hitZone * speed * PADDLE_EDGE_INFLUENCE + paddleVelocityX * PADDLE_SPIN_INFLUENCE;
  const fallbackSign = Math.sign(desiredVx) || Math.sign(input.incomingVx) || 1;
  return upwardVelocity(speed, desiredVx, fallbackSign);
}

function upwardVelocity(speed: number, desiredVx: number, fallbackSign: number): PaddleRebound {
  const maxVx = speed * MAX_REBOUND_X_RATIO;
  const minVx = Math.min(speed * MIN_REBOUND_X_RATIO, maxVx);
  const sign = Math.sign(desiredVx) || Math.sign(fallbackSign) || 1;
  const vx = sign * clamp(Math.abs(desiredVx), minVx, maxVx);
  const vy = -Math.sqrt(Math.max(0, speed * speed - vx * vx));
  return { vx, vy, speed };
}

export function normalizeLoopRiskVelocity(input: LoopRiskVelocityInput): LoopRiskVelocity {
  const speed = Math.hypot(input.vx, input.vy);
  if (speed <= 0) return { vx: input.vx, vy: input.vy, speed, changed: false };

  let vx = input.vx;
  let vy = input.vy;
  let changed = false;

  if (input.minXRatio !== undefined) {
    const minAbsX = speed * input.minXRatio;
    if (Math.abs(vx) < minAbsX) {
      const sign = Math.sign(vx) || Math.sign(input.fallbackXSign ?? 0) || 1;
      vx = sign * minAbsX;
      const ySign = Math.sign(vy) || Math.sign(input.fallbackYSign ?? 0) || 1;
      vy = ySign * Math.sqrt(Math.max(0, speed * speed - vx * vx));
      changed = true;
    }
  }

  if (input.minYRatio !== undefined) {
    const minAbsY = speed * input.minYRatio;
    if (Math.abs(vy) < minAbsY) {
      const sign = Math.sign(vy) || Math.sign(input.fallbackYSign ?? 0) || 1;
      vy = sign * minAbsY;
      const xSign = Math.sign(vx) || Math.sign(input.fallbackXSign ?? 0) || 1;
      vx = xSign * Math.sqrt(Math.max(0, speed * speed - vy * vy));
      changed = true;
    }
  }

  return { vx, vy, speed, changed };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function toSavedBall(ball: Ball): SavedBallState {
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

function toSavedBrick(brick: Brick): SavedBrick {
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

function normalizeComposerArchive(input: unknown): ComposerGeneratedLevelEntry[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeComposerArchiveEntry).filter((entry): entry is ComposerGeneratedLevelEntry => entry !== null);
}

export function trimComposerArchive(entries: ComposerGeneratedLevelEntry[], max = COMPOSER_LEVEL_ARCHIVE_MAX): ComposerGeneratedLevelEntry[] {
  if (!Number.isFinite(max) || max <= 0) return [];
  return entries.slice(0, max);
}

function normalizeComposerArchiveEntry(input: unknown): ComposerGeneratedLevelEntry | null {
  if (!isRecord(input)) return null;
  if (!isRecord(input.levelBlueprint)) return null;
  if (!Array.isArray(input.levelBlueprint.rows)) return null;
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString();
  const level = Math.max(1, Math.round(numberValue(input.level, 1)));
  const score = Math.max(0, Math.round(numberValue(input.score, 0)));
  const lives = Math.max(1, Math.round(numberValue(input.lives, 3)));
  const clearedLevels = Math.max(0, Math.round(numberValue(input.clearedLevels, 0)));
  const levelName = typeof input.levelName === "string" && input.levelName.trim().length > 0 ? input.levelName.trim() : "Generated Level";
  const levelBlueprint = input.levelBlueprint as unknown as LevelBlueprint;
  const model = isRecord(input.model) ? (input.model as LevelResponse["model"]) : { id: "composer-2", params: [{ id: "mode", value: "fast" }] };
  if (!levelBlueprint || !isLevelBlueprint(levelBlueprint)) return null;
  const trace = normalizeComposerTrace(input.trace);
  return {
    createdAt,
    level,
    score,
    lives,
    clearedLevels,
    levelName,
    model,
    levelBlueprint,
    summary: normalizeGenerationSummary(input.summary),
    trace
  };
}

function normalizeGenerationSummary(input: unknown): GenerationSummary | undefined {
  if (!isRecord(input)) return undefined;
  const source = input.source === "cursor-sdk" || input.source === "fallback" ? input.source : "fallback";
  return {
    source,
    title: typeof input.title === "string" ? input.title.slice(0, 80) : source === "cursor-sdk" ? "Cursor SDK board" : "Local fallback board",
    detail: typeof input.detail === "string" ? input.detail.slice(0, 240) : "",
    chips: Array.isArray(input.chips) ? input.chips.filter((chip): chip is string => typeof chip === "string").slice(0, 6) : [],
    warning: typeof input.warning === "string" ? input.warning.slice(0, 140) : undefined
  };
}

function normalizeComposerTrace(input: unknown): LevelResponse["trace"] | undefined {
  if (!isRecord(input)) return undefined;
  const parseStatus = input.parseStatus;
  if (parseStatus !== "success" && parseStatus !== "parse-failed" && parseStatus !== "worker-failed") return undefined;
  const request = input.request;
  if (!isRecord(request)) return undefined;
  return {
    request: {
      level: numberValue(request.level, 0),
      score: numberValue(request.score, 0),
      lives: Math.max(1, numberValue(request.lives, 3)),
      clearedLevels: Math.max(0, numberValue(request.clearedLevels, 0)),
      recentEvents: Array.isArray(request.recentEvents)
        ? request.recentEvents.filter((event): event is string => typeof event === "string")
        : []
    },
    requestJson: typeof input.requestJson === "string" ? input.requestJson : JSON.stringify(request),
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    rawOutput: typeof input.rawOutput === "string" ? input.rawOutput : "",
    rawError: typeof input.rawError === "string" ? input.rawError : "",
    parseStatus,
    parseError: typeof input.parseError === "string" ? input.parseError : undefined,
    durationMs: numberValue(input.durationMs, 0),
    startedAt: typeof input.startedAt === "string" ? input.startedAt : new Date(0).toISOString(),
    finishedAt: typeof input.finishedAt === "string" ? input.finishedAt : new Date(0).toISOString(),
    workerExitCode: Number.isFinite(numberValue(input.workerExitCode, Number.NaN))
      ? numberValue(input.workerExitCode, Number.NaN)
      : null,
    parsedOutput: isRecord(input.parsedOutput) ? input.parsedOutput : undefined
  };
}

function numberValue(input: unknown, fallback: number): number {
  return typeof input === "number" && Number.isFinite(input) ? input : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLevelBlueprint(value: unknown): value is LevelBlueprint {
  return isRecord(value) && Array.isArray(value.rows);
}

function readSave(): GameSave | null {
  return readJson(SAVE_KEY, normalizeSaveState);
}

function readSettings(): GameSettings {
  return readJson(SETTINGS_KEY, normalizeSettings) ?? { ...DEFAULT_SETTINGS, reducedMotion: prefersReducedMotion() };
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeDesignerFeedbackList(input: unknown): BoardDesignerFeedback[] {
  const intent = normalizeDesignerIntent({ feedback: input });
  return intent.feedback;
}

function readBestScore(): number {
  const value = Number(localStorage.getItem(BEST_SCORE_KEY));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function writeBestScore(score: number) {
  writeJson(BEST_SCORE_KEY, Math.max(0, Math.round(score)));
}

function readJson<T>(key: string, normalize: (value: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local persistence is a convenience; gameplay should survive private-mode quota failures.
  }
}
