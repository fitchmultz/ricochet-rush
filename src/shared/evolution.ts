import { clamp, isRecord } from "./util";
import { BRICK_COLUMNS, BRICK_ROWS, DESIGNER_BRICK_COLUMNS, DESIGNER_BRICK_ROWS } from "./gridDimensions";
import { BRICK_KINDS, COMPACT_GRID_KINDS, brickForKind, type BrickCell, type BrickKind } from "./brickKinds";
import { createDesignerBriefPlan, createDesignerBriefPlanForDesigner, designerFeatureCells, type DesignerBriefPlan } from "./designerBriefPlan";
import { selectFallbackCells, shapeLabel } from "./designerShapes";
import { applyDesignerBriefConstraints, repairConstrainedFallback, validateDesignerBriefRows } from "./designerBriefConstraints";
import { cellKey, countBricks } from "./gridCells";
import { brickKindsFromBrief, normalizeBriefText, shapeFromBrief, type DesignerBriefAnalysis } from "./designerBriefAnalysis";
export { analyzeDesignerBrief, mergeFeatureConstraints, type DesignerBriefAnalysis, type DesignerBriefFeature, type DesignerBriefFeatureConstraint, type DesignerBriefShape } from "./designerBriefAnalysis";
export { BRICK_COLUMNS, BRICK_ROWS, DESIGNER_BRICK_COLUMNS, DESIGNER_BRICK_ROWS } from "./gridDimensions";
export { type BrickCell, type BrickKind, type BrickSpec } from "./brickKinds";
export { createDesignerBriefPlan, createDesignerBriefPlanForDesigner, constrainedFeatureOnlyMinimum, describeDesignerBriefGuidance, designerBriefConstraintMode, designerBriefFillKind, designerBriefFillPolicy, designerBriefPromptRules, designerFeatureCells, requiresBossCoreForDesignerStyle, type DesignerBriefConstraintMode, type DesignerBriefFeatureCellRule, type DesignerBriefFillPolicy, type DesignerBriefPlan, type DesignerBriefPromptRules } from "./designerBriefPlan";

export interface CursorModelParameter {
  id: string;
  value: string;
}

export interface CursorModelSelection {
  id: string;
  params?: CursorModelParameter[];
}

export const CURSOR_MODEL = {
  id: "composer-2.5",
  params: [{ id: "fast", value: "true" }]
} satisfies CursorModelSelection;

export const PACK_CELL_COUNT = BRICK_COLUMNS * BRICK_ROWS;
export const DESIGNER_CELL_COUNT = DESIGNER_BRICK_COLUMNS * DESIGNER_BRICK_ROWS;

function scalePackCountToDesigner(packCount: number): number {
  return Math.max(1, Math.round((packCount * DESIGNER_CELL_COUNT) / PACK_CELL_COUNT));
}

export const MIN_BRICKS = 34;
export const MAX_BRICKS = 86;

/** Playable brick bounds on the designer canvas (scaled from the pack grid). */
export const MIN_DESIGNER_BRICKS = scalePackCountToDesigner(MIN_BRICKS);
export const MAX_DESIGNER_BRICKS = scalePackCountToDesigner(MAX_BRICKS);

export const DESIGNER_STYLES = ["balanced", "open-lanes", "bomb-chains", "precision", "boss-core"] as const;

export type DesignerStyle = (typeof DESIGNER_STYLES)[number];

export interface LevelRequest {
  level: number;
  score: number;
  lives: number;
  clearedLevels: number;
  recentEvents: string[];
  designer?: BoardDesignerIntent;
}

export type DesignerVisualPreset = "arcade" | "icon";

export type DesignerBriefMode = "arcade" | "silhouette";

export interface BoardDesignerIntent {
  style: DesignerStyle;
  difficulty: number;
  density: number;
  specialBias: number;
  seed: string;
  brief: string;
  visualPreset?: DesignerVisualPreset;
}

export interface DesignerBriefClassification {
  mode: DesignerBriefMode;
  wantsMixedKinds: boolean;
  wantsNegativeSpace: boolean;
}

export interface LevelBlueprint {
  name: string;
  briefing: string;
  paddleHint: string;
  speed: number;
  rows: BrickCell[][];
}

export interface LevelResponse {
  level: LevelBlueprint;
  source: "cursor-sdk" | "fallback";
  model: CursorModelSelection;
  summary?: GenerationSummary;
  warning?: string;
  trace?: ComposerAgentTrace;
}

export interface GenerationSummary {
  source: "cursor-sdk" | "fallback";
  title: string;
  detail: string;
  chips: string[];
  warning?: string;
}

