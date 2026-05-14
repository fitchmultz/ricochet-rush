import {
  DEFAULT_DESIGNER_INTENT,
  type BoardDesignerIntent,
  type ComposerAgentTrace,
  type GenerationSummary
} from "../../shared/evolution";

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
    ballSpeed: number;
    particles: boolean;
    reducedMotion: boolean;
    highContrast: boolean;
    sfx: boolean;
    music: boolean;
  };
  activePowers: { label: string; seconds: number; maxSeconds: number; tone: "reward" | "hazard" | "volatile" }[];
  powerupPrimerDismissed: boolean;
  packs: HudPackItem[];
  canSaveBoard: boolean;
  boardSource: "pack" | "generated";
  designer: {
    intent: BoardDesignerIntent;
    generationSummary?: GenerationSummary;
  };
  events: string[];
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
  updateSettings(settings: HudState["settings"]): void;
}

export interface HudApi {
  update(state: HudState): void;
  setActions(actions: HudActions): void;
}

type HudToolPanel = "designer" | "packs" | "options" | "diagnostics";

const TOOL_PANEL_LABELS: Record<HudToolPanel, string> = {
  designer: "Board Designer",
  packs: "Board Select",
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
          <div class="hud-primary">
            <div class="meters">
              <span data-score>0</span>
              <span data-best>best 0</span>
              <span data-lives>3 lives</span>
              <span data-level>level 1</span>
              <span data-bricks>0 bricks</span>
              <span data-combo>x1.0</span>
            </div>
            <div data-active-powers class="active-powers" hidden></div>
          </div>
          <div data-status class="status"></div>
        </div>
        <div class="touch-controls" aria-label="Touch controls">
          <button type="button" data-touch-action="left" aria-label="Move paddle left">←</button>
          <button type="button" data-touch-action="primary" class="touch-primary">Launch</button>
          <button type="button" data-touch-action="right" aria-label="Move paddle right">→</button>
          <button type="button" data-touch-action="pause">Pause</button>
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
          <button type="button" data-tool-panel="options">Options</button>
          <button type="button" data-tool-panel="diagnostics">Log</button>
        </nav>
        <div class="console-status" aria-label="Latest event">
          <strong>Latest</strong>
          <span data-console-event>Break the wall. Catch powerups. Clear the board.</span>
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
                <textarea data-designer="brief" maxlength="180" rows="4" placeholder="heart shaped board with only exploding blocks"></textarea>
              </label>
            </div>
            <div class="designer-actions">
              <button type="button" data-action="new-board">Design board</button>
              <span data-designer-pending hidden>Generating Level 1...</span>
            </div>
            <div data-generation-summary class="generation-summary" hidden></div>
          </section>
          <section class="pack-browser tool-view" data-tool-view="packs" aria-label="Board packs" hidden>
            <div class="panel-heading">Board Select</div>
            <div data-pack-list class="pack-list"></div>
          </section>
          <section class="settings-panel tool-view" data-tool-view="options" aria-label="Options" hidden>
            <div class="panel-heading">Options</div>
            <form class="settings" aria-label="Settings">
              <label>
                <span>Ball speed</span>
                <input data-setting="ball-speed" type="range" min="0.8" max="1.2" step="0.05" value="1" />
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
              <label class="toggle">
                <span>SFX</span>
                <input data-setting="sfx" type="checkbox" />
              </label>
              <label class="toggle">
                <span>Music</span>
                <input data-setting="music" type="checkbox" />
              </label>
            </form>
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
  const designerPending = query(root, "[data-designer-pending]");
  const generationSummary = query(root, "[data-generation-summary]");
  const compactGenerationSummary = query(root, "[data-compact-generation-summary]");
  const ballSpeed = queryInput(root, '[data-setting="ball-speed"]');
  const particles = queryInput(root, '[data-setting="particles"]');
  const reducedMotion = queryInput(root, '[data-setting="reduced-motion"]');
  const highContrast = queryInput(root, '[data-setting="high-contrast"]');
  const sfx = queryInput(root, '[data-setting="sfx"]');
  const music = queryInput(root, '[data-setting="music"]');
  const activePowersEl = query(root, "[data-active-powers]");
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

  const emitSettings = () => {
    actions?.updateSettings({
      ballSpeed: Number(ballSpeed.value),
      particles: particles.checked,
      reducedMotion: reducedMotion.checked,
      highContrast: highContrast.checked,
      sfx: sfx.checked,
      music: music.checked
    });
  };

  const emitDesigner = () => {
    actions?.updateDesigner({
      ...DEFAULT_DESIGNER_INTENT,
      brief: designerBrief.value
    });
  };

  const setToolPanel = (panel: HudToolPanel | null) => {
    activeToolPanel = panel;
    const isOpen = panel !== null;
    shell.classList.toggle("is-tool-panel-open", isOpen);
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
      if (previousToolFocus?.isConnected) previousToolFocus.focus({ preventScroll: true });
      previousToolFocus = null;
      return;
    }

    previousToolFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    toolTitle.textContent = TOOL_PANEL_LABELS[panel];
    toolSurface.setAttribute("aria-label", `${TOOL_PANEL_LABELS[panel]} panel`);
    toolClose.focus({ preventScroll: true });
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

  newBoard.addEventListener("click", () => actions?.requestBoard());
  saveBoard.addEventListener("click", () => actions?.saveBoardToPack());
  reset.addEventListener("click", () => actions?.resetProgress());
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
  ballSpeed.addEventListener("input", emitSettings);
  particles.addEventListener("change", emitSettings);
  reducedMotion.addEventListener("change", emitSettings);
  highContrast.addEventListener("change", emitSettings);
  sfx.addEventListener("change", emitSettings);
  music.addEventListener("change", emitSettings);

  return {
    setActions(nextActions) {
      actions = nextActions;
    },
    update(state) {
      score.textContent = `${state.score} pts`;
      best.textContent = `best ${state.bestScore}`;
      lives.textContent = `${state.lives} lives`;
      level.textContent = `level ${state.level}`;
      bricks.textContent = `${state.bricks} bricks`;
      combo.textContent = `x${state.combo.toFixed(1)}`;
      status.textContent = state.pending ? "Designing board..." : state.status;
      boardMeta.textContent = renderBoardMeta(state);
      levelName.textContent = state.levelName;
      hint.textContent = state.hint;
      consoleEvent.textContent = state.pending ? "Designing the next board." : state.events[0] ?? state.status;
      newBoard.textContent = state.pending ? `Generating Level ${state.level}` : state.boardSource === "generated" ? "Design another board" : "Design board";
      newBoard.disabled = state.pending;
      designerPending.hidden = !state.pending;
      designerPending.textContent = `Generating Level ${state.level}. The game is paused while Cursor SDK designs and validates the wall.`;
      gameActions.hidden = state.boardSource !== "generated";
      saveBoard.hidden = state.boardSource !== "generated";
      saveBoard.disabled = state.pending || !state.canSaveBoard;
      reset.disabled = state.pending || !state.hasSave;
      sidebarToggle.textContent = state.sidebarCollapsed ? "⟩" : "⟨";
      sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
      if (document.activeElement !== designerBrief) {
        designerBrief.value = state.designer.intent.brief;
      }
      renderSummary(generationSummary, state.designer.generationSummary);
      renderCompactSummary(compactGenerationSummary, state);
      powerupPrimer.hidden = state.powerupPrimerDismissed;
      ballSpeed.value = String(state.settings.ballSpeed);
      particles.checked = state.settings.particles;
      reducedMotion.checked = state.settings.reducedMotion;
      highContrast.checked = state.settings.highContrast;
      sfx.checked = state.settings.sfx;
      music.checked = state.settings.music;
      score.classList.toggle("is-pulsing", state.score > previousScore);
      combo.classList.toggle("is-pulsing", state.combo > previousCombo + 0.05);
      previousScore = state.score;
      previousCombo = state.combo;
      if (state.activePowers.length > 0) {
        activePowersEl.hidden = false;
        activePowersEl.innerHTML = state.activePowers.map(renderPower).join("");
      } else {
        activePowersEl.hidden = true;
        activePowersEl.innerHTML = "";
      }
      liveAnnouncement.textContent = state.announcement;
      const packListMarkup = state.packs.map((pack) => renderPack(pack, state.pending)).join("");
      if (packListMarkup !== previousPackListMarkup) {
        packList.innerHTML = packListMarkup;
        previousPackListMarkup = packListMarkup;
      }
      events.innerHTML = state.events.map((event) => `<li>${escapeHtml(event)}</li>`).join("");
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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function normalizeToolPanel(value: string | undefined): HudToolPanel | null {
  if (value === "designer" || value === "packs" || value === "options" || value === "diagnostics") return value;
  return null;
}

function renderBoardMeta(state: HudState): string {
  if (state.boardSource === "generated") return "Generated board";
  const activePack = state.packs.find((pack) => pack.active);
  if (!activePack) return "Curated board";
  return `${activePack.name} - ${activePack.progressLabel}`;
}

function renderCompactSummary(element: HTMLElement, state: HudState) {
  const summary = state.designer.generationSummary;
  if (state.boardSource !== "generated" || !summary) {
    element.hidden = true;
    element.classList.remove("is-cursor-sdk", "is-fallback");
    element.innerHTML = "";
    return;
  }

  element.hidden = false;
  element.classList.toggle("is-cursor-sdk", summary.source === "cursor-sdk");
  element.classList.toggle("is-fallback", summary.source === "fallback");
  const chips = summary.chips
    .slice(0, 3)
    .map((chip) => `<span>${escapeHtml(chip)}</span>`)
    .join("");
  const statusLabel = summary.source === "cursor-sdk" ? "New board ready" : "Local backup used";
  element.innerHTML = `
    <span>${statusLabel}</span>
    <strong>${escapeHtml(summary.title)}</strong>
    <div>${chips}</div>
    ${summary.warning ? `<em>${escapeHtml(summary.warning)}</em>` : ""}
  `;
}

function renderPower(power: HudState["activePowers"][number]): string {
  const width = Math.round(Math.max(0, Math.min(1, power.seconds / power.maxSeconds)) * 100);
  return `<span class="power-timer is-${power.tone}"><span>${escapeHtml(power.label)}</span><strong>${power.seconds}s</strong><i style="width: ${width}%"></i></span>`;
}

function renderSummary(element: HTMLElement, summary?: GenerationSummary) {
  if (!summary) {
    element.hidden = true;
    element.innerHTML = "";
    return;
  }
  element.hidden = false;
  const chips = summary.chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
  element.innerHTML = `
    <strong>${escapeHtml(summary.title)}</strong>
    <p>${escapeHtml(summary.detail)}</p>
    <div>${chips}</div>
    ${summary.warning ? `<em>${escapeHtml(summary.warning)}</em>` : ""}
  `;
}

function formatStreamStats(stats: ComposerAgentTrace["streamStats"]): string {
  if (!stats) return "";
  const pieces = [`thinking ${stats.thinkingEvents}`, `assistant ${stats.assistantEvents}`];
  if (stats.toolCallEvents > 0) pieces.push(`tools ${stats.toolCallEvents} (${stats.firstToolCalls.join(", ")})`);
  return pieces.join(", ");
}

function renderPack(pack: HudPackItem, pending: boolean): string {
  const classes = ["pack-card"];
  if (pack.active) classes.push("is-active");
  if (pack.empty) classes.push("is-empty");
  const disabled = pending || !pack.unlocked || pack.empty;
  const previewRows = pack.previewRows.length > 0 ? pack.previewRows : ["..............", "..............", ".............."];
  const preview = previewRows
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
  return `
    <button type="button" class="${classes.join(" ")}" data-pack-id="${escapeAttribute(pack.id)}" ${disabled ? "disabled" : ""}>
      <span class="pack-preview" aria-hidden="true">${preview}</span>
      <span class="pack-copy">
        <strong>${escapeHtml(pack.name)}</strong>
        <span>${escapeHtml(pack.description)}</span>
        <em>${escapeHtml(pack.progressLabel)} · best ${pack.bestScore}</em>
      </span>
    </button>
  `;
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
