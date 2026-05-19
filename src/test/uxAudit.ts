import { once } from "node:events";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { chromium, type ConsoleMessage, type Page } from "playwright";
import { LAUNCH_LOSS_GRACE_SECONDS } from "../client/game/RicochetRushGame";
import { createApiServer } from "../server/api";

process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";

const ARTIFACT_DIR = resolve("dist/playtest-report");
const SCREENSHOT_DIR = resolve(ARTIFACT_DIR, "screenshots");
const STATIC_DIR = resolve("dist");
const DESKTOP_VIEWPORT = { width: 1280, height: 820 };
const MOBILE_VIEWPORT = { width: 390, height: 760 };

interface DebugSnapshot {
  phase: "loading" | "ready" | "playing" | "levelComplete" | "gameOver";
  score: number;
  lives: number;
  level: number;
  bricks: number;
  balls: Array<{ x: number; y: number; vx: number; vy: number; stuck: boolean }>;
  paddleX: number;
  paddleVelocityX: number;
  boardSource: "pack" | "generated";
  currentPackId: string | null;
  designerIntent: {
    brief: string;
  };
  generationSummary?: {
    title: string;
    detail: string;
  };
}

interface ConsoleEntry {
  type: string;
  text: string;
  location: string;
}

interface CanvasMetrics {
  accentPixels: number;
  canvasPixels: number;
  colorBuckets: number;
  depthPixels: number;
  displayWidth: number;
  displayHeight: number;
  height: number;
  litPixels: number;
  lowerBandLitPixels: number;
  width: number;
}

interface LayoutIssue {
  selector: string;
  text: string;
  width: number;
  height: number;
  scrollWidth?: number;
  scrollHeight?: number;
  left?: number;
  right?: number;
}

interface CoverageMetrics {
  coverageRatio: number;
  items: Array<{ selector: string; area: number }>;
}

interface AuditCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

interface ScreenshotArtifact {
  label: string;
  path: string;
}

const checks: AuditCheck[] = [];
const screenshots: ScreenshotArtifact[] = [];
const consoleEntries: ConsoleEntry[] = [];
const pageErrors: string[] = [];

await rm(ARTIFACT_DIR, { recursive: true, force: true });
await mkdir(SCREENSHOT_DIR, { recursive: true });

const server = createApiServer({ staticDir: STATIC_DIR });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Preview server did not expose a TCP port.");

const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
  page.on("console", trackConsole);
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await runDesktopAudit(page);
  await runMobileAudit(page);
  recordConsoleHealth();
  await writeReport(baseUrl);

  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const reportPath = relative(process.cwd(), resolve(ARTIFACT_DIR, "report.md"));
  const jsonPath = relative(process.cwd(), resolve(ARTIFACT_DIR, "report.json"));
  console.log(`UX audit checks: ${checks.length - failures.length - warnings.length} passed, ${warnings.length} warnings, ${failures.length} failures.`);
  console.log(`UX audit report: ${reportPath}`);
  console.log(`UX audit JSON: ${jsonPath}`);

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL ${failure.name}: ${failure.detail}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