export interface ComposerAgentTrace {
  request: LevelRequest;
  requestJson: string;
  prompt: string;
  rawOutput: string;
  rawError: string;
  parseStatus: "success" | "parse-failed" | "worker-failed";
  parseError?: string;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  workerExitCode?: number | null;
  streamStats?: ComposerStreamStats;
  parsedOutput?: unknown;
}

export interface ComposerStreamStats {
  requestEvents: number;
  statusEvents: number;
  thinkingEvents: number;
  assistantEvents: number;
  toolCallEvents: number;
  taskEvents: number;
  systemEvents: number;
  userEvents: number;
  otherEvents: number;
  firstToolCalls: string[];
}

export interface DesignerTargets {
  brickTarget: number;
  specialTarget: number;
  hardTarget: number;
  speedTarget: number;
  difficultyLabel: string;
  styleGoal: string;
}

export const DEFAULT_DESIGNER_INTENT: BoardDesignerIntent = {
  style: "balanced",
  difficulty: 3,
  density: 0.52,
  specialBias: 0.45,
  seed: "fresh-angle",
  brief: "",
  visualPreset: "arcade"
};

/** Icon/silhouette boards need lower fill so outlines read in 3D. */
export const ICON_DENSITY_CAP = 0.32;
export const ICON_SPECIAL_BIAS_CAP = 0.35;
/** Playable brick bounds for creative/silhouette SDK boards on the designer canvas. */
export const MIN_SILHOUETTE_BRICKS = scalePackCountToDesigner(22);
export const MAX_SILHOUETTE_BRICKS = scalePackCountToDesigner(48);
export const MIN_RAW_SILHOUETTE_BRICKS = scalePackCountToDesigner(14);

export function designerGridDimensions(): { columns: number; rows: number } {
  return { columns: DESIGNER_BRICK_COLUMNS, rows: DESIGNER_BRICK_ROWS };
}

export function levelGridDimensions(level: LevelBlueprint): { columns: number; rows: number } {
  const rows = level.rows.length;
  const columns = level.rows[0]?.length ?? BRICK_COLUMNS;
  return { columns, rows };
}

const STYLE_GOALS: Record<DesignerStyle, string> = {
  balanced: "A readable mix of lanes, shields, rewards, and light risk.",
  "open-lanes": "Two or three clean bank lanes with rewards around the openings.",
  "bomb-chains": "Linked bomb pockets that can open routes without making the board unfair.",
  precision: "Narrow aim windows, deliberate shields, and rewards for controlled angles.",
  "boss-core": "A reachable center core with boss bricks, shields, and power routes."
};

const DIFFICULTY_LABELS = ["soft", "steady", "sharp", "hot", "wild"] as const;
const MAX_REQUEST_LEVEL = 999;
const MAX_REQUEST_SCORE = 999_999_999;
const MAX_REQUEST_LIVES = 99;
const MAX_RECENT_EVENTS = 5;
const MAX_DESIGNER_BRIEF_LENGTH = 180;
export function normalizeLevelRequest(input: unknown): LevelRequest | null {
  if (!isRecord(input)) return null;
  const level = boundedInteger(input.level, 1, MAX_REQUEST_LEVEL);
  const score = boundedInteger(input.score, 0, MAX_REQUEST_SCORE);
  const lives = boundedInteger(input.lives, 0, MAX_REQUEST_LIVES);
  const clearedLevels = boundedInteger(input.clearedLevels, 0, MAX_REQUEST_LEVEL);
  if (level === null || score === null || lives === null || clearedLevels === null) return null;
  if (!Array.isArray(input.recentEvents) || !input.recentEvents.every((event): event is string => typeof event === "string")) return null;
  const recentEvents = input.recentEvents.slice(0, MAX_RECENT_EVENTS);
  const request: LevelRequest = {
    level,
    score,
    lives,
    clearedLevels,
    recentEvents
  };
  if (input.designer !== undefined) request.designer = normalizeDesignerIntent(input.designer);
  return request;
}

export interface SdkLevelValidationSuccess {
  ok: true;
  level: LevelBlueprint;
  rawBrickCount: number;
}

export interface SdkLevelValidationFailure {
  ok: false;
  reason: string;
  rawBrickCount: number;
}

export type SdkLevelValidation = SdkLevelValidationSuccess | SdkLevelValidationFailure;

/** Minimum occupied cells in raw SDK grid before server-side repair. */
export const MIN_RAW_SDK_BRICKS = Math.max(24, Math.floor(MIN_BRICKS * 0.65));

