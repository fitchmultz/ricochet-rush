import { once } from "node:events";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createApiServer } from "../server/api";

process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";

interface DebugSnapshot {
  phase: string;
  score: number;
  bestScore: number;
  lives: number;
  level: number;
  bricks: number;
  balls: Array<{ x: number; y: number; vx: number; vy: number; stuck: boolean }>;
  paddleX: number;
  paddleWidth: number;
  hasSave: boolean;
  settings: {
    ballSpeed: number;
    particles: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
    sound: boolean;
  };
  recentEvents: string[];
  announcement: string;
}

const server = createApiServer({ staticDir: resolve("dist") });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Preview server did not expose a TCP port.");

const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForSelector('[data-action="save"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");

  const ready = await snapshot(page);
  assert(ready.phase === "ready", `Expected ready phase, got ${ready.phase}.`);
  assert(ready.bricks >= 34, `Expected a playable board, got ${ready.bricks} bricks.`);
  assert(ready.balls.length === 1 && ready.balls[0]?.stuck, "Expected one stuck launch ball.");
  assert(await hasFocusedOverlayAction(page), "Expected ready overlay to focus its primary action.");
  const canvasLabel = await page.locator('[data-testid="ricochet-rush-canvas"]').getAttribute("aria-label");
  assert(canvasLabel?.includes("Level 1") === true, "Expected canvas to expose current game state.");

  await page.locator("[data-overlay-action]").click();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(180);
  await page.keyboard.up("ArrowRight");

  const playing = await snapshot(page);
  assert(playing.phase === "playing", `Expected playing phase after launch, got ${playing.phase}.`);
  assert(playing.balls.some((ball) => !ball.stuck && ball.vy < 0), "Expected launched ball moving upward.");
  assert(playing.paddleX > ready.paddleX, "Expected keyboard movement to move the paddle right.");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const pauseText = await page.locator(".overlay-card").innerText();
  assert(pauseText.includes("Paused"), "Expected Escape to pause into an overlay.");
  assert(await hasFocusedOverlayAction(page), "Expected pause overlay to focus its primary action.");

  await page.locator('[data-action="save"]').click();
  const saved = await snapshot(page);
  assert(saved.hasSave, "Expected save action to mark a checkpoint.");
  assert(await hasLocalStorageKey(page, "ricochet-rush-save"), "Expected checkpoint in localStorage.");

  await page.locator('[data-setting="high-contrast"]').check();
  await page.locator('[data-setting="reduced-motion"]').check();
  await page.locator('[data-setting="sound"]').check();
  await page.locator('[data-setting="particles"]').uncheck();
  await page.locator('[data-setting="ball-speed"]').fill("1.15");
  const tuned = await snapshot(page);
  assert(tuned.settings.highContrast, "Expected high contrast setting to apply.");
  assert(tuned.settings.reducedMotion, "Expected reduced motion setting to apply.");
  assert(tuned.settings.sound, "Expected sound setting to apply.");
  assert(!tuned.settings.particles, "Expected particles setting to apply.");
  assert(tuned.settings.ballSpeed === 1.15, `Expected ball speed 1.15, got ${tuned.settings.ballSpeed}.`);
  assert(await page.locator(".shell.is-high-contrast.is-reduced-motion").count() === 1, "Expected visual settings classes to apply.");
  assert((await page.locator("[data-live-announcement]").textContent()) === tuned.announcement, "Expected live region to mirror game announcements.");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const restoredSettings = await snapshot(page);
  assert(restoredSettings.settings.highContrast, "Expected high contrast setting to persist after reload.");
  assert(restoredSettings.settings.reducedMotion, "Expected reduced motion setting to persist after reload.");
  assert(restoredSettings.settings.sound, "Expected sound setting to persist after reload.");
  assert(!restoredSettings.settings.particles, "Expected particles setting to persist after reload.");

  await page.locator('[data-action="clear-save"], [data-action="reset"]').click();
  const confirmText = await page.locator(".overlay-card").innerText();
  assert(confirmText.includes("Clear Saved Run?"), "Expected clear-save confirmation dialog.");
  await page.locator("[data-overlay-secondary]").click();
  await page.waitForFunction(() => document.querySelector(".overlay-card") === null);
  assert(await hasLocalStorageKey(page, "ricochet-rush-save"), "Expected cancel to preserve checkpoint.");

  await page.locator('[data-action="reset"]').click();
  await page.locator("[data-overlay-action]").click();
  assert(!(await hasLocalStorageKey(page, "ricochet-rush-save")), "Expected confirmed clear-save to remove checkpoint.");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert(!overflow, "Expected desktop layout without horizontal overflow.");

  await page.setViewportSize({ width: 390, height: 760 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert(!mobileOverflow, "Expected narrow layout without horizontal overflow.");
} finally {
  await browser.close();
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

async function snapshot(page: { evaluate: <T>(callback: () => T) => Promise<T> }): Promise<DebugSnapshot> {
  return page.evaluate(() => {
    const game = window.__ricochetRushGame;
    if (!game) throw new Error("Missing Ricochet Rush debug surface.");
    return game.debugSnapshot();
  });
}

async function hasLocalStorageKey(page: { evaluate: <T>(callback: (key: string) => T, key: string) => Promise<T> }, key: string): Promise<boolean> {
  return page.evaluate((storageKey) => localStorage.getItem(storageKey) !== null, key);
}

async function hasFocusedOverlayAction(page: { evaluate: <T>(callback: () => T) => Promise<T> }): Promise<boolean> {
  return page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute("data-overlay-action"));
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
