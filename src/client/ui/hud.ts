import {
  DEFAULT_DESIGNER_INTENT,
  type BoardDesignerIntent,
  type ComposerAgentTrace,
  type GenerationSummary
} from "../../shared/evolution";
import { type GameEventRecord, gameEventAudience, gameEventText } from "../../shared/gameEvents";
import type { GameCosmetics } from "../../shared/saveState";
import { escapeAttribute, escapeHtml } from "../../shared/util";
import { trapFocus } from "./focusTrap";

export interface HudPackItem {
  id: string;
  name: string;
  description: string;
  progressLabel: string;
  bestScore: number;
  unlocked: boolean;
  active: boolean;
  empty: boolean;
  previewRows: string[];
  kind?: "pack" | "saved-board";
  sourcePrompt?: string;
  createdAt?: string;
  actionLabel?: string;
}

export interface HudState {
  score: number;
  bestScore: number;
  lives: number;
  level: number;
  bricks: number;
  combo: number;
  status: string;
  levelName: string;
  hint: string;
  pending: boolean;
  hasSave: boolean;
  settings: {
    particles: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
    sfxVolume: number;
    musicVolume: number;
  };
  cosmetics: GameCosmetics;
  cosmeticOptions: {
    paddleSkins: Array<{ id: GameCosmetics["paddleSkin"]; label: string; unlocked: boolean }>;
    ballTrails: Array<{ id: GameCosmetics["ballTrail"]; label: string; unlocked: boolean }>;
    boardBackplates: Array<{ id: GameCosmetics["boardBackplate"]; label: string; unlocked: boolean }>;
  };
  activePowers: { label: string; seconds: number; maxSeconds: number; tone: "reward" | "hazard" | "volatile" }[];
  powerupPrimerDismissed: boolean;
  packs: HudPackItem[];
  canSaveBoard: boolean;
  boardSource: "pack" | "generated";
  designer: {
    intent: BoardDesignerIntent;
    generationSummary?: GenerationSummary;
    previewRows?: string[];
  };
  events: GameEventRecord[];
  announcement: string;
  sidebarCollapsed?: boolean;
  agentTrace?: ComposerAgentTrace;
}

export interface HudActions {
  requestBoard(): void;
  saveBoardToPack(): void;
  resetProgress(): void;
  selectPack(packId: string): void;
  updateDesigner(intent: BoardDesignerIntent): void;
  dismissPowerupPrimer(): void;
  toggleSidebar(): void;
  exportBoard(): string;
  importBoard(text: string): { ok: boolean; message: string };
  renderScoreCard(): Promise<{ ok: boolean; message: string; dataUrl?: string }>;
  updateCosmetics(cosmetics: GameCosmetics): void;
  updateSettings(settings: HudState["settings"]): void;
}

export interface HudApi {
  update(state: HudState): void;
  setActions(actions: HudActions): void;
  closeToolPanel(): void;
}

type HudToolPanel = "designer" | "packs" | "share" | "options" | "diagnostics";

const TOOL_PANEL_LABELS: Record<HudToolPanel, string> = {
  designer: "Board Designer",
  packs: "Board Select",
  share: "Share",
  options: "Options",
  diagnostics: "Run Log"
};

