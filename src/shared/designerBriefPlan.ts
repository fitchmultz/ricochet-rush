import { DESIGNER_BRICK_COLUMNS, DESIGNER_BRICK_ROWS } from "./gridDimensions";
import { kindMatcherSource, type BrickKind } from "./brickKinds";
import { clamp } from "./util";
import {
  analyzeDesignerBrief,
  mergeFeatureConstraints,
  normalizeBriefText,
  type DesignerBriefAnalysis,
  type DesignerBriefFeature,
  type DesignerBriefFeatureConstraint
} from "./designerBriefAnalysis";

export type DesignerBriefConstraintMode = "normal" | "feature-only";

export interface DesignerBriefFeatureCellRule extends DesignerBriefFeatureConstraint {
  cells: Array<{ x: number; y: number }>;
}

export interface DesignerBriefFillPolicy {
  nonFeatureFillKind?: BrickKind;
  defaultFillKind?: BrickKind;
  relaxedFillKind?: BrickKind;
}

export interface DesignerBriefPlan {
  analysis: DesignerBriefAnalysis;
  constraintMode: DesignerBriefConstraintMode;
  fillPolicy: DesignerBriefFillPolicy;
  requiresBossCore: boolean;
  featureOnlyMinimum?: number;
  requiredFeatures: DesignerBriefFeatureConstraint[];
  localizedFeatures: DesignerBriefFeatureConstraint[];
  featureCellRules: DesignerBriefFeatureCellRule[];
}

export interface DesignerBriefPromptRules {
  bossCoreRule?: string;
  exclusivityRule: string;
  featureBombRule?: string;
  featurePositionRule?: string;
  nonBombFeatureRule?: string;
}

export interface DesignerBriefGuidanceOptions {
  silhouette: boolean;
}

export function createDesignerBriefPlan(brief: string, dimensions: { columns: number; rows: number } = { columns: DESIGNER_BRICK_COLUMNS, rows: DESIGNER_BRICK_ROWS }): DesignerBriefPlan {
  return createDesignerBriefPlanFromAnalysis(analyzeDesignerBrief(brief), dimensions);
}

export function createDesignerBriefPlanForDesigner(designer: { style: string; brief: string }, dimensions: { columns: number; rows: number } = { columns: DESIGNER_BRICK_COLUMNS, rows: DESIGNER_BRICK_ROWS }): DesignerBriefPlan {
  const analysis = analyzeDesignerBrief(designer.brief);
  return { ...createDesignerBriefPlanFromAnalysis(analysis, dimensions), requiresBossCore: requiresBossCoreForDesignerStyle(designer, analysis) };
}

export function createDesignerBriefPlanFromAnalysis(analysis: DesignerBriefAnalysis, dimensions: { columns: number; rows: number }): DesignerBriefPlan {
  const constraintMode = designerBriefConstraintMode(analysis);
  const fillPolicy = designerBriefFillPolicy(analysis);
  const featureCellRules = mergeFeatureConstraints(analysis.requiredKindFeatures, analysis.localizedKindFeatures).map((feature) => ({
    ...feature,
    cells: designerFeatureCells(feature.feature, dimensions.columns, dimensions.rows)
  }));
  const featureOnlyMinimum = constraintMode === "feature-only" ? protectedFeatureCellCount(featureCellRules) || undefined : undefined;
  return {
    analysis,
    constraintMode,
    fillPolicy,
    requiresBossCore: analysis.requiredKindFeatures.some((feature) => feature.kind === "boss" && feature.feature === "core"),
    featureOnlyMinimum,
    requiredFeatures: [...analysis.requiredKindFeatures],
    localizedFeatures: [...analysis.localizedKindFeatures],
    featureCellRules
  };
}

export function designerBriefConstraintMode(analysis: DesignerBriefAnalysis): DesignerBriefConstraintMode {
  if (analysis.localizedKindFeatures.length === 0) return "normal";
  return designerBriefFillKind(analysis, analysis.localizedKindFeatures.map((feature) => feature.kind)) ? "normal" : "feature-only";
}

export function designerBriefFillPolicy(analysis: DesignerBriefAnalysis): DesignerBriefFillPolicy {
  const localizedFeatureKinds = analysis.localizedKindFeatures.map((feature) => feature.kind);
  const nonFeatureFillKind = designerBriefFillKind(analysis, localizedFeatureKinds);
  return {
    nonFeatureFillKind,
    defaultFillKind: analysis.exclusiveKind ?? analysis.preferredKind ?? nonFeatureFillKind ?? designerBriefFillKind(analysis) ?? "basic",
    relaxedFillKind: designerBriefFillKind(analysis, localizedFeatureKinds, "relaxed")
  };
}

