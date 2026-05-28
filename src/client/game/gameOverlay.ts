import { escapeAttribute, escapeHtml } from "../../shared/util";
import { trapFocus } from "../ui/focusTrap";
import type { SummaryAction, SummaryStat } from "./gameEntityTypes";

export interface GameOverlayHost {
  readonly mount: HTMLDivElement;
  readonly overlay: HTMLDivElement;
  closeToolPanel(): void;
}

export class GameOverlay {
  private releaseFocusTrap: (() => void) | null = null;
  private previouslyFocusedElement: HTMLElement | null = null;

  constructor(private readonly host: GameOverlayHost) {}

  hide() {
    this.releaseFocusTrap?.();
    this.releaseFocusTrap = null;
    this.host.overlay.classList.remove("is-visible");
    this.host.mount.closest<HTMLElement>(".stage")?.classList.remove("has-visible-overlay", "has-priority-overlay");
    this.host.overlay.innerHTML = "";
    if (this.previouslyFocusedElement?.isConnected) this.previouslyFocusedElement.focus({ preventScroll: true });
    this.previouslyFocusedElement = null;
  }

  showLoading(title: string, body: string) {
    this.show(title, body, undefined, undefined, true);
  }

  showLevelReady(title: string, body: string, onLaunch: () => void) {
    this.show(title, body, "Launch", onLaunch);
  }

  show(
    title: string,
    body: string,
    actionLabel?: string,
    action?: () => void,
    busy = false,
    secondaryLabel?: string,
    secondaryAction?: () => void
  ) {
    if (secondaryLabel) this.host.closeToolPanel();
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stage = this.host.mount.closest<HTMLElement>(".stage");
    stage?.classList.add("has-visible-overlay");
    stage?.classList.toggle("has-priority-overlay", busy || Boolean(secondaryLabel));
    this.host.overlay.classList.add("is-visible");
    this.host.overlay.innerHTML = `
      <div class="overlay-card" role="dialog" aria-modal="true" aria-label="${escapeAttribute(title)}">
        <div class="overlay-kicker">${busy ? "Generating" : "Ricochet Rush"}</div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(body)}</p>
        ${
          actionLabel
            ? `<div class="overlay-actions"><button type="button" data-overlay-action>${escapeHtml(actionLabel)}</button>${
                secondaryLabel ? `<button type="button" class="secondary" data-overlay-secondary>${escapeHtml(secondaryLabel)}</button>` : ""
              }</div>`
            : `<div class="loader-bar"><span></span></div>`
        }
      </div>
    `;
    const button = this.host.overlay.querySelector<HTMLButtonElement>("[data-overlay-action]");
    const secondaryButton = this.host.overlay.querySelector<HTMLButtonElement>("[data-overlay-secondary]");
    if (button && action) button.addEventListener("click", action, { once: true });
    if (secondaryButton && secondaryAction) secondaryButton.addEventListener("click", secondaryAction, { once: true });
    button?.focus({ preventScroll: true });
    const card = this.host.overlay.querySelector<HTMLElement>(".overlay-card");
    if (card) {
      this.releaseFocusTrap?.();
      this.releaseFocusTrap = trapFocus(card, () => {
        if (secondaryAction) secondaryAction();
      });
    }
  }

  showRunSummary(mode: "clear" | "gameOver", content: { title: string; body: string; actions: SummaryAction[] }, stats: SummaryStat[]) {
    this.host.closeToolPanel();
    this.previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const stage = this.host.mount.closest<HTMLElement>(".stage");
    stage?.classList.add("has-visible-overlay", "has-priority-overlay");
    this.host.overlay.classList.add("is-visible");
    this.host.overlay.innerHTML = `
      <div class="overlay-card run-summary" role="dialog" aria-modal="true" aria-label="${escapeAttribute(content.title)}" data-run-summary="${mode}">
        <div class="overlay-kicker">${mode === "clear" ? "Board Clear" : "Run Summary"}</div>
        <h1>${escapeHtml(content.title)}</h1>
        <p>${escapeHtml(content.body)}</p>
        <dl class="summary-grid" aria-label="Run stats">
          ${stats
            .map(
              (stat) => `<div class="summary-stat is-${stat.tone ?? "neutral"}"><dt>${escapeHtml(stat.label)}</dt><dd>${escapeHtml(stat.value)}</dd></div>`
            )
            .join("")}
        </dl>
        <div class="overlay-actions summary-actions">
          ${content.actions
            .map(
              (action, index) =>
                `<button type="button" class="${action.primary ? "" : "secondary"}" data-summary-action="${index}"${action.disabled ? " disabled aria-disabled=\"true\"" : ""}>${escapeHtml(action.label)}</button>`
            )
            .join("")}
        </div>
      </div>
    `;
    for (const [index, action] of content.actions.entries()) {
      const button = this.host.overlay.querySelector<HTMLButtonElement>(`[data-summary-action="${index}"]`);
      if (button && !action.disabled) button.addEventListener("click", action.action, { once: true });
    }
    this.host.overlay.querySelector<HTMLButtonElement>("[data-summary-action]:not([disabled])")?.focus({ preventScroll: true });
    const card = this.host.overlay.querySelector<HTMLElement>(".run-summary");
    if (card) {
      this.releaseFocusTrap?.();
      this.releaseFocusTrap = trapFocus(card, () => undefined);
    }
  }

  scrollStageIntoView() {
    if (!window.matchMedia("(max-width: 860px)").matches) return;
    this.host.mount.closest<HTMLElement>(".stage")?.scrollIntoView({ block: "start", inline: "nearest" });
  }
}
