import "./styles.css";
import { isDebugSurfaceEnabled } from "./game/debugSurface";
import { isRecognizedAgentModeUrl, persistAgentModePreference, resolvePlayMode } from "./game/playSession";
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

const search = window.location.search;
const storage = window.localStorage;
const playMode = resolvePlayMode(search, storage);
persistAgentModePreference(search, storage);
const debugSurfaceEnabled = isRecognizedAgentModeUrl(search) || isDebugSurfaceEnabled(search, storage);
const { RicochetRushGame } = await import("./game/RicochetRushGame");
const game = new RicochetRushGame(mount, hud, { playMode });
if (debugSurfaceEnabled) {
  window.__ricochetRushGame = game;
}
game.start();
