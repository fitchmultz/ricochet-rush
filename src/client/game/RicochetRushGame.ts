import * as THREE from "three";
import {
  BRICK_COLUMNS,
  BRICK_ROWS,
  DEFAULT_DESIGNER_INTENT,
  type BoardDesignerIntent,
  type BrickKind,
  type GenerationSummary,
  type LevelBlueprint,
  type LevelRequest,
  type LevelResponse,
  fallbackLevel,
  nextDesignerSeed,
  normalizeDesignerIntent,
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
  normalizeDailyProgress,
  normalizePackProgress,
  normalizeSavedBoards,
  previewRowsFromLevel,
  trimSavedBoards
} from "../../shared/boardPacks";
import { createBoardExportPayload, encodeBoardExport, parseBoardExport } from "../../shared/shareState";
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
  normalizeCosmetics,
  normalizeSaveState,
  normalizeSettings
} from "../../shared/saveState";
import type { HudApi, HudPackItem } from "../ui/hud";
import { createGameAudio, type GameAudioPlayOptions, type GameSoundKind } from "./gameAudio";
import { isLevelGenerationNetworkError, levelGenerationServerHint, requestGeneratedLevel } from "./levelApi";

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
  gravity: number;
  size: number;
}

interface SparkBurstOptions {
  minSpeed: number;
  maxSpeed: number;
  minLife: number;
  maxLife: number;
  minSize: number;
  maxSize: number;
  gravity: number;
  ring: boolean;
}

interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  life: number;
  duration: number;
  kind: "score" | "combo" | "status" | "powerupReward" | "powerupHazard" | "powerupVolatile";
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
  | { source: "pack"; packId: string; boardIndex: number; dailyDateKey?: string }
  | { source: "generated"; packId: null; boardIndex: 0 };

interface BoardTheme {
  scene: string;
  floor: string;
  wall: string;
  wallGlow: string;
  rim: string;
}

interface RunStats {
  runStartedAt: number;
  levelStartedAt: number;
  scoreAtRunStart: number;
  bestScoreAtRunStart: number;
  bricksBroken: number;
  longestCombo: number;
  powerupsCaught: number;
  boardsCleared: number;
}

interface SummaryStat {
  label: string;
  value: string;
  tone?: "reward" | "neutral" | "warning";
}

interface SummaryAction {
  label: string;
  action: () => void;
  primary?: boolean;
  disabled?: boolean;
}

interface BrickVisualProfile {
  rim: string;
  shadow: string;
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  depthScale: number;
  hpDepthBoost: number;
  rimOpacity: number;
  impactGlow: number;
  wobble: number;
}

