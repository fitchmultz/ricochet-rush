import * as THREE from "three";
import type { LevelBlueprint } from "../../shared/evolution";
import { BRICK_COLUMNS, levelGridDimensions } from "../../shared/evolution";
import type { SavedBrick } from "../../shared/saveState";
import { clamp } from "../../shared/util";
import type { Ball, Brick, LevelLayout } from "./gameEntityTypes";

export const WIDTH = 960;
export const HEIGHT = 640;
export const WALL = 18;
export const BRICK_GAP = 5;
export const BRICK_TOP = 72;
export const BRICK_HEIGHT = 28;
export const PADDLE_Y = HEIGHT - 52;
export const PADDLE_SPEED = 620;
export const MAX_PADDLE_VELOCITY = 920;
export const MAX_BALL_SPEED = 860;
export const MIN_COLLISION_X_RATIO = 0.16;
export const MIN_COLLISION_Y_RATIO = 0.16;

export function brickWidthForColumns(columns: number): number {
  return (WIDTH - WALL * 2 - BRICK_GAP * (columns - 1)) / columns;
}

export const BRICK_WIDTH = brickWidthForColumns(BRICK_COLUMNS);

export function computeLevelLayout(level: LevelBlueprint): LevelLayout {
  const { columns, rows } = levelGridDimensions(level);
  const brickWidth = brickWidthForColumns(columns);
  const availableHeight = PADDLE_Y - BRICK_TOP - BRICK_GAP;
  const brickHeight = Math.min(BRICK_HEIGHT, Math.floor((availableHeight - BRICK_GAP * Math.max(0, rows - 1)) / Math.max(1, rows)));
  return { columns, rows, brickWidth, brickHeight };
}

export function circleRect(ball: Ball, brick: Brick): boolean {
  const nearestX = clamp(ball.x, brick.x, brick.x + brick.width);
  const nearestY = clamp(ball.y, brick.y, brick.y + brick.height);
  return (ball.x - nearestX) ** 2 + (ball.y - nearestY) ** 2 < ball.radius ** 2;
}

export function toWorld(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x - WIDTH / 2, HEIGHT / 2 - y, z);
}

export function materializeLevelBricks(level: LevelBlueprint, layout: LevelLayout): Brick[] {
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

export function bricksFitLevel(savedBricks: readonly SavedBrick[], level: LevelBlueprint): boolean {
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
