import { describe, expect, it } from "vitest";
import {
  calculatePaddleRebound,
  computeStuckBallLaunch,
  normalizeLoopRiskVelocity
} from "../client/game/physics";
import { LAUNCH_LOSS_GRACE_SECONDS } from "../client/game/tuning";

describe("Ricochet Rush launch fairness", () => {
  it("keeps centered launches readable instead of hard-biasing to a side lane", () => {
    const launch = computeStuckBallLaunch({
      stuckOffset: 0,
      paddleWidth: 116,
      paddleVelocityX: 0,
      storedVx: 210,
      speedMultiplier: 1
    });

    expect(Math.abs(launch.vx)).toBeLessThan(launch.speed * 0.22);
    expect(launch.vy).toBeLessThan(0);
    expect(Math.abs(launch.vx)).toBeGreaterThanOrEqual(launch.speed * 0.18 - 0.001);
  });

  it("applies paddle spin to centered launches", () => {
    const left = computeStuckBallLaunch({
      stuckOffset: 0,
      paddleWidth: 116,
      paddleVelocityX: -620,
      storedVx: 210,
      speedMultiplier: 1
    });
    const right = computeStuckBallLaunch({
      stuckOffset: 0,
      paddleWidth: 116,
      paddleVelocityX: 620,
      storedVx: 210,
      speedMultiplier: 1
    });

    expect(left.vx).toBeLessThan(0);
    expect(right.vx).toBeGreaterThan(0);
    expect(left.vy).toBeLessThan(0);
    expect(right.vy).toBeLessThan(0);
  });

  it("still respects aimed offset launches away from center", () => {
    const launch = computeStuckBallLaunch({
      stuckOffset: 40,
      paddleWidth: 116,
      paddleVelocityX: 0,
      storedVx: 210,
      speedMultiplier: 1
    });

    expect(Math.abs(launch.vx)).toBeGreaterThan(launch.speed * 0.22);
    expect(launch.vy).toBeLessThan(0);
  });

  it("exposes a minimum post-launch survival window before life loss", () => {
    expect(LAUNCH_LOSS_GRACE_SECONDS).toBeGreaterThanOrEqual(2);
  });
});

describe("Ricochet Rush paddle feel", () => {
  it("keeps center paddle hits from becoming vertical dead loops", () => {
    const rebound = calculatePaddleRebound({
      hitZone: 0,
      paddleVelocityX: 0,
      incomingVx: 0,
      incomingVy: 480
    });

    expect(Math.abs(rebound.vx)).toBeGreaterThanOrEqual(rebound.speed * 0.18 - 0.001);
    expect(rebound.vy).toBeLessThan(0);
  });

  it("normalizes shallow wall rebounds away from horizontal traps", () => {
    const corrected = normalizeLoopRiskVelocity({
      vx: 200,
      vy: 12,
      minYRatio: 0.16,
      fallbackYSign: -1
    });

    expect(corrected.changed).toBe(true);
    expect(Math.abs(corrected.vy)).toBeGreaterThanOrEqual(corrected.speed * 0.16 - 0.001);
  });
});
