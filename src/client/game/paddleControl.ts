import { clamp } from "../../shared/util";
import { clampPaddleCenterX, MAX_PADDLE_VELOCITY, PADDLE_SPEED } from "./gameArena";

export interface PaddleMotionState {
  paddleX: number;
  paddleWidth: number;
  paddleVelocityX: number;
}

export function movePaddle(state: PaddleMotionState, nextX: number, elapsedSeconds: number, options: { snap?: boolean } = {}): PaddleMotionState {
  const previousX = state.paddleX;
  const paddleX = clampPaddleCenterX(nextX, state.paddleWidth);
  if (options.snap) {
    return { ...state, paddleX, paddleVelocityX: 0 };
  }
  const rawVelocity = elapsedSeconds > 0 ? (paddleX - previousX) / elapsedSeconds : 0;
  return {
    ...state,
    paddleX,
    paddleVelocityX: clamp(rawVelocity, -MAX_PADDLE_VELOCITY, MAX_PADDLE_VELOCITY)
  };
}

export function decayPaddleVelocity(paddleVelocityX: number, delta: number): number {
  const next = paddleVelocityX * Math.max(0, 1 - delta * 12);
  return Math.abs(next) < 1 ? 0 : next;
}

export function keyboardPaddleDirection(keys: ReadonlySet<string>): number {
  return Number(keys.has("ArrowRight") || keys.has("KeyD")) - Number(keys.has("ArrowLeft") || keys.has("KeyA"));
}

export function keyboardPaddleTargetX(state: PaddleMotionState, direction: number, delta: number): number {
  return state.paddleX + direction * PADDLE_SPEED * delta;
}