async function runDesktopAudit(page: Page) {
  await bootFresh(page, DESKTOP_VIEWPORT);
  await assertShellHealth(page, "desktop ready");
  await assertReadyState(page, "desktop ready");
  await assertCanvasClarity(page, "desktop ready");
  await assertLayoutHealth(page, "desktop ready", { failSmallTouchTargets: false });
  await assertDesktopStageSeparation(page);
  await capture(page, "desktop-ready");
  await assertToolDrawerOwnsFocus(page, "desktop ready");
  await bootFresh(page, DESKTOP_VIEWPORT);
  await assertShellHealth(page, "desktop launch prep");
  await assertReadyState(page, "desktop launch prep");
  await assertLaunchSurvivalWindow(page, "desktop center launch");

  const launchBefore = await snapshot(page);
  await page.locator("[data-overlay-action]").click();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(220);
  await page.keyboard.up("ArrowRight");
  await assertPlayingState(page, launchBefore, "desktop keyboard launch");
  await assertCanvasClarity(page, "desktop playing");
  await assertStageCoverage(page, "desktop playing");
  await capture(page, "desktop-playing");

  await page.evaluate(() => window.__ricochetRushGame?.debugStageVisualSmokeState());
  recordCheck(await page.locator("[data-combo]").isVisible(), "combo streak badge appears only when active", "Debug state exposes the live streak reward badge.");
  recordCheck((await page.locator(".impact-ring").count()) >= 1, "impact rings render for amplified feedback", "Debug state emits impact rings for combo and pickup bursts.");
  recordCheck((await page.locator(".floating-text.is-combo").count()) >= 1, "combo pop text renders", "Debug state emits boosted combo text.");
  await capture(page, "desktop-effects");

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  await assertFocusedOverlayAction(page, "desktop pause");

  await openToolPanel(page, "designer", "Board Designer");
  await assertLayoutHealth(page, "desktop designer panel", { failSmallTouchTargets: false });
  await capture(page, "desktop-designer");

  await page.locator('[data-designer="brief"]').fill("radial gold maze with side lanes");
  await page.locator('[data-action="new-board"]').click();
  await page.waitForFunction(() => {
    const state = window.__ricochetRushGame?.debugSnapshot();
    return state?.phase === "ready" && state.boardSource === "generated";
  });
  const generated = await snapshot(page);
  recordCheck(generated.designerIntent.brief === "radial gold maze with side lanes", "designer prompt applies", generated.designerIntent.brief);
  recordCheck(generated.generationSummary?.title === "Local backup board", "fallback generation is explained in tools", generated.generationSummary?.title ?? "missing summary");
  recordCheck(await page.locator("[data-generation-summary]").isVisible(), "full generation summary is visible", "Board Designer exposes the result summary.");
  recordCheck(await page.locator("[data-compact-generation-summary]").isHidden(), "generation diagnostics stay out of play rail", "Play Console remains player-facing after generation.");
  recordCheck(!(await page.locator(".console-status").innerText()).toLowerCase().includes("local backup"), "play rail hides fallback diagnostics", "Fallback details stay in tools/log surfaces.");
  recordCheck(await page.locator('[data-action="save-board"]').isEnabled(), "generated board can be kept", "Keep board is enabled after generation.");
  await assertCanvasClarity(page, "desktop generated board");
  await capture(page, "desktop-generated");

  await openToolPanel(page, "packs", "Board Select");
  recordCheck((await page.locator("[data-pack-id]").count()) >= 5, "board selector lists packs", "Expected at least the built-in pack set.");
  await assertLayoutHealth(page, "desktop board select", { failSmallTouchTargets: false });
  await capture(page, "desktop-boards");

  await openToolPanel(page, "options", "Options");
  recordCheck(await page.locator('[data-setting="high-contrast"]').isVisible(), "options expose visual settings", "High contrast control is visible.");
  await page.locator('[data-setting="high-contrast"]').check();
  await page.locator('[data-setting="reduced-motion"]').check();
  recordCheck((await page.locator(".shell.is-high-contrast.is-reduced-motion").count()) === 1, "visual settings apply immediately", "Shell classes reflect high contrast and reduced motion.");
  await assertLayoutHealth(page, "desktop options", { failSmallTouchTargets: false });
  await capture(page, "desktop-options");
}

