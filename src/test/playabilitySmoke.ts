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
  powerups: Array<{ x: number; y: number; kind: string; tone: "reward" | "hazard" | "volatile"; label: string }>;
  paddleX: number;
  paddleWidth: number;
  paddleVelocityX: number;
  lastPaddleHit: { hitZone: number; paddleVelocityX: number; vx: number; vy: number; speed: number } | null;
  hasSave: boolean;
  boardSource: "pack" | "generated";
  currentPackId: string | null;
  packBoardIndex: number;
  boardTheme: {
    scene: string;
    floor: string;
    wall: string;
    wallGlow: string;
    rim: string;
  };
  designerIntent: {
    style: string;
    difficulty: number;
    density: number;
    specialBias: number;
    seed: string;
  };
  currentBoardVote: "up" | "down" | null;
  generationSummary?: {
    title: string;
    detail: string;
  };
  settings: {
    ballSpeed: number;
    particles: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
    sfx: boolean;
    music: boolean;
  };
  powerupPrimerDismissed: boolean;
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
  await page.waitForFunction(() => {
    const mark = document.querySelector<HTMLImageElement>(".brand-mark");
    return mark && mark.complete && mark.naturalWidth > 0;
  });

  const ready = await snapshot(page);
  assert(ready.phase === "ready", `Expected ready phase, got ${ready.phase}.`);
  assert(ready.bricks >= 34, `Expected a playable board, got ${ready.bricks} bricks.`);
  assert(ready.balls.length === 1 && ready.balls[0]?.stuck, "Expected one stuck launch ball.");
  assert(ready.boardSource === "pack", `Expected first board to come from a curated pack, got ${ready.boardSource}.`);
  assert(ready.currentPackId === "starter", `Expected Starter pack on boot, got ${ready.currentPackId}.`);
  assert(ready.boardTheme.wallGlow === "#4ecdc4", `Expected Starter board theme, got ${ready.boardTheme.wallGlow}.`);
  assert((await page.locator('link[rel="icon"][href="/assets/ricochet-rush-icon.svg"]').count()) === 1, "Expected branded favicon asset.");
  assert(await page.locator(".play-console").count() === 1, "Expected a compact play console.");
  assert((await page.locator(".brand-mark").count()) === 1, "Expected the original brand mark in the Play Console.");
  assert(await page.locator("[data-powerup-primer]").isVisible(), "Expected first-run power-up primer to be visible.");
  const primerText = await page.locator("[data-powerup-primer]").innerText();
  assert(primerText.includes("Green helps") && primerText.includes("Red hurts") && primerText.includes("Gold is chaos"), "Expected primer to explain power-up color tones.");
  assert(await page.locator(".play-console .designer-panel, .play-console .pack-browser, .play-console .settings, .play-console .agent-trace").count() === 0, "Expected heavy tools outside the play console.");
  assert(await page.locator("[data-tool-surface]").isHidden(), "Expected tool panels to be closed by default.");
  assert(await page.locator('[data-action="save-board"]').isDisabled(), "Expected Keep board to be disabled for authored boards.");
  assert(await hasFocusedOverlayAction(page), "Expected ready overlay to focus its primary action.");
  await page.locator('[data-action="dismiss-powerup-primer"]').click();
  assert((await snapshot(page)).powerupPrimerDismissed, "Expected power-up primer dismissal in debug state.");
  assert(await hasLocalStorageKey(page, "ricochet-rush-powerup-primer-dismissed"), "Expected power-up primer dismissal to persist.");
  assert(await page.locator("[data-powerup-primer]").isHidden(), "Expected dismissed power-up primer to hide.");
  assert(await canvasHasVisiblePixels(page), "Expected the WebGL canvas to render nonblank gameplay pixels.");
  assert(!(await stageOverlapsPlayConsole(page)), "Expected desktop playfield and Play Console not to overlap.");
  await page.locator('[data-tool-panel="packs"]').click();
  assert(await page.locator("[data-tool-surface]").isVisible(), "Expected Board Select panel to open.");
  assert((await page.locator("[data-tool-title]").innerText()) === "Board Select", "Expected Board Select title.");
  assert(await page.locator('[data-pack-id="starter"].is-active').count() === 1, "Expected Starter pack card to be active.");
  assert(await page.locator('[data-pack-id="saved-designs"]').isDisabled(), "Expected empty Saved Designs pack to be disabled.");
  await page.locator('[data-tool-panel="designer"]').click();
  assert((await page.locator("[data-tool-title]").innerText()) === "Board Designer", "Expected Board Designer title.");
  assert(await page.locator(".designer-panel").isVisible(), "Expected Board Designer controls in a focused panel.");
  const agentPipelineText = await page.locator("[data-agent-pipeline]").innerText();
  assert(agentPipelineText.includes("Intent → composer-2 → validation → playable wall"), "Expected Board Designer to explain the Cursor SDK agent pipeline.");
  assert(agentPipelineText.includes("server-side") && agentPipelineText.includes("fallback"), "Expected agent pipeline to explain credential safety and fallback behavior.");
  assert((await page.locator("[data-designer-targets]").innerText()).includes("66 bricks"), "Expected visible designer target counts.");
  const canvasLabel = await page.locator('[data-testid="ricochet-rush-canvas"]').getAttribute("aria-label");
  assert(canvasLabel?.includes("Level 1") === true, "Expected canvas to expose current game state.");

  await page.selectOption('[data-designer="style"]', "bomb-chains");
  await page.locator('[data-designer="seed"]').fill("smoke sparks");
  assert(await hasLocalStorageKey(page, "ricochet-rush-designer-intent"), "Expected designer intent to persist.");
  await page.locator('[data-action="new-board"]').click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready" && window.__ricochetRushGame?.debugSnapshot().boardSource === "generated");
  const designed = await snapshot(page);
  assert(designed.designerIntent.style === "bomb-chains", `Expected designer style to apply, got ${designed.designerIntent.style}.`);
  assert(designed.boardTheme.wallGlow === "#7ef1ff", `Expected generated board theme, got ${designed.boardTheme.wallGlow}.`);
  assert(designed.generationSummary?.title === "Local fallback board", "Expected public generation summary for forced fallback.");
  assert(await page.locator("[data-generation-summary]").isVisible(), "Expected visible public generation summary.");
  assert(await page.locator("[data-compact-generation-summary]").isVisible(), "Expected compact generated-board summary in the play console.");
  assert(await page.locator('[data-action="save-board"]').isEnabled(), "Expected generated boards to be keepable.");
  await page.locator('[data-action="rate-up"]').click();
  assert((await snapshot(page)).currentBoardVote === "up", "Expected generated board feedback to be captured.");
  assert(await hasLocalStorageKey(page, "ricochet-rush-designer-feedback"), "Expected designer feedback to persist.");
  await page.locator('[data-action="save-board"]').click();
  assert(await hasLocalStorageKey(page, "ricochet-rush-saved-boards"), "Expected kept generated board to persist in Saved Designs.");
  assert(!(await page.locator('[data-pack-id="saved-designs"]').isDisabled()), "Expected Saved Designs to unlock after keeping a board.");
  await page.locator('[data-tool-panel="packs"]').click();
  assert((await page.locator("[data-tool-title]").innerText()) === "Board Select", "Expected Board Select title after switching tools.");
  await page.locator('[data-pack-id="starter"]').click();
  await page.waitForFunction(() => {
    const snapshot = window.__ricochetRushGame?.debugSnapshot();
    return snapshot?.phase === "ready" && snapshot.boardSource === "pack" && snapshot.currentPackId === "starter";
  });
  const selectedStarter = await snapshot(page);
  assert(selectedStarter.packBoardIndex === 0, `Expected Starter to restart at board 1, got board index ${selectedStarter.packBoardIndex}.`);
  assert(await page.locator("[data-tool-surface]").isHidden(), "Expected Board Select to close after choosing a pack.");
  assert((await page.locator("[data-level-name]").innerText()) === "Starter Gates", "Expected Starter Gates after selecting Starter.");
  assert(await page.locator("[data-compact-generation-summary]").isHidden(), "Expected generated-board summary to clear after selecting Starter.");
  assert(await page.locator('[data-action="save-board"]').isDisabled(), "Expected authored boards not to be keepable.");

  await page.locator("[data-overlay-action]").click();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(180);
  await page.keyboard.up("ArrowRight");

  const playing = await snapshot(page);
  assert(playing.phase === "playing", `Expected playing phase after launch, got ${playing.phase}.`);
  assert(playing.balls.some((ball) => !ball.stuck && ball.vy < 0), "Expected launched ball moving upward.");
  assert(playing.balls.some((ball) => !ball.stuck && Math.abs(ball.vx) > 70), "Expected launched ball to avoid near-vertical loops.");
  assert(playing.paddleX > ready.paddleX, "Expected keyboard movement to move the paddle right.");
  assert(playing.paddleVelocityX > 0, "Expected debug state to expose rightward paddle velocity.");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const pauseText = await page.locator(".overlay-card").innerText();
  assert(pauseText.includes("Paused"), "Expected Escape to pause into an overlay.");
  assert(await hasFocusedOverlayAction(page), "Expected pause overlay to focus its primary action.");
  await injectPowerupClarityState(page);
  const powerupClarity = await snapshot(page);
  assert(powerupClarity.powerups.map((powerup) => powerup.tone).join(",") === "reward,hazard,volatile", "Expected reward, hazard, and volatile power-up tones.");
  assert((await page.locator(".floating-text.is-powerupReward").count()) === 1, "Expected reward pickup label.");
  assert((await page.locator(".floating-text.is-powerupHazard").count()) === 1, "Expected hazard pickup label.");
  assert((await page.locator(".floating-text.is-powerupVolatile").count()) === 1, "Expected volatile pickup label.");
  assert((await page.locator(".power-timer.is-reward").count()) >= 2, "Expected active power timers to use reward tone styling.");

  await page.locator('[data-action="save"]').click();
  const saved = await snapshot(page);
  assert(saved.hasSave, "Expected save action to mark a checkpoint.");
  assert(await hasLocalStorageKey(page, "ricochet-rush-save"), "Expected checkpoint in localStorage.");

  await page.locator('[data-tool-panel="options"]').click();
  assert((await page.locator("[data-tool-title]").innerText()) === "Options", "Expected Options panel title.");
  await page.locator('[data-setting="high-contrast"]').check();
  await page.locator('[data-setting="reduced-motion"]').check();
  await page.locator('[data-setting="sfx"]').check();
  await page.locator('[data-setting="music"]').check();
  await page.locator('[data-setting="particles"]').uncheck();
  await page.locator('[data-setting="ball-speed"]').fill("1.15");
  const tuned = await snapshot(page);
  assert(tuned.settings.highContrast, "Expected high contrast setting to apply.");
  assert(tuned.settings.reducedMotion, "Expected reduced motion setting to apply.");
  assert(tuned.settings.sfx, "Expected SFX setting to apply.");
  assert(tuned.settings.music, "Expected music setting to apply.");
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
  assert(restoredSettings.settings.sfx, "Expected SFX setting to persist after reload.");
  assert(restoredSettings.settings.music, "Expected music setting to persist after reload.");
  assert(!restoredSettings.settings.particles, "Expected particles setting to persist after reload.");
  assert(restoredSettings.powerupPrimerDismissed, "Expected dismissed power-up primer to persist after reload.");
  assert(await page.locator("[data-powerup-primer]").isHidden(), "Expected dismissed power-up primer to stay hidden after reload.");

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
  assert(await canvasHasVisiblePixels(page), "Expected mobile viewport to keep rendering the game canvas.");
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

async function canvasHasVisiblePixels(page: { evaluate: <T>(callback: () => T) => Promise<T> }): Promise<boolean> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="ricochet-rush-canvas"]');
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    const probe = document.createElement("canvas");
    probe.width = 64;
    probe.height = 64;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    let litPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 36) litPixels += 1;
    }
    return litPixels > 300;
  });
}

async function stageOverlapsPlayConsole(page: { evaluate: <T>(callback: () => T) => Promise<T> }): Promise<boolean> {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage")?.getBoundingClientRect();
    const consolePanel = document.querySelector<HTMLElement>(".play-console")?.getBoundingClientRect();
    if (!stage || !consolePanel) return true;
    return stage.right > consolePanel.left && consolePanel.right > stage.left && stage.bottom > consolePanel.top && consolePanel.bottom > stage.top;
  });
}

async function injectPowerupClarityState(page: { evaluate: <T>(callback: () => T) => Promise<T> }): Promise<void> {
  await page.evaluate(() => {
    if (!window.__ricochetRushGame) throw new Error("Ricochet Rush game is not mounted.");
    window.__ricochetRushGame.debugStageVisualSmokeState();
  });
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
