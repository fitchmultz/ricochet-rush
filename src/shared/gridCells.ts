import type { BrickCell } from "./brickKinds";

export interface GridCellCoordinate {
  x: number;
  y: number;
}

export function cellKey(cell: GridCellCoordinate): string {
  return `${cell.x}:${cell.y}`;
}

export function countBricks(rows: BrickCell[][]): number {
  return rows.flat().filter(Boolean).length;
}
