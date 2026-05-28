import type { BrickKind } from "../../shared/evolution";
import type { BoardTheme, BrickVisualProfile, FloatingText, SparkBurstOptions } from "./gameEntityTypes";
import type { PowerupKind, PowerupTone } from "./powerups";

export const POWERUP_ATLAS_COLUMNS = 5;
export const POWERUP_ATLAS_ROWS = 4;

export const POWER_DURATIONS: Record<string, number> = {
  Laser: 8,
  Grab: 12,
  Fire: 10,
  Thru: 10,
  Mega: 12
};

export const BOARD_THEMES: Record<string, BoardTheme> = {
  starter: { scene: "#050910", floor: "#07111d", wall: "#183a3d", wallGlow: "#4ecdc4", rim: "#7ef1ff" },
  classic: { scene: "#090b13", floor: "#0e1320", wall: "#222d48", wallGlow: "#8e7dff", rim: "#d6ff4d" },
  chaos: { scene: "#11080c", floor: "#180f15", wall: "#3a1621", wallGlow: "#ff5c7a", rim: "#ffe066" },
  precision: { scene: "#06100f", floor: "#081816", wall: "#173d38", wallGlow: "#b6fffa", rim: "#7bf1a8" },
  "boss-rush": { scene: "#120b06", floor: "#1b100a", wall: "#4a260d", wallGlow: "#ff9f43", rim: "#ff5c7a" },
  "saved-designs": { scene: "#080b14", floor: "#101521", wall: "#26314b", wallGlow: "#ffe066", rim: "#7ef1ff" },
  generated: { scene: "#070912", floor: "#0d1320", wall: "#142a44", wallGlow: "#7ef1ff", rim: "#ff4d8d" }
};

export const COLORS: Record<BrickKind, string> = {
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

export const BRICK_VISUALS: Record<BrickKind, BrickVisualProfile> = {
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

export const BALL_TRAIL_MIN_SPEED = 80;

export const DEFAULT_SPARK_BURST: SparkBurstOptions = {
  minSpeed: 60,
  maxSpeed: 220,
  minLife: 0.34,
  maxLife: 0.72,
  minSize: 3.4,
  maxSize: 5.8,
  gravity: 220,
  ring: false
};

export const BRICK_BURST_SCALE: Record<BrickKind, { chip: number; crumble: number; speed: number; size: number; ring: boolean }> = {
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

export const POWERUP_ORDER: PowerupKind[] = [
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

export const POWERUP_NAMES: Record<PowerupKind, string> = {
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

export const POWERUP_VISUALS: Record<PowerupTone, { tint: string; emissive: string; spark: string; floatingKind: FloatingText["kind"] }> = {
  reward: { tint: "#7bf1a8", emissive: "#28e68a", spark: "#7bf1a8", floatingKind: "powerupReward" },
  hazard: { tint: "#ff5c7a", emissive: "#ff244c", spark: "#ff5c7a", floatingKind: "powerupHazard" },
  volatile: { tint: "#ffe066", emissive: "#ff9f43", spark: "#ffe066", floatingKind: "powerupVolatile" }
};
