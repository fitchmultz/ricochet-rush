import { once } from "node:events";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";
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
  runStats: Array<{ label: string; value: string; tone?: "reward" | "neutral" | "warning" }>;
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
    brief: string;
  };
  generationSummary?: {
    title: string;
    detail: string;
  };
  settings: {
    particles: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
    sfxVolume: number;
    musicVolume: number;
  };
  audio: {
    contextState: string;
    sfxVolume: number;
    musicVolume: number;
    musicEnabled: boolean;
    musicPlaying: boolean;
    musicMasterGain: number;
    musicMelodyOutputPeak: number;
    lastSfxOutputPeak: number;
    lastSfxKind: string | null;
    sfxLimiterActive: boolean;
  };
  effects: {
    sparks: number;
    impactRings: number;
    screenFlashes: number;
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
  await page.evaluate((save) => {
    localStorage.clear();
    localStorage.setItem("ricochet-rush-save", JSON.stringify(save));
  }, staleEmptyBrickSave());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const repairedStaleSave = await snapshot(page);
  assert(repairedStaleSave.boardSource === "generated", "Expected stale generated save to restore as a generated board.");
  assert(repairedStaleSave.bricks >= 34, `Expected stale empty save to rebuild playable bricks, got ${repairedStaleSave.bricks}.`);
  assert(await page.evaluate(() => JSON.parse(localStorage.getItem("ricochet-rush-save") ?? "{}").bricks?.length >= 34), "Expected repaired save to persist rebuilt bricks.");

  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "ricochet-rush-settings",
      JSON.stringify({
        particles: true,
        reducedMotion: false,
        highContrast: false,
        sfx: false,
        music: false
      })
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForSelector('[data-tool-panel="designer"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  await page.waitForFunction(() => {
    const mark = document.querySelector<HTMLImageElement>(".brand-mark");
    return mark && mark.complete && mark.naturalWidth > 0;
  });
  const explicitOptOut = await snapshot(page);
  assert(explicitOptOut.settings.sfxVolume === 0, `Expected explicit SFX opt-out to migrate to volume 0, got ${explicitOptOut.settings.sfxVolume}.`);
  assert(explicitOptOut.settings.musicVolume === 0, `Expected explicit music opt-out to migrate to volume 0, got ${explicitOptOut.settings.musicVolume}.`);

  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "ricochet-rush-settings",
      JSON.stringify({
        particles: true,
        reducedMotion: false,
        highContrast: false,
        sound: false
      })
    );
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const legacySoundOff = await snapshot(page);
  assert(legacySoundOff.settings.sfxVolume === 0, `Expected legacy Sound opt-out to migrate to SFX volume 0, got ${legacySoundOff.settings.sfxVolume}.`);
  assert(legacySoundOff.settings.musicVolume === 1, `Expected missing legacy music setting to default to full volume, got ${legacySoundOff.settings.musicVolume}.`);

  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForSelector('[data-tool-panel="designer"]');
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
  await page.evaluate(() => {
    const raw = localStorage.getItem("ricochet-rush-save");
    if (!raw) throw new Error("Missing starter checkpoint to corrupt.");
    const save = JSON.parse(raw) as {
      bricks?: Array<{ kind: string; hp: number; maxHp: number }>;
      recentEvents?: string[];
    };
    save.bricks = save.bricks?.map((brick) => ({ ...brick, kind: "bomb", hp: 1, maxHp: 1 })) ?? [];
    save.recentEvents = ["Corrupt pack checkpoint."];
    localStorage.setItem("ricochet-rush-save", JSON.stringify(save));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const repairedPackSave = await page.evaluate(() => JSON.parse(localStorage.getItem("ricochet-rush-save") ?? "{}") as { bricks?: Array<{ kind: string }> });
  const repairedPackKinds = new Set(repairedPackSave.bricks?.map((brick) => brick.kind) ?? []);
  assert(!repairedPackKinds.has("bomb"), "Expected corrupt bomb-only Starter checkpoint to rebuild from authored board data.");
  assert(repairedPackKinds.has("wide") && repairedPackKinds.has("split"), "Expected repaired Starter checkpoint to restore authored special bricks.");
  const repairedReady = await snapshot(page);
  assert(repairedReady.boardSource === "pack" && repairedReady.currentPackId === "starter", "Expected repaired corrupt checkpoint to stay on Starter pack.");
  assert(repairedReady.bricks === ready.bricks, `Expected repaired Starter brick count ${ready.bricks}, got ${repairedReady.bricks}.`);
  assert(repairedReady.recentEvents.includes("Saved board rebuilt."), "Expected corrupt checkpoint repair to be visible in recent events.");
  assert(repairedReady.settings.sfxVolume === 1, `Expected missing settings to default SFX volume to 1, got ${repairedReady.settings.sfxVolume}.`);
  assert(repairedReady.settings.musicVolume === 1, `Expected missing settings to default music volume to 1, got ${repairedReady.settings.musicVolume}.`);
  assert((await page.locator('link[rel="icon"][href="/assets/ricochet-rush-icon.svg"]').count()) === 1, "Expected branded favicon asset.");
  assert(await page.locator(".play-console").count() === 1, "Expected a compact play console.");
  assert((await page.locator(".meter-card").count()) === 3, "Expected grouped score, lives, and board HUD cards.");
  assert(await page.locator("[data-combo]").isHidden(), "Expected combo streak badge to stay hidden until a live streak starts.");
  assert(!(await page.locator(".console-status").innerText()).includes("Generated power-up atlas"), "Expected technical atlas messages to stay out of the play rail.");
  assert((await page.locator(".brand-mark").count()) === 1, "Expected the original brand mark in the Play Console.");
  assert(await page.locator("[data-powerup-primer]").isVisible(), "Expected first-run power-up primer to be visible.");
  const primerText = await page.locator("[data-powerup-primer]").innerText();
  assert(primerText.includes("Green helps") && primerText.includes("Red hurts") && primerText.includes("Gold is chaos"), "Expected primer to explain power-up color tones.");
  assert(await page.locator(".play-console .designer-panel, .play-console .pack-browser, .play-console .settings, .play-console .agent-trace").count() === 0, "Expected heavy tools outside the play console.");
  assert(await page.locator("[data-tool-surface]").isHidden(), "Expected tool panels to be closed by default.");
  assert(await page.locator('[data-action="save-board"]').isHidden(), "Expected Keep board to stay hidden for authored boards.");
  assert((await page.locator('.play-console [data-action="reset"]').count()) === 0, "Expected Clear save to stay out of primary play actions.");
  assert((await page.locator('[data-action="save"]').count()) === 0, "Expected autosave to replace the old manual save action.");
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
  assert((await page.locator('.play-console [data-action="new-board"]').count()) === 0, "Expected Design board action to live in the Board Designer panel.");
  assert((await page.locator('.designer-panel [data-action="new-board"]').count()) === 1, "Expected Board Designer panel to own the Design board action.");
  assert((await page.locator("[data-agent-pipeline]").count()) === 0, "Expected SDK plumbing to stay out of the player-facing Board Designer.");
  const canvasLabel = await page.locator('[data-testid="ricochet-rush-canvas"]').getAttribute("aria-label");
  assert(canvasLabel?.includes("Level 1") === true, "Expected canvas to expose current game state.");

  const promptInput = page.locator('[data-designer="brief"]');
  const generatedPrompt = "heart shape, only bomb bricks with a bright center lane, mirrored bomb pockets, soft corner safety, and a tiny boss-free finish that still feels like a readable gallery preview";
  assert(generatedPrompt.length > 140 && generatedPrompt.length <= 180, "Expected smoke prompt to exercise checkpoint prompt length limits.");
  await promptInput.fill("");
  await promptInput.pressSequentially(generatedPrompt);
  assert((await promptInput.inputValue()) === generatedPrompt, "Expected the board prompt to preserve typed spaces while focused.");
  assert(await hasLocalStorageKey(page, "ricochet-rush-designer-intent"), "Expected designer intent to persist.");
  await page.locator('[data-action="new-board"]').click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready" && window.__ricochetRushGame?.debugSnapshot().boardSource === "generated");
  const designed = await snapshot(page);
  assert(designed.designerIntent.brief === generatedPrompt, `Expected designer brief to apply, got ${designed.designerIntent.brief}.`);
  assert(designed.boardTheme.wallGlow === "#7ef1ff", `Expected generated board theme, got ${designed.boardTheme.wallGlow}.`);
  assert(designed.generationSummary?.title === "Local backup board", "Expected public generation summary for forced fallback.");
  assert(await page.locator("[data-generation-summary]").isVisible(), "Expected visible public generation summary in the Designer panel.");
  assert(await page.locator("[data-compact-generation-summary]").isHidden(), "Expected generation diagnostics to stay out of the default play rail.");
  assert(!(await page.locator(".console-status").innerText()).toLowerCase().includes("local backup"), "Expected fallback wording to stay out of the default play rail.");
  assert(await page.locator('[data-action="save-board"]').isEnabled(), "Expected generated boards to be keepable.");
  await promptInput.fill("different prompt after generation should not rewrite the saved board");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready" && window.__ricochetRushGame?.debugSnapshot().boardSource === "generated");
  assert(await page.locator('[data-action="save-board"]').isEnabled(), "Expected restored generated board to stay keepable.");
  await page.locator('[data-action="save-board"]').click();
  assert(await hasLocalStorageKey(page, "ricochet-rush-saved-boards"), "Expected kept generated board to persist in Saved Designs.");
  assert(!(await page.locator('[data-pack-id="saved-designs"]').isDisabled()), "Expected Saved Designs to unlock after keeping a board.");
  await page.locator('[data-tool-panel="packs"]').click();
  assert((await page.locator("[data-tool-title]").innerText()) === "Board Select", "Expected Board Select title after switching tools.");
  assert((await page.locator('[data-pack-id^="saved-designs:"]').count()) >= 1, "Expected Saved Designs gallery to show individual saved board cards.");
  assert((await page.locator('[data-pack-id^="saved-designs:"]').first().innerText()).includes(generatedPrompt), "Expected saved board card to keep full source prompt language after checkpoint reload.");
  assert((await page.locator('[data-pack-id^="saved-designs:"] .pack-preview .mini-brick').count()) >= 20, "Expected saved board card to include a thumbnail preview.");
  await page.locator('[data-pack-id^="saved-designs:"]').first().click();
  await page.waitForFunction(() => {
    const snapshot = window.__ricochetRushGame?.debugSnapshot();
    return snapshot?.phase === "ready" && snapshot.boardSource === "pack" && snapshot.currentPackId === "saved-designs";
  });
  const selectedSavedDesign = await snapshot(page);
  assert(selectedSavedDesign.packBoardIndex === 0, `Expected first saved design replay, got index ${selectedSavedDesign.packBoardIndex}.`);
  await page.locator('[data-tool-panel="packs"]').click();
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
  assert(playing.audio.musicEnabled, "Expected music to be enabled after launch.");
  assert(playing.audio.musicVolume === 1, `Expected music to launch at full volume, got ${playing.audio.musicVolume}.`);
  assert(playing.audio.musicPlaying, `Expected music to be playing after launch, got context ${playing.audio.contextState}.`);
  assert(playing.audio.musicMelodyOutputPeak >= 0.008, `Expected audible music output peak, got ${playing.audio.musicMelodyOutputPeak}.`);
  await page.evaluate(() => window.__ricochetRushGame?.debugAudioIdentitySmokeState());
  const audioIdentity = await snapshot(page);
  assert(audioIdentity.audio.lastSfxKind === "volatilePowerup", `Expected audio identity smoke to end on volatile power-up, got ${audioIdentity.audio.lastSfxKind}.`);
  assert(audioIdentity.audio.sfxLimiterActive, "Expected procedural SFX bus limiter to be active.");
  assert(audioIdentity.audio.lastSfxOutputPeak > 0.01, `Expected procedural SFX output peak, got ${audioIdentity.audio.lastSfxOutputPeak}.`);
  assert(audioIdentity.audio.lastSfxOutputPeak <= 0.16, `Expected procedural SFX to stay below clipping guard, got ${audioIdentity.audio.lastSfxOutputPeak}.`);
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
  assert((await page.locator(".floating-text.is-combo").count()) >= 1, "Expected boosted combo floating text for streak feedback.");
  assert(await page.locator("[data-combo]").isVisible(), "Expected combo streak badge to appear only when a streak is active.");
  assert((await page.locator(".impact-ring").count()) >= 1, "Expected impact rings for amplified hit and pickup feedback.");
  assert((await page.locator(".power-timer.is-reward").count()) >= 2, "Expected active power timers to use reward tone styling.");

  const saved = await snapshot(page);
  assert(saved.hasSave, "Expected autosave to keep a run checkpoint.");
  assert(await hasLocalStorageKey(page, "ricochet-rush-save"), "Expected checkpoint in localStorage.");

  await page.evaluate(() => {
    const game = window.__ricochetRushGame as unknown as { bricks: unknown[]; completeLevel: () => void };
    game.bricks.splice(0);
    game.completeLevel();
  });
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "levelComplete");
  const clearSummaryText = await page.locator('[data-run-summary="clear"]').innerText();
  const clearSummaryLower = clearSummaryText.toLowerCase();
  assert(clearSummaryLower.includes("level cleared"), "Expected level-clear summary title.");
  assert(clearSummaryLower.includes("score"), "Expected level-clear summary to show score.");
  assert(clearSummaryLower.includes("best delta"), "Expected level-clear summary to show best score delta.");
  assert(clearSummaryLower.includes("bricks broken"), "Expected level-clear summary to show bricks broken.");
  assert(clearSummaryLower.includes("longest streak"), "Expected level-clear summary to show longest streak.");
  assert(clearSummaryLower.includes("power-ups caught"), "Expected level-clear summary to show power-ups caught.");
  assert(clearSummaryLower.includes("boards cleared"), "Expected level-clear summary to show boards cleared.");
  assert(clearSummaryLower.includes("clear time"), "Expected level-clear summary to show clear time.");
  assert((await page.locator('[data-summary-action]').count()) >= 4, "Expected level-clear summary to expose direct next actions.");
  assert(/continue|next board|generate board/i.test(await page.locator('[data-summary-action="0"]').innerText()), "Expected level-clear summary primary action to continue the loop.");
  assert((await page.locator('[data-summary-action]:has-text("Retry Run")').count()) === 1, "Expected level-clear summary to expose a retry action.");
  assert((await page.locator('[data-summary-action]:has-text("Choose Board")').count()) === 1, "Expected level-clear summary to expose a board chooser action.");
  await page.locator('[data-summary-action]:has-text("Choose Board")').press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-tool-title]")?.textContent === "Board Select");
  assert((await page.locator('[data-tool-title]').innerText()) === "Board Select", "Expected keyboard-activated summary secondary action to open board picker.");
  assert(!(await hasLocalStorageKey(page, "ricochet-rush-save")), "Expected level clear to remove the stale pre-clear checkpoint.");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const afterClearReload = await snapshot(page);
  assert(afterClearReload.bricks >= 34, `Expected reload after level clear to start a fresh playable board, got ${afterClearReload.bricks}.`);
  assert(!afterClearReload.recentEvents.includes("Saved run restored."), "Expected reload after level clear not to restore the pre-clear checkpoint.");

  await page.locator("[data-overlay-action]").click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "playing");
  await page.evaluate(() => {
    const game = window.__ricochetRushGame as unknown as { lives: number; loseLife: () => void };
    game.lives = 1;
    game.loseLife();
  });
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "gameOver");
  const gameOverSummaryText = await page.locator('[data-run-summary="gameOver"]').innerText();
  const gameOverSummaryLower = gameOverSummaryText.toLowerCase();
  assert(gameOverSummaryLower.includes("game over"), "Expected game-over summary title.");
  assert(gameOverSummaryLower.includes("survival time"), "Expected game-over summary to show survival time.");
  assert((await page.locator('[data-summary-action]:has-text("Retry Run")').count()) === 1, "Expected game-over summary to expose retry.");
  assert((await page.locator('[data-summary-action]:has-text("Choose Board")').count()) === 1, "Expected game-over summary to expose board chooser.");
  await page.locator('[data-summary-action]:has-text("Retry Run")').click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");

  await page.locator('[data-tool-panel="options"]').click();
  assert((await page.locator("[data-tool-title]").innerText()) === "Options", "Expected Options panel title.");
  assert((await page.locator('.settings-panel [data-action="reset"]').count()) === 1, "Expected Clear save to live in Options.");
  assert((await page.locator('.settings-panel [data-action="reset"]').innerText()) === "Clear local save", "Expected save reset copy to be explicit and secondary.");
  assert((await page.locator('[data-setting="ball-speed"]').count()) === 0, "Expected Ball speed setting to be removed.");
  assert((await page.locator('[data-setting="sfx"]').count()) === 0, "Expected SFX checkbox to be removed.");
  assert((await page.locator('[data-setting="music"]').count()) === 0, "Expected music checkbox to be removed.");
  assert((await page.locator('[data-setting="sfx-volume"]').inputValue()) === "1", "Expected SFX volume to default to full.");
  assert((await page.locator('[data-setting="music-volume"]').inputValue()) === "1", "Expected music volume to default to full.");
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().effects.sparks === 0);
  await page.locator('[data-setting="high-contrast"]').check();
  await page.locator('[data-setting="reduced-motion"]').check();
  await injectPowerupClarityState(page);
  const reducedEffects = await snapshot(page);
  assert(reducedEffects.effects.sparks === 0, `Expected reduced motion to suppress amplified spark bursts, got ${reducedEffects.effects.sparks}.`);
  assert(reducedEffects.effects.impactRings === 0, `Expected reduced motion to suppress impact rings, got ${reducedEffects.effects.impactRings}.`);
  assert(reducedEffects.effects.screenFlashes === 0, `Expected reduced motion to suppress screen flashes, got ${reducedEffects.effects.screenFlashes}.`);
  await page.locator('[data-setting="sfx-volume"]').fill("0.45");
  await page.locator('[data-setting="music-volume"]').fill("0.65");
  await page.locator('[data-setting="particles"]').uncheck();
  const tuned = await snapshot(page);
  assert(tuned.settings.highContrast, "Expected high contrast setting to apply.");
  assert(tuned.settings.reducedMotion, "Expected reduced motion setting to apply.");
  assert(tuned.settings.sfxVolume === 0.45, `Expected SFX volume setting to apply, got ${tuned.settings.sfxVolume}.`);
  assert(tuned.settings.musicVolume === 0.65, `Expected music volume setting to apply, got ${tuned.settings.musicVolume}.`);
  assert(tuned.audio.sfxVolume === 0.45, `Expected live SFX volume to apply, got ${tuned.audio.sfxVolume}.`);
  assert(tuned.audio.musicVolume === 0.65, `Expected live music volume to apply, got ${tuned.audio.musicVolume}.`);
  assert(!tuned.settings.particles, "Expected particles setting to apply.");
  assert(await page.locator(".shell.is-high-contrast.is-reduced-motion").count() === 1, "Expected visual settings classes to apply.");
  assert((await page.locator("[data-live-announcement]").textContent()) === tuned.announcement, "Expected live region to mirror game announcements.");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  const restoredSettings = await snapshot(page);
  assert(restoredSettings.settings.highContrast, "Expected high contrast setting to persist after reload.");
  assert(restoredSettings.settings.reducedMotion, "Expected reduced motion setting to persist after reload.");
  assert(restoredSettings.settings.sfxVolume === 0.45, `Expected SFX volume setting to persist after reload, got ${restoredSettings.settings.sfxVolume}.`);
  assert(restoredSettings.settings.musicVolume === 0.65, `Expected music volume setting to persist after reload, got ${restoredSettings.settings.musicVolume}.`);
  assert(!restoredSettings.settings.particles, "Expected particles setting to persist after reload.");
  assert(restoredSettings.powerupPrimerDismissed, "Expected dismissed power-up primer to persist after reload.");
  assert(await page.locator("[data-powerup-primer]").isHidden(), "Expected dismissed power-up primer to stay hidden after reload.");

  await page.locator('[data-tool-panel="options"]').click();
  await page.locator('.settings-panel [data-action="reset"]').click();
  const confirmText = await page.locator(".overlay-card").innerText();
  assert(confirmText.includes("Clear Saved Run?"), "Expected clear-save confirmation dialog.");
  await page.locator("[data-overlay-secondary]").click();
  await page.waitForFunction(() => document.querySelector(".overlay-card") === null);
  assert(await hasLocalStorageKey(page, "ricochet-rush-save"), "Expected cancel to preserve checkpoint.");

  await page.evaluate(() => {
    const game = window.__ricochetRushGame as unknown as { handlePrimaryAction: () => void };
    game.handlePrimaryAction();
  });
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "playing");
  await page.locator('.settings-panel [data-action="reset"]').click();
  await page.locator("[data-overlay-action]").click();
  await page.waitForTimeout(1200);
  assert(!(await hasLocalStorageKey(page, "ricochet-rush-save")), "Expected confirmed clear-save during active play to remove checkpoint without autosave recreating it.");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ricochet-rush-canvas"]');
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  await page.evaluate(() => {
    const game = window.__ricochetRushGame as unknown as { hideOverlay: () => void; refreshHud: () => void };
    game.hideOverlay();
    game.refreshHud();
  });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert(!overflow, "Expected desktop layout without horizontal overflow.");

  if (await page.locator("[data-tool-surface]").isVisible()) {
    await page.locator('[data-action="close-tool-panel"]').click();
  }
  assert(await page.locator("[data-tool-surface]").isHidden(), "Expected tool panel to close before mobile touch controls.");

  await page.setViewportSize({ width: 390, height: 760 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert(!mobileOverflow, "Expected narrow layout without horizontal overflow.");
  assert(await canvasHasVisiblePixels(page), "Expected mobile viewport to keep rendering the game canvas.");
  assert(await page.locator(".touch-controls").isVisible(), "Expected mobile touch controls to be visible.");
  await page.locator('[data-touch-action="primary"]').click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "playing");
  const touchLaunched = await snapshot(page);
  assert(touchLaunched.balls.some((ball) => !ball.stuck), "Expected touch launch to start play.");
  await page.locator('[data-touch-action="right"]').dispatchEvent("pointerdown");
  await page.waitForTimeout(180);
  await page.locator('[data-touch-action="right"]').dispatchEvent("pointerup");
  const touchMovedRight = await snapshot(page);
  assert(touchMovedRight.paddleX > touchLaunched.paddleX, "Expected right touch control to move the paddle right.");
  await page.locator('[data-touch-action="left"]').dispatchEvent("pointerdown");
  await page.waitForTimeout(180);
  await page.locator('[data-touch-action="left"]').dispatchEvent("pointerup");
  assert((await snapshot(page)).paddleX < touchMovedRight.paddleX, "Expected left touch control to move the paddle left.");
  await page.locator('[data-touch-action="pause"]').click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  assert((await page.locator(".overlay-card").innerText()).includes("Paused"), "Expected touch pause to open the pause overlay.");
  assert(await page.locator(".touch-controls").isHidden(), "Expected touch controls to hide while an overlay is visible.");
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

async function canvasHasVisiblePixels(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
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
      },
      undefined,
      { polling: "raf", timeout: 3000 }
    );
    return true;
  } catch {
    return false;
  }
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

function staleEmptyBrickSave() {
  const rows = Array.from({ length: 9 }, (_, y) =>
    Array.from({ length: 14 }, (_, x) => (y < 3 || (y === 3 && x < 2) ? { kind: "basic", hp: 1 } : null))
  );
  return {
    version: 3,
    savedAt: new Date(0).toISOString(),
    level: 2,
    clearedLevels: 1,
    boardSource: "generated",
    packId: null,
    packBoardIndex: 0,
    score: 1200,
    bestScore: 1200,
    lives: 2,
    combo: 1,
    paddleWidth: 116,
    levelBlueprint: {
      name: "Stale Empty Save",
      briefing: "A stale save should rebuild into a playable wall.",
      paddleHint: "Launch from the center.",
      speed: 1,
      rows
    },
    bricks: [],
    recentEvents: ["Stale empty save."],
    laserTimer: 0,
    grabTimer: 0,
    explosionScale: 1,
    balls: null
  };
}
