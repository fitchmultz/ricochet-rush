import { ARENA_HEIGHT, ARENA_WIDTH } from "./tuning";

/** Map arena coordinates to percentage positions inside the effects overlay layer. */
export function arenaPointToPercent(x: number, y: number): { left: string; top: string } {
  return {
    left: `${(x / ARENA_WIDTH) * 100}%`,
    top: `${(y / ARENA_HEIGHT) * 100}%`
  };
}
