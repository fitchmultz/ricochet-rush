import { clamp } from "../../shared/util";
import {
  LAUNCH_CENTER_OFFSET_THRESHOLD,
  LAUNCH_OFFSET_INFLUENCE,
  LAUNCH_SIDE_SPEED,
  LAUNCH_SPIN_INFLUENCE,
  LAUNCH_UPWARD_SPEED,
  MAX_BALL_SPEED,
  MAX_LAUNCH_SPEED,
  MAX_PADDLE_VELOCITY,
  MAX_REBOUND_X_RATIO,
  MIN_BALL_SPEED,
  MIN_REBOUND_X_RATIO,
  PADDLE_ACCELERATION,
  PADDLE_EDGE_INFLUENCE,
  PADDLE_SPIN_INFLUENCE
} from "./tuning";

export interface PaddleRebound {
  vx: number;
  vy: number;
  speed: number;
}

export interface PaddleReboundInput {
  hitZone: number;
  paddleVelocityX: number;
  incomingVx: number;
  incomingVy: number;
}

export interface LoopRiskVelocityInput {
  vx: number;
  vy: number;
  minXRatio?: number;
  minYRatio?: number;
  fallbackXSign?: number;
  fallbackYSign?: number;
}

export interface LoopRiskVelocity extends LoopRiskVelocityInput {
  speed: number;
  changed: boolean;
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

function upwardVelocity(speed: number, desiredVx: number, fallbackSign: number): PaddleRebound {
  const maxVx = speed * MAX_REBOUND_X_RATIO;
  const minVx = Math.min(speed * MIN_REBOUND_X_RATIO, maxVx);
  const sign = Math.sign(desiredVx) || Math.sign(fallbackSign) || 1;
  const vx = sign * clamp(Math.abs(desiredVx), minVx, maxVx);
  const vy = -Math.sqrt(Math.max(0, speed * speed - vx * vx));
  return { vx, vy, speed };
}