export const CURSOR_EVOLUTION_MAX_ATTEMPTS = 3;
export const CURSOR_WORKER_TIMEOUT_MS = 75_000;
/** Browser fetch budget: server attempts × worker timeout + startup buffer. */
export const CURSOR_GENERATION_BUDGET_MS = CURSOR_EVOLUTION_MAX_ATTEMPTS * CURSOR_WORKER_TIMEOUT_MS + 15_000;

export function normalizeLevel(input: unknown, request: LevelRequest): LevelBlueprint {
  const raw = isRecord(input) ? input : {};
  const dimensions = dimensionsForRawLevel(raw);
  const normalizedRows = normalizeLevelRows(raw, request, dimensions);
  if (!normalizedRows) return fallbackLevel(request);
  const rows = repairBrickCount(normalizedRows, request.level);
  const designer = normalizeDesignerIntent(request.designer);
  const plan = createDesignerBriefPlanForDesigner(designer, { columns: rows[0]?.length ?? BRICK_COLUMNS, rows: rows.length });
  return {
    name: stringValue(raw.name, `Sector ${request.level}`),
    briefing: stringValue(raw.briefing, "Break the wall before it learns your rhythm."),
    paddleHint: stringValue(raw.paddleHint, "Keep the ball angled. Flat returns are a trap."),
    speed: clamp(numberValue(raw.speed, 1 + request.level * 0.04), 0.85, 1.85),
    rows: applyDesignerBriefConstraints(rows, plan, designer, brickBoundsForGrid(rows[0]?.length ?? BRICK_COLUMNS, rows.length).max)
  };
}

export function validateAndNormalizeSdkLevel(input: unknown, request: LevelRequest): SdkLevelValidation {
  if (!isRecord(input)) {
    return { ok: false, reason: "SDK output is not an object.", rawBrickCount: 0 };
  }
  const raw = input;
  if (!Array.isArray(raw.grid) && !Array.isArray(raw.rows)) {
    return { ok: false, reason: "SDK output is missing grid or rows.", rawBrickCount: 0 };
  }

  const designer = resolveDesignerIntentForGeneration(request.designer);
  const bounds = generationBrickBounds(designer);
  const briefPlan = createDesignerBriefPlanForDesigner(designer, designerGridDimensions());
  const minRawBrickCount = briefPlan.featureOnlyMinimum ?? bounds.minRaw;
  const minPlayableBrickCount = briefPlan.featureOnlyMinimum ?? bounds.min;

  const rawBrickCount = Array.isArray(raw.grid)
    ? countCompactGridGlyphs(raw.grid, designerGridDimensions())
    : countRowsBrickSpecs(raw.rows);
  if (rawBrickCount < minRawBrickCount) {
    return {
      ok: false,
      reason: `SDK grid is too sparse (${rawBrickCount} occupied cells; need at least ${minRawBrickCount}).`,
      rawBrickCount
    };
  }

  const normalizedRows = normalizeLevelRows(raw, request, designerGridDimensions());
  if (!normalizedRows) {
    return { ok: false, reason: "SDK grid could not be normalized.", rawBrickCount };
  }

  const rows = normalizedRows;
  const brickCount = countBricks(rows);
  if (brickCount < minPlayableBrickCount || brickCount > bounds.max) {
    return {
      ok: false,
      reason: `Playable brick count ${brickCount} is outside ${minPlayableBrickCount}-${bounds.max}.`,
      rawBrickCount
    };
  }

  const name = stringValue(raw.name, "");
  const briefing = stringValue(raw.briefing, "");
  const paddleHint = stringValue(raw.paddleHint, "");
  if (!name || !briefing || !paddleHint) {
    return { ok: false, reason: "SDK output is missing name, briefing, or paddleHint.", rawBrickCount };
  }
  const level: LevelBlueprint = {
    name,
    briefing,
    paddleHint,
    speed: clamp(numberValue(raw.speed, 1 + request.level * 0.04), 0.85, 1.85),
    rows
  };

  const fidelity = validateCreativeFidelity(level, designer.brief, designer.visualPreset, designer);
  if (!fidelity.ok) {
    return { ok: false, reason: fidelity.reason, rawBrickCount: brickCount };
  }

  return {
    ok: true,
    rawBrickCount: brickCount,
    level
  };
}

