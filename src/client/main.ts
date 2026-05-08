import "./styles.css";
import { RicochetRushGame } from "./game/RicochetRushGame";
import { createHud } from "./ui/hud";

declare global {
  interface Window {
    __ricochetRushGame?: RicochetRushGame;
  }
}

const hud = createHud(document.querySelector<HTMLDivElement>("#app"));
const mount = document.querySelector<HTMLDivElement>("#game");

if (!mount) {
  throw new Error("Missing #game mount");
}

const game = new RicochetRushGame(mount, hud);
window.__ricochetRushGame = game;
game.start();
