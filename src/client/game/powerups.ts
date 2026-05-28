import { clamp } from "../../shared/util";

export type PowerupKind =
  | "expandPaddle"
  | "shrinkPaddle"
  | "superShrink"
  | "splitBall"
  | "eightBall"
  | "megaBall"
  | "slowBall"
  | "fastBall"
  | "shrinkBall"
  | "fireball"
  | "thruBrick"
  | "shootingPaddle"
  | "grabPaddle"
  | "extraLife"
  | "levelWarp"
  | "zapBricks"
  | "setOffExploding"
  | "expandExploding"
  | "fallingBricks"
  | "killPaddle";

export type PowerupTone = "reward" | "hazard" | "volatile";

export interface PowerupPoolInput {
  level: number;
  clearedLevels: number;
  combo: number;
}

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
const VOLATILE_REWARD_POWERUPS: PowerupKind[] = ["eightBall", "levelWarp", "setOffExploding", "expandExploding"];
const MILD_HAZARD_POWERUPS: PowerupKind[] = ["shrinkPaddle", "fastBall", "shrinkBall"];
const HARD_HAZARD_POWERUPS: PowerupKind[] = ["superShrink", "fallingBricks", "killPaddle"];
const NEGATIVE_POWERUPS: PowerupKind[] = [...MILD_HAZARD_POWERUPS, ...HARD_HAZARD_POWERUPS];
const VOLATILE_POWERUPS = new Set<PowerupKind>(VOLATILE_REWARD_POWERUPS);

function powerupPressure(input: PowerupPoolInput): number {
  return clamp((input.level + input.clearedLevels - 1) / 10, 0, 1);
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