async function runMobileAudit(page: Page) {
  await bootFresh(page, MOBILE_VIEWPORT);
  await assertShellHealth(page, "mobile ready");
  await assertReadyState(page, "mobile ready");
  await assertCanvasClarity(page, "mobile ready");
  await assertLayoutHealth(page, "mobile ready", { failSmallTouchTargets: true });
  await capture(page, "mobile-ready");

  await openToolPanel(page, "designer", "Board Designer");
  await assertLayoutHealth(page, "mobile designer panel", { failSmallTouchTargets: true });
  await capture(page, "mobile-designer");
  await page.locator('[data-action="close-tool-panel"]').click();
  await page.waitForFunction(() => document.querySelector("[data-tool-surface]")?.hasAttribute("hidden") === true);

  await page.locator("[data-overlay-action]").click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "playing");
  await assertStageInViewport(page, "mobile playing");
  const touchBefore = await snapshot(page);
  recordCheck(await page.locator(".touch-controls").isVisible(), "mobile touch controls visible during play", "Touch controls appear after the launch overlay closes.");
  const stageTouchAction = await page.locator(".stage").evaluate((element) => getComputedStyle(element).touchAction);
  recordCheck(stageTouchAction === "none", "mobile stage disables browser panning for drag aim", `touch-action: ${stageTouchAction}.`);
  await dragAimStage(page, 72, 520, 330, 520);
  const dragRight = await snapshot(page);
  recordCheck(dragRight.paddleX > touchBefore.paddleX + 50, "mobile drag-anywhere aims paddle", `Paddle x ${touchBefore.paddleX.toFixed(1)} -> ${dragRight.paddleX.toFixed(1)}.`);
  const scrollAfterDrag = await page.evaluate(() => window.scrollY);
  recordCheck(scrollAfterDrag === 0, "mobile drag aim does not scroll page", `scrollY ${scrollAfterDrag}.`);
  await page.locator('[data-touch-action="right"]').dispatchEvent("pointerdown");
  await page.waitForTimeout(180);
  await page.locator('[data-touch-action="right"]').dispatchEvent("pointerup");
  const touchRight = await snapshot(page);
  recordCheck(touchRight.paddleX > dragRight.paddleX, "mobile right touch moves paddle", `Paddle x ${dragRight.paddleX.toFixed(1)} -> ${touchRight.paddleX.toFixed(1)}.`);
  await page.locator('[data-touch-action="left"]').dispatchEvent("pointerdown");
  await page.waitForTimeout(180);
  await page.locator('[data-touch-action="left"]').dispatchEvent("pointerup");
  const touchLeft = await snapshot(page);
  recordCheck(touchLeft.paddleX < touchRight.paddleX, "mobile left touch moves paddle", `Paddle x ${touchRight.paddleX.toFixed(1)} -> ${touchLeft.paddleX.toFixed(1)}.`);
  await assertStageCoverage(page, "mobile playing");
  await capture(page, "mobile-playing");

  await page.locator('[data-touch-action="pause"]').click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const pauseText = await page.locator(".overlay-card").innerText();
  recordCheck(pauseText.includes("Paused"), "mobile pause opens clear overlay", pauseText.split("\n").slice(0, 2).join(" "));
  recordCheck(await page.locator(".touch-controls").isHidden(), "mobile touch controls hide under overlay", "Pause overlay owns the next action.");
  await capture(page, "mobile-paused");
}

async function bootFresh(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  await page.waitForFunction(() => document.fonts.status === "loaded");
}

async function assertShellHealth(page: Page, label: string) {
  const title = await page.title();
  recordCheck(title === "Ricochet Rush", `${label}: page identity`, title);

  const content = await page.locator(".brand").innerText();
  recordCheck(content === "Ricochet Rush", `${label}: brand renders`, content);

  const hasFrameworkOverlay = await page.evaluate(() => {
    const overlay = document.querySelector("vite-error-overlay, nextjs-portal, webpack-dev-server-client-overlay");
    const bodyText = document.body.innerText;
    return Boolean(overlay) || bodyText.includes("Internal server error") || bodyText.includes("Failed to load module script");
  });
  recordCheck(!hasFrameworkOverlay, `${label}: no framework error overlay`, hasFrameworkOverlay ? "Framework error content found." : "No framework overlay detected.");
}

async function assertToolDrawerOwnsFocus(page: Page, label: string) {
  await page.locator('[data-tool-panel="designer"]').click();
  await page.waitForFunction(() => document.querySelector(".shell")?.classList.contains("is-tool-panel-open"));
  const overlayHidden = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>(".game-overlay.is-visible");
    if (!overlay) return false;
    return getComputedStyle(overlay).visibility === "hidden";
  });
  recordCheck(
    overlayHidden,
    `${label}: tool drawer hides competing launch overlay`,
    overlayHidden ? "Launch overlay is suppressed while Designer is open." : "Launch overlay still competes with the tool drawer."
  );
  const panelHeight = await page.evaluate(() => document.querySelector<HTMLElement>(".tool-panel")?.getBoundingClientRect().height ?? 0);
  const bodyHeight = await page.evaluate(() => document.querySelector<HTMLElement>(".tool-body")?.getBoundingClientRect().height ?? 0);
  recordCheck(
    panelHeight > 0 && panelHeight < 720,
    `${label}: tool drawer sizes to content`,
    `Panel ${panelHeight.toFixed(0)}px tall with ${bodyHeight.toFixed(0)}px body.`
  );
  await page.locator('[data-action="close-tool-panel"]').click();
  await page.waitForFunction(() => !document.querySelector(".shell")?.classList.contains("is-tool-panel-open"));
  const overlayRestored = await page.evaluate(() => {
    const overlay = document.querySelector<HTMLElement>(".game-overlay.is-visible");
    return Boolean(overlay && getComputedStyle(overlay).visibility !== "hidden");
  });
  recordCheck(
    overlayRestored,
    `${label}: launch overlay returns after closing drawer`,
    overlayRestored ? "Launch overlay is visible again after closing Designer." : "Launch overlay did not return."
  );
}

