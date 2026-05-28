import { BRICK_COLUMNS, DESIGNER_BRICK_COLUMNS, DESIGNER_BRICK_ROWS } from "./gridDimensions";
import { brickForKind, type BrickCell, type BrickKind } from "./brickKinds";
import { cellKey, countBricks } from "./gridCells";
import { mergeFeatureConstraints, type DesignerBriefAnalysis, type DesignerBriefFeatureConstraint } from "./designerBriefAnalysis";
import { designerBriefFillKind, designerFeatureCells, type DesignerBriefPlan } from "./designerBriefPlan";
import { cellsForShape, embedPackCellsOnDesignerGrid } from "./designerShapes";

export interface DesignerBriefConstraintDesigner {
  difficulty: number;
}

export interface DesignerBriefRowValidationOptions {
  maxSilhouetteBricks: number;
  silhouette: boolean;
  wantsNegativeSpace: boolean;
}

export type DesignerBriefRowValidation = { ok: true } | { ok: false; reason: string };

export function applyDesignerBriefConstraints(rows: BrickCell[][], plan: DesignerBriefPlan, designer: DesignerBriefConstraintDesigner, maxBrickCount: number): BrickCell[][] {
  const brief = plan.analysis;
  const exclusiveKind = brief.exclusiveKind;
  const fillPolicy = plan.fillPolicy;
  const nonFeatureFillKind = fillPolicy.nonFeatureFillKind;
  const fillKind = fillPolicy.defaultFillKind ?? "basic";
  let constrained = rows.map((row) => [...row]);

  if (brief.shape) {
    const shapeCells = new Set(embedPackCellsOnDesignerGrid(cellsForShape(brief.shape)).map(cellKey));
    const shapeFillKind = brief.localizedKindFeatures.length > 0 ? nonFeatureFillKind : fillKind;
    constrained = constrained.map((row, y) =>
      row.map((brick, x) => {
        if (!shapeCells.has(cellKey({ x, y }))) return null;
        return brick ?? (shapeFillKind ? brickForKind(shapeFillKind, designer.difficulty, 1) : null);
      })
    );
  }

  if (exclusiveKind) {
    constrained = constrained.map((row) => row.map((brick) => (brick ? brickForKind(exclusiveKind, designer.difficulty, 1) : null)));
  } else {
    if (brief.localizedKindFeatures.length > 0) {
      constrained = applyLocalizedKindFeatures(constrained, brief.localizedKindFeatures, designer, nonFeatureFillKind, maxBrickCount);
    }
    if (brief.requiredKindFeatures.length > 0) {
      constrained = applyRequiredKindFeatures(constrained, brief.requiredKindFeatures, designer);
    }
  }

  return applyExcludedKindConstraints(constrained, brief, designer);
}

export function validateDesignerBriefRows(rows: BrickCell[][], plan: DesignerBriefPlan, options: DesignerBriefRowValidationOptions): DesignerBriefRowValidation {
  const brickCount = countBricks(rows);
  if (options.silhouette) {
    if (brickCount > options.maxSilhouetteBricks) {
      return { ok: false, reason: `Silhouette prompt produced an overfilled wall (${brickCount} bricks; target at most ${options.maxSilhouetteBricks}).` };
    }
    if (options.wantsNegativeSpace) {
      const openSpaceRatio = plan.analysis.shape ? shapeInteriorEmptyRatio(rows, plan.analysis.shape) : centerRegionEmptyRatio(rows);
      if (openSpaceRatio < 0.28) return { ok: false, reason: "Silhouette prompt needs more open center space for the motif to read." };
    }
  }

  for (const excludedKind of plan.analysis.excludedKinds) {
    if (countKind(rows, excludedKind) > 0) return { ok: false, reason: `Prompt excludes ${excludedKind} bricks.` };
  }

  for (const featureRequirement of plan.requiredFeatures) {
    const featureCells = plan.featureCellRules.find((feature) => feature.kind === featureRequirement.kind && feature.feature === featureRequirement.feature)?.cells ?? [];
    if (!satisfiesRequiredFeature(rows, featureRequirement, featureCells)) {
      return { ok: false, reason: `Feature-scoped prompt requires ${featureRequirement.kind} bricks at the ${featureRequirement.feature} positions.` };
    }
  }

  if (plan.requiresBossCore && !designerFeatureCells("core", rows[0]?.length ?? DESIGNER_BRICK_COLUMNS, rows.length).every((cell) => rows[cell.y]?.[cell.x]?.kind === "boss")) {
    return { ok: false, reason: "Boss-core style prompt requires boss bricks at the core positions." };
  }

  for (const featureKind of new Set(plan.localizedFeatures.map((feature) => feature.kind))) {
    const localizedFeaturesForKind = plan.localizedFeatures.filter((feature) => feature.kind === featureKind);
    const allowedFeatureCells = new Set(plan.featureCellRules.filter((feature) => feature.kind === featureKind).flatMap((feature) => feature.cells).map(cellKey));
    const outsideFeatureKinds = rows.flatMap((row, y) => row.filter((brick, x) => brick?.kind === featureKind && !allowedFeatureCells.has(cellKey({ x, y })))).length;
    if (outsideFeatureKinds > 0) {
      const featureLabel = localizedFeaturesForKind.length === 1 ? `the ${localizedFeaturesForKind[0]?.feature}` : "the named feature positions";
      return { ok: false, reason: `Feature-scoped prompt allows ${featureKind} only in ${featureLabel}.` };
    }
  }

  if (plan.analysis.exclusiveKind) {
    const mismatched = rows.flat().filter((brick) => brick && brick.kind !== plan.analysis.exclusiveKind).length;
    if (mismatched > 0) return { ok: false, reason: `Prompt requires every occupied brick to be ${plan.analysis.exclusiveKind}.` };
  }

  if (plan.analysis.preferredKind && countKind(rows, plan.analysis.preferredKind) === 0) {
    return { ok: false, reason: `Prompt asks for ${plan.analysis.preferredKind} bricks, but none were generated.` };
  }

  return { ok: true };
}