interface BallVisual {
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

const WIDTH = 960;
const HEIGHT = 640;
const WALL = 18;
const BRICK_GAP = 5;
const BRICK_TOP = 72;
const BRICK_WIDTH = (WIDTH - WALL * 2 - BRICK_GAP * (BRICK_COLUMNS - 1)) / BRICK_COLUMNS;
const BRICK_HEIGHT = 28;

interface LevelLayout {
  columns: number;
  rows: number;
  brickWidth: number;
  brickHeight: number;
}

function computeLevelLayout(level: LevelBlueprint): LevelLayout {
  const { columns, rows } = levelGridDimensions(level);
  const brickWidth = (WIDTH - WALL * 2 - BRICK_GAP * (columns - 1)) / columns;
  const availableHeight = PADDLE_Y - BRICK_TOP - BRICK_GAP;
  const brickHeight = Math.min(BRICK_HEIGHT, Math.floor((availableHeight - BRICK_GAP * Math.max(0, rows - 1)) / Math.max(1, rows)));
  return { columns, rows, brickWidth, brickHeight };
}
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
/** Minimum seconds after launch before an empty board can cost a life. */
export const LAUNCH_LOSS_GRACE_SECONDS = 2.2;
const LAUNCH_CENTER_OFFSET_THRESHOLD = 0.08;
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
const COSMETICS_KEY = "ricochet-rush-cosmetics";
const SIDEBAR_COLLAPSED_KEY = "ricochet-rush-sidebar-collapsed";
const BEST_SCORE_KEY = "ricochet-rush-best-score";
const PACK_PROGRESS_KEY = "ricochet-rush-pack-progress";
const DAILY_PROGRESS_KEY = "ricochet-rush-daily-progress";
const SAVED_BOARDS_KEY = "ricochet-rush-saved-boards";
const SAVED_BOARDS_MAX = 24;
const DESIGNER_INTENT_KEY = "ricochet-rush-designer-intent";
const POWERUP_PRIMER_DISMISSED_KEY = "ricochet-rush-powerup-primer-dismissed";
const POWER_DURATIONS: Record<string, number> = {
  Laser: 8,
  Grab: 12,
  Fire: 10,
  Thru: 10,
  Mega: 12
};
const BOARD_THEMES: Record<string, BoardTheme> = {
  starter: { scene: "#050910", floor: "#07111d", wall: "#183a3d", wallGlow: "#4ecdc4", rim: "#7ef1ff" },
  classic: { scene: "#090b13", floor: "#0e1320", wall: "#222d48", wallGlow: "#8e7dff", rim: "#d6ff4d" },
  chaos: { scene: "#11080c", floor: "#180f15", wall: "#3a1621", wallGlow: "#ff5c7a", rim: "#ffe066" },
  precision: { scene: "#06100f", floor: "#081816", wall: "#173d38", wallGlow: "#b6fffa", rim: "#7bf1a8" },
  "boss-rush": { scene: "#120b06", floor: "#1b100a", wall: "#4a260d", wallGlow: "#ff9f43", rim: "#ff5c7a" },
  "saved-designs": { scene: "#080b14", floor: "#101521", wall: "#26314b", wallGlow: "#ffe066", rim: "#7ef1ff" },
  generated: { scene: "#070912", floor: "#0d1320", wall: "#142a44", wallGlow: "#7ef1ff", rim: "#ff4d8d" }
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

const BRICK_VISUALS: Record<BrickKind, BrickVisualProfile> = {
  basic: { rim: "#bffcf8", shadow: "#082a2a", metalness: 0.54, roughness: 0.24, emissiveIntensity: 0.26, depthScale: 1.08, hpDepthBoost: 0.16, rimOpacity: 0.5, impactGlow: 0.75, wobble: 0 },
  hard: { rim: "#d5e4ff", shadow: "#0b1324", metalness: 0.9, roughness: 0.16, emissiveIntensity: 0.18, depthScale: 1.34, hpDepthBoost: 0.2, rimOpacity: 0.7, impactGlow: 0.72, wobble: 0 },
  bomb: { rim: "#ffd3d3", shadow: "#431015", metalness: 0.62, roughness: 0.18, emissiveIntensity: 0.5, depthScale: 1.2, hpDepthBoost: 0.22, rimOpacity: 0.76, impactGlow: 1.24, wobble: 0.04 },
  prize: { rim: "#ddffe9", shadow: "#07321d", metalness: 0.44, roughness: 0.22, emissiveIntensity: 0.42, depthScale: 1.14, hpDepthBoost: 0.18, rimOpacity: 0.72, impactGlow: 0.9, wobble: 0.012 },
  penalty: { rim: "#ffadbd", shadow: "#2b0710", metalness: 0.58, roughness: 0.28, emissiveIntensity: 0.3, depthScale: 1.1, hpDepthBoost: 0.16, rimOpacity: 0.62, impactGlow: 1.0, wobble: 0.018 },
  laser: { rim: "#ffc6e2", shadow: "#381025", metalness: 0.68, roughness: 0.16, emissiveIntensity: 0.46, depthScale: 1.16, hpDepthBoost: 0.18, rimOpacity: 0.76, impactGlow: 1.0, wobble: 0.012 },
  grab: { rim: "#ecfffd", shadow: "#0c3538", metalness: 0.46, roughness: 0.2, emissiveIntensity: 0.42, depthScale: 1.12, hpDepthBoost: 0.18, rimOpacity: 0.72, impactGlow: 0.92, wobble: 0.01 },
  fire: { rim: "#ffd5a8", shadow: "#401708", metalness: 0.62, roughness: 0.2, emissiveIntensity: 0.48, depthScale: 1.18, hpDepthBoost: 0.18, rimOpacity: 0.74, impactGlow: 1.04, wobble: 0.014 },
  thru: { rim: "#fbffbd", shadow: "#2d3308", metalness: 0.5, roughness: 0.18, emissiveIntensity: 0.46, depthScale: 1.12, hpDepthBoost: 0.16, rimOpacity: 0.7, impactGlow: 0.94, wobble: 0.008 },
  split: { rim: "#fff2af", shadow: "#3b2f08", metalness: 0.48, roughness: 0.22, emissiveIntensity: 0.44, depthScale: 1.12, hpDepthBoost: 0.18, rimOpacity: 0.7, impactGlow: 0.92, wobble: 0.01 },
  wide: { rim: "#ddffe9", shadow: "#07321d", metalness: 0.42, roughness: 0.2, emissiveIntensity: 0.42, depthScale: 1.16, hpDepthBoost: 0.18, rimOpacity: 0.72, impactGlow: 0.92, wobble: 0.008 },
  slow: { rim: "#d8d1ff", shadow: "#161139", metalness: 0.56, roughness: 0.2, emissiveIntensity: 0.4, depthScale: 1.12, hpDepthBoost: 0.16, rimOpacity: 0.72, impactGlow: 0.9, wobble: 0.008 },
  boss: { rim: "#ffe0ad", shadow: "#4a2305", metalness: 0.88, roughness: 0.12, emissiveIntensity: 0.58, depthScale: 1.72, hpDepthBoost: 0.42, rimOpacity: 0.9, impactGlow: 1.28, wobble: 0.016 }
};

const BALL_TRAIL_MIN_SPEED = 80;
const DEFAULT_SPARK_BURST: SparkBurstOptions = {
  minSpeed: 60,
  maxSpeed: 220,
  minLife: 0.34,
  maxLife: 0.72,
  minSize: 3.4,
  maxSize: 5.8,
  gravity: 220,
  ring: false
};
const BRICK_BURST_SCALE: Record<BrickKind, { chip: number; crumble: number; speed: number; size: number; ring: boolean }> = {
  basic: { chip: 12, crumble: 28, speed: 1, size: 1, ring: false },
  hard: { chip: 18, crumble: 36, speed: 0.85, size: 1.2, ring: false },
  bomb: { chip: 18, crumble: 54, speed: 1.35, size: 1.25, ring: true },
  prize: { chip: 16, crumble: 36, speed: 1.08, size: 1.1, ring: false },
  penalty: { chip: 18, crumble: 40, speed: 1.16, size: 1.12, ring: false },
  laser: { chip: 16, crumble: 38, speed: 1.14, size: 1.08, ring: false },
  grab: { chip: 16, crumble: 34, speed: 1.04, size: 1.08, ring: false },
  fire: { chip: 18, crumble: 42, speed: 1.2, size: 1.12, ring: false },
  thru: { chip: 16, crumble: 34, speed: 1.04, size: 1.06, ring: false },
  split: { chip: 16, crumble: 36, speed: 1.08, size: 1.08, ring: false },
  wide: { chip: 16, crumble: 34, speed: 1.04, size: 1.08, ring: false },
  slow: { chip: 16, crumble: 34, speed: 0.95, size: 1.08, ring: false },
  boss: { chip: 30, crumble: 72, speed: 1.18, size: 1.45, ring: true }
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

type PowerupTone = "reward" | "hazard" | "volatile";

const SAFE_REWARD_POWERUPS: PowerupKind[] = [
  "expandPaddle",
  "splitBall",
  "slowBall",
  "fireball",
  "thruBrick",
  "shootingPaddle",
  "grabPaddle",
  "extraLife"
];
const SKILL_REWARD_POWERUPS: PowerupKind[] = ["megaBall", "zapBricks"];
const VOLATILE_REWARD_POWERUPS: PowerupKind[] = [
  "eightBall",
  "levelWarp",
  "setOffExploding",
  "expandExploding"
];
const MILD_HAZARD_POWERUPS: PowerupKind[] = ["shrinkPaddle", "fastBall", "shrinkBall"];
const HARD_HAZARD_POWERUPS: PowerupKind[] = ["superShrink", "fallingBricks", "killPaddle"];
const NEGATIVE_POWERUPS: PowerupKind[] = [...MILD_HAZARD_POWERUPS, ...HARD_HAZARD_POWERUPS];
const VOLATILE_POWERUPS = new Set<PowerupKind>(VOLATILE_REWARD_POWERUPS);
const POWERUP_VISUALS: Record<PowerupTone, { tint: string; emissive: string; spark: string; floatingKind: FloatingText["kind"] }> = {
  reward: { tint: "#7bf1a8", emissive: "#28e68a", spark: "#7bf1a8", floatingKind: "powerupReward" },
  hazard: { tint: "#ff5c7a", emissive: "#ff244c", spark: "#ff5c7a", floatingKind: "powerupHazard" },
  volatile: { tint: "#ffe066", emissive: "#ff9f43", spark: "#ffe066", floatingKind: "powerupVolatile" }
};

interface PowerupPoolInput {
  level: number;
  clearedLevels: number;
  combo: number;
}

export class RicochetRushGame {
  private readonly mount: HTMLDivElement;
  private readonly hud: HudApi;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-WIDTH / 2, WIDTH / 2, HEIGHT / 2, -HEIGHT / 2, 1, 1800);
  private readonly board = new THREE.Group();
  private readonly backgroundGroup = new THREE.Group();
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
  private readonly brickRims = new Map<Brick, THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>>();
  private readonly brickShadows = new Map<Brick, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>();
  private readonly ballMeshes = new Map<Ball, THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>();
  private readonly ballVisuals = new Map<Ball, BallVisual>();
  private readonly powerupObjects = new Map<Powerup, THREE.Object3D>();
  private readonly laserObjects = new Map<LaserBeam, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>();
  private readonly brickImpactTimers = new Map<Brick, number>();
  private readonly floatingTextNodes = new Map<number, HTMLDivElement>();
  private readonly brickGeometry = new THREE.BoxGeometry(BRICK_WIDTH, BRICK_HEIGHT, 22, 2, 2, 1);
  private readonly brickRimGeometry = new THREE.EdgesGeometry(this.brickGeometry, 28);
  private readonly brickShadowGeometry = new THREE.PlaneGeometry(BRICK_WIDTH * 1.16, BRICK_HEIGHT * 1.42);
  private readonly paddleGeometry = new THREE.BoxGeometry(1, 1, 1, 3, 1, 1);
  private readonly paddleGlowGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  private readonly paddleSpecularGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  private readonly ballGeometry = new THREE.SphereGeometry(1, 28, 18);
  private readonly ballGlowGeometry = new THREE.SphereGeometry(1, 24, 12);
  private readonly fallbackPowerupGeometry = new THREE.BoxGeometry(38, 24, 10, 2, 1, 1);
  private readonly backdropMaterial = new THREE.MeshBasicMaterial({ color: "#07111d", transparent: true, opacity: 0.74, depthWrite: false });
  private readonly backdropFogMaterial = new THREE.MeshBasicMaterial({ color: "#4ecdc4", transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly backdropGridMaterial = new THREE.LineBasicMaterial({ color: "#7ef1ff", transparent: true, opacity: 0.24, depthWrite: false });
  private readonly backdropStarMaterial = new THREE.PointsMaterial({ color: "#8aefff", size: 2.4, transparent: true, opacity: 0.66, sizeAttenuation: false, depthWrite: false });
  private readonly floorMaterial = new THREE.MeshStandardMaterial({ color: "#07111d", metalness: 0.35, roughness: 0.58 });
  private readonly wallMaterial = new THREE.MeshStandardMaterial({ color: "#18263a", emissive: "#4ecdc4", emissiveIntensity: 0.22, metalness: 0.74, roughness: 0.2 });
  private readonly brickMaterials = new Map<BrickKind, THREE.MeshStandardMaterial>();
  private readonly powerupMaterials = new Map<PowerupKind, THREE.SpriteMaterial>();
  private readonly fallbackPowerupMaterials = new Map<PowerupTone, THREE.MeshStandardMaterial>();
  private readonly paddleGlowMaterial = new THREE.MeshBasicMaterial({ color: "#7ef1ff", transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly paddleSpecularMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.34, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly rimLight = new THREE.PointLight("#ff4d8d", 1.8, 940);
  private readonly paddleMesh = new THREE.Mesh(
    this.paddleGeometry,
    new THREE.MeshStandardMaterial({ color: "#e9ffff", emissive: "#35f3ff", emissiveIntensity: 0.45, metalness: 0.82, roughness: 0.18 })
  );
  private readonly paddleGlowMesh = new THREE.Mesh(this.paddleGlowGeometry, this.paddleGlowMaterial);
  private readonly paddleSpecularMesh = new THREE.Mesh(this.paddleSpecularGeometry, this.paddleSpecularMaterial);
  private sparksPoints: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null = null;
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
  private loadingLevel = false;
  private hasSave = false;
  private autosaveSuppressed = false;
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
  private lastStreakToneAt = 0;
  private boardShakeTimer = 0;
  private boardShakeStrength = 0;
  private paddleFlashTimer = 0;
  private levelClearFlashTimer = 0;
  private lifeFlashTimer = 0;
  private previouslyFocusedElement: HTMLElement | null = null;
  private readonly audio = createGameAudio();
  private savedBoards: SavedBoardEntry[] = [];
  private dailyProgress: DailyProgressState = normalizeDailyProgress(null);
  private packProgress: PackProgressState = normalizePackProgress(null, 0);
  private boardContext: BoardContext = { source: "pack", packId: "starter", boardIndex: 0 };
  private designerIntent: BoardDesignerIntent = DEFAULT_DESIGNER_INTENT;
  private powerupPrimerDismissed = false;
  private latestGenerationSummary?: GenerationSummary;

  constructor(mount: HTMLDivElement, hud: HudApi) {
    this.mount = mount;
    this.hud = hud;
    this.settings = readSettings();
    this.cosmetics = readJson(COSMETICS_KEY, normalizeCosmetics) ?? DEFAULT_COSMETICS;
    this.savedBoards = readJson(SAVED_BOARDS_KEY, normalizeSavedBoards) ?? [];
    this.dailyProgress = readJson(DAILY_PROGRESS_KEY, normalizeDailyProgress) ?? normalizeDailyProgress(null);
    this.packProgress =
      readJson(PACK_PROGRESS_KEY, (input) => normalizePackProgress(input, this.savedBoards.length)) ?? normalizePackProgress(null, this.savedBoards.length);
    this.bestScore = Math.max(readBestScore(), readSave()?.bestScore ?? 0);
    this.cosmetics = this.clampCosmetics(this.cosmetics);
    const storedDesignerIntent = readJson(DESIGNER_INTENT_KEY, normalizeDesignerIntent);
    this.designerIntent = {
      ...DEFAULT_DESIGNER_INTENT,
      brief: storedDesignerIntent?.brief ?? DEFAULT_DESIGNER_INTENT.brief,
      visualPreset: storedDesignerIntent?.visualPreset ?? DEFAULT_DESIGNER_INTENT.visualPreset
    };
    this.sidebarCollapsed = readJson(SIDEBAR_COLLAPSED_KEY, normalizeBoolean) ?? false;
    this.powerupPrimerDismissed = readJson(POWERUP_PRIMER_DISMISSED_KEY, normalizeBoolean) ?? false;
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
      activeDailyKey: this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.boardContext.dailyDateKey ?? localDateKey() : null,
      runStats: this.summaryStats("debug"),
      designerIntent: this.designerIntent,
      generationSummary: this.latestGenerationSummary,
      settings: this.settings,
      cosmetics: this.cosmetics,
      cosmeticOptions: this.collectCosmeticOptions(),
      audio: this.audio.debugSnapshot(),
      effects: {
        sparks: this.sparks.length,
        impactRings: this.effectsLayer.querySelectorAll(".impact-ring").length,
        screenFlashes: this.effectsLayer.querySelectorAll(".screen-flash").length
      },
      powerupPrimerDismissed: this.powerupPrimerDismissed,
      recentEvents: this.recentEvents,
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
    this.board.add(
      this.backgroundGroup,
      this.bricksGroup,
      this.ballsGroup,
      this.powerupsGroup,
      this.lasersGroup,
      this.sparksGroup,
      this.paddleGlowMesh,
      this.paddleMesh,
      this.paddleSpecularMesh
    );

    const ambient = new THREE.AmbientLight("#bfd8ff", 1.38);
    const key = new THREE.DirectionalLight("#ffffff", 2.75);
    key.position.set(-290, 330, 820);
    key.castShadow = true;
    key.shadow.mapSize.width = 1536;
    key.shadow.mapSize.height = 1536;
    key.shadow.camera.near = 120;
    key.shadow.camera.far = 1200;
    this.rimLight.position.set(470, 125, 340);
    this.scene.add(ambient, key, this.rimLight);
    this.setupBackdrop();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH - WALL * 2, HEIGHT - WALL * 2), this.floorMaterial);
    floor.position.set(0, 0, -20);
    floor.receiveShadow = true;
    this.board.add(floor);

    const topWall = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 18, 34), this.wallMaterial);
    topWall.position.copy(toWorld(WIDTH / 2, WALL / 2, 4));
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(18, HEIGHT - WALL, 34), this.wallMaterial);
    leftWall.position.copy(toWorld(WALL / 2, HEIGHT / 2, 4));
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(18, HEIGHT - WALL, 34), this.wallMaterial);
    rightWall.position.copy(toWorld(WIDTH - WALL / 2, HEIGHT / 2, 4));
    const bottomWall = new THREE.Mesh(new THREE.BoxGeometry(WIDTH, 18, 18), this.wallMaterial);
    bottomWall.position.copy(toWorld(WIDTH / 2, HEIGHT - WALL / 2, -2));
    this.board.add(topWall, leftWall, rightWall, bottomWall);

    for (const kind of Object.keys(COLORS) as BrickKind[]) {
      const color = COLORS[kind];
      const visual = BRICK_VISUALS[kind];
      this.brickMaterials.set(
        kind,
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: visual.emissiveIntensity,
          metalness: visual.metalness,
          roughness: visual.roughness
        })
      );
    }
    this.paddleMesh.castShadow = true;
    this.paddleMesh.receiveShadow = true;
    this.paddleGlowMesh.renderOrder = 2;
    this.paddleSpecularMesh.renderOrder = 4;
  }

  private setupBackdrop() {
    const field = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH * 1.08, HEIGHT * 1.1), this.backdropMaterial);
    field.position.set(0, 0, -72);
    const fog = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH * 0.96, HEIGHT * 0.54), this.backdropFogMaterial);
    fog.position.set(0, 74, -16);
    fog.scale.set(1, 1.18, 1);
    this.backgroundGroup.add(field, fog, this.createBackdropGrid(), this.createStarfield());
  }

  private createBackdropGrid() {
    const points: number[] = [];
    const left = -WIDTH / 2 + WALL;
    const right = WIDTH / 2 - WALL;
    const top = HEIGHT / 2 - WALL;
    const bottom = -HEIGHT / 2 + WALL;
    for (let x = left; x <= right; x += 64) points.push(x, bottom, -15, x, top, -15);
    for (let y = bottom; y <= top; y += 48) points.push(left, y, -15, right, y, -15);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(geometry, this.backdropGridMaterial);
  }

  private createStarfield() {
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = pseudoRandom(index, 17) * WIDTH - WIDTH / 2;
      positions[index * 3 + 1] = pseudoRandom(index, 41) * HEIGHT - HEIGHT / 2;
      positions[index * 3 + 2] = -13 - pseudoRandom(index, 73) * 6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geometry, this.backdropStarMaterial);
  }

  private loadPowerupAtlas() {
    new THREE.TextureLoader().load(
      "/assets/powerups.png",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        for (const [index, kind] of POWERUP_ORDER.entries()) {
          const map = texture.clone();
          const visual = powerupVisualFor(kind);
          map.colorSpace = THREE.SRGBColorSpace;
          map.repeat.set(1 / POWERUP_ATLAS_COLUMNS, 1 / POWERUP_ATLAS_ROWS);
          map.offset.set((index % POWERUP_ATLAS_COLUMNS) / POWERUP_ATLAS_COLUMNS, 1 - (Math.floor(index / POWERUP_ATLAS_COLUMNS) + 1) / POWERUP_ATLAS_ROWS);
          map.needsUpdate = true;
          this.powerupMaterials.set(kind, new THREE.SpriteMaterial({ map, color: visual.tint, transparent: true }));
        }
        this.pushEvent("Power-up icons are ready.");
      },
      undefined,
      () => this.pushEvent("Power-up icons switched to simple gems.")
    );
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
      const rect = this.renderer.domElement.getBoundingClientRect();
      const nextX = ((clientX - rect.left) / rect.width) * WIDTH;
      const elapsedSeconds = this.lastPointerAt > 0 ? (now - this.lastPointerAt) / 1000 : 1 / 60;
      this.lastPointerAt = now;
      this.setPaddleX(nextX, elapsedSeconds);
    };
    let activeTouchPointerId: number | null = null;
    const stage = this.mount.closest<HTMLElement>(".stage");
    this.renderer.domElement.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      applyPointerPaddle(event.clientX);
    });
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
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
        this.renderer.domElement.focus({ preventScroll: true });
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
      this.renderer.domElement.focus({ preventScroll: true });
      this.handlePrimaryAction();
    });
    shell.querySelector<HTMLButtonElement>('[data-touch-action="pause"]')?.addEventListener("click", (event) => {
      event.preventDefault();
      this.renderer.domElement.focus({ preventScroll: true });
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
        this.cosmetics = this.clampCosmetics(normalizeCosmetics(cosmetics));
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
      ball.x += ball.vx * delta;
      ball.y += ball.vy * delta;
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
      this.launchLossGraceTimer = Math.max(0, this.launchLossGraceTimer - delta);
      if (this.noBallTimer >= 0.22 && this.launchLossGraceTimer <= 0) this.loseLife();
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
    const packName = this.packNameFor(packId);
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

  private loadPackBoard(packId: string, boardIndex: number, event: string) {
    const level = this.materializePackBoard(packId, boardIndex);
    if (!level) return;
    this.level = boardIndex + 1;
    this.clearedLevels = boardIndex;
    this.latestAgentTrace = undefined;
    const dailyDateKey = packId === DAILY_PACK_ID ? this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.boardContext.dailyDateKey ?? localDateKey() : localDateKey() : undefined;
    this.loadLevel(level, event, undefined, undefined, { source: "pack", packId, boardIndex, dailyDateKey });
  }

  private materializePackBoard(packId: string, boardIndex: number): LevelBlueprint | null {
    const request = { ...this.levelRequest(), level: boardIndex + 1, clearedLevels: boardIndex };
    if (packId === DAILY_PACK_ID) {
      const dateKey = this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.boardContext.dailyDateKey ?? localDateKey() : localDateKey();
      return materializeDailyBoard(dateKey);
    }
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
    this.refreshHud("Board saved to Saved Designs.");
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
    const stats = this.summaryStats(this.phase === "levelComplete" ? "clear" : "gameOver");
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
      this.saveCheckpoint("Saved board rebuilt.", true);
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
    const node = document.createElement("div");
    node.className = `impact-ring is-${kind}`;
    node.style.setProperty("--impact-color", color);
    node.style.left = `${(x / WIDTH) * 100}%`;
    node.style.top = `${(y / HEIGHT) * 100}%`;
    this.effectsLayer.append(node);
    window.setTimeout(() => node.remove(), 720);
  }

  private emitScreenFlash(color: string, opacity: number) {
    if (!this.settings.particles || this.settings.reducedMotion) return;
    const node = document.createElement("div");
    node.className = "screen-flash";
    node.style.setProperty("--flash-color", color);
    node.style.setProperty("--flash-opacity", String(opacity));
    this.effectsLayer.append(node);
    window.setTimeout(() => node.remove(), 360);
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
    for (const spark of this.sparks) {
      spark.x += spark.vx * delta;
      spark.y += spark.vy * delta;
      spark.vx *= Math.max(0.72, 1 - delta * 0.7);
      spark.vy += spark.gravity * delta;
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
    const duration = kind === "combo" ? 0.95 : kind.startsWith("powerup") ? 0.9 : 0.75;
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
    this.saveCheckpoint("Level checkpoint saved.");
    const nextStep = this.nextLevelCompleteStep(completedContext);
    const actions: SummaryAction[] = [
      { label: nextStep.actionLabel, primary: true, action: () => void this.continueToNextLevel() },
      { label: "Retry Run", action: () => void this.restartRun() },
      { label: "Choose Board", action: () => this.openBoardPicker() }
    ];
    if (completedContext.source === "generated") actions.splice(1, 0, { label: "Keep Board", action: () => this.saveCurrentBoardToPack() });
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
    const activeDailyDateKey = this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.boardContext.dailyDateKey ?? localDateKey() : null;
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
            this.pushEvent(`${lastError} Retrying with a fresh seed.`);
            continue;
          }
          const fingerprint = blueprintFingerprint(result.level);
          if (fingerprint === previousFingerprint && attempt < maxAttempts) {
            lastError = "Designer returned the same wall layout; retrying with a fresh seed.";
            this.pushEvent(lastError);
            continue;
          }
          const sourceEvent = `${result.level.name} is ready.`;
          if (result.source === "fallback" && result.warning) {
            this.pushEvent(result.warning);
          }
          this.loadLevel(result.level, sourceEvent, result.trace, result.summary, { source: "generated", packId: null, boardIndex: 0 }, sourcePrompt);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "unknown error";
          if (attempt < maxAttempts && !isLevelGenerationNetworkError(error)) {
            this.pushEvent(`Generation attempt ${attempt} failed. Retrying.`);
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
      recentEvents: this.recentEvents.slice(0, 5),
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
    return {
      source: "fallback",
      title: serverOffline ? "Local backup (server offline)" : "Local backup board",
      detail: serverOffline
        ? `${reason} Local backup built ${level.name} so you can keep playing offline. Target was ${targets.brickTarget} bricks with about ${targets.specialTarget} specials; final wall has ${brickCount} playable bricks.`
        : `Local backup built ${level.name} from the current board prompt. Target was ${targets.brickTarget} bricks with about ${targets.specialTarget} specials; final wall has ${brickCount} playable bricks.`,
      chips: [
        designer.brief ? "prompt" : "default prompt",
        `difficulty ${designer.difficulty}/5`,
        `${Math.round(designer.density * 100)}% density`,
        `${Math.round(designer.specialBias * 100)}% specials`
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
      body: `The board is frozen. Continue when you want the Board Designer to generate Level ${this.level + 1}.`,
      actionLabel: "Continue",
      status: "Level cleared. Continue when ready."
    };
  }

  private packNameFor(packId: string): string {
    if (packId === DAILY_PACK_ID) return "Today's Board";
    if (packId === SAVED_DESIGNS_PACK_ID) return "Saved Designs";
    return getBuiltInPack(packId)?.name ?? "Board Pack";
  }

  private collectPackItems(): HudPackItem[] {
    const todayKey = localDateKey();
    const dailyLevel = materializeDailyBoard(todayKey);
    const todayProgress = this.dailyProgress[todayKey] ?? { bestScore: 0, completed: false };
    const dailyItem: HudPackItem = {
      id: DAILY_PACK_ID,
      name: "Today's Board",
      description: `Local-only daily challenge for ${todayKey}. Same date, same app version, same board; no remote service needed.`,
      progressLabel: todayProgress.completed ? "completed today" : "open today",
      bestScore: todayProgress.bestScore,
      unlocked: true,
      active: this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID,
      empty: false,
      previewRows: previewRowsFromLevel(dailyLevel),
      kind: "pack",
      actionLabel: "Play daily"
    };
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
        previewRows: [...pack.boards[previewIndex].pattern],
        kind: "pack" as const
      };
    });
    const savedProgress = this.packProgress[SAVED_DESIGNS_PACK_ID] ?? { cleared: 0, bestScore: 0, unlocked: this.savedBoards.length > 0 };
    const savedPreview = this.savedBoards[0] ? previewRowsFromLevel(this.savedBoards[0].levelBlueprint) : [];
    const savedCollection: HudPackItem = {
      id: SAVED_DESIGNS_PACK_ID,
      name: "Saved Designs Gallery",
      description: "Generated boards you kept. Individual cards below can be replayed; remix by copying their prompt into the Designer or discard by replacing them with better saves.",
      progressLabel: this.savedBoards.length > 0 ? `${savedProgress.cleared}/${this.savedBoards.length} cleared` : "empty",
      bestScore: savedProgress.bestScore,
      unlocked: this.savedBoards.length > 0,
      active: this.boardContext.source === "pack" && this.boardContext.packId === SAVED_DESIGNS_PACK_ID,
      empty: this.savedBoards.length === 0,
      previewRows: savedPreview,
      kind: "pack",
      actionLabel: "Browse"
    };
    const savedItems: HudPackItem[] = this.savedBoards.map((board, index) => ({
      id: savedBoardPackId(index),
      name: board.levelName,
      description: "Saved generated board. Replay this layout, remix from its prompt, or discard later by keeping stronger designs.",
      progressLabel: "saved design",
      bestScore: board.bestScore,
      unlocked: true,
      active: this.boardContext.source === "pack" && this.boardContext.packId === SAVED_DESIGNS_PACK_ID && this.boardContext.boardIndex === index,
      empty: false,
      previewRows: previewRowsFromLevel(board.levelBlueprint),
      kind: "saved-board",
      sourcePrompt: board.sourcePrompt,
      createdAt: board.createdAt,
      actionLabel: "Replay saved board"
    }));
    return [dailyItem, ...builtInItems, savedCollection, ...savedItems];
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
      cosmetics: this.cosmetics,
      cosmeticOptions: this.collectCosmeticOptions(),
      activePowers: this.collectActivePowers(),
      powerupPrimerDismissed: this.powerupPrimerDismissed,
      packs: this.collectPackItems(),
      canSaveBoard: this.boardContext.source === "generated" && this.bricks.length > 0,
      boardSource: this.boardContext.source,
      designer: {
        intent: this.designerIntent,
        generationSummary: this.latestGenerationSummary,
        previewRows: this.boardContext.source === "generated" ? previewRowsFromLevel(this.levelBlueprint) : []
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

  private collectCosmeticOptions() {
    const anyPackComplete = BUILT_IN_PACKS.some((pack) => (this.packProgress[pack.id]?.cleared ?? 0) >= pack.boards.length);
    const dailyComplete = Object.values(this.dailyProgress).some((progress) => progress.completed);
    const sharedOrSaved = this.savedBoards.length > 0 || this.bestScore >= 5000;
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

  private clampCosmetics(cosmetics: GameCosmetics): GameCosmetics {
    const options = this.collectCosmeticOptions();
    return {
      paddleSkin: options.paddleSkins.some((option) => option.id === cosmetics.paddleSkin && option.unlocked) ? cosmetics.paddleSkin : "classic",
      ballTrail: options.ballTrails.some((option) => option.id === cosmetics.ballTrail && option.unlocked) ? cosmetics.ballTrail : "classic",
      boardBackplate: options.boardBackplates.some((option) => option.id === cosmetics.boardBackplate && option.unlocked) ? cosmetics.boardBackplate : "default"
    };
  }

  private collectActivePowers(): { label: string; seconds: number; maxSeconds: number; tone: PowerupTone }[] {
    const rows: { label: string; seconds: number; maxSeconds: number; tone: PowerupTone }[] = [];
    if (this.laserTimer > 0) rows.push({ label: "Laser", seconds: Math.ceil(this.laserTimer), maxSeconds: POWER_DURATIONS.Laser, tone: powerupToneFor("shootingPaddle") });
    if (this.grabTimer > 0) rows.push({ label: "Grab", seconds: Math.ceil(this.grabTimer), maxSeconds: POWER_DURATIONS.Grab, tone: powerupToneFor("grabPaddle") });
    if (this.balls.length > 0) {
      const fire = Math.max(0, ...this.balls.map((ball) => ball.fireTimer));
      const thru = Math.max(0, ...this.balls.map((ball) => ball.thruTimer));
      const mega = Math.max(0, ...this.balls.map((ball) => ball.megaTimer));
      if (fire > 0) rows.push({ label: "Fire", seconds: Math.ceil(fire), maxSeconds: POWER_DURATIONS.Fire, tone: powerupToneFor("fireball") });
      if (thru > 0) rows.push({ label: "Thru", seconds: Math.ceil(thru), maxSeconds: POWER_DURATIONS.Thru, tone: powerupToneFor("thruBrick") });
      if (mega > 0) rows.push({ label: "Mega", seconds: Math.ceil(mega), maxSeconds: POWER_DURATIONS.Mega, tone: powerupToneFor("megaBall") });
    }
    return rows.slice(0, 5);
  }

  private pushEvent(event: string) {
    this.recentEvents.unshift(event);
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

  private saveCheckpoint(event?: string, force = false) {
    const now = performance.now();
    if (!force && !event && now - this.lastCheckpointAt < 1000) return;
    this.lastCheckpointAt = now;
    this.bestScore = Math.max(this.bestScore, this.score);
    writeBestScore(this.bestScore);
    if (this.bricks.length === 0 || this.autosaveSuppressed) {
      localStorage.removeItem(SAVE_KEY);
      this.hasSave = false;
      if (event) this.pushEvent(event);
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
      dailyDateKey: this.boardContext.source === "pack" && this.boardContext.packId === DAILY_PACK_ID ? this.boardContext.dailyDateKey ?? localDateKey() : null,
      score: this.score,
      bestScore: this.bestScore,
      lives: this.lives,
      combo: this.combo,
      paddleWidth: this.paddleWidth,
      levelBlueprint: this.levelBlueprint,
      levelSourcePrompt: this.levelSourcePrompt,
      bricks: this.bricks.map(toSavedBrick),
      recentEvents: event ? [event, ...this.recentEvents].slice(0, 6) : this.recentEvents,
      laserTimer: this.laserTimer,
      grabTimer: this.grabTimer,
      explosionScale: this.explosionScale,
      balls: this.balls.length > 0 ? this.balls.map(toSavedBall) : null,
      runStats: toSavedRunStats(this.runStats)
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

  private applyBoardTheme() {
    const theme = boardThemeFor(this.boardContext);
    const backplate = boardBackplateCosmetic(this.cosmetics.boardBackplate, theme, this.settings.highContrast);
    this.scene.background = new THREE.Color(backplate.scene);
    this.floorMaterial.color.set(backplate.floor);
    this.wallMaterial.color.set(theme.wall);
    this.wallMaterial.emissive.set(backplate.wallGlow);
    this.backdropMaterial.color.set(backplate.floor);
    this.backdropFogMaterial.color.set(backplate.wallGlow);
    this.backdropGridMaterial.color.set(backplate.rim);
    this.backdropStarMaterial.color.set(backplate.rim);
    this.rimLight.color.set(backplate.rim);
    const stage = this.mount.closest<HTMLElement>(".stage");
    stage?.style.setProperty("--stage-border-color", `${theme.wallGlow}66`);
    stage?.style.setProperty("--stage-glow-color", `${theme.wallGlow}2f`);
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
    const now = performance.now();
    const shake = this.boardShakeTimer > 0 && !this.settings.reducedMotion ? (Math.random() - 0.5) * this.boardShakeStrength : 0;
    this.board.rotation.z = this.settings.reducedMotion ? 0 : Math.sin(now / 3600) * 0.006 + shake * 0.002;
    this.board.position.x = shake;
    this.board.position.y = this.levelClearFlashTimer > 0 && !this.settings.reducedMotion ? Math.sin(now / 38) * 1.2 : 0;
    this.backgroundGroup.rotation.z = this.settings.reducedMotion ? 0 : Math.sin(now / 12000) * 0.004;
    this.backgroundGroup.position.x = this.settings.reducedMotion ? 0 : Math.sin(now / 9000) * 3.2;
    this.backgroundGroup.position.y = this.settings.reducedMotion ? 0 : Math.cos(now / 11000) * 2.2;
    this.renderer.render(this.scene, this.camera);
  }

  private syncBricks() {
    for (const [brick, mesh] of this.brickMeshes) {
      if (!this.bricks.includes(brick)) {
        this.bricksGroup.remove(mesh);
        mesh.material.dispose();
        this.brickMeshes.delete(brick);
        this.removeBrickAccents(brick);
      }
    }
    const now = performance.now();
    for (const brick of this.bricks) {
      const visual = BRICK_VISUALS[brick.kind];
      let mesh = this.brickMeshes.get(brick);
      let rim = this.brickRims.get(brick);
      let shadow = this.brickShadows.get(brick);
      if (!mesh) {
        const template = this.brickMaterials.get(brick.kind) ?? this.brickMaterials.get("basic");
        if (!template) continue;
        const material = template.clone();
        mesh = new THREE.Mesh(this.brickGeometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        rim = new THREE.LineSegments(
          this.brickRimGeometry,
          new THREE.LineBasicMaterial({ color: visual.rim, transparent: true, opacity: visual.rimOpacity, depthWrite: false })
        );
        rim.renderOrder = 3;
        shadow = new THREE.Mesh(
          this.brickShadowGeometry,
          new THREE.MeshBasicMaterial({ color: visual.shadow, transparent: true, opacity: 0.22, depthWrite: false })
        );
        shadow.renderOrder = 1;
        this.brickMeshes.set(brick, mesh);
        this.brickRims.set(brick, rim);
        this.brickShadows.set(brick, shadow);
        this.bricksGroup.add(shadow, mesh, rim);
      }
      if (!rim || !shadow) continue;
      const material = mesh.material;
      const hpRatio = brick.maxHp > 0 ? brick.hp / brick.maxHp : 1;
      const damageRatio = 1 - hpRatio;
      const impact = clamp((this.brickImpactTimers.get(brick) ?? 0) / 0.16, 0, 1);
      material.emissiveIntensity = visual.emissiveIntensity * (0.42 + 0.58 * hpRatio) + impact * visual.impactGlow;
      material.metalness = visual.metalness;
      material.roughness = visual.roughness + damageRatio * 0.08;
      const centerX = brick.x + brick.width / 2;
      const centerY = brick.y + brick.height / 2;
      const z = 12 + visual.depthScale * 6 + hpRatio * visual.hpDepthBoost * 12;
      mesh.position.copy(toWorld(centerX, centerY, z));
      const punch = this.settings.reducedMotion ? 0 : impact * 0.07;
      const wobble = this.settings.reducedMotion ? 0 : Math.sin(now / 170 + centerX * 0.03) * visual.wobble;
      const zScale = visual.depthScale + hpRatio * visual.hpDepthBoost + punch;
      const widthScale = brick.width / BRICK_WIDTH;
      const heightScale = brick.height / BRICK_HEIGHT;
      mesh.scale.set((1 + punch) * widthScale, (1 + punch * 0.7) * heightScale, zScale);
      mesh.rotation.z = brick.kind === "bomb" && !this.settings.reducedMotion ? Math.sin(now / 180) * 0.04 : wobble;

      rim.position.copy(mesh.position);
      rim.scale.copy(mesh.scale);
      rim.rotation.copy(mesh.rotation);
      rim.material.color.set(visual.rim);
      rim.material.opacity = clamp(visual.rimOpacity + impact * 0.22 + (brick.kind === "boss" ? 0.08 : 0), 0, 1);

      shadow.position.copy(toWorld(centerX + 5, centerY + 7, -5));
      shadow.scale.set(1 + damageRatio * 0.06 + impact * 0.04, 1.06 + visual.depthScale * 0.05, 1);
      shadow.rotation.z = mesh.rotation.z;
      shadow.material.color.set(visual.shadow);
      shadow.material.opacity = clamp(0.16 + visual.depthScale * 0.05 + impact * 0.06, 0, 0.4);
    }
  }

  private removeBrickAccents(brick: Brick) {
    const rim = this.brickRims.get(brick);
    if (rim) {
      this.bricksGroup.remove(rim);
      rim.material.dispose();
      this.brickRims.delete(brick);
    }
    const shadow = this.brickShadows.get(brick);
    if (shadow) {
      this.bricksGroup.remove(shadow);
      shadow.material.dispose();
      this.brickShadows.delete(brick);
    }
  }

  private syncPaddle() {
    const flash = clamp(this.paddleFlashTimer / 0.2, 0, 1);
    const now = performance.now();
    const width = this.paddleWidth + flash * 24;
    const height = Math.max(11, 15 - flash * 3);
    const depth = this.laserTimer > 0 ? 32 : 21 + flash * 16;
    const cosmetic = paddleCosmetic(this.cosmetics.paddleSkin, this.settings.highContrast);
    this.paddleMesh.scale.set(width, height, depth);
    this.paddleMesh.position.copy(toWorld(this.paddleX, PADDLE_Y + 7 + flash * 0.8, 37));
    this.paddleMesh.material.color.set(cosmetic.color);
    this.paddleMesh.material.emissive.set(cosmetic.emissive);
    this.paddleMesh.material.emissiveIntensity = cosmetic.emissiveIntensity + flash * 1.05 + (this.lifeFlashTimer > 0 ? 0.35 : 0);

    this.paddleGlowMaterial.color.set(cosmetic.glow);
    this.paddleSpecularMaterial.color.set(cosmetic.specular);
    this.paddleGlowMesh.position.copy(toWorld(this.paddleX, PADDLE_Y + 9, 30));
    this.paddleGlowMesh.scale.set(width * 1.16, 27 + flash * 12, 1);
    this.paddleGlowMaterial.opacity = this.settings.reducedMotion ? 0.22 + flash * 0.08 : 0.3 + flash * 0.18;

    const sweep = this.settings.reducedMotion ? 0 : Math.sin(now / 520) * this.paddleWidth * 0.34;
    this.paddleSpecularMesh.position.copy(toWorld(this.paddleX + sweep, PADDLE_Y + 1, 56));
    this.paddleSpecularMesh.scale.set(Math.max(38, this.paddleWidth * 0.24), 3 + flash * 2.4, 1);
    this.paddleSpecularMaterial.opacity = this.settings.reducedMotion ? 0.16 + flash * 0.1 : 0.26 + flash * 0.24;
  }

  private syncBalls() {
    for (const [ball, mesh] of this.ballMeshes) {
      if (!this.balls.includes(ball)) {
        this.ballsGroup.remove(mesh);
        mesh.material.dispose();
        this.ballMeshes.delete(ball);
        this.removeBallVisual(ball);
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
        mesh.renderOrder = 5;
        this.ballMeshes.set(ball, mesh);
        this.ballsGroup.add(mesh);
      }
      const visual = this.ballVisuals.get(ball) ?? this.createBallVisual(ball);
      const head = toWorld(ball.x, ball.y, 56);
      mesh.position.copy(head);
      mesh.scale.setScalar(ball.radius);
      if (!this.settings.reducedMotion) {
        mesh.rotation.x += 0.08;
        mesh.rotation.y += 0.055;
      }
      const material = mesh.material;
      const ballColor = ball.fireTimer > 0 ? "#ff5c5c" : ball.thruTimer > 0 ? "#d6ff4d" : ballCosmeticColor(this.cosmetics.ballTrail, this.settings.highContrast);
      material.color.set(ballColor);
      material.emissive.set(ballColor);
      material.emissiveIntensity = ball.megaTimer > 0 ? 0.92 : 0.62;
      this.syncBallVisual(ball, visual, ballColor, head);
    }
  }

  private createBallVisual(ball: Ball): BallVisual {
    const glow = new THREE.Mesh(
      this.ballGlowGeometry,
      new THREE.MeshBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glow.renderOrder = 4;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const trail = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: "#ffe066", transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    trail.renderOrder = 3;
    const visual = { glow, trail };
    this.ballVisuals.set(ball, visual);
    this.ballsGroup.add(trail, glow);
    return visual;
  }

  private syncBallVisual(ball: Ball, visual: BallVisual, color: string, head: THREE.Vector3) {
    const speed = Math.hypot(ball.vx, ball.vy);
    const trailMaterial = visual.trail.material;
    const glowMaterial = visual.glow.material;
    visual.glow.position.copy(head);
    visual.glow.scale.setScalar(ball.radius * (this.settings.reducedMotion ? 1.65 : 2.2));
    glowMaterial.color.set(color);
    glowMaterial.opacity = this.settings.reducedMotion ? 0.18 : ball.megaTimer > 0 ? 0.36 : 0.28;

    const trailPositions = visual.trail.geometry.getAttribute("position");
    const hasTrail = speed > BALL_TRAIL_MIN_SPEED && !ball.stuck;
    const trailLength = hasTrail ? (this.settings.reducedMotion ? 18 : clamp(speed * 0.08, 34, 86)) : 0;
    const normalizedX = speed > 0 ? ball.vx / speed : 0;
    const normalizedY = speed > 0 ? ball.vy / speed : 0;
    const tail = toWorld(ball.x - normalizedX * trailLength, ball.y - normalizedY * trailLength, 49);
    trailPositions.setXYZ(0, tail.x, tail.y, tail.z);
    trailPositions.setXYZ(1, head.x, head.y, head.z);
    trailPositions.needsUpdate = true;
    visual.trail.geometry.computeBoundingSphere();
    trailMaterial.color.set(color);
    trailMaterial.opacity = hasTrail ? (this.settings.reducedMotion ? 0.18 : clamp(speed / MAX_BALL_SPEED, 0.28, 0.68)) : 0;
  }

  private removeBallVisual(ball: Ball) {
    const visual = this.ballVisuals.get(ball);
    if (!visual) return;
    this.ballsGroup.remove(visual.trail, visual.glow);
    visual.trail.geometry.dispose();
    visual.trail.material.dispose();
    visual.glow.material.dispose();
    this.ballVisuals.delete(ball);
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
        object = material ? new THREE.Sprite(material) : new THREE.Mesh(this.fallbackPowerupGeometry, this.fallbackMaterialForPowerup(powerup.kind));
        object.userData.label = POWERUP_NAMES[powerup.kind];
        this.powerupObjects.set(powerup, object);
        this.powerupsGroup.add(object);
      }
      const tone = powerupToneFor(powerup.kind);
      const pulse = this.settings.reducedMotion ? 0 : Math.sin(performance.now() / 150 + powerup.x) * 0.07;
      object.position.copy(toWorld(powerup.x, powerup.y, 62));
      const spriteWidth = tone === "volatile" ? 50 : 44;
      const spriteHeight = tone === "hazard" ? 36 : 30;
      object.scale.set(object instanceof THREE.Sprite ? spriteWidth * (1 + pulse) : 1, object instanceof THREE.Sprite ? spriteHeight * (1 + pulse) : 1, 1);
      object.rotation.z = this.settings.reducedMotion
        ? 0
        : Math.sin(performance.now() / (tone === "hazard" ? 130 : 200) + powerup.x) * (tone === "hazard" ? 0.18 : 0.08);
    }
  }

  private fallbackMaterialForPowerup(kind: PowerupKind): THREE.MeshStandardMaterial {
    const tone = powerupToneFor(kind);
    const existing = this.fallbackPowerupMaterials.get(tone);
    if (existing) return existing;
    const visual = POWERUP_VISUALS[tone];
    const material = new THREE.MeshStandardMaterial({
      color: visual.tint,
      emissive: visual.emissive,
      emissiveIntensity: tone === "hazard" ? 0.72 : 0.52,
      metalness: 0.5,
      roughness: 0.25
    });
    this.fallbackPowerupMaterials.set(tone, material);
    return material;
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
    const size = this.sparks.reduce((largest, spark) => Math.max(largest, spark.size), 4);
    this.sparksPoints = new THREE.Points(geometry, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity: 0.92 }));
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
      const baseScale = text.kind === "combo" ? 1.16 : text.kind.startsWith("powerup") ? 1.08 : 1;
      node.style.transform = `translate(-50%, -50%) scale(${this.settings.reducedMotion ? baseScale : baseScale + (1 - progress) * 0.12})`;
    }
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

  private summaryStats(mode: "clear" | "gameOver" | "debug"): SummaryStat[] {
    const bestDelta = Math.max(0, this.bestScore - this.runStats.bestScoreAtRunStart);
    const now = Date.now();
    const elapsed = mode === "clear" ? now - this.runStats.levelStartedAt : now - this.runStats.runStartedAt;
    return [
      { label: "Score", value: this.score.toLocaleString(), tone: "reward" },
      { label: "Best Delta", value: bestDelta > 0 ? `+${bestDelta.toLocaleString()}` : "Even", tone: bestDelta > 0 ? "reward" : "neutral" },
      { label: "Bricks Broken", value: this.runStats.bricksBroken.toLocaleString(), tone: "neutral" },
      { label: "Longest Streak", value: `x${this.runStats.longestCombo.toFixed(1)}`, tone: this.runStats.longestCombo >= 2 ? "reward" : "neutral" },
      { label: "Power-Ups Caught", value: this.runStats.powerupsCaught.toLocaleString(), tone: "neutral" },
      { label: "Boards Cleared", value: this.runStats.boardsCleared.toLocaleString(), tone: this.runStats.boardsCleared > 0 ? "reward" : "neutral" },
      { label: mode === "clear" ? "Clear Time" : "Survival Time", value: formatRunDuration(elapsed), tone: "neutral" }
    ];
  }

  private showRunSummaryOverlay(mode: "clear" | "gameOver", content: { title: string; body: string; actions: SummaryAction[] }) {
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stage = this.mount.closest<HTMLElement>(".stage");
    stage?.classList.add("has-visible-overlay", "has-priority-overlay");
    this.overlay.classList.add("is-visible");
    const stats = this.summaryStats(mode);
    this.overlay.innerHTML = `
      <div class="overlay-card run-summary" role="dialog" aria-modal="true" aria-label="${escapeAttribute(content.title)}" data-run-summary="${mode}">
        <div class="overlay-kicker">${mode === "clear" ? "Board Clear" : "Run Summary"}</div>
        <h1>${escapeHtml(content.title)}</h1>
        <p>${escapeHtml(content.body)}</p>
        <dl class="summary-grid" aria-label="Run stats">
          ${stats
            .map(
              (stat) => `<div class="summary-stat is-${stat.tone ?? "neutral"}"><dt>${escapeHtml(stat.label)}</dt><dd>${escapeHtml(stat.value)}</dd></div>`
            )
            .join("")}
        </dl>
        <div class="overlay-actions summary-actions">
          ${content.actions
            .map(
              (action, index) =>
                `<button type="button" class="${action.primary ? "" : "secondary"}" data-summary-action="${index}"${action.disabled ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(action.label)}</button>`
            )
            .join("")}
        </div>
      </div>
    `;
    for (const [index, action] of content.actions.entries()) {
      const button = this.overlay.querySelector<HTMLButtonElement>(`[data-summary-action="${index}"]`);
      if (button && !action.disabled) button.addEventListener("click", action.action, { once: true });
    }
    this.overlay.querySelector<HTMLButtonElement>("[data-summary-action]:not([disabled])")?.focus({ preventScroll: true });
  }

  private openBoardPicker() {
    this.hideOverlay();
    const packsButton = this.mount.closest<HTMLElement>(".shell")?.querySelector<HTMLButtonElement>('[data-tool-panel="packs"]');
    packsButton?.click();
    this.refreshHud("Choose a board pack.");
  }

  private showLevelReadyOverlay(event: string) {
    this.showOverlay(
      `Level ${this.level}: ${this.levelBlueprint.name}`,
      `${this.levelBlueprint.briefing} ${event.includes("backup") || event.includes("fallback") ? "Local backup handled this board; the wall is still playable." : ""}`,
      "Launch",
      () => this.handlePrimaryAction()
    );
  }

  private showLoadingOverlay(title: string, body: string) {
    this.showOverlay(title, body, undefined, undefined, true);
  }

  private showOverlay(title: string, body: string, actionLabel?: string, action?: () => void, busy = false, secondaryLabel?: string, secondaryAction?: () => void) {
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stage = this.mount.closest<HTMLElement>(".stage");
    stage?.classList.add("has-visible-overlay");
    stage?.classList.toggle("has-priority-overlay", busy || Boolean(secondaryLabel));
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
    this.mount.closest<HTMLElement>(".stage")?.classList.remove("has-visible-overlay", "has-priority-overlay");
    this.overlay.innerHTML = "";
    if (this.previouslyFocusedElement?.isConnected) this.previouslyFocusedElement.focus({ preventScroll: true });
    this.previouslyFocusedElement = null;
  }

  private scrollStageIntoView() {
    if (!window.matchMedia("(max-width: 860px)").matches) return;
    this.mount.closest<HTMLElement>(".stage")?.scrollIntoView({ block: "start", inline: "nearest" });
  }
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

export function prizePowerupPool(input: PowerupPoolInput): readonly PowerupKind[] {
  const progress = powerupPressure(input);
  if (input.combo >= 3 && progress >= 0.55) return [...SAFE_REWARD_POWERUPS, ...SKILL_REWARD_POWERUPS, ...VOLATILE_REWARD_POWERUPS];
  if (input.combo >= 3) return [...SAFE_REWARD_POWERUPS, ...SKILL_REWARD_POWERUPS];
  if (progress >= 0.55) return [...SAFE_REWARD_POWERUPS, ...VOLATILE_REWARD_POWERUPS];
  return SAFE_REWARD_POWERUPS;
}

export function penaltyPowerupPool(input: PowerupPoolInput): readonly PowerupKind[] {
  if (powerupPressure(input) >= 0.45) return [...MILD_HAZARD_POWERUPS, ...HARD_HAZARD_POWERUPS];
  return MILD_HAZARD_POWERUPS;
}

export function powerupToneFor(kind: PowerupKind): PowerupTone {
  if (NEGATIVE_POWERUPS.includes(kind)) return "hazard";
  if (VOLATILE_POWERUPS.has(kind)) return "volatile";
  return "reward";
}

function powerupVisualFor(kind: PowerupKind): (typeof POWERUP_VISUALS)[PowerupTone] {
  return POWERUP_VISUALS[powerupToneFor(kind)];
}

function pickupLabelFor(kind: PowerupKind): string {
  const tone = powerupToneFor(kind);
  if (tone === "hazard") return `-${POWERUP_NAMES[kind]}`;
  if (tone === "volatile") return `! ${POWERUP_NAMES[kind]}`;
  return `+${POWERUP_NAMES[kind]}`;
}

function powerupPressure(input: PowerupPoolInput): number {
  return clamp((input.level + input.clearedLevels - 1) / 10, 0, 1);
}

function pseudoRandom(index: number, salt: number): number {
  return fract(Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function boardThemeFor(context: BoardContext): BoardTheme {
  if (context.source === "generated") return BOARD_THEMES.generated;
  return BOARD_THEMES[context.packId] ?? BOARD_THEMES.starter;
}

function createRunStats(scoreAtRunStart: number, bestScoreAtRunStart: number): RunStats {
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

function toSavedRunStats(stats: RunStats): SavedRunStats {
  return { ...stats };
}

function fromSavedRunStats(stats: SavedRunStats, score: number, bestScore: number): RunStats {
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

function paddleCosmetic(skin: GameCosmetics["paddleSkin"], highContrast: boolean) {
  if (highContrast) return { color: "#ffffff", emissive: "#ffe066", glow: "#ffe066", specular: "#ffffff", emissiveIntensity: 0.58 };
  if (skin === "gold") return { color: "#fff0a6", emissive: "#ffb000", glow: "#ffe066", specular: "#ffffff", emissiveIntensity: 0.64 };
  if (skin === "neon") return { color: "#dffcff", emissive: "#8e7dff", glow: "#b6fffa", specular: "#d6ff4d", emissiveIntensity: 0.56 };
  return { color: "#e9ffff", emissive: "#35f3ff", glow: "#7ef1ff", specular: "#ffffff", emissiveIntensity: 0.48 };
}

function ballCosmeticColor(trail: GameCosmetics["ballTrail"], highContrast: boolean): string {
  if (highContrast) return "#ffffff";
  if (trail === "aurora") return "#b6fffa";
  if (trail === "comet") return "#ff9f43";
  return "#ffe066";
}

function boardBackplateCosmetic(backplate: GameCosmetics["boardBackplate"], theme: BoardTheme, highContrast: boolean): BoardTheme {
  if (highContrast) return { scene: "#010307", floor: "#010307", wall: theme.wall, wallGlow: "#ffe066", rim: "#ffe066" };
  if (backplate === "midnight") return { scene: "#040414", floor: "#070920", wall: theme.wall, wallGlow: "#8e7dff", rim: "#b6fffa" };
  if (backplate === "sunrise") return { scene: "#160b10", floor: "#1b1013", wall: theme.wall, wallGlow: "#ff9f43", rim: "#ffe066" };
  return theme;
}

function cloneLevelBlueprint(level: LevelBlueprint): LevelBlueprint {
  return {
    name: level.name,
    briefing: level.briefing,
    paddleHint: level.paddleHint,
    speed: level.speed,
    rows: level.rows.map((row) => row.map((cell) => (cell ? { ...cell } : null)))
  };
}

function authoredBoardRequestForSaved(request: LevelRequest): LevelRequest {
  return {
    level: request.level,
    score: request.score,
    lives: request.lives,
    clearedLevels: request.clearedLevels,
    recentEvents: request.recentEvents
  };
}

function formatRunDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function savedBoardPackId(index: number): string {
  return `${SAVED_DESIGNS_PACK_ID}:${index}`;
}

function savedBoardIndexFromPackId(packId: string): number | null {
  if (!packId.startsWith(`${SAVED_DESIGNS_PACK_ID}:`)) return null;
  const index = Number(packId.slice(SAVED_DESIGNS_PACK_ID.length + 1));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function drawScoreCardPreview(context: CanvasRenderingContext2D, rows: string[], x: number, y: number, cell: number) {
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

function soundForBrickDestroy(kind: BrickKind): GameSoundKind {
  if (kind === "boss") return "bossBrick";
  if (kind === "hard") return "hardBrick";
  if (kind === "basic") return "brickDestroy";
  return "specialBrick";
}

function brickAudioOptions(brick: Brick, combo: number, destroyed: boolean): GameAudioPlayOptions {
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

function soundForPowerup(kind: PowerupKind): GameSoundKind {
  if (kind === "extraLife") return "extraLife";
  if (kind === "levelWarp") return "levelWarp";
  if (VOLATILE_POWERUPS.has(kind)) return "volatilePowerup";
  if (NEGATIVE_POWERUPS.includes(kind)) return "badPowerup";
  return "goodPowerup";
}

function powerupAudioOptions(kind: PowerupKind): GameAudioPlayOptions {
  const tone = powerupToneFor(kind);
  if (tone === "volatile") return { pitch: 0.96, intensity: 1.12, rumble: 0.44 };
  if (tone === "hazard") return { pitch: 0.82, intensity: 1.04, rumble: 0.28 };
  return { pitch: kind === "extraLife" ? 1.16 : 1.04, intensity: 0.94 };
}

function circleRect(ball: Ball, brick: Brick): boolean {
  const nearestX = clamp(ball.x, brick.x, brick.x + brick.width);
  const nearestY = clamp(ball.y, brick.y, brick.y + brick.height);
  return (ball.x - nearestX) ** 2 + (ball.y - nearestY) ** 2 < ball.radius ** 2;
}

function toWorld(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x - WIDTH / 2, HEIGHT / 2 - y, z);
}

function materializeLevelBricks(level: LevelBlueprint, layout: LevelLayout): Brick[] {
  const bricks: Brick[] = [];
  for (let row = 0; row < layout.rows; row += 1) {
    for (let column = 0; column < layout.columns; column += 1) {
      const spec = level.rows[row]?.[column];
      if (!spec) continue;
      bricks.push({
        x: WALL + column * (layout.brickWidth + BRICK_GAP),
        y: BRICK_TOP + row * (layout.brickHeight + BRICK_GAP),
        width: layout.brickWidth,
        height: layout.brickHeight,
        kind: spec.kind,
        hp: spec.hp,
        maxHp: spec.hp
      });
    }
  }
  return bricks;
}

function bricksFitLevel(savedBricks: readonly SavedBrick[], level: LevelBlueprint): boolean {
  const expected = materializeLevelBricks(level, computeLevelLayout(level));
  if (savedBricks.length > expected.length) return false;
  return savedBricks.every((saved) =>
    expected.some(
      (brick) =>
        Math.abs(brick.x - saved.x) < 0.001 &&
        Math.abs(brick.y - saved.y) < 0.001 &&
        Math.abs(brick.width - saved.width) < 0.001 &&
        Math.abs(brick.height - saved.height) < 0.001 &&
        brick.kind === saved.kind &&
        brick.maxHp === saved.maxHp &&
        saved.hp > 0 &&
        saved.hp <= brick.maxHp
    )
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface StuckBallLaunchInput {
  stuckOffset: number;
  paddleWidth: number;
  paddleVelocityX: number;
  storedVx: number;
  speedMultiplier: number;
}

export function computeStuckBallLaunch(input: StuckBallLaunchInput): PaddleRebound {
  const offset = clamp(input.stuckOffset / (input.paddleWidth / 2), -1, 1);
  const aimedLaunch = Math.abs(offset) > LAUNCH_CENTER_OFFSET_THRESHOLD;
  const fallbackX = Math.abs(input.storedVx) > 60 ? Math.sign(input.storedVx) * LAUNCH_SIDE_SPEED : LAUNCH_SIDE_SPEED;
  const launchSpeed = clamp(Math.hypot(fallbackX, LAUNCH_UPWARD_SPEED * input.speedMultiplier), MIN_BALL_SPEED, MAX_LAUNCH_SPEED);
  const desiredVx =
    (aimedLaunch ? LAUNCH_OFFSET_INFLUENCE * offset : 0) + input.paddleVelocityX * LAUNCH_SPIN_INFLUENCE;
  return upwardVelocity(launchSpeed, desiredVx, Math.sign(desiredVx) || Math.sign(input.storedVx) || 1);
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

function readSave(): GameSave | null {
  return readJson(SAVE_KEY, normalizeSaveState);
}

function readSettings(): GameSettings {
  const storedSettings = readJson(SETTINGS_KEY, normalizeSettingsObject);
  return storedSettings ? normalizeSettings(storedSettings) : { ...DEFAULT_SETTINGS, reducedMotion: prefersReducedMotion() };
}

function normalizeSettingsObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function normalizeBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function actionControlTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>("button:not(:disabled), a[href], [role='button']:not([aria-disabled='true'])");
}

function isArenaPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !target.closest("button, input, textarea, select, .panel, .tool-panel, .game-overlay, .touch-controls");
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
  } catch (error) {
    warnStorageFailure("read", key, error);
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    warnStorageFailure("write", key, error);
  }
}

function warnStorageFailure(operation: "read" | "write", key: string, error: unknown) {
  const reason = error instanceof DOMException || error instanceof Error ? error.name : "unknown error";
  console.warn(`Ricochet Rush could not ${operation} local state ${key}: ${reason}.`);
}