export function constrainedFeatureOnlyMinimum(analysis: DesignerBriefAnalysis, dimensions: { columns: number; rows: number }): number | undefined {
  return createDesignerBriefPlanFromAnalysis(analysis, dimensions).featureOnlyMinimum;
}

export function designerBriefPromptRules(
  plan: DesignerBriefPlan,
  dimensions: { columns: number; rows: number } = { columns: DESIGNER_BRICK_COLUMNS, rows: DESIGNER_BRICK_ROWS },
  options: { bossCoreRequired?: boolean } = {}
): DesignerBriefPromptRules {
  const { analysis } = plan;
  const localizedBombFeatures = plan.localizedFeatures.filter((feature) => feature.kind === "bomb").map((feature) => feature.feature);
  const requiredBombFeatures = plan.requiredFeatures.filter((feature) => feature.kind === "bomb").map((feature) => feature.feature);
  const requiredNonBombFeatures = plan.requiredFeatures.filter((feature) => feature.kind !== "bomb");
  const localizedBombFeatureName = localizedBombFeatures.length > 1 ? localizedBombFeatures.join(" and ") : localizedBombFeatures[0] === "core" ? "core" : "named bomb feature positions";
  return {
    bossCoreRule: (options.bossCoreRequired ?? plan.requiresBossCore)
      ? "- Preserve the boss core: all core positions must be boss (c) cells, even when the prompt forbids bomb/exploding core cells."
      : undefined,
    exclusivityRule: analysis.exclusiveKind
      ? `- Every occupied brick must be ${analysis.exclusiveKind}.`
      : "- If only/all/exclusive wording names a feature, apply that kind only to the named feature; keep the rest playable with non-excluded mixed bricks unless the brief explicitly makes the whole wall exclusive.",
    featureBombRule: analysis.exclusiveKind
      ? "- Exploding or bomb feature wording follows the global exclusive brick rule above."
      : localizedBombFeatures.length > 0
        ? `- Use bomb (o) bricks only in the ${localizedBombFeatureName}; avoid bomb cells elsewhere.`
        : requiredBombFeatures.length > 0
          ? requiredBombFeatureRule(requiredBombFeatures)
          : analysis.preferredKind === "bomb"
            ? "- Include bomb (o) bricks in the wall where they fit the requested motif and playability."
            : undefined,
    nonBombFeatureRule: requiredNonBombFeatures.length > 0
      ? `- Ensure these non-bomb feature positions are set: ${requiredNonBombFeatures.map((feature) => `${feature.feature}=${feature.kind}`).join(", ")}.`
      : undefined,
    featurePositionRule: describeFeaturePositionRule(plan.featureCellRules, dimensions)
  };
}

export function describeDesignerBriefGuidance(plan: DesignerBriefPlan, options: DesignerBriefGuidanceOptions): string {
  const { analysis } = plan;
  const hints: string[] = [];
  if (options.silhouette) hints.push("Treat this as a silhouette or icon prompt with readable outline and negative space.");
  if (analysis.excludedKinds.length > 0) hints.push(`Do not use these brick kinds: ${analysis.excludedKinds.join(", ")}.`);
  if (analysis.exclusiveKind) {
    hints.push(`Every occupied brick must be ${analysis.exclusiveKind}.`);
  } else {
    if (plan.localizedFeatures.length > 0) {
      const kinds = [...new Set(plan.localizedFeatures.map((feature) => feature.kind))].join(", ");
      const features = [...new Set(plan.localizedFeatures.map((feature) => feature.feature))].join(" and ");
      hints.push(
        plan.featureOnlyMinimum
          ? `Use ${kinds} only for the named ${features} feature positions; leave every non-feature cell empty because no legal fill kind remains.`
          : `Use ${kinds} only for the named ${features} feature positions; fill the rest with non-excluded playable or mixed bricks.`
      );
    }
    const requiredFeatures = plan.requiredFeatures.filter(
      (feature) => !plan.localizedFeatures.some((localizedFeature) => localizedFeature.kind === feature.kind && localizedFeature.feature === feature.feature)
    );
    if (requiredFeatures.length > 0) {
      const required = requiredFeatures.map((feature) => `${feature.feature}=${feature.kind}`).join(", ");
      hints.push(`Ensure these additional feature positions are set: ${required}; keep the rest playable with normal mixed placement.`);
    } else if (plan.localizedFeatures.length === 0 && analysis.preferredKind) {
      hints.push(`Include ${analysis.preferredKind} bricks where they fit the requested motif and playability.`);
    }
    if (analysis.mentionedKinds.length > 1) {
      hints.push(`Use mixed grid codes. Mentioned kinds: ${analysis.mentionedKinds.join(", ")}. Place specials only where the prompt implies.`);
    }
  }
  if ([...plan.localizedFeatures, ...plan.requiredFeatures].some((feature) => feature.feature === "eyes" && feature.kind === "bomb")) {
    hints.push("Exploding eyes should be bomb (o) cells at the eye positions.");
  }
  return hints.length > 0 ? hints.join(" ") : "Follow the player brief literally for layout, motif, and brick placement.";
}