function dimensionsForRawLevel(raw: Record<string, unknown>): { columns: number; rows: number } {
  if (Array.isArray(raw.grid)) return designerGridDimensions();
  if (Array.isArray(raw.rows) && raw.rows.length > 0) {
    const firstRow = raw.rows[0];
    const columns = Array.isArray(firstRow) ? firstRow.length : BRICK_COLUMNS;
    const rows = raw.rows.length;
    if (columns === DESIGNER_BRICK_COLUMNS && rows === DESIGNER_BRICK_ROWS) return designerGridDimensions();
    if (columns === BRICK_COLUMNS && rows === BRICK_ROWS) return { columns: BRICK_COLUMNS, rows: BRICK_ROWS };
    return { columns: BRICK_COLUMNS, rows: BRICK_ROWS };
  }
  return { columns: BRICK_COLUMNS, rows: BRICK_ROWS };
}

function countCompactGridGlyphs(grid: unknown[], dimensions: { columns: number; rows: number }): number {
  let count = 0;
  for (let y = 0; y < dimensions.rows; y += 1) {
    const rawRow = grid[y];
    const sourceRow = typeof rawRow === "string" ? rawRow : "";
    const normalized = sourceRow.padEnd(dimensions.columns, ".").slice(0, dimensions.columns);
    for (const char of normalized) {
      const code = char.toLowerCase();
      if (code !== "." && code !== "_" && code !== "-" && code.trim().length > 0) count += 1;
    }
  }
  return count;
}

function countRowsBrickSpecs(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  let count = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell !== null && cell !== 0 && cell !== false) count += 1;
    }
  }
  return count;
}

function normalizeLevelRows(
  raw: Record<string, unknown>,
  request: LevelRequest,
  dimensions: { columns: number; rows: number } = { columns: BRICK_COLUMNS, rows: BRICK_ROWS }
): BrickCell[][] | null {
  if (Array.isArray(raw.rows)) return normalizeRows(raw.rows, request.level, dimensions);
  if (Array.isArray(raw.grid)) return normalizeCompactGrid(raw.grid, raw, request, dimensions);
  return null;
}

function normalizeCompactGrid(
  grid: unknown[],
  raw: Record<string, unknown>,
  request: LevelRequest,
  dimensions: { columns: number; rows: number }
): BrickCell[][] {
  const designer = normalizeDesignerIntent(request.designer);
  const defaultKind = brickKindValue(raw.brick) ?? brickKindValue(raw.kind) ?? brickKindValue(raw.fillKind);
  const legend = isRecord(raw.legend) ? raw.legend : {};
  return Array.from({ length: dimensions.rows }, (_, y) => {
    const sourceRow = typeof grid[y] === "string" ? grid[y] : "";
    const cells = [...sourceRow.padEnd(dimensions.columns, ".").slice(0, dimensions.columns)];
    return cells.map((char) => compactGridCell(char, legend, defaultKind, designer, request.level));
  });
}

function compactGridCell(char: string, legend: Record<string, unknown>, defaultKind: BrickKind | undefined, designer: BoardDesignerIntent, level: number): BrickCell {
  const code = char.toLowerCase();
  if (code === "." || code === "_" || code === "-" || code.trim().length === 0) return null;
  const legendEntry = legend[char] ?? legend[code];
  const kind = brickKindValue(legendEntry) ?? COMPACT_GRID_KINDS[code] ?? defaultKind ?? "basic";
  const brick = brickForKind(kind, designer.difficulty, level);
  const hp = hpValue(legendEntry);
  return hp === undefined ? brick : { kind, hp };
}

function brickKindValue(value: unknown): BrickKind | undefined {
  if (typeof value === "string" && BRICK_KINDS.has(value as BrickKind)) return value as BrickKind;
  if (isRecord(value)) return brickKindValue(value.kind);
  return undefined;
}

function hpValue(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const hp = boundedInteger(value.hp, 1, 12);
  return hp ?? undefined;
}

export function normalizeDesignerIntent(input: unknown): BoardDesignerIntent {
  const raw = isRecord(input) ? input : {};
  const rawStyle = raw.style;
  const style: DesignerStyle = typeof rawStyle === "string" && isDesignerStyle(rawStyle) ? rawStyle : DEFAULT_DESIGNER_INTENT.style;
  const visualPreset: DesignerVisualPreset = raw.visualPreset === "icon" ? "icon" : "arcade";
  const densityDefault = visualPreset === "icon" ? ICON_DENSITY_CAP : DEFAULT_DESIGNER_INTENT.density;
  const specialDefault = visualPreset === "icon" ? ICON_SPECIAL_BIAS_CAP : DEFAULT_DESIGNER_INTENT.specialBias;
  return {
    style,
    difficulty: clamp(Math.round(numberValue(raw.difficulty, DEFAULT_DESIGNER_INTENT.difficulty)), 1, 5),
    density: clamp(numberValue(raw.density, densityDefault), 0.34, 0.82),
    specialBias: clamp(numberValue(raw.specialBias, specialDefault), 0, 1),
    seed: stringValue(raw.seed, DEFAULT_DESIGNER_INTENT.seed).slice(0, 36),
    brief: briefValue(raw.brief, DEFAULT_DESIGNER_INTENT.brief),
    visualPreset
  };
}

