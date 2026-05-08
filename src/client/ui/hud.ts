import type { ComposerAgentTrace } from "../../shared/evolution";

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
    sound: boolean;
  };
  activePowers: { label: string; seconds: number; maxSeconds: number }[];
  packs: HudPackItem[];
  canSaveBoard: boolean;
  events: string[];
  announcement: string;
  sidebarCollapsed?: boolean;
  agentTrace?: ComposerAgentTrace;
}

export interface HudActions {
  requestBoard(): void;
  saveNow(): void;
  saveBoardToPack(): void;
  resetProgress(): void;
  selectPack(packId: string): void;
  toggleSidebar(): void;
  updateSettings(settings: HudState["settings"]): void;
}

export interface HudApi {
  update(state: HudState): void;
  setActions(actions: HudActions): void;
}

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
        <div class="hint">A/D or arrows move - Space/Enter launch or continue - P/Escape pause - N generate a new board</div>
        <div data-live-announcement class="sr-only" aria-live="polite" aria-atomic="true"></div>
      </section>
      <aside class="panel">
        <button type="button" data-action="toggle-sidebar" class="sidebar-toggle" aria-label="Toggle sidebar">⟨</button>
        <div class="brand">Ricochet Rush</div>
        <div class="controls">
          <strong data-level-name>Starter Wall</strong>
          <span data-hint>Keep the ball angled. Flat returns are a trap.</span>
        </div>
        <div class="actions" aria-label="Game actions">
          <button type="button" data-action="new-board">New board</button>
          <button type="button" data-action="save-board">Keep board</button>
          <button type="button" data-action="save">Save run</button>
          <button type="button" data-action="reset">Clear save</button>
        </div>
        <section class="pack-browser" aria-label="Board packs">
          <div class="panel-heading">Board packs</div>
          <div data-pack-list class="pack-list"></div>
        </section>
        <form class="settings" aria-label="Settings">
          <label>
            <span>Ball speed</span>
            <input data-setting="ball-speed" type="range" min="0.8" max="1.2" step="0.05" value="1" />
          </label>
          <label class="toggle">
            <input data-setting="particles" type="checkbox" checked />
            <span>Particles</span>
          </label>
          <label class="toggle">
            <input data-setting="reduced-motion" type="checkbox" />
            <span>Reduced motion</span>
          </label>
          <label class="toggle">
            <input data-setting="high-contrast" type="checkbox" />
            <span>High contrast</span>
          </label>
          <label class="toggle">
            <input data-setting="sound" type="checkbox" />
            <span>Sound</span>
          </label>
        </form>
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
        <ol data-events class="events"></ol>
        <details class="agent-trace" data-agent-trace>
          <summary>Composer trace</summary>
          <div class="agent-trace-content">
            <p data-trace-status class="agent-trace-status">No composer trace yet.</p>
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
      </aside>
    </main>
  `;

  const score = query(root, "[data-score]");
  const best = query(root, "[data-best]");
  const lives = query(root, "[data-lives]");
  const level = query(root, "[data-level]");
  const bricks = query(root, "[data-bricks]");
  const combo = query(root, "[data-combo]");
  const status = query(root, "[data-status]");
  const levelName = query(root, "[data-level-name]");
  const hint = query(root, "[data-hint]");
  const events = query(root, "[data-events]");
  const newBoard = queryButton(root, '[data-action="new-board"]');
  const saveBoard = queryButton(root, '[data-action="save-board"]');
  const save = queryButton(root, '[data-action="save"]');
  const reset = queryButton(root, '[data-action="reset"]');
  const sidebarToggle = queryButton(root, '[data-action="toggle-sidebar"]');
  const ballSpeed = queryInput(root, '[data-setting="ball-speed"]');
  const particles = queryInput(root, '[data-setting="particles"]');
  const reducedMotion = queryInput(root, '[data-setting="reduced-motion"]');
  const highContrast = queryInput(root, '[data-setting="high-contrast"]');
  const sound = queryInput(root, '[data-setting="sound"]');
  const activePowersEl = query(root, "[data-active-powers]");
  const packList = query(root, "[data-pack-list]");
  const liveAnnouncement = query(root, "[data-live-announcement]");
  const traceStatus = query(root, "[data-trace-status]");
  const traceInput = queryCode(root, "[data-trace-input]");
  const tracePrompt = queryCode(root, "[data-trace-prompt]");
  const traceOutput = queryCode(root, "[data-trace-output]");
  const traceRaw = queryCode(root, "[data-trace-raw]");
  const traceErrors = queryCode(root, "[data-trace-errors]");

  let actions: HudActions | null = null;
  let previousScore = 0;
  let previousCombo = 1;

  const emitSettings = () => {
    actions?.updateSettings({
      ballSpeed: Number(ballSpeed.value),
      particles: particles.checked,
      reducedMotion: reducedMotion.checked,
      highContrast: highContrast.checked,
      sound: sound.checked
    });
  };

  const renderTrace = (trace?: ComposerAgentTrace) => {
    if (!trace) {
      traceStatus.textContent = "No composer trace yet.";
      traceInput.textContent = "";
      tracePrompt.textContent = "";
      traceOutput.textContent = "";
      traceRaw.textContent = "";
      traceErrors.textContent = "";
      return;
    }

    traceStatus.textContent = `Status: ${trace.parseStatus}. ${trace.durationMs}ms`;
    traceInput.textContent = prettyJson(trace.request);
    tracePrompt.textContent = trace.prompt;
    traceOutput.textContent = trace.parsedOutput ? prettyJson(trace.parsedOutput) : "(not parsed)";
    traceRaw.textContent = trace.rawOutput || "(empty raw output)";
    traceErrors.textContent = trace.parseError || trace.rawError || "(no trace errors)";
  };

  newBoard.addEventListener("click", () => actions?.requestBoard());
  saveBoard.addEventListener("click", () => actions?.saveBoardToPack());
  save.addEventListener("click", () => actions?.saveNow());
  reset.addEventListener("click", () => actions?.resetProgress());
  sidebarToggle.addEventListener("click", () => actions?.toggleSidebar());
  packList.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-pack-id]") : null;
    if (!button || button.disabled) return;
    actions?.selectPack(button.dataset.packId ?? "");
  });
  ballSpeed.addEventListener("input", emitSettings);
  particles.addEventListener("change", emitSettings);
  reducedMotion.addEventListener("change", emitSettings);
  highContrast.addEventListener("change", emitSettings);
  sound.addEventListener("change", emitSettings);

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
      status.textContent = state.pending ? "Forging level..." : state.status;
      levelName.textContent = state.levelName;
      hint.textContent = state.hint;
      newBoard.disabled = state.pending;
      saveBoard.disabled = state.pending || !state.canSaveBoard;
      save.disabled = state.pending;
      reset.disabled = state.pending || !state.hasSave;
      sidebarToggle.textContent = state.sidebarCollapsed ? "⟩" : "⟨";
      sidebarToggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
      ballSpeed.value = String(state.settings.ballSpeed);
      particles.checked = state.settings.particles;
      reducedMotion.checked = state.settings.reducedMotion;
      highContrast.checked = state.settings.highContrast;
      sound.checked = state.settings.sound;
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
      packList.innerHTML = state.packs.map(renderPack).join("");
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

function renderPower(power: HudState["activePowers"][number]): string {
  const width = Math.round(Math.max(0, Math.min(1, power.seconds / power.maxSeconds)) * 100);
  return `<span class="power-timer"><span>${escapeHtml(power.label)}</span><strong>${power.seconds}s</strong><i style="width: ${width}%"></i></span>`;
}

function renderPack(pack: HudPackItem): string {
  const classes = ["pack-card"];
  if (pack.active) classes.push("is-active");
  if (pack.empty) classes.push("is-empty");
  const disabled = !pack.unlocked || pack.empty;
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