async function assertLaunchSurvivalWindow(page: Page, label: string) {
  const before = await snapshot(page);
  if (await page.locator("[data-tool-backdrop]").isVisible()) {
    await page.locator('[data-action="close-tool-panel"]').click();
    await page.waitForFunction(() => !document.querySelector("[data-tool-backdrop]"));
  }
  await page.waitForSelector(".game-overlay.is-visible [data-overlay-action]");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "playing");
  const survivalMs = Math.round((LAUNCH_LOSS_GRACE_SECONDS - 0.25) * 1000);
  await page.waitForTimeout(survivalMs);
  const after = await snapshot(page);
  recordCheck(
    after.lives === before.lives,
    `${label}: center launch keeps life during survival window`,
    after.lives === before.lives
      ? `No life lost in the first ${(survivalMs / 1000).toFixed(1)}s after launch.`
      : `Lives dropped ${before.lives} -> ${after.lives}.`
  );
}

async function assertReadyState(page: Page, label: string) {
  const state = await snapshot(page);
  recordCheck(state.phase === "ready", `${label}: ready phase`, state.phase);
  recordCheck(state.bricks >= 34, `${label}: playable brick count`, `${state.bricks} bricks`);
  recordCheck(state.balls.length === 1 && Boolean(state.balls[0]?.stuck), `${label}: launch ball is staged`, `${state.balls.length} ball(s)`);
  recordCheck(state.boardSource === "pack" && state.currentPackId === "starter", `${label}: curated starter board`, `${state.boardSource}/${state.currentPackId ?? "none"}`);
  await assertFocusedOverlayAction(page, label);
}

async function assertPlayingState(page: Page, before: DebugSnapshot, label: string) {
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "playing");
  const state = await snapshot(page);
  const movingBalls = state.balls.filter((ball) => !ball.stuck);
  recordCheck(state.phase === "playing", `${label}: playing phase`, state.phase);
  recordCheck(movingBalls.length >= 1, `${label}: launched ball is moving`, `${movingBalls.length} moving ball(s)`);
  recordCheck(movingBalls.some((ball) => Math.abs(ball.vx) > 70), `${label}: launch avoids vertical loop`, movingBalls.map((ball) => `vx=${ball.vx.toFixed(1)}`).join(", "));
  recordCheck(state.paddleX > before.paddleX, `${label}: keyboard moves paddle`, `Paddle x ${before.paddleX.toFixed(1)} -> ${state.paddleX.toFixed(1)}.`);
  recordCheck(state.paddleVelocityX > 0, `${label}: paddle exposes positive velocity`, `vx=${state.paddleVelocityX.toFixed(1)}`);
}

async function assertFocusedOverlayAction(page: Page, label: string) {
  const focused = await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute("data-overlay-action"));
  recordCheck(focused, `${label}: primary overlay action has focus`, focused ? "Launch/pause action is focused." : "Focus is not on the primary overlay action.");
}

async function openToolPanel(page: Page, panel: "designer" | "packs" | "options" | "diagnostics", expectedTitle: string) {
  await page.locator(`[data-tool-panel="${panel}"]`).click();
  await page.waitForFunction((title) => document.querySelector("[data-tool-title]")?.textContent === title, expectedTitle);
  const title = await page.locator("[data-tool-title]").innerText();
  const closeFocused = await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.matches('[data-action="close-tool-panel"]'));
  recordCheck(title === expectedTitle, `${expectedTitle}: panel opens`, title);
  recordCheck(closeFocused, `${expectedTitle}: close action receives focus`, closeFocused ? "Close button focused." : "Focus did not move into the panel.");
}