export function classifyDesignerBrief(brief: string, visualPreset: DesignerVisualPreset = "arcade"): DesignerBriefClassification {
  const text = normalizeBriefText(brief);
  const silhouetteKeywords =
    /\b(face|smiley|smile|grin|emoji|icon|logo|silhouette|portrait|symbol|letter|outline|figure|character|mask|mascot|pixel art)\b/.test(text) ||
    /\b(shaped|shape of|looks like|look like)\b/.test(text);
  const negativeSpaceKeywords = /\b(face|smiley|smile|grin|emoji|icon|logo|silhouette|portrait|symbol|letter|outline|figure|character|mask|mascot|pixel art|hollow|empty center|open center|negative space|ring outline|donut)\b/.test(text);
  const effectiveSilhouette = visualPreset === "icon" || silhouetteKeywords || Boolean(shapeFromBrief(text));
  const mentionedKinds = brickKindsFromBrief(text);
  const wantsMixedKinds =
    mentionedKinds.length > 1 ||
    /\b(eyes?|mouth|cheeks?|only the|except|but the|accent|highlights?)\b/.test(text) ||
    (mentionedKinds.length === 1 && /\b(eyes?|center|core|corners?|edges?)\b/.test(text));
  const wantsNegativeSpace = negativeSpaceKeywords;
  return {
    mode: effectiveSilhouette ? "silhouette" : "arcade",
    wantsMixedKinds,
    wantsNegativeSpace
  };
}

/** Effective designer tuning for a live generation request (does not mutate stored UI state). */
export function resolveDesignerIntentForGeneration(input: unknown): BoardDesignerIntent {
  const base = normalizeDesignerIntent(input);
  const classification = classifyDesignerBrief(base.brief, base.visualPreset);
  if (classification.mode === "silhouette") {
    return {
      ...base,
      density: Math.min(base.density, ICON_DENSITY_CAP),
      specialBias: Math.min(base.specialBias, ICON_SPECIAL_BIAS_CAP)
    };
  }
  return base;
}

export function generationBrickBounds(designer: BoardDesignerIntent): { min: number; max: number; minRaw: number; mode: DesignerBriefMode } {
  const resolved = resolveDesignerIntentForGeneration(designer);
  const mode = classifyDesignerBrief(resolved.brief, resolved.visualPreset).mode;
  if (mode === "silhouette") {
    return { min: MIN_SILHOUETTE_BRICKS, max: MAX_SILHOUETTE_BRICKS, minRaw: MIN_RAW_SILHOUETTE_BRICKS, mode };
  }
  return {
    min: MIN_DESIGNER_BRICKS,
    max: MAX_DESIGNER_BRICKS,
    minRaw: Math.max(MIN_RAW_SILHOUETTE_BRICKS, Math.floor(MIN_DESIGNER_BRICKS * 0.65)),
    mode
  };
}

export function validateCreativeFidelity(
  level: LevelBlueprint,
  brief: string,
  visualPreset: DesignerVisualPreset = "arcade",
  designer?: BoardDesignerIntent
): { ok: true } | { ok: false; reason: string } {
  const trimmed = brief.trim();
  if (trimmed.length === 0) return { ok: true };

  const classification = classifyDesignerBrief(trimmed, visualPreset);
  const rows = level.rows;
  const plan = designer
    ? createDesignerBriefPlanForDesigner(designer, { columns: rows[0]?.length ?? BRICK_COLUMNS, rows: rows.length })
    : createDesignerBriefPlan(trimmed, { columns: rows[0]?.length ?? BRICK_COLUMNS, rows: rows.length });
  return validateDesignerBriefRows(rows, plan, {
    maxSilhouetteBricks: MAX_SILHOUETTE_BRICKS,
    silhouette: classification.mode === "silhouette",
    wantsNegativeSpace: classification.wantsNegativeSpace
  });
}

export function designerStyleGoal(style: DesignerStyle): string {
  return STYLE_GOALS[style];
}

