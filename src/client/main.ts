import "./styles.css";
import { resolveAgentMode } from "./game/agentMode";
import { createHud } from "./ui/hud";
import type { RicochetRushGame as RicochetRushGameInstance } from "./game/RicochetRushGame";

declare global {
  interface Window {
    __ricochetRushGame?: RicochetRushGameInstance;
  }
}

const hud = createHud(document.querySelector<HTMLDivElement>("#app"));
const mount = document.querySelector<HTMLDivElement>("#game");

if (!mount) {
  throw new Error("Missing #game mount");
}

const agentMode = resolveAgentMode(window.location.search, window.localStorage);
const { RicochetRushGame } = await import("./game/RicochetRushGame");
const game = new RicochetRushGame(mount, hud, { agentMode });
if (agentMode.enabled || isDebugSurfaceEnabled()) {
  window.__ricochetRushGame = game;
}
game.start();

function isDebugSurfaceEnabled(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has("debugGame")) return true;
  try {
    return window.localStorage.getItem("ricochet-rush-debug") === "1";
  } catch {
    return false;
  }
}