export function requiresBossCoreForDesignerStyle(designer: { style: string; brief: string }, analysis = analyzeDesignerBrief(designer.brief)): boolean {
  if (analysis.excludedKinds.includes("boss")) return false;
  if (analysis.requiredKindFeatures.some((feature) => feature.kind === "boss" && feature.feature === "core")) return true;
  return designer.style === "boss-core" && hasCoreBombExclusionBrief(designer.brief);
}

export function designerFeatureCells(feature: DesignerBriefFeature, columns = DESIGNER_BRICK_COLUMNS, rowCount = DESIGNER_BRICK_ROWS): Array<{ x: number; y: number }> {
  return feature === "eyes" ? eyeFeatureCells(columns, rowCount) : coreFeatureCells(columns, rowCount);
}

function protectedFeatureCellCount(features: DesignerBriefFeatureCellRule[]): number {
  return new Set(features.flatMap((feature) => feature.cells).map((cell) => `${cell.x}:${cell.y}`)).size;
}

function requiredBombFeatureRule(requiredBombFeatures: DesignerBriefFeature[]): string {
  if (requiredBombFeatures.includes("core") && requiredBombFeatures.includes("eyes")) {
    return "- Ensure both eye positions and all core positions are bomb (o) cells; other bomb cells are allowed only when they fit the prompt and playability.";
  }
  return requiredBombFeatures[0] === "core"
    ? "- Ensure all core positions are bomb (o) cells; other bomb cells are allowed only when they fit the prompt and playability."
    : "- Ensure both eye positions are bomb (o) cells; other bomb cells are allowed only when they fit the prompt and playability.";
}

function describeFeaturePositionRule(features: DesignerBriefFeatureCellRule[], dimensions: { columns: number; rows: number }): string | undefined {
  if (features.length === 0) return undefined;
  const descriptions = features.map((feature) => {
    const cells = feature.cells.map((cell) => `(x=${cell.x}, y=${cell.y})`).join(" and ");
    return `${feature.feature} ${feature.kind} cells at ${cells}`;
  });
  return `- Feature coordinates are fixed on the ${dimensions.columns}x${dimensions.rows} grid: ${descriptions.join("; ")}.`;
}

function hasCoreBombExclusionBrief(brief: string): boolean {
  const text = normalizeBriefText(brief);
  const bombPattern = kindMatcherSource("bomb");
  const coreFeature = "(?:the\\s+)?(?:boss\\s+)?cores?";
  return new RegExp(`\\b(?:no|not|avoid|without|exclude|excluding)\\s+(?:${coreFeature}\\s+${bombPattern}|${bombPattern}\\s+${coreFeature})\\b`).test(text);
}

export function designerBriefFillKind(analysis: DesignerBriefAnalysis, extraExcludedKinds: Iterable<BrickKind> = [], mode: "strict" | "relaxed" = "strict"): BrickKind | undefined {
  const excludedKinds = new Set([...analysis.excludedKinds, ...extraExcludedKinds]);
  const strictOrder: BrickKind[] = ["basic", "prize", "wide", "split", "laser", "grab", "fire", "thru", "slow", "bomb", "hard", "penalty", "boss"];
  const relaxedOrder: BrickKind[] = ["basic", "hard", "prize", "wide", "split", "laser", "grab", "fire", "thru", "slow", "penalty", "boss", "bomb"];
  return (mode === "relaxed" ? relaxedOrder : strictOrder).find((kind) => !excludedKinds.has(kind));
}

function eyeFeatureCells(columns: number, rowCount: number): Array<{ x: number; y: number }> {
  const y = clamp(Math.floor(rowCount * 0.22), 1, Math.max(1, rowCount - 2));
  const left = clamp(Math.floor(columns * 0.28), 1, Math.max(1, columns - 2));
  const right = clamp(columns - 1 - left, 1, Math.max(1, columns - 2));
  return [
    { x: left, y },
    { x: right, y }
  ];
}

function coreFeatureCells(columns: number, rowCount: number): Array<{ x: number; y: number }> {
  const centerX = (columns - 1) / 2;
  const bossX = clamp(Math.round(centerX - 0.5), 0, Math.max(0, columns - 2));
  const bossY = clamp(Math.max(2, Math.round(rowCount * 0.22)), 0, Math.max(0, rowCount - 2));
  return [
    { x: bossX, y: bossY },
    { x: bossX + 1, y: bossY },
    { x: bossX, y: bossY + 1 },
    { x: bossX + 1, y: bossY + 1 }
  ];
}