async function assertCanvasClarity(page: Page, label: string) {
  const metrics = await page.evaluate<CanvasMetrics>(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="ricochet-rush-canvas"]');
    if (!canvas) {
      return {
        accentPixels: 0,
        canvasPixels: 0,
        colorBuckets: 0,
        depthPixels: 0,
        displayHeight: 0,
        displayWidth: 0,
        height: 0,
        litPixels: 0,
        lowerBandLitPixels: 0,
        width: 0
      };
    }

    const probe = document.createElement("canvas");
    probe.width = 96;
    probe.height = 64;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) {
      return {
        accentPixels: 0,
        canvasPixels: canvas.width * canvas.height,
        colorBuckets: 0,
        depthPixels: 0,
        displayHeight: canvas.getBoundingClientRect().height,
        displayWidth: canvas.getBoundingClientRect().width,
        height: canvas.height,
        litPixels: 0,
        lowerBandLitPixels: 0,
        width: canvas.width
      };
    }

    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    const buckets = new Set<string>();
    let accentPixels = 0;
    let depthPixels = 0;
    let litPixels = 0;
    let lowerBandLitPixels = 0;

    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const blue = pixels[index + 2] ?? 0;
      const alpha = pixels[index + 3] ?? 0;
      const pixel = index / 4;
      const y = Math.floor(pixel / probe.width);
      const brightness = red + green + blue;
      const brightestChannel = Math.max(red, green, blue);
      const darkestChannel = Math.min(red, green, blue);
      if (alpha > 0 && brightness > 42) {
        if (brightestChannel > 92 && brightestChannel - darkestChannel > 28) accentPixels += 1;
        if (brightness > 70 && brightness < 230) depthPixels += 1;
        litPixels += 1;
        if (y > probe.height * 0.62) lowerBandLitPixels += 1;
      }
      if (alpha > 0 && brightness > 28) {
        buckets.add(`${Math.floor(red / 32)}:${Math.floor(green / 32)}:${Math.floor(blue / 32)}`);
      }
    }

    const rect = canvas.getBoundingClientRect();
    return {
      accentPixels,
      canvasPixels: canvas.width * canvas.height,
      colorBuckets: buckets.size,
      depthPixels,
      displayHeight: rect.height,
      displayWidth: rect.width,
      height: canvas.height,
      litPixels,
      lowerBandLitPixels,
      width: canvas.width
    };
  });

  recordCheck(metrics.canvasPixels > 0, `${label}: canvas has backing pixels`, `${metrics.width}x${metrics.height}`);
  recordCheck(metrics.displayWidth >= 320 && metrics.displayHeight >= 210, `${label}: canvas is large enough to play`, `${Math.round(metrics.displayWidth)}x${Math.round(metrics.displayHeight)} displayed`);
  if (label.startsWith("mobile")) {
    recordCheck(metrics.displayWidth >= 384 && metrics.displayHeight >= 255, `${label}: compact HUD gives the canvas more room`, `${Math.round(metrics.displayWidth)}x${Math.round(metrics.displayHeight)} displayed`);
    recordCheck(metrics.displayWidth >= 389 && metrics.displayHeight >= 259, `${label}: P7 canvas area exceeds the prior 388x259 baseline`, `${Math.round(metrics.displayWidth)}x${Math.round(metrics.displayHeight)} displayed`);
  }
  recordCheck(metrics.litPixels > 900, `${label}: canvas is not visually blank`, `${metrics.litPixels} lit sample pixels`);
  recordCheck(metrics.colorBuckets >= 16, `${label}: canvas has rich arcade color`, `${metrics.colorBuckets} color buckets`);
  recordCheck(metrics.accentPixels > 140, `${label}: bright arcade accents are visible`, `${metrics.accentPixels} accent sample pixels`);
  recordCheck(metrics.depthPixels > 650, `${label}: depth and shadow detail is visible`, `${metrics.depthPixels} mid-tone sample pixels`);
  recordCheck(metrics.lowerBandLitPixels > 90, `${label}: paddle/lower playfield is visible`, `${metrics.lowerBandLitPixels} lower-band lit pixels`);
}

