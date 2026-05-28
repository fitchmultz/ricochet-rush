import "./styles.css";
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

const { RicochetRushGame } = await import("./game/RicochetRushGame");
const game = new RicochetRushGame(mount, hud);
if (isDebugSurfaceEnabled()) {
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
