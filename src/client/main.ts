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
window.__ricochetRushGame = game;
game.start();