async function assertLayoutHealth(page: Page, label: string, options: { failSmallTouchTargets: boolean }) {
  const overflow = await page.evaluate<{
    clientWidth: number;
    offenders: LayoutIssue[];
    overflowed: boolean;
    scrollWidth: number;
  }>(`
    (() => {
      function selectorFor(element) {
        if (element.id) return "#" + element.id;
        const testId = element.getAttribute("data-testid");
        if (testId) return "[data-testid=\\"" + testId + "\\"]";
        const action = element.getAttribute("data-action");
        if (action) return "[data-action=\\"" + action + "\\"]";
        const toolPanel = element.getAttribute("data-tool-panel");
        if (toolPanel) return "[data-tool-panel=\\"" + toolPanel + "\\"]";
        const className = Array.from(element.classList).slice(0, 2).join(".");
        return className ? element.tagName.toLowerCase() + "." + className : element.tagName.toLowerCase();
      }
      function textFor(element) {
        const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.innerText;
        return value.trim().replace(/\\s+/g, " ").slice(0, 80);
      }
      function describeElement(element) {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          left: rect.left,
          right: rect.right,
          selector: selectorFor(element),
          text: textFor(element),
          width: rect.width
        };
      }
      const overflowed = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const offenders = Array.from(document.body.querySelectorAll("*"))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (
            rect.width > 1 &&
            rect.height > 1 &&
            style.visibility !== "hidden" &&
            style.display !== "none" &&
            (rect.right > window.innerWidth + 1 || rect.left < -1)
          );
        })
        .slice(0, 5)
        .map((element) => describeElement(element));
      return { overflowed, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, offenders };
    })()
  `);
  recordCheck(!overflow.overflowed, `${label}: no horizontal page overflow`, overflow.overflowed ? `scrollWidth ${overflow.scrollWidth}, clientWidth ${overflow.clientWidth}; ${formatIssues(overflow.offenders)}` : "No horizontal overflow.");

  const textOverflow = await findTextOverflow(page);
  recordCheck(textOverflow.length === 0, `${label}: visible text fits controls`, textOverflow.length === 0 ? "No text overflow found." : formatIssues(textOverflow), "warn");

  const smallTargets = await findSmallTargets(page, options.failSmallTouchTargets);
  recordCheck(smallTargets.length === 0, `${label}: touch/click targets are comfortably sized`, smallTargets.length === 0 ? "Targets meet the audit threshold." : formatIssues(smallTargets), options.failSmallTouchTargets ? "fail" : "warn");
}

async function assertDesktopStageSeparation(page: Page) {
  const overlaps = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage")?.getBoundingClientRect();
    const consolePanel = document.querySelector<HTMLElement>(".play-console")?.getBoundingClientRect();
    if (!stage || !consolePanel) return true;
    return stage.right > consolePanel.left && consolePanel.right > stage.left && stage.bottom > consolePanel.top && consolePanel.bottom > stage.top;
  });
  recordCheck(!overlaps, "desktop: playfield and Play Console do not overlap", overlaps ? "Stage and console rectangles intersect." : "Stage and console are separated.");
}

async function dragAimStage(page: Page, startX: number, startY: number, endX: number, endY: number): Promise<void> {
  await page.locator(".stage").dispatchEvent("pointerdown", { pointerId: 27, pointerType: "touch", clientX: startX, clientY: startY, bubbles: true, cancelable: true });
  await page.locator(".stage").dispatchEvent("pointermove", { pointerId: 27, pointerType: "touch", clientX: endX, clientY: endY, bubbles: true, cancelable: true });
  await page.locator(".stage").dispatchEvent("pointerup", { pointerId: 27, pointerType: "touch", clientX: endX, clientY: endY, bubbles: true, cancelable: true });
}

async function assertStageCoverage(page: Page, label: string) {
  const coverage = await page.evaluate<CoverageMetrics>(() => {
    const stage = document.querySelector<HTMLElement>(".stage")?.getBoundingClientRect();
    if (!stage) return { coverageRatio: 1, items: [] };
    const stageArea = stage.width * stage.height;
    const selectors = [".meters", ".status", ".hint", ".touch-controls", ".floating-text", ".active-powers"];
    const items = selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const width = Math.max(0, Math.min(rect.right, stage.right) - Math.max(rect.left, stage.left));
          const height = Math.max(0, Math.min(rect.bottom, stage.bottom) - Math.max(rect.top, stage.top));
          return { selector, area: width * height };
        })
        .filter((item) => item.area > 0)
    );
    const coveredArea = items.reduce((total, item) => total + item.area, 0);
    return { coverageRatio: stageArea === 0 ? 1 : coveredArea / stageArea, items };
  });

  const viewportWidth = page.viewportSize()?.width ?? 999;
  const maxCoverage = viewportWidth <= 520 ? 0.38 : 0.22;
  recordCheck(coverage.coverageRatio < maxCoverage, `${label}: overlays leave the playfield readable`, `${Math.round(coverage.coverageRatio * 100)}% sampled overlay coverage`, "warn");
}

