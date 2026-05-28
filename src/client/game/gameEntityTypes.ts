import type * as THREE from "three";
import type { BrickKind } from "../../shared/evolution";
import type { LoopRiskVelocity, PaddleRebound } from "./physics";
import type { PowerupKind } from "./powerups";

export interface Ball {
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

export interface Brick {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: BrickKind;
  hp: number;
  maxHp: number;
}

export interface Powerup {
  x: number;
  y: number;
  vy: number;
  kind: PowerupKind;
}

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  gravity: number;
  size: number;
}

export interface SparkBurstOptions {
  minSpeed: number;
  maxSpeed: number;
  minLife: number;
  maxLife: number;
  minSize: number;
  maxSize: number;
  gravity: number;
  ring: boolean;
}

export interface FloatingText {
  id: number;
  x: number;
  y: number;
  text: string;
  life: number;
  duration: number;
  kind: "score" | "combo" | "status" | "powerupReward" | "powerupHazard" | "powerupVolatile";
}

export interface LaserBeam {
  x: number;
  life: number;
}

export interface PaddleHitDebug extends PaddleRebound {
  hitZone: number;
  paddleVelocityX: number;
}

export interface LoopCorrectionDebug extends LoopRiskVelocity {
  source: "wall" | "brick";
  axis: "x" | "y";
  beforeVx: number;
  beforeVy: number;
}

export type GamePhase = "loading" | "ready" | "playing" | "levelComplete" | "gameOver";

export type BoardContext =
  | { source: "pack"; packId: string; boardIndex: number; dailyDateKey?: string }
  | { source: "generated"; packId: null; boardIndex: 0 };

export interface BoardTheme {
  scene: string;
  floor: string;
  wall: string;
  wallGlow: string;
  rim: string;
}

export interface RunStats {
  runStartedAt: number;
  levelStartedAt: number;
  scoreAtRunStart: number;
  bestScoreAtRunStart: number;
  bricksBroken: number;
  longestCombo: number;
  powerupsCaught: number;
  boardsCleared: number;
}

export interface SummaryStat {
  label: string;
  value: string;
  tone?: "reward" | "neutral" | "warning";
}

export interface SummaryAction {
  label: string;
  action: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface BrickVisualProfile {
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

export interface BallVisual {
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

export interface LevelLayout {
  columns: number;
  rows: number;
  brickWidth: number;
  brickHeight: number;
}