export function repairConstrainedFallback(rows: BrickCell[][], level: number, plan: DesignerBriefPlan, designer: DesignerBriefConstraintDesigner, minimumBrickCount: number): BrickCell[][] {
  const repaired = rows.map((row) => [...row]);
  const rowCount = repaired.length;
  const columnCount = repaired[0]?.length ?? BRICK_COLUMNS;
  let count = countBricks(repaired);
  if (count >= minimumBrickCount) return repaired;

  const brief = plan.analysis;
  const fillPolicy = plan.fillPolicy;
  const strictFillKind = brief.exclusiveKind ?? fillPolicy.nonFeatureFillKind;
  const relaxedFillKind = strictFillKind ?? fillPolicy.relaxedFillKind;
  if (!relaxedFillKind) return repaired;

  const protectedCells = protectedFeatureCellSet(brief, columnCount, rowCount);
  const repairableShapeCells = brief.shape ? new Set(embedPackCellsOnDesignerGrid(cellsForShape(brief.shape)).map(cellKey)) : undefined;
  for (let y = 0; y < rowCount && count < minimumBrickCount; y += 1) {
    for (let x = (y + level) % 3; x < columnCount && count < minimumBrickCount; x += 3) {
      const key = cellKey({ x, y });
      if (repaired[y]?.[x] || protectedCells.has(key) || (repairableShapeCells && !repairableShapeCells.has(key))) continue;
      repaired[y][x] = brickForKind(relaxedFillKind, designer.difficulty, level);
      count += 1;
    }
  }
  for (let y = 0; y < rowCount && count < minimumBrickCount; y += 1) {
    for (let x = 0; x < columnCount && count < minimumBrickCount; x += 1) {
      const key = cellKey({ x, y });
      if (repaired[y]?.[x] || protectedCells.has(key) || (repairableShapeCells && !repairableShapeCells.has(key))) continue;
      repaired[y][x] = brickForKind(relaxedFillKind, designer.difficulty, level);
      count += 1;
    }
  }
  return repaired;
}

function satisfiesRequiredFeature(rows: BrickCell[][], feature: DesignerBriefFeatureConstraint, canonicalCells: Array<{ x: number; y: number }>): boolean {
  const exactMatches = canonicalCells.filter((cell) => rows[cell.y]?.[cell.x]?.kind === feature.kind).length;
  if (exactMatches >= canonicalCells.length) return true;
  if (feature.feature !== "eyes") return false;
  return countEyeBandKind(rows, feature.kind) >= canonicalCells.length;
}

function countEyeBandKind(rows: BrickCell[][], kind: BrickKind): number {
  const rowCount = rows.length;
  const columnCount = rows[0]?.length ?? BRICK_COLUMNS;
  const maxY = Math.max(1, Math.ceil(rowCount * 0.36));
  const minX = Math.floor(columnCount * 0.12);
  const maxX = Math.ceil(columnCount * 0.88);
  let count = 0;
  for (let y = 0; y <= maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      if (rows[y]?.[x]?.kind === kind) count += 1;
    }
  }
  return count;
}

function shapeInteriorEmptyRatio(rows: BrickCell[][], shape: NonNullable<DesignerBriefAnalysis["shape"]>): number {
  const shapeCells = new Set(embedPackCellsOnDesignerGrid(cellsForShape(shape)).map(cellKey));
  const interiorCells = [...shapeCells]
    .map((key) => {
      const [xText, yText] = key.split(":");
      return { x: Number(xText), y: Number(yText) };
    })
    .filter((cell) =>
      shapeCells.has(cellKey({ x: cell.x - 1, y: cell.y })) &&
      shapeCells.has(cellKey({ x: cell.x + 1, y: cell.y })) &&
      shapeCells.has(cellKey({ x: cell.x, y: cell.y - 1 })) &&
      shapeCells.has(cellKey({ x: cell.x, y: cell.y + 1 }))
    );
  if (interiorCells.length === 0) return centerRegionEmptyRatio(rows);
  const empty = interiorCells.filter((cell) => !rows[cell.y]?.[cell.x]).length;
  return empty / interiorCells.length;
}