async function assertStageInViewport(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".stage")?.getBoundingClientRect();
    if (!stage) return { ratio: 0, top: 0, visibleHeight: 0 };
    const visibleHeight = Math.max(0, Math.min(stage.bottom, window.innerHeight) - Math.max(stage.top, 0));
    return {
      ratio: stage.height === 0 ? 0 : visibleHeight / stage.height,
      top: stage.top,
      visibleHeight
    };
  });
  recordCheck(metrics.ratio >= 0.82 && metrics.top >= -8, `${label}: stage is returned to view`, `${Math.round(metrics.ratio * 100)}% visible, top ${Math.round(metrics.top)}px`);
}

async function findTextOverflow(page: Page): Promise<LayoutIssue[]> {
  return page.evaluate<LayoutIssue[]>(`
    (() => {
      function isVisibleElement(element) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden" && style.display !== "none";
      }
      function selectorFor(element) {
        if (element.id) return "#" + element.id;
        const testId = element.getAttribute("data-testid");
        if (testId) return "[data-testid=\\"" + testId + "\\"]";
        const action = element.getAttribute("data-action");
        if (action) return "[data-action=\\"" + action + "\\"]";
        const toolPanel = element.getAttribute("data-tool-panel");
        if (toolPanel) return "[data-tool-panel=\\"" + toolPanel + "\\"]";
        const className = Array.from(element.classList).slice(0, 2).join(".");
        return className ? element.tagName.toLowerCase() + "." + className : element.tagName.toLowerCase();
      }
      function textFor(element) {
        const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.innerText;
        return value.trim().replace(/\\s+/g, " ").slice(0, 80);
      }
      function describeElement(element) {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          selector: selectorFor(element),
          text: textFor(element),
          width: rect.width
        };
      }
      const selectors = [
        "button",
        "[data-board-meta]",
        "[data-level-name]",
        "[data-tool-title]",
        ".brand",
        ".status",
        ".hint",
        ".console-status span",
        ".compact-summary",
        ".powerup-primer"
      ].join(",");

      return Array.from(document.querySelectorAll(selectors))
        .filter(isVisibleElement)
        .filter((element) => {
          const style = getComputedStyle(element);
          const horizontalOverflow = element.scrollWidth > Math.ceil(element.clientWidth) + 2 && style.overflowX !== "auto" && style.overflowX !== "scroll";
          const verticalOverflow = element.tagName === "BUTTON" && element.scrollHeight > Math.ceil(element.clientHeight) + 2;
          return horizontalOverflow || verticalOverflow;
        })
        .slice(0, 8)
        .map((element) => ({
          ...describeElement(element),
          scrollHeight: element.scrollHeight,
          scrollWidth: element.scrollWidth
        }));
    })()
  `);
}

async function findSmallTargets(page: Page, failSmallTouchTargets: boolean): Promise<LayoutIssue[]> {
  const strictTouchTargets = failSmallTouchTargets ? "true" : "false";
  return page.evaluate<LayoutIssue[]>(
    `
      (() => {
        const strictTouchTargets = ${strictTouchTargets};
        function isVisibleElement(element) {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 1 && rect.height > 1 && style.visibility !== "hidden" && style.display !== "none";
        }
        function selectorFor(element) {
          if (element.id) return "#" + element.id;
          const testId = element.getAttribute("data-testid");
          if (testId) return "[data-testid=\\"" + testId + "\\"]";
          const action = element.getAttribute("data-action");
          if (action) return "[data-action=\\"" + action + "\\"]";
          const toolPanel = element.getAttribute("data-tool-panel");
          if (toolPanel) return "[data-tool-panel=\\"" + toolPanel + "\\"]";
          const className = Array.from(element.classList).slice(0, 2).join(".");
          return className ? element.tagName.toLowerCase() + "." + className : element.tagName.toLowerCase();
        }
        function textFor(element) {
          const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.innerText;
          return value.trim().replace(/\\s+/g, " ").slice(0, 80);
        }
        function describeElement(element) {
          const rect = element.getBoundingClientRect();
          return {
            height: rect.height,
            selector: selectorFor(element),
            text: textFor(element),
            width: rect.width
          };
        }
        const candidates = Array.from(document.querySelectorAll("button, textarea"));
        return candidates
          .filter(isVisibleElement)
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const isTouchControl = Boolean(element.closest(".touch-controls"));
            const minimum = strictTouchTargets || isTouchControl ? 40 : 30;
            return rect.width < minimum || rect.height < minimum;
          })
          .slice(0, 8)
          .map(describeElement);
      })()
    `
  );
}

