import { describe, expect, it } from "vitest";
import {
  calculatePaddleRebound,
  computeStuckBallLaunch,
  detectBrickContact,
  detectPaddleContact,
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

  it("detects paddle edge hits when only the ball radius overlaps", () => {
    const contact = detectPaddleContact({
      ballX: 421,
      ballY: 582,
      ballRadius: 10,
      ballVy: 500,
      paddleCenterX: 480,
      paddleWidth: 116,
      paddleY: 588,
      topTolerance: 8,
      bottomTolerance: 12
    });

    expect(contact).not.toBeNull();
    expect(contact?.hitZone).toBe(-1);
  });

  it("ignores near-edge paddle misses outside the ball radius", () => {
    const contact = detectPaddleContact({
      ballX: 411.9,
      ballY: 582,
      ballRadius: 10,
      ballVy: 500,
      paddleCenterX: 480,
      paddleWidth: 116,
      paddleY: 588,
      topTolerance: 8,
      bottomTolerance: 12
    });

    expect(contact).toBeNull();
  });

  it("detects fast brick hits even when the ball tunnels past the brick in one frame", () => {
    const contact = detectBrickContact({
      previousX: 150,
      previousY: 95,
      ballX: 150,
      ballY: 135,
      ballRadius: 5,
      brickX: 120,
      brickY: 104,
      brickWidth: 60,
      brickHeight: 20
    });

    expect(contact).not.toBeNull();
    expect(contact?.axis).toBe("y");
    expect(contact?.travelT).toBeGreaterThan(0);
    expect(contact?.travelT).toBeLessThan(1);
  });

  it("uses the swept entry side for brick direction instead of late overlap depth", () => {
    const contact = detectBrickContact({
      previousX: 90,
      previousY: 110,
      ballX: 150,
      ballY: 122,
      ballRadius: 5,
      brickX: 120,
      brickY: 104,
      brickWidth: 60,
      brickHeight: 20
    });

    expect(contact).not.toBeNull();
    expect(contact?.axis).toBe("x");
  });
});