function centerRegionEmptyRatio(rows: BrickCell[][]): number {
  const rowCount = rows.length;
  const columnCount = rows[0]?.length ?? BRICK_COLUMNS;
  const x0 = Math.floor(columnCount * 0.28);
  const x1 = Math.ceil(columnCount * 0.72);
  const y0 = Math.floor(rowCount * 0.22);
  const y1 = Math.ceil(rowCount * 0.78);
  let total = 0;
  let empty = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      total += 1;
      if (!rows[y]?.[x]) empty += 1;
    }
  }
  return total > 0 ? empty / total : 1;
}

function countKind(rows: BrickCell[][], kind: BrickKind): number {
  return rows.flat().filter((brick) => brick?.kind === kind).length;
}

function applyExcludedKindConstraints(rows: BrickCell[][], brief: DesignerBriefAnalysis, designer: DesignerBriefConstraintDesigner): BrickCell[][] {
  if (brief.excludedKinds.length === 0) return rows;
  const replacementKind = designerBriefFillKind(brief, brief.localizedKindFeatures.map((feature) => feature.kind));
  return rows.map((row) =>
    row.map((brick) => {
      if (!brick || !brief.excludedKinds.includes(brick.kind)) return brick;
      return replacementKind ? brickForKind(replacementKind, designer.difficulty, 1) : null;
    })
  );
}

function protectedFeatureCellSet(brief: DesignerBriefAnalysis, columns: number, rowCount: number): Set<string> {
  const features = mergeFeatureConstraints(brief.localizedKindFeatures, brief.requiredKindFeatures);
  return new Set(features.flatMap((feature) => designerFeatureCells(feature.feature, columns, rowCount)).map(cellKey));
}

function applyLocalizedKindFeatures(rows: BrickCell[][], features: DesignerBriefFeatureConstraint[], designer: DesignerBriefConstraintDesigner, fillKind: BrickKind | undefined, maxBrickCount: number): BrickCell[][] {
  const columns = rows[0]?.length ?? DESIGNER_BRICK_COLUMNS;
  const rowCount = rows.length || DESIGNER_BRICK_ROWS;
  const protectedCellsByKind = new Map<BrickKind, Set<string>>();
  for (const feature of features) {
    const protectedCells = protectedCellsByKind.get(feature.kind) ?? new Set<string>();
    for (const cell of designerFeatureCells(feature.feature, columns, rowCount)) protectedCells.add(cellKey(cell));
    protectedCellsByKind.set(feature.kind, protectedCells);
  }
  const constrained = rows.map((row, y) =>
    row.map((brick, x) => {
      if (!brick) return brick;
      const protectedCells = protectedCellsByKind.get(brick.kind);
      if (protectedCells && !protectedCells.has(cellKey({ x, y }))) return fillKind ? brickForKind(fillKind, designer.difficulty, 1) : null;
      return brick;
    })
  );
  for (const feature of features) {
    for (const cell of designerFeatureCells(feature.feature, columns, rowCount)) {
      if (constrained[cell.y]) constrained[cell.y][cell.x] = brickForKind(feature.kind, designer.difficulty, 1);
    }
  }
  return trimLocalizedFeatureOverflow(constrained, new Set([...protectedCellsByKind.values()].flatMap((cells) => [...cells])), maxBrickCount);
}

function applyRequiredKindFeatures(rows: BrickCell[][], features: DesignerBriefFeatureConstraint[], designer: DesignerBriefConstraintDesigner): BrickCell[][] {
  const constrained = rows.map((row) => [...row]);
  const columns = constrained[0]?.length ?? DESIGNER_BRICK_COLUMNS;
  const rowCount = constrained.length || DESIGNER_BRICK_ROWS;
  for (const feature of features) {
    for (const cell of designerFeatureCells(feature.feature, columns, rowCount)) {
      if (constrained[cell.y]) constrained[cell.y][cell.x] = brickForKind(feature.kind, designer.difficulty, 1);
    }
  }
  return constrained;
}

function trimLocalizedFeatureOverflow(rows: BrickCell[][], protectedCells: Set<string>, maxBrickCount: number): BrickCell[][] {
  const columnCount = rows[0]?.length ?? BRICK_COLUMNS;
  let count = countBricks(rows);
  for (let y = rows.length - 1; y >= 0 && count > maxBrickCount; y -= 1) {
    for (let x = columnCount - 1; x >= 0 && count > maxBrickCount; x -= 1) {
      if (!rows[y]?.[x] || protectedCells.has(cellKey({ x, y }))) continue;
      rows[y][x] = null;
      count -= 1;
    }
  }
  return rows;
}