export function designerTargets(intentInput: unknown, level = 1): DesignerTargets {
  const intent = normalizeDesignerIntent(intentInput);
  const brickTarget = clamp(Math.round(BRICK_COLUMNS * BRICK_ROWS * intent.density), MIN_BRICKS, MAX_BRICKS);
  const specialRatio = 0.06 + intent.specialBias * 0.32;
  const difficultyRatio = 0.05 + intent.difficulty * 0.035;
  return {
    brickTarget,
    specialTarget: clamp(Math.round(brickTarget * specialRatio), intent.specialBias > 0 ? 2 : 0, Math.max(2, Math.round(brickTarget * 0.42))),
    hardTarget: clamp(Math.round(brickTarget * difficultyRatio), 1, Math.max(2, Math.round(brickTarget * 0.28))),
    speedTarget: clamp(0.9 + level * 0.035 + intent.difficulty * 0.06, 0.95, 1.75),
    difficultyLabel: DIFFICULTY_LABELS[intent.difficulty - 1] ?? "sharp",
    styleGoal: designerStyleGoal(intent.style)
  };
}

/** Targets for live composer generation (respects brief-driven silhouette tuning). */
export function designerTargetsForGeneration(intentInput: unknown, level = 1): DesignerTargets {
  const intent = resolveDesignerIntentForGeneration(intentInput);
  const bounds = generationBrickBounds(intent);
  const rawTarget = Math.round(DESIGNER_CELL_COUNT * intent.density);
  const brickTarget = clamp(rawTarget, bounds.min, bounds.max);
  const specialRatio = bounds.mode === "silhouette" ? 0.04 + intent.specialBias * 0.2 : 0.06 + intent.specialBias * 0.32;
  const difficultyRatio = bounds.mode === "silhouette" ? 0.02 + intent.difficulty * 0.02 : 0.05 + intent.difficulty * 0.035;
  return {
    brickTarget,
    specialTarget: clamp(Math.round(brickTarget * specialRatio), intent.specialBias > 0 ? 1 : 0, Math.max(2, Math.round(brickTarget * 0.42))),
    hardTarget: clamp(Math.round(brickTarget * difficultyRatio), bounds.mode === "silhouette" ? 0 : 1, Math.max(2, Math.round(brickTarget * 0.28))),
    speedTarget: clamp(0.9 + level * 0.035 + intent.difficulty * 0.06, 0.95, 1.75),
    difficultyLabel: DIFFICULTY_LABELS[intent.difficulty - 1] ?? "sharp",
    styleGoal: bounds.mode === "silhouette" ? "Readable motif from the player brief with negative space." : designerStyleGoal(intent.style)
  };
}

export function describeDesignerIntent(intentInput: unknown): string {
  const intent = normalizeDesignerIntent(intentInput);
  const targets = designerTargets(intent);
  const difficulty = targets.difficultyLabel;
  const prompt = intent.brief ? `"${intent.brief}"` : "default prompt";
  return `${prompt} / ${difficulty} / ${Math.round(intent.density * 100)}% density / ${Math.round(intent.specialBias * 100)}% specials`;
}

/** Derive a fresh designer seed so each generation request varies run context. */
export function nextDesignerSeed(seed: string, request: LevelRequest, nonce = Date.now()): string {
  const mixed = hashText(`${seed}:${request.level}:${request.clearedLevels}:${request.score}:${nonce}`);
  return `run-${mixed.toString(36)}`.slice(0, 36);
}

export function fallbackLevel(request: LevelRequest): LevelBlueprint {
  const designer = normalizeDesignerIntent(request.designer);
  const targets = designerTargetsForGeneration(designer, request.level);
  const plan = createDesignerBriefPlanForDesigner(designer, designerGridDimensions());
  const brief = plan.analysis;
  const initialRows = repairBrickCount(buildFallbackRows(request, designer, plan), request.level);
  const constrainedRows = applyDesignerBriefConstraints(initialRows, plan, designer, brickBoundsForGrid(initialRows[0]?.length ?? BRICK_COLUMNS, initialRows.length).max);
  const rows = repairConstrainedFallback(constrainedRows, request.level, plan, designer, generationBrickBounds(designer).min);

  return {
    name: brief.shape ? `${shapeLabel(brief.shape)} Prompt ${request.level}` : `Generated Sector ${request.level}`,
    briefing: designer.brief
      ? `Local designer followed "${designer.brief}" from the "${designer.seed}" seed.`
      : `Local designer built a generated wall from the "${designer.seed}" seed.`,
    paddleHint: hintForDesignerIntent(designer, brief),
    speed: targets.speedTarget,
    rows
  };
}

