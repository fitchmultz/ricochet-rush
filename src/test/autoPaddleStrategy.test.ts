import { describe, expect, it } from "vitest";
import { chooseAutoPaddleTarget } from "../client/game/autoPaddleStrategy";
import { PADDLE_Y } from "../client/game/gameArena";
import type { Ball, Brick, Powerup } from "../client/game/gameEntityTypes";

const baseBall: Ball = {
  x: 480,
  y: 240,
  vx: 80,
  vy: -420,
  radius: 8,
  stuck: false,
  stuckOffset: 0,
  fireTimer: 0,
  thruTimer: 0,
  megaTimer: 0
};

const baseBrick: Brick = {
  x: 680,
  y: 260,
  width: 60,
  height: 28,
  kind: "basic",
  hp: 1,
  maxHp: 1
};

function choose(overrides: Partial<Parameters<typeof chooseAutoPaddleTarget>[0]> = {}) {
  return chooseAutoPaddleTarget({
    balls: [baseBall],
    bricks: [baseBrick],
    powerups: [],
    paddleX: 480,
    paddleWidth: 116,
    ...overrides
  });
}

describe("chooseAutoPaddleTarget", () => {
  it("chases helpful power-ups while the ball is not an immediate threat", () => {
    const powerup: Powerup = { x: 320, y: 360, vy: 90, kind: "expandPaddle" };
    expect(choose({ powerups: [powerup] })).toMatchObject({ kind: "powerup", x: 320 });
  });

  it("ignores hazardous power-ups", () => {
    const hazard: Powerup = { x: 320, y: 520, vy: 90, kind: "killPaddle" };
    expect(choose({ powerups: [hazard] }).kind).toBe("ball");
  });

  it("prioritizes an imminent falling ball over a power-up", () => {
    const imminentBall = { ...baseBall, y: PADDLE_Y - 80, vy: 420 };
    const powerup: Powerup = { x: 320, y: 520, vy: 90, kind: "expandPaddle" };
    expect(choose({ balls: [imminentBall], powerups: [powerup] }).kind).toBe("ball");
  });

  it("offsets paddle contact to aim at remaining bricks instead of always centering the hit", () => {
    const fallingBall = { ...baseBall, x: 480, y: PADDLE_Y - 120, vx: 0, vy: 420 };
    const target = choose({ balls: [fallingBall], bricks: [{ ...baseBrick, x: 700 }] });
    expect(target.kind).toBe("ball");
    if (target.kind !== "ball") return;
    expect(target.hitZone).toBeGreaterThan(0.2);
    expect(target.x).toBeLessThan(fallingBall.x);
  });
});
