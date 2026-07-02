import { clamp } from "../../shared/util";
import { clampPaddleCenterX } from "./gameArena";
import type { Ball, Brick, Powerup } from "./gameEntityTypes";
import { MAX_BALL_SPEED, PADDLE_Y, WALL, WIDTH } from "./gameArena";
import { powerupToneFor } from "./powerups";
import { MIN_BALL_SPEED, PADDLE_ACCELERATION, PADDLE_EDGE_INFLUENCE } from "./tuning";

const BALL_DANGER_SECONDS = 0.55;
const AIM_LOOKAHEAD_SECONDS = 1.4;
const MIN_USEFUL_HIT_ZONE = 0.22;
const MAX_AUTO_HIT_ZONE = 0.88;

export type AutoPaddleTarget =
  | { kind: "idle"; x: number }
  | { kind: "powerup"; x: number; powerup: Powerup }
  | { kind: "ball"; x: number; ball: Ball; hitZone: number; targetBrick: Brick | null };

export interface AutoPaddleInput {
  balls: readonly Ball[];
  bricks: readonly Brick[];
  powerups: readonly Powerup[];
  paddleX: number;
  paddleWidth: number;
}

interface BrickAim {
  brick: Brick;
  hitZone: number;
  score: number;
}

export function chooseAutoPaddleTarget(input: AutoPaddleInput): AutoPaddleTarget {
  const ball = selectBall(input.balls);
  if (ball && timeToPaddle(ball) <= BALL_DANGER_SECONDS) return ballTarget(input, ball);

  const powerup = selectPowerup(input);
  if (powerup) return { kind: "powerup", x: clampPaddleCenterX(powerup.x, input.paddleWidth), powerup };

  if (ball) return ballTarget(input, ball);
  return { kind: "idle", x: input.paddleX };
}

function selectBall(balls: readonly Ball[]): Ball | null {
  return balls
    .filter((ball) => !ball.stuck)
    .sort((a, b) => {
      const aFalling = a.vy > 0 ? 1 : 0;
      const bFalling = b.vy > 0 ? 1 : 0;
      if (aFalling !== bFalling) return bFalling - aFalling;
      return b.y - a.y;
    })[0] ?? null;
}

function selectPowerup(input: AutoPaddleInput): Powerup | null {
  return input.powerups
    .filter((powerup) => powerup.y <= PADDLE_Y + 24 && powerupToneFor(powerup.kind) !== "hazard")
    .sort((a, b) => {
      const toneRank = (powerup: Powerup) => (powerupToneFor(powerup.kind) === "reward" ? 0 : 1);
      return toneRank(a) - toneRank(b) || b.y - a.y || Math.abs(a.x - input.paddleX) - Math.abs(b.x - input.paddleX);
    })[0] ?? null;
}

function ballTarget(input: AutoPaddleInput, ball: Ball): AutoPaddleTarget {
  const interceptX = ball.vy > 0 ? projectBallXAtPaddle(ball) : ball.x;
  const aim = chooseBrickAim(input.bricks, ball, interceptX);
  const hitZone = aim?.hitZone ?? 0;
  const paddleCenterX = interceptX - hitZone * (input.paddleWidth / 2);
  return { kind: "ball", x: clampPaddleCenterX(paddleCenterX, input.paddleWidth), ball, hitZone, targetBrick: aim?.brick ?? null };
}

function chooseBrickAim(bricks: readonly Brick[], ball: Ball, interceptX: number): BrickAim | null {
  const speed = clamp(Math.hypot(ball.vx, ball.vy) * PADDLE_ACCELERATION, MIN_BALL_SPEED, MAX_BALL_SPEED);
  const verticalSpeed = speed * 0.82;
  const originY = PADDLE_Y - 10 - ball.radius;
  let best: BrickAim | null = null;

  for (const brick of bricks) {
    const targetX = brick.x + brick.width / 2;
    const targetY = brick.y + brick.height / 2;
    const verticalDistance = Math.max(80, originY - targetY);
    const timeToTarget = verticalDistance / verticalSpeed;
    const desiredVx = (targetX - interceptX) / timeToTarget;
    const rawHitZone = desiredVx / (speed * PADDLE_EDGE_INFLUENCE);
    const hitZone = usefulHitZone(rawHitZone, targetX - interceptX);
    const absRaw = Math.abs(rawHitZone);
    const angleReward = Math.abs(hitZone) >= MIN_USEFUL_HIT_ZONE ? 90 : 0;
    const unreachablePenalty = absRaw > MAX_AUTO_HIT_ZONE ? (absRaw - MAX_AUTO_HIT_ZONE) * 160 : 0;
    const score = brick.y * 2 + angleReward - Math.abs(targetX - interceptX) * 0.18 - unreachablePenalty;
    if (!best || score > best.score) best = { brick, hitZone, score };
  }

  return best;
}

function usefulHitZone(rawHitZone: number, fallbackDirection: number): number {
  let hitZone = clamp(rawHitZone, -MAX_AUTO_HIT_ZONE, MAX_AUTO_HIT_ZONE);
  if (Math.abs(hitZone) > 0 && Math.abs(hitZone) < MIN_USEFUL_HIT_ZONE) hitZone = Math.sign(hitZone) * MIN_USEFUL_HIT_ZONE;
  if (hitZone === 0 && fallbackDirection !== 0) hitZone = Math.sign(fallbackDirection) * MIN_USEFUL_HIT_ZONE;
  return hitZone;
}

function timeToPaddle(ball: Ball): number {
  if (ball.stuck || ball.vy <= 0) return Number.POSITIVE_INFINITY;
  return clamp((PADDLE_Y - ball.y) / ball.vy, 0, AIM_LOOKAHEAD_SECONDS);
}

function projectBallXAtPaddle(ball: Ball): number {
  const time = timeToPaddle(ball);
  const minBallX = WALL + ball.radius;
  const maxBallX = WIDTH - WALL - ball.radius;
  return reflectBetween(ball.x + ball.vx * time, minBallX, maxBallX);
}

function reflectBetween(value: number, min: number, max: number): number {
  const range = max - min;
  if (range <= 0) return min;
  const period = range * 2;
  const offset = ((value - min) % period + period) % period;
  return offset <= range ? min + offset : max - (offset - range);
}
