import { BRICK_COLUMNS, BRICK_ROWS, DESIGNER_BRICK_COLUMNS, DESIGNER_BRICK_ROWS } from "./gridDimensions";
import type { DesignerBriefAnalysis, DesignerBriefShape } from "./designerBriefAnalysis";

export function selectFallbackCells(candidates: Array<{ x: number; y: number; score: number }>, brief: DesignerBriefAnalysis, targetCount: number, maxDesignerBricks: number): Array<{ x: number; y: number }> {
  if (!brief.shape) return candidates.slice(0, targetCount);
  const shaped = embedPackCellsOnDesignerGrid(cellsForShape(brief.shape));
  if (shaped.length <= maxDesignerBricks) return shaped;
  return shaped.slice(0, maxDesignerBricks);
}

export function embedPackCellsOnDesignerGrid(cells: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const offsetX = Math.floor((DESIGNER_BRICK_COLUMNS - BRICK_COLUMNS) / 2);
  const offsetY = Math.floor((DESIGNER_BRICK_ROWS - BRICK_ROWS) / 2);
  return cells.map((cell) => ({ x: cell.x + offsetX, y: cell.y + offsetY }));
}

export function cellsForShape(shape: DesignerBriefShape): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < BRICK_ROWS; y += 1) {
    for (let x = 0; x < BRICK_COLUMNS; x += 1) {
      if (shapeIncludesCell(shape, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

function shapeIncludesCell(shape: DesignerBriefShape, x: number, y: number): boolean {
  const cx = x - (BRICK_COLUMNS - 1) / 2;
  const cy = y - (BRICK_ROWS - 1) / 2;
  if (shape === "heart") {
    const rowExtents = [
      [3, 5],
      [2, 11],
      [1, 12],
      [0, 13],
      [1, 12],
      [2, 11],
      [3, 10],
      [4, 9],
      [5, 8]
    ] as const;
    const range = rowExtents[y];
    if (!range) return false;
    if (y === 0) return (x >= 3 && x <= 5) || (x >= 8 && x <= 10);
    return x >= range[0] && x <= range[1];
  }
  if (shape === "diamond") return Math.abs(cx) / 6.5 + Math.abs(cy) / 4 <= 1;
  if (shape === "circle") return (cx * cx) / 40 + (cy * cy) / 16 <= 1;
  if (shape === "triangle") return y >= 1 && y <= 8 && Math.abs(cx) <= y * 0.82;
  if (shape === "cross") return (x >= 5 && x <= 8 && y <= 8) || (y >= 3 && y <= 5 && x >= 1 && x <= 12);
  return Math.abs(cx - cy * 1.35) <= 1.15 || Math.abs(cx + cy * 1.35) <= 1.15;
}

export function shapeLabel(shape: DesignerBriefShape): string {
  return shape === "x" ? "X-Shaped" : `${shape[0]?.toUpperCase() ?? ""}${shape.slice(1)}`;
}