async function capture(page: Page, name: string) {
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ fullPage: false, path });
  screenshots.push({ label: name, path: relative(process.cwd(), path) });
}

async function snapshot(page: Page): Promise<DebugSnapshot> {
  return page.evaluate(() => {
    const game = window.__ricochetRushGame;
    if (!game) throw new Error("Missing Ricochet Rush debug surface.");
    return game.debugSnapshot();
  });
}

function trackConsole(message: ConsoleMessage) {
  const type = message.type();
  if (type !== "error" && type !== "warning") return;
  const location = message.location();
  consoleEntries.push({
    location: `${location.url}:${location.lineNumber}:${location.columnNumber}`,
    text: message.text(),
    type
  });
}

function recordConsoleHealth() {
  const errors = consoleEntries.filter((entry) => entry.type === "error");
  const warnings = consoleEntries.filter((entry) => entry.type === "warning" && !isIgnoredConsoleEntry(entry));
  recordCheck(errors.length === 0 && pageErrors.length === 0, "browser console has no runtime errors", [...errors.map(formatConsoleEntry), ...pageErrors].slice(0, 5).join(" | ") || "No console errors or page errors.");
  recordCheck(warnings.length === 0, "browser console warning budget", warnings.slice(0, 5).map(formatConsoleEntry).join(" | ") || "No browser warnings.", "warn");
}

function recordCheck(condition: boolean, name: string, detail: string, failingStatus: "fail" | "warn" = "fail") {
  checks.push({
    detail,
    name,
    status: condition ? "pass" : failingStatus
  });
}

async function writeReport(auditBaseUrl: string) {
  const payload = {
    baseUrl: auditBaseUrl,
    checks,
    consoleEntries: consoleEntries.filter((entry) => !isIgnoredConsoleEntry(entry)),
    generatedAt: new Date().toISOString(),
    pageErrors,
    screenshots
  };
  await writeFile(resolve(ARTIFACT_DIR, "report.json"), `${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(resolve(ARTIFACT_DIR, "report.md"), renderMarkdownReport(payload));
}

function renderMarkdownReport(payload: {
  baseUrl: string;
  checks: AuditCheck[];
  consoleEntries: ConsoleEntry[];
  generatedAt: string;
  pageErrors: string[];
  screenshots: ScreenshotArtifact[];
}) {
  const failures = payload.checks.filter((check) => check.status === "fail");
  const warnings = payload.checks.filter((check) => check.status === "warn");
  const passes = payload.checks.length - failures.length - warnings.length;
  const lines = [
    "# Ricochet Rush UX Audit",
    "",
    `Generated: ${payload.generatedAt}`,
    `URL: ${payload.baseUrl}`,
    "",
    `Summary: ${passes} passed, ${warnings.length} warnings, ${failures.length} failures.`,
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
    ...payload.checks.map((check) => `| ${check.status.toUpperCase()} | ${escapeMarkdown(check.name)} | ${escapeMarkdown(check.detail)} |`),
    "",
    "## Screenshots",
    "",
    ...payload.screenshots.map((screenshot) => `- ${screenshot.label}: \`${screenshot.path}\``),
    "",
    "## Console",
    "",
    payload.consoleEntries.length === 0 ? "No console warnings or errors." : payload.consoleEntries.map((entry) => `- ${entry.type}: ${entry.text} (${entry.location})`).join("\n")
  ];

  if (payload.pageErrors.length > 0) {
    lines.push("", "## Page Errors", "", ...payload.pageErrors.map((error) => `- ${error}`));
  }

  return `${lines.join("\n")}\n`;
}

function formatIssues(issues: LayoutIssue[]) {
  return issues.map((issue) => `${issue.selector} "${issue.text}" ${Math.round(issue.width)}x${Math.round(issue.height)}`).join("; ");
}

function formatConsoleEntry(entry: ConsoleEntry) {
  return `${entry.text} (${entry.location})`;
}

function isIgnoredConsoleEntry(entry: ConsoleEntry) {
  return entry.type === "warning" && entry.text.includes("GPU stall due to ReadPixels");
}

function escapeMarkdown(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