export function createHud(root: HTMLDivElement | null): HudApi {
  if (!root) throw new Error("Missing #app root");

  root.innerHTML = `
    <main class="shell">
      <section class="stage">
        <div id="game" class="game"></div>
        <div class="hud">
          <div class="hud-primary" aria-label="Run status">
            <div class="meters">
              <div class="meter-card meter-score">
                <span>Score</span>
                <strong data-score>0</strong>
                <em data-best>Best 0</em>
              </div>
              <div class="meter-card meter-lives">
                <span>Lives</span>
                <strong data-lives aria-label="3 lives">●●●</strong>
              </div>
              <div class="meter-card meter-board">
                <span data-level>Level 1</span>
                <strong data-bricks>0 bricks</strong>
              </div>
            </div>
            <div data-active-powers class="active-powers" hidden></div>
          </div>
          <div data-combo class="combo-badge" hidden></div>
          <div data-status class="status"></div>
        </div>
        <div class="touch-controls" aria-label="Touch controls">
          <button type="button" data-touch-action="left" aria-label="Move paddle left" aria-keyshortcuts="ArrowLeft">←</button>
          <button type="button" data-touch-action="primary" class="touch-primary" aria-keyshortcuts="Space Enter">Launch</button>
          <button type="button" data-touch-action="right" aria-label="Move paddle right" aria-keyshortcuts="ArrowRight">→</button>
          <button type="button" data-touch-action="pause" aria-keyshortcuts="KeyP Escape">Pause</button>
        </div>
        <div class="hint">A/D or arrows move - Space/Enter launch or continue - P/Escape pause - N design or reroll</div>
        <div data-live-announcement class="sr-only" aria-live="polite" aria-atomic="true"></div>
      </section>
      <aside class="panel play-console" aria-label="Play console">
        <div class="console-head">
          <button type="button" data-action="toggle-sidebar" class="sidebar-toggle" aria-label="Toggle play console">⟨</button>
          <img class="brand-mark" src="/assets/ricochet-rush-icon.svg" alt="" width="38" height="38" aria-hidden="true" />
          <div class="brand-lockup">
            <div class="brand">Ricochet Rush</div>
            <div data-board-meta class="console-kicker">Starter pack</div>
          </div>
        </div>
        <div class="controls board-card">
          <strong data-level-name>Starter Wall</strong>
          <span data-hint>Keep the ball angled. Flat returns are a trap.</span>
        </div>
        <div data-console-active-powers class="console-active-powers" hidden></div>
        <div data-compact-generation-summary class="compact-summary" hidden></div>
        <section data-powerup-primer class="powerup-primer" aria-label="Power-up primer">
          <div>
            <span class="primer-kicker">Power-ups</span>
            <strong>Read the falling icons before you catch them.</strong>
          </div>
          <ul>
            <li><i class="is-reward" aria-hidden="true"></i><span>Green helps: wide paddle, fire, lasers, extra life.</span></li>
            <li><i class="is-hazard" aria-hidden="true"></i><span>Red hurts: shrink, fast ball, kill paddle.</span></li>
            <li><i class="is-volatile" aria-hidden="true"></i><span>Gold is chaos: multiball, warp, bomb chain swings.</span></li>
          </ul>
          <button type="button" data-action="dismiss-powerup-primer">Got it</button>
        </section>
        <div class="actions" data-game-actions aria-label="Game actions">
          <button type="button" data-action="save-board">Keep board</button>
        </div>
        <nav class="tool-dock" aria-label="Game tools">
          <button type="button" data-tool-panel="designer">Designer</button>
          <button type="button" data-tool-panel="packs">Boards</button>
          <button type="button" data-tool-panel="share">Share</button>
          <button type="button" data-tool-panel="options">Options</button>
          <button type="button" data-tool-panel="diagnostics">Log</button>
        </nav>
        <div class="console-status" aria-label="Run action">
          <strong>Run</strong>
          <span data-console-event>Aim for the gates. Catch green. Dodge red.</span>
        </div>
      </aside>
      <div class="tool-backdrop" data-tool-backdrop hidden></div>
      <section class="tool-panel" data-tool-surface role="dialog" aria-modal="true" aria-label="Game tools" tabindex="-1" hidden>
        <header class="tool-header">
          <div>
            <span class="tool-kicker">Ricochet Rush</span>
            <h2 data-tool-title>Board Designer</h2>
          </div>
          <button type="button" data-action="close-tool-panel" class="tool-close" aria-label="Close tool panel">Close</button>
        </header>
        <div class="tool-body">
          <section class="designer-panel tool-view" data-tool-view="designer" aria-label="Board designer">
            <div class="panel-heading">Board Designer</div>
            <div class="designer-controls">
              <label class="designer-brief">
                <span>Board prompt</span>
                <textarea data-designer="brief" maxlength="180" rows="4" placeholder="make a smiley face and the eyes are exploding bricks"></textarea>
              </label>
              <label>
                <span>Visual preset</span>
                <select data-designer="visual-preset">
                  <option value="arcade">Arcade wall</option>
                  <option value="icon">Icon / silhouette</option>
                </select>
              </label>
              <p class="designer-hint">Face, logo, and icon prompts use lower density automatically so outlines read clearly. Pick Icon for the strictest silhouette rules.</p>
            </div>
            <div class="designer-actions">
              <button type="button" data-action="new-board">Design board</button>
              <span data-designer-pending hidden>Generating Level 1...</span>
            </div>
            <div data-generation-summary class="generation-summary" hidden></div>
          </section>
          <section class="pack-browser tool-view" data-tool-view="packs" aria-label="Board packs" hidden>
            <p class="pack-browser-lead">Pick a daily board, curated pack, or a saved design. Locked packs unlock as you clear the previous pack.</p>
            <div data-pack-list class="pack-list"></div>
          </section>
          <section class="share-panel tool-view" data-tool-view="share" aria-label="Share" hidden>
            <div class="panel-heading">Share Board</div>
            <p class="share-help">Export public-safe board JSON, import a shared board, or render a local PNG score card. Nothing uploads to a server.</p>
            <label class="share-field">
              <span>Board export JSON</span>
              <textarea data-share-export readonly rows="5"></textarea>
            </label>
            <div class="share-actions">
              <button type="button" data-action="refresh-export">Refresh export</button>
              <button type="button" data-action="copy-export">Copy JSON</button>
            </div>
            <label class="share-field">
              <span>Import board JSON</span>
              <textarea data-share-import rows="4" placeholder="Paste a Ricochet Rush board export"></textarea>
            </label>
            <div class="share-actions">
              <button type="button" data-action="import-board">Import board</button>
              <button type="button" data-action="render-score-card">Render PNG score card</button>
            </div>
            <a data-score-card-download class="score-card-download" download="ricochet-rush-score-card.png" hidden>Download score card</a>
            <p data-share-status class="share-status" role="status"></p>
          </section>
          <section class="settings-panel tool-view" data-tool-view="options" aria-label="Options" hidden>
            <div class="panel-heading">Options</div>
            <form class="settings" aria-label="Settings">
              <label>
                <span>SFX volume <output data-setting-output="sfx-volume">100%</output></span>
                <input data-setting="sfx-volume" type="range" min="0" max="1" step="0.05" value="1" />
              </label>
              <label>
                <span>Music volume <output data-setting-output="music-volume">100%</output></span>
                <input data-setting="music-volume" type="range" min="0" max="1" step="0.05" value="1" />
              </label>
              <label class="toggle">
                <span>Particles</span>
                <input data-setting="particles" type="checkbox" checked />
              </label>
              <label class="toggle">
                <span>Reduced motion</span>
                <input data-setting="reduced-motion" type="checkbox" />
              </label>
              <label class="toggle">
                <span>High contrast</span>
                <input data-setting="high-contrast" type="checkbox" />
              </label>
            </form>
            <div class="cosmetic-panel" aria-label="Cosmetics">
              <div class="panel-heading">Cosmetics</div>
              <label>
                <span>Paddle skin</span>
                <select data-cosmetic="paddleSkin"></select>
              </label>
              <label>
                <span>Ball trail</span>
                <select data-cosmetic="ballTrail"></select>
              </label>
              <label>
                <span>Board backplate</span>
                <select data-cosmetic="boardBackplate"></select>
              </label>
              <p data-cosmetic-status>Cosmetics are local-only and never change physics.</p>
            </div>
            <div class="settings-actions" aria-label="Save management">
              <button type="button" data-action="reset">Clear local save</button>
            </div>
            <div class="legend">
              <span><i class="basic" aria-hidden="true"></i>basic</span>
              <span><i class="hard" aria-hidden="true"></i>hard</span>
              <span><i class="bomb" aria-hidden="true"></i>bomb</span>
              <span><i class="laser" aria-hidden="true"></i>laser</span>
              <span><i class="fire" aria-hidden="true"></i>fire</span>
              <span><i class="grab" aria-hidden="true"></i>grab</span>
              <span><i class="split" aria-hidden="true"></i>multiball</span>
              <span><i class="wide" aria-hidden="true"></i>wide</span>
              <span><i class="slow" aria-hidden="true"></i>slow</span>
              <span><i class="thru" aria-hidden="true"></i>thru</span>
              <span><i class="prize" aria-hidden="true"></i>prize</span>
              <span><i class="penalty" aria-hidden="true"></i>penalty</span>
              <span><i class="boss" aria-hidden="true"></i>boss</span>
            </div>
          </section>
          <section class="diagnostics-panel tool-view" data-tool-view="diagnostics" aria-label="Run log" hidden>
            <div class="panel-heading">Run Log</div>
            <ol data-events class="events"></ol>
            <details class="agent-trace" data-agent-trace>
              <summary>Generation trace</summary>
              <div class="agent-trace-content">
                <p data-trace-status class="agent-trace-status">No generation trace yet.</p>
                <h4>Request JSON</h4>
                <pre data-trace-input class="agent-trace-block"></pre>
                <h4>Prompt</h4>
                <pre data-trace-prompt class="agent-trace-block"></pre>
                <h4>Parsed response</h4>
                <pre data-trace-output class="agent-trace-block"></pre>
                <h4>Raw output</h4>
                <pre data-trace-raw class="agent-trace-block"></pre>
                <h4>Raw errors</h4>
                <pre data-trace-errors class="agent-trace-block"></pre>
              </div>
            </details>
          </section>
        </div>
      </section>
    </main>
  `;

  const shell = query(root, ".shell");
  const score = query(root, "[data-score]");
  const best = query(root, "[data-best]");
  const lives = query(root, "[data-lives]");
  const level = query(root, "[data-level]");
  const bricks = query(root, "[data-bricks]");
  const combo = query(root, "[data-combo]");
  const status = query(root, "[data-status]");
  const boardMeta = query(root, "[data-board-meta]");
  const levelName = query(root, "[data-level-name]");
  const hint = query(root, "[data-hint]");
  const consoleEvent = query(root, "[data-console-event]");
  const events = query(root, "[data-events]");
  const gameActions = query(root, "[data-game-actions]");
  const newBoard = queryButton(root, '[data-action="new-board"]');
  const saveBoard = queryButton(root, '[data-action="save-board"]');
  const reset = queryButton(root, '[data-action="reset"]');
  const powerupPrimer = query(root, "[data-powerup-primer]");
  const dismissPowerupPrimer = queryButton(root, '[data-action="dismiss-powerup-primer"]');
  const sidebarToggle = queryButton(root, '[data-action="toggle-sidebar"]');
  const toolClose = queryButton(root, '[data-action="close-tool-panel"]');
  const designerBrief = queryTextArea(root, '[data-designer="brief"]');
  const designerVisualPreset = querySelect(root, '[data-designer="visual-preset"]');
  const designerPending = query(root, "[data-designer-pending]");
  const generationSummary = query(root, "[data-generation-summary]");
  const compactGenerationSummary = query(root, "[data-compact-generation-summary]");
  const shareExport = queryTextArea(root, "[data-share-export]");
  const shareImport = queryTextArea(root, "[data-share-import]");
  const shareStatus = query(root, "[data-share-status]");
  const scoreCardDownload = query(root, "[data-score-card-download]") as HTMLAnchorElement;
  const refreshExport = queryButton(root, '[data-action="refresh-export"]');
  const copyExport = queryButton(root, '[data-action="copy-export"]');
  const importBoard = queryButton(root, '[data-action="import-board"]');
  const renderScoreCard = queryButton(root, '[data-action="render-score-card"]');
  const sfxVolume = queryInput(root, '[data-setting="sfx-volume"]');
  const musicVolume = queryInput(root, '[data-setting="music-volume"]');
  const sfxVolumeOutput = queryOutput(root, '[data-setting-output="sfx-volume"]');
  const musicVolumeOutput = queryOutput(root, '[data-setting-output="music-volume"]');
  const particles = queryInput(root, '[data-setting="particles"]');
  const reducedMotion = queryInput(root, '[data-setting="reduced-motion"]');
  const highContrast = queryInput(root, '[data-setting="high-contrast"]');
  const paddleSkin = querySelect(root, '[data-cosmetic="paddleSkin"]');
  const ballTrail = querySelect(root, '[data-cosmetic="ballTrail"]');
  const boardBackplate = querySelect(root, '[data-cosmetic="boardBackplate"]');
  const cosmeticStatus = query(root, "[data-cosmetic-status]");
  const activePowersEl = query(root, "[data-active-powers]");
  const consoleActivePowersEl = query(root, "[data-console-active-powers]");
  const packList = query(root, "[data-pack-list]");
  const liveAnnouncement = query(root, "[data-live-announcement]");
  const toolSurface = query(root, "[data-tool-surface]");
  const toolBackdrop = query(root, "[data-tool-backdrop]");
  const toolTitle = query(root, "[data-tool-title]");
  const toolButtons = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-tool-panel]"));
  const toolViews = Array.from(root.querySelectorAll<HTMLElement>("[data-tool-view]"));
  const traceStatus = query(root, "[data-trace-status]");
  const traceInput = queryCode(root, "[data-trace-input]");
  const tracePrompt = queryCode(root, "[data-trace-prompt]");
  const traceOutput = queryCode(root, "[data-trace-output]");
  const traceRaw = queryCode(root, "[data-trace-raw]");
  const traceErrors = queryCode(root, "[data-trace-errors]");

  let actions: HudActions | null = null;
  let previousScore = 0;
  let previousCombo = 1;
  let activeToolPanel: HudToolPanel | null = null;
  let previousToolFocus: HTMLElement | null = null;
  let previousPackListMarkup = "";
  let previousEventsMarkup = "";
  let previousShareExport = "";
  let previousActivePowersKey = "";
  let releaseToolFocusTrap: (() => void) | null = null;

  const emitSettings = () => {
    actions?.updateSettings({
      particles: particles.checked,
      reducedMotion: reducedMotion.checked,
      highContrast: highContrast.checked,
      sfxVolume: Number(sfxVolume.value),
      musicVolume: Number(musicVolume.value)
    });
  };

  const emitCosmetics = () => {
    actions?.updateCosmetics({
      paddleSkin: paddleSkin.value as GameCosmetics["paddleSkin"],
      ballTrail: ballTrail.value as GameCosmetics["ballTrail"],
      boardBackplate: boardBackplate.value as GameCosmetics["boardBackplate"]
    });
  };

  const emitDesigner = () => {
    actions?.updateDesigner({
      ...DEFAULT_DESIGNER_INTENT,
      brief: designerBrief.value,
      visualPreset: designerVisualPreset.value === "icon" ? "icon" : "arcade"
    });
  };

  const setToolPanel = (panel: HudToolPanel | null) => {
    activeToolPanel = panel;
    const isOpen = panel !== null;
    shell.classList.toggle("is-tool-panel-open", isOpen);
    shell.classList.toggle("is-pack-panel-open", panel === "packs");
    toolSurface.hidden = !isOpen;
    toolBackdrop.hidden = !isOpen;

    for (const button of toolButtons) {
      const isSelected = button.dataset.toolPanel === panel;
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-expanded", String(isSelected));
    }

    for (const view of toolViews) {
      view.hidden = view.dataset.toolView !== panel;
    }

    if (!panel) {
      releaseToolFocusTrap?.();
      releaseToolFocusTrap = null;
      if (previousToolFocus?.isConnected) previousToolFocus.focus({ preventScroll: true });
      previousToolFocus = null;
      return;
    }

    previousToolFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    toolTitle.textContent = TOOL_PANEL_LABELS[panel];
    toolSurface.setAttribute("aria-label", `${TOOL_PANEL_LABELS[panel]} panel`);
    toolClose.focus({ preventScroll: true });
    releaseToolFocusTrap?.();
    releaseToolFocusTrap = trapFocus(toolSurface, () => setToolPanel(null));
    if (panel === "share") {
      const nextExport = actions?.exportBoard() ?? "";
      shareExport.value = nextExport;
      previousShareExport = nextExport;
    }
  };

  const renderTrace = (trace?: ComposerAgentTrace) => {
    if (!trace) {
      traceStatus.textContent = "No generation trace yet.";
      traceInput.textContent = "";
      tracePrompt.textContent = "";
      traceOutput.textContent = "";
      traceRaw.textContent = "";
      traceErrors.textContent = "";
      return;
    }

    traceStatus.textContent = `Generation: ${trace.parseStatus}. ${trace.durationMs}ms${trace.streamStats ? `; ${formatStreamStats(trace.streamStats)}` : ""}`;
    traceInput.textContent = prettyJson(trace.request);
    tracePrompt.textContent = trace.prompt;
    traceOutput.textContent = trace.parsedOutput ? prettyJson(trace.parsedOutput) : "(not parsed)";
    traceRaw.textContent = trace.rawOutput || "(empty raw output)";
    traceErrors.textContent = trace.parseError || trace.rawError || "(no trace errors)";
  };

  const refreshShareExport = () => {
    const text = actions?.exportBoard() ?? "";
    shareExport.value = text;
    return text;
  };

  newBoard.addEventListener("click", () => actions?.requestBoard());
  saveBoard.addEventListener("click", () => actions?.saveBoardToPack());
  reset.addEventListener("click", () => actions?.resetProgress());
  refreshExport.addEventListener("click", () => {
    refreshShareExport();
    shareStatus.textContent = "Board export refreshed.";
  });
  copyExport.addEventListener("click", async () => {
    const text = refreshShareExport();
    const writeText = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!writeText) {
      shareStatus.textContent = "Copy unavailable. Select and copy the JSON manually.";
      return;
    }
    try {
      await writeText(text);
      shareStatus.textContent = "Board export copied.";
    } catch {
      shareStatus.textContent = "Copy unavailable. Select and copy the JSON manually.";
    }
  });
  importBoard.addEventListener("click", () => {
    const result = actions?.importBoard(shareImport.value) ?? { ok: false, message: "Import unavailable." };
    shareStatus.textContent = result.message;
    if (result.ok) {
      shareImport.value = "";
      refreshShareExport();
    }
  });
  renderScoreCard.addEventListener("click", async () => {
    const result = (await actions?.renderScoreCard()) ?? { ok: false, message: "Score-card renderer unavailable." };
    shareStatus.textContent = result.message;
    if (result.ok && result.dataUrl) {
      scoreCardDownload.href = result.dataUrl;
      scoreCardDownload.hidden = false;
    }
  });
  dismissPowerupPrimer.addEventListener("click", () => actions?.dismissPowerupPrimer());
  sidebarToggle.addEventListener("click", () => actions?.toggleSidebar());
  toolClose.addEventListener("click", () => setToolPanel(null));
  toolBackdrop.addEventListener("click", () => setToolPanel(null));
  for (const button of toolButtons) {
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const panel = normalizeToolPanel(button.dataset.toolPanel);
      if (panel) setToolPanel(panel === activeToolPanel ? null : panel);
    });
  }
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !activeToolPanel) return;
      event.preventDefault();
      event.stopPropagation();
      setToolPanel(null);
    },
    true
  );
  packList.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-pack-id]") : null;
    if (!button || button.disabled) return;
    setToolPanel(null);
    actions?.selectPack(button.dataset.packId ?? "");
  });
  designerBrief.addEventListener("input", emitDesigner);
  designerVisualPreset.addEventListener("change", emitDesigner);
  sfxVolume.addEventListener("input", emitSettings);
  musicVolume.addEventListener("input", emitSettings);
  particles.addEventListener("change", emitSettings);
  reducedMotion.addEventListener("change", emitSettings);
  highContrast.addEventListener("change", emitSettings);
  paddleSkin.addEventListener("change", emitCosmetics);
  ballTrail.addEventListener("change", emitCosmetics);
  boardBackplate.addEventListener("change", emitCosmetics);

  return {
    setActions(nextActions) {
      actions = nextActions;
    },
    closeToolPanel() {
      setToolPanel(null);
    },
    update(state) {
      const playerStatus = playerStatusFor(state);
      score.textContent = String(state.score);
      best.textContent = `Best ${state.bestScore}`;
      lives.textContent = renderLives(state.lives);
      lives.setAttribute("aria-label", `${state.lives} ${state.lives === 1 ? "life" : "lives"}`);
      level.textContent = `Level ${state.level}`;
      bricks.textContent = `${state.bricks} bricks`;
      combo.textContent = `Streak x${state.combo.toFixed(1)}`;
      combo.hidden = state.combo < 1.2;
      status.textContent = playerStatus;
      boardMeta.textContent = renderBoardMeta(state);
      levelName.textContent = state.levelName;
      hint.textContent = state.hint;
      consoleEvent.textContent = playerStatus;
      newBoard.textContent = state.pending ? "Shaping wall..." : state.boardSource === "generated" ? "Design another" : "Design board";
      newBoard.disabled = state.pending;
      designerPending.hidden = !state.pending;
      designerPending.textContent = `Shaping Level ${state.level}. The game is paused while the Designer builds a playable wall.`;
      gameActions.hidden = state.boardSource !== "generated";
      saveBoard.hidden = state.boardSource !== "generated";
      saveBoard.textContent = state.canSaveBoard ? "Keep board" : "Saved in Boards";
      saveBoard.disabled = state.pending || !state.canSaveBoard;
      reset.disabled = state.pending || !state.hasSave;
      sidebarToggle.textContent = state.sidebarCollapsed ? "⟩" : "⟨";
      sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
      if (document.activeElement !== designerBrief) {
        designerBrief.value = state.designer.intent.brief;
      }
      if (document.activeElement !== designerVisualPreset) {
        designerVisualPreset.value = state.designer.intent.visualPreset === "icon" ? "icon" : "arcade";
      }
      renderSummary(generationSummary, state.designer.generationSummary, state.designer.previewRows);
      renderCompactSummary(compactGenerationSummary, state);
      if (activeToolPanel === "share" && document.activeElement !== shareExport && document.activeElement !== shareImport) {
        const nextExport = actions?.exportBoard() ?? "";
        if (nextExport !== previousShareExport) {
          shareExport.value = nextExport;
          previousShareExport = nextExport;
        }
      }
      powerupPrimer.hidden = state.powerupPrimerDismissed;
      sfxVolume.value = String(state.settings.sfxVolume);
      musicVolume.value = String(state.settings.musicVolume);
      sfxVolumeOutput.textContent = formatVolume(state.settings.sfxVolume);
      musicVolumeOutput.textContent = formatVolume(state.settings.musicVolume);
      renderCosmeticOptions(paddleSkin, state.cosmeticOptions.paddleSkins, state.cosmetics.paddleSkin);
      renderCosmeticOptions(ballTrail, state.cosmeticOptions.ballTrails, state.cosmetics.ballTrail);
      renderCosmeticOptions(boardBackplate, state.cosmeticOptions.boardBackplates, state.cosmetics.boardBackplate);
      cosmeticStatus.textContent = cosmeticStatusFor(state);
      particles.checked = state.settings.particles;
      reducedMotion.checked = state.settings.reducedMotion;
      highContrast.checked = state.settings.highContrast;
      score.classList.toggle("is-pulsing", state.score > previousScore);
      combo.classList.toggle("is-pulsing", state.combo > previousCombo + 0.05);
      previousScore = state.score;
      previousCombo = state.combo;
      const activePowersKey = state.activePowers.map((power) => `${power.label}:${power.seconds}`).join("|");
      if (activePowersKey !== previousActivePowersKey) {
        previousActivePowersKey = activePowersKey;
        if (state.activePowers.length > 0) {
          const activePowersMarkup = state.activePowers.map(renderPower).join("");
          activePowersEl.hidden = false;
          consoleActivePowersEl.hidden = false;
          activePowersEl.innerHTML = activePowersMarkup;
          consoleActivePowersEl.innerHTML = activePowersMarkup;
        } else {
          activePowersEl.hidden = true;
          consoleActivePowersEl.hidden = true;
          activePowersEl.innerHTML = "";
          consoleActivePowersEl.innerHTML = "";
        }
      }
      liveAnnouncement.textContent = state.announcement;
      const packListMarkup = renderPackListMarkup(state.packs, state.pending);
      if (packListMarkup !== previousPackListMarkup) {
        packList.innerHTML = packListMarkup;
        previousPackListMarkup = packListMarkup;
      }
      const eventsMarkup = state.events.map((event) => `<li>${escapeHtml(gameEventText(event))}</li>`).join("");
      if (eventsMarkup !== previousEventsMarkup) {
        events.innerHTML = eventsMarkup;
        previousEventsMarkup = eventsMarkup;
      }
      renderTrace(state.agentTrace);
    }
  };
}