function buildFallbackRows(request: LevelRequest, designer: BoardDesignerIntent, plan: DesignerBriefPlan): BrickCell[][] {
  const { columns, rows: rowCount } = designerGridDimensions();
  const rows = Array.from({ length: rowCount }, () => Array.from({ length: columns }, () => null as BrickCell));
  const targets = designerTargetsForGeneration(designer, request.level);
  const seed = hashText(`${request.level}:${request.score}:${designer.style}:${designer.seed}`);
  const brief = plan.analysis;
  const excludedKinds = new Set(brief.excludedKinds);
  const candidates: { x: number; y: number; score: number }[] = [];
  const laneSkipA = Math.round((2 / (BRICK_COLUMNS - 1)) * (columns - 1));
  const laneSkipB = Math.round((11 / (BRICK_COLUMNS - 1)) * (columns - 1));
  const centerX = (columns - 1) / 2;
  for (let y = 0; y < rowCount - 2; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (designer.style === "open-lanes" && y > 0 && (x === laneSkipA || x === laneSkipB)) continue;
      if (designer.style === "precision" && y > 0 && Math.abs(x - centerX) > columns * 0.28 && (x + y + seed) % 3 === 0) continue;
      const centerBias = designer.style === "boss-core" ? Math.abs(x - centerX) * 17 + y * 5 : 0;
      candidates.push({ x, y, score: hashNumber(seed, x, y) + centerBias });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const selected = selectFallbackCells(candidates, brief, targets.brickTarget, MAX_DESIGNER_BRICKS);
  const featureKinds = new Set(plan.localizedFeatures.map((feature) => feature.kind));
  const nonFeatureExcludedKinds = new Set(excludedKinds);
  for (const featureKind of featureKinds) nonFeatureExcludedKinds.add(featureKind);
  const defaultFillKind = plan.fillPolicy.nonFeatureFillKind;
  const specialCells = new Set(
    [...selected]
      .sort((a, b) => hashNumber(seed + 1_037, a.x, a.y) - hashNumber(seed + 1_037, b.x, b.y))
      .slice(0, targets.specialTarget)
      .map(cellKey)
  );
  const hardCells = new Set(
    [...selected]
      .filter((cell) => !specialCells.has(cellKey(cell)))
      .sort((a, b) => hashNumber(seed + 2_071, a.x, a.y) - hashNumber(seed + 2_071, b.x, b.y))
      .slice(0, nonFeatureExcludedKinds.has("hard") ? 0 : targets.hardTarget)
      .map(cellKey)
  );

  for (const cell of selected) {
    const key = cellKey(cell);
    if (brief.exclusiveKind) {
      rows[cell.y][cell.x] = brickForKind(brief.exclusiveKind, designer.difficulty, request.level);
    } else if (specialCells.has(key)) {
      const specialKind = brief.preferredKind ?? pickSpecialKindAvoiding(designer.style, seed, cell.x, cell.y, nonFeatureExcludedKinds, defaultFillKind);
      rows[cell.y][cell.x] = specialKind ? brickForKind(specialKind, designer.difficulty, request.level) : null;
    } else if (hardCells.has(key)) {
      rows[cell.y][cell.x] = brickForKind("hard", designer.difficulty, request.level);
    } else {
      rows[cell.y][cell.x] = defaultFillKind ? brickForKind(defaultFillKind, designer.difficulty, request.level) : null;
    }
  }

  if (!nonFeatureExcludedKinds.has("boss") && (designer.style === "boss-core" || (request.level % 5 === 0 && designer.difficulty >= 4))) {
    for (const { x, y } of designerFeatureCells("core", columns, rowCount)) {
      if (y < rowCount && x < columns) rows[y][x] = brickForKind("boss", designer.difficulty, request.level);
    }
  }
  return rows;
}

function specialKindPool(style: DesignerStyle): BrickKind[] {
  const pools: Record<DesignerStyle, BrickKind[]> = {
    balanced: ["prize", "wide", "split", "laser", "bomb", "slow", "grab", "fire", "thru"],
    "open-lanes": ["wide", "slow", "grab", "split", "prize", "thru"],
    "bomb-chains": ["bomb", "bomb", "fire", "split", "laser", "prize", "penalty"],
    precision: ["thru", "grab", "slow", "laser", "prize"],
    "boss-core": ["fire", "laser", "thru", "split", "bomb", "prize", "penalty"]
  };
  return pools[style];
}

function pickSpecialKindAvoiding(style: DesignerStyle, seed: number, x: number, y: number, excludedKinds: ReadonlySet<BrickKind>, fallbackKind: BrickKind | undefined): BrickKind | undefined {
  const pool = specialKindPool(style).filter((kind) => !excludedKinds.has(kind));
  return pool[hashNumber(seed, x + 13, y + 29) % pool.length] ?? fallbackKind;
}

function hintForDesignerStyle(style: DesignerStyle): string {
  if (style === "open-lanes") return "Use the open columns for long banks before chasing rewards.";
  if (style === "bomb-chains") return "Trigger bombs from the side so the blast opens a safe route.";
  if (style === "precision") return "Hold a shallow angle and work through the narrow windows.";
  if (style === "boss-core") return "Save fire, laser, or thru power for the center core.";
  return "Open a lane first, then chase powerups when the return angle is safe.";
}

function hintForDesignerIntent(designer: BoardDesignerIntent, brief: DesignerBriefAnalysis): string {
  if (brief.exclusiveKind === "bomb") return "Clip the edge of the bomb chain, then ride the opened lanes.";
  if (brief.shape === "heart") return "Open one heart lobe first so the return has a clean center lane.";
  return hintForDesignerStyle(designer.style);
}

function normalizeRows(
  input: unknown,
  level: number,
  dimensions: { columns: number; rows: number } = { columns: BRICK_COLUMNS, rows: BRICK_ROWS }
): BrickCell[][] {
  if (!Array.isArray(input)) return fallbackLevel({ level, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] }).rows;
  const rows: BrickCell[][] = [];
  for (let y = 0; y < dimensions.rows; y += 1) {
    const sourceRow = Array.isArray(input[y]) ? input[y] : [];
    const row: BrickCell[] = [];
    for (let x = 0; x < dimensions.columns; x += 1) {
      row.push(normalizeBrick(sourceRow[x]));
    }
    rows.push(row);
  }
  return rows;
}