function query(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing HUD element ${selector}`);
  return element;
}

function queryButton(root: ParentNode, selector: string): HTMLButtonElement {
  const element = root.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing HUD button ${selector}`);
  return element;
}

function queryInput(root: ParentNode, selector: string): HTMLInputElement {
  const element = root.querySelector<HTMLInputElement>(selector);
  if (!element) throw new Error(`Missing HUD input ${selector}`);
  return element;
}

function queryOutput(root: ParentNode, selector: string): HTMLOutputElement {
  const element = root.querySelector<HTMLOutputElement>(selector);
  if (!element) throw new Error(`Missing HUD output ${selector}`);
  return element;
}

function querySelect(root: ParentNode, selector: string): HTMLSelectElement {
  const element = root.querySelector<HTMLSelectElement>(selector);
  if (!element) throw new Error(`Missing HUD select ${selector}`);
  return element;
}

function queryTextArea(root: ParentNode, selector: string): HTMLTextAreaElement {
  const element = root.querySelector<HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing HUD textarea ${selector}`);
  return element;
}

function queryCode(root: ParentNode, selector: string): HTMLPreElement {
  const element = root.querySelector<HTMLPreElement>(selector);
  if (!element) throw new Error(`Missing HUD code block ${selector}`);
  return element;
}

function normalizeToolPanel(value: string | undefined): HudToolPanel | null {
  if (value === "designer" || value === "packs" || value === "share" || value === "options" || value === "diagnostics") return value;
  return null;
}

function formatVolume(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function renderLives(lives: number): string {
  if (lives <= 0) return "0";
  const dots = "●".repeat(Math.min(lives, 5));
  return lives > 5 ? `${dots}+${lives - 5}` : dots;
}

function playerStatusFor(state: HudState): string {
  if (state.pending) return "Designer is shaping a playable wall.";
  const playerEvent = state.events.find((event) => gameEventAudience(event) === "player");
  return (playerEvent ? gameEventText(playerEvent) : "") || state.status || state.hint || "Aim the rebound. Keep the streak alive.";
}

function renderBoardMeta(state: HudState): string {
  if (state.boardSource === "generated") return "Custom board";
  const activePack = state.packs.find((pack) => pack.active);
  if (!activePack) return "Curated board";
  return `${activePack.name} - ${activePack.progressLabel}`;
}

function renderCompactSummary(element: HTMLElement, _state: HudState) {
  element.hidden = true;
  element.classList.remove("is-cursor-sdk", "is-fallback");
  element.innerHTML = "";
}

function renderPower(power: HudState["activePowers"][number]): string {
  const width = Math.round(Math.max(0, Math.min(1, power.seconds / power.maxSeconds)) * 100);
  return `<span class="power-timer is-${power.tone}"><span>${escapeHtml(power.label)}</span><strong>${power.seconds}s</strong><i style="width: ${width}%"></i></span>`;
}

function renderCosmeticOptions<T extends string>(select: HTMLSelectElement, options: Array<{ id: T; label: string; unlocked: boolean }>, value: T) {
  const markup = options.map((option) => `<option value="${escapeAttribute(option.id)}"${option.unlocked ? "" : " disabled"}>${escapeHtml(option.label)}${option.unlocked ? "" : " (locked)"}</option>`).join("");
  if (select.innerHTML !== markup) select.innerHTML = markup;
  select.value = options.some((option) => option.id === value && option.unlocked) ? value : options.find((option) => option.unlocked)?.id ?? value;
}

function cosmeticStatusFor(state: HudState): string {
  const unlocked = [
    ...state.cosmeticOptions.paddleSkins,
    ...state.cosmeticOptions.ballTrails,
    ...state.cosmeticOptions.boardBackplates
  ].filter((option) => option.unlocked).length;
  return `${unlocked} cosmetic choices unlocked. Local-only visuals; physics and scoring do not change.`;
}

function renderSummary(element: HTMLElement, summary?: GenerationSummary, previewRows: string[] = []) {
  if (!summary) {
    element.hidden = true;
    element.innerHTML = "";
    return;
  }
  element.hidden = false;
  const chips = summary.chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
  const preview = previewRows.length > 0 ? `<span class="summary-preview" aria-label="Generated board thumbnail">${renderMiniPreview(previewRows)}</span>` : "";
  element.innerHTML = `
    ${preview}
    <strong>${escapeHtml(summary.title)}</strong>
    <p>${escapeHtml(summary.detail)}</p>
    <div>${chips}</div>
    <small>Keep to Saved Designs, replay from the gallery, remix the prompt above, or discard by designing another board.</small>
    ${summary.warning ? `<em>${escapeHtml(summary.warning)}</em>` : ""}
  `;
}

function formatStreamStats(stats: ComposerAgentTrace["streamStats"]): string {
  if (!stats) return "";
  const pieces = [`thinking ${stats.thinkingEvents}`, `assistant ${stats.assistantEvents}`];
  if (stats.toolCallEvents > 0) pieces.push(`tools ${stats.toolCallEvents} (${stats.firstToolCalls.join(", ")})`);
  return pieces.join(", ");
}

function renderPackListMarkup(packs: HudPackItem[], pending: boolean): string {
  const daily = packs.find((pack) => pack.id === "daily");
  const builtIn = packs.filter((pack) => pack.kind !== "saved-board" && pack.id !== "daily" && pack.id !== "saved-designs");
  const savedCollection = packs.find((pack) => pack.id === "saved-designs");
  const savedBoards = packs.filter((pack) => pack.kind === "saved-board");
  const unlockedBuiltIn = builtIn.filter((pack) => pack.unlocked);
  const lockedBuiltIn = builtIn.filter((pack) => !pack.unlocked);

  const sections: string[] = [];
  if (daily) {
    sections.push(renderPackSection("Today", [daily], pending));
  }
  if (unlockedBuiltIn.length > 0) {
    sections.push(renderPackSection("Curated packs", unlockedBuiltIn, pending));
  }
  if (lockedBuiltIn.length > 0) {
    sections.push(renderPackSection("Locked packs", lockedBuiltIn, pending, { compact: true }));
  }
  if (savedCollection) {
    const savedHeading = savedBoards.length > 0 ? "Saved designs" : "Saved designs (empty)";
    sections.push(renderPackSection(savedHeading, [savedCollection, ...savedBoards], pending));
  }
  return sections.join("");
}

function renderPackSection(
  heading: string,
  packs: HudPackItem[],
  pending: boolean,
  options?: { compact?: boolean }
): string {
  const cards = packs.map((pack) => renderPack(pack, pending, options?.compact === true && !pack.unlocked && pack.kind === "pack")).join("");
  return `
    <section class="pack-section" aria-label="${escapeAttribute(heading)}">
      <h3 class="pack-section-heading">${escapeHtml(heading)}</h3>
      <div class="pack-section-list">${cards}</div>
    </section>
  `;
}

function renderPack(pack: HudPackItem, pending: boolean, compact = false): string {
  const classes = ["pack-card"];
  if (pack.active) classes.push("is-active");
  if (pack.empty) classes.push("is-empty");
  if (pack.kind === "saved-board") classes.push("is-saved-board");
  if (compact) classes.push("is-compact");
  const disabled = pending || !pack.unlocked || pack.empty;
  const previewRows = pack.previewRows.length > 0 ? pack.previewRows : ["..............", "..............", ".............."];
  const prompt = pack.sourcePrompt ? `<span class="pack-prompt">Prompt: ${escapeHtml(pack.sourcePrompt)}</span>` : "";
  const date = pack.createdAt ? ` · saved ${formatShortDate(pack.createdAt)}` : "";
  const actionLabel = pack.actionLabel ?? (pack.kind === "saved-board" ? "Replay" : "Play");
  const description =
    pack.empty && pack.id === "saved-designs"
      ? "Keep a generated board from the Designer to unlock individual replays here."
      : pack.description;
  const meta = compact
    ? `<em>${escapeHtml(pack.progressLabel)} · ${escapeHtml(actionLabel)}</em>`
    : `<em>${escapeHtml(pack.progressLabel)} · best ${pack.bestScore}${escapeHtml(date)} · ${escapeHtml(actionLabel)}</em>`;
  const preview = compact ? "" : `<span class="pack-preview" aria-hidden="true">${renderMiniPreview(previewRows)}</span>`;
  return `
    <button type="button" class="${classes.join(" ")}" data-pack-id="${escapeAttribute(pack.id)}" ${disabled ? "disabled" : ""}>
      ${preview}
      <span class="pack-copy">
        <strong>${escapeHtml(pack.name)}</strong>
        <span>${escapeHtml(description)}</span>
        ${compact ? "" : prompt}
        ${meta}
      </span>
    </button>
  `;
}

function renderMiniPreview(previewRows: string[]): string {
  return previewRows
    .slice(0, 9)
    .map((row) =>
      row
        .slice(0, 14)
        .padEnd(14, ".")
        .split("")
        .map((glyph) => `<i class="mini-brick mini-${glyphClass(glyph)}"></i>`)
        .join("")
    )
    .join("");
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown date";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function glyphClass(glyph: string): string {
  if (glyph === ".") return "empty";
  if (glyph === "B") return "boss";
  if (glyph === "o") return "bomb";
  if (glyph === "h") return "hard";
  if (glyph === "p") return "prize";
  if (glyph === "x") return "penalty";
  if (glyph === "l") return "laser";
  if (glyph === "f") return "fire";
  if (glyph === "g") return "grab";
  if (glyph === "s") return "split";
  if (glyph === "w") return "wide";
  if (glyph === "c") return "slow";
  if (glyph === "t") return "thru";
  return "basic";
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}