function normalizeBrick(input: unknown): BrickCell {
  if (input === null || input === 0 || input === false) return null;
  if (!isRecord(input)) return null;
  const kind = input.kind;
  if (typeof kind !== "string" || !BRICK_KINDS.has(kind as BrickKind)) return null;
  const hp = clamp(Math.round(numberValue(input.hp, kind === "hard" ? 2 : 1)), 1, kind === "boss" ? 12 : 4);
  return { kind: kind as BrickKind, hp };
}

function repairBrickCount(rows: BrickCell[][], level: number): BrickCell[][] {
  const repaired = rows.map((row) => [...row]);
  const rowCount = repaired.length;
  const columnCount = repaired[0]?.length ?? BRICK_COLUMNS;
  const { min, max } = brickBoundsForGrid(columnCount, rowCount);
  let count = countBricks(repaired);
  if (count > max) {
    for (let y = rowCount - 1; y >= 0 && count > max; y -= 1) {
      for (let x = (y + level) % 2; x < columnCount && count > max; x += 2) {
        const brick = repaired[y][x];
        if (!brick || brick.kind === "boss") continue;
        repaired[y][x] = null;
        count -= 1;
      }
    }
    for (let y = rowCount - 1; y >= 0 && count > max; y -= 1) {
      for (let x = (y + level + 1) % 2; x < columnCount && count > max; x += 2) {
        if (!repaired[y][x]) continue;
        repaired[y][x] = null;
        count -= 1;
      }
    }
  }

  if (count < min) {
    for (let y = 0; y < rowCount && count < min; y += 1) {
      for (let x = (y + level) % 3; x < columnCount && count < min; x += 3) {
        if (repaired[y][x]) continue;
        const toughLane = level > 2 && (x + y + level) % 5 === 0;
        repaired[y][x] = toughLane ? { kind: "hard", hp: 2 } : { kind: "basic", hp: 1 };
        count += 1;
      }
    }
  }

  return repaired;
}

function brickBoundsForGrid(columns: number, rowCount: number): { min: number; max: number } {
  if (columns === DESIGNER_BRICK_COLUMNS && rowCount === DESIGNER_BRICK_ROWS) {
    return { min: MIN_DESIGNER_BRICKS, max: MAX_DESIGNER_BRICKS };
  }
  return { min: MIN_BRICKS, max: MAX_BRICKS };
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? trimForUi(value.trim(), 110) : fallback;
}

function briefValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? trimForUi(value.trim(), MAX_DESIGNER_BRIEF_LENGTH) : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function isDesignerStyle(value: string): value is DesignerStyle {
  return DESIGNER_STYLES.includes(value as DesignerStyle);
}

function trimForUi(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength + 1);
  const wordBreak = clipped.lastIndexOf(" ");
  const end = wordBreak > maxLength * 0.66 ? wordBreak : maxLength;
  return `${value.slice(0, end).trimEnd()}...`;
}

function hashText(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashNumber(seed: number, x: number, y: number): number {
  let hash = seed ^ Math.imul(x + 101, 374761393) ^ Math.imul(y + 151, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return (hash ^ (hash >>> 16)) >>> 0;
}
