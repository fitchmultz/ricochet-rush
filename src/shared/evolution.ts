export const CURSOR_MODEL = {
  id: "composer-2.5",
  params: [{ id: "mode", value: "fast" }]
};

export const BRICK_COLUMNS = 14;
export const BRICK_ROWS = 9;
export const MIN_BRICKS = 34;
export const MAX_BRICKS = 86;

export const DESIGNER_STYLES = ["balanced", "open-lanes", "bomb-chains", "precision", "boss-core"] as const;

export type BrickKind =
  | "basic"
  | "hard"
  | "bomb"
  | "prize"
  | "penalty"
  | "laser"
  | "grab"
  | "fire"
  | "thru"
  | "split"
  | "wide"
  | "slow"
  | "boss";

export type DesignerStyle = (typeof DESIGNER_STYLES)[number];

export interface BrickSpec {
  kind: BrickKind;
  hp: number;
}

export type BrickCell = BrickSpec | null;

export interface LevelRequest {
  level: number;
  score: number;
  lives: number;
  clearedLevels: number;
  recentEvents: string[];
  designer?: BoardDesignerIntent;
}

export interface BoardDesignerIntent {
  style: DesignerStyle;
  difficulty: number;
  density: number;
  specialBias: number;
  seed: string;
  brief: string;
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
  model: typeof CURSOR_MODEL;
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

const BRICK_KINDS = new Set<BrickKind>([
  "basic",
  "hard",
  "bomb",
  "prize",
  "penalty",
  "laser",
  "grab",
  "fire",
  "thru",
  "split",
  "wide",
  "slow",
  "boss"
]);

export const DEFAULT_DESIGNER_INTENT: BoardDesignerIntent = {
  style: "balanced",
  difficulty: 3,
  density: 0.52,
  specialBias: 0.45,
  seed: "fresh-angle",
  brief: ""
};

const STYLE_LABELS: Record<DesignerStyle, string> = {
  balanced: "Balanced",
  "open-lanes": "Open lanes",
  "bomb-chains": "Bomb chains",
  precision: "Precision",
  "boss-core": "Boss core"
};

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
const COMPACT_GRID_KINDS: Record<string, BrickKind> = {
  b: "basic",
  h: "hard",
  o: "bomb",
  p: "prize",
  n: "penalty",
  l: "laser",
  g: "grab",
  f: "fire",
  t: "thru",
  s: "split",
  w: "wide",
  m: "slow",
  c: "boss"
};

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

export function normalizeLevel(input: unknown, request: LevelRequest): LevelBlueprint {
  const raw = isRecord(input) ? input : {};
  const normalizedRows = normalizeLevelRows(raw, request);
  if (!normalizedRows) return fallbackLevel(request);
  const rows = repairBrickCount(normalizedRows, request.level);
  return {
    name: stringValue(raw.name, `Sector ${request.level}`),
    briefing: stringValue(raw.briefing, "Break the wall before it learns your rhythm."),
    paddleHint: stringValue(raw.paddleHint, "Keep the ball angled. Flat returns are a trap."),
    speed: clamp(numberValue(raw.speed, 1 + request.level * 0.04), 0.85, 1.85),
    rows: applyDesignerBriefConstraints(rows, normalizeDesignerIntent(request.designer))
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

  const rawBrickCount = Array.isArray(raw.grid) ? countCompactGridGlyphs(raw.grid) : countRowsBrickSpecs(raw.rows);
  if (rawBrickCount < MIN_RAW_SDK_BRICKS) {
    return {
      ok: false,
      reason: `SDK grid is too sparse (${rawBrickCount} occupied cells; need at least ${MIN_RAW_SDK_BRICKS}).`,
      rawBrickCount
    };
  }

  const normalizedRows = normalizeLevelRows(raw, request);
  if (!normalizedRows) {
    return { ok: false, reason: "SDK grid could not be normalized.", rawBrickCount };
  }

  const rows = repairBrickCount(normalizedRows, request.level);
  const brickCount = countBricks(rows);
  if (brickCount < MIN_BRICKS || brickCount > MAX_BRICKS) {
    return {
      ok: false,
      reason: `Playable brick count ${brickCount} is outside ${MIN_BRICKS}-${MAX_BRICKS}.`,
      rawBrickCount
    };
  }

  const name = stringValue(raw.name, "");
  const briefing = stringValue(raw.briefing, "");
  const paddleHint = stringValue(raw.paddleHint, "");
  if (!name || !briefing || !paddleHint) {
    return { ok: false, reason: "SDK output is missing name, briefing, or paddleHint.", rawBrickCount };
  }

  return {
    ok: true,
    rawBrickCount,
    level: {
      name,
      briefing,
      paddleHint,
      speed: clamp(numberValue(raw.speed, 1 + request.level * 0.04), 0.85, 1.85),
      rows: applyDesignerBriefConstraints(rows, normalizeDesignerIntent(request.designer))
    }
  };
}

function countCompactGridGlyphs(grid: unknown[]): number {
  let count = 0;
  for (let y = 0; y < BRICK_ROWS; y += 1) {
    const rawRow = grid[y];
    const sourceRow = typeof rawRow === "string" ? rawRow : "";
    const normalized = sourceRow.padEnd(BRICK_COLUMNS, ".").slice(0, BRICK_COLUMNS);
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

function normalizeLevelRows(raw: Record<string, unknown>, request: LevelRequest): BrickCell[][] | null {
  if (Array.isArray(raw.rows)) return normalizeRows(raw.rows, request.level);
  if (Array.isArray(raw.grid)) return normalizeCompactGrid(raw.grid, raw, request);
  return null;
}

function normalizeCompactGrid(grid: unknown[], raw: Record<string, unknown>, request: LevelRequest): BrickCell[][] {
  const designer = normalizeDesignerIntent(request.designer);
  const defaultKind = brickKindValue(raw.brick) ?? brickKindValue(raw.kind) ?? brickKindValue(raw.fillKind);
  const legend = isRecord(raw.legend) ? raw.legend : {};
  return Array.from({ length: BRICK_ROWS }, (_, y) => {
    const sourceRow = typeof grid[y] === "string" ? grid[y] : "";
    const cells = [...sourceRow.padEnd(BRICK_COLUMNS, ".").slice(0, BRICK_COLUMNS)];
    return cells.map((char) => compactGridCell(char, legend, defaultKind, designer, request.level));
  });
}

function compactGridCell(char: string, legend: Record<string, unknown>, defaultKind: BrickKind | undefined, designer: BoardDesignerIntent, level: number): BrickCell {
  const code = char.toLowerCase();
  if (code === "." || code === "_" || code === "-" || code.trim().length === 0) return null;
  const legendEntry = legend[char] ?? legend[code];
  const kind = brickKindValue(legendEntry) ?? COMPACT_GRID_KINDS[code] ?? defaultKind ?? "basic";
  const brick = brickForKind(kind, designer, level);
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
  return {
    style,
    difficulty: clamp(Math.round(numberValue(raw.difficulty, DEFAULT_DESIGNER_INTENT.difficulty)), 1, 5),
    density: clamp(numberValue(raw.density, DEFAULT_DESIGNER_INTENT.density), 0.34, 0.82),
    specialBias: clamp(numberValue(raw.specialBias, DEFAULT_DESIGNER_INTENT.specialBias), 0, 1),
    seed: stringValue(raw.seed, DEFAULT_DESIGNER_INTENT.seed).slice(0, 36),
    brief: briefValue(raw.brief, DEFAULT_DESIGNER_INTENT.brief)
  };
}

export function designerStyleLabel(style: DesignerStyle): string {
  return STYLE_LABELS[style];
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
  const targets = designerTargets(designer, request.level);
  const rows = applyDesignerBriefConstraints(repairBrickCount(buildFallbackRows(request, designer), request.level), designer);
  const brief = analyzeDesignerBrief(designer.brief);

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

function buildFallbackRows(request: LevelRequest, designer: BoardDesignerIntent): BrickCell[][] {
  const rows = Array.from({ length: BRICK_ROWS }, () => Array.from({ length: BRICK_COLUMNS }, () => null as BrickCell));
  const targets = designerTargets(designer, request.level);
  const seed = hashText(`${request.level}:${request.score}:${designer.style}:${designer.seed}`);
  const brief = analyzeDesignerBrief(designer.brief);
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = 0; y < BRICK_ROWS - 2; y += 1) {
    for (let x = 0; x < BRICK_COLUMNS; x += 1) {
      if (designer.style === "open-lanes" && y > 0 && (x === 2 || x === 11)) continue;
      if (designer.style === "precision" && y > 0 && Math.abs(x - 6.5) > 4 && (x + y + seed) % 3 === 0) continue;
      const centerBias = designer.style === "boss-core" ? Math.abs(x - 6.5) * 17 + y * 5 : 0;
      candidates.push({ x, y, score: hashNumber(seed, x, y) + centerBias });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  const selected = selectFallbackCells(candidates, brief, targets.brickTarget);
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
      .slice(0, targets.hardTarget)
      .map(cellKey)
  );

  for (const cell of selected) {
    const key = cellKey(cell);
    if (brief.exclusiveKind) {
      rows[cell.y][cell.x] = brickForKind(brief.exclusiveKind, designer, request.level);
    } else if (specialCells.has(key)) {
      rows[cell.y][cell.x] = { kind: brief.preferredKind ?? pickSpecialKind(designer.style, seed, cell.x, cell.y), hp: 1 };
    } else if (hardCells.has(key)) {
      rows[cell.y][cell.x] = { kind: "hard", hp: clamp(1 + Math.ceil(designer.difficulty / 2), 2, 4) };
    } else {
      rows[cell.y][cell.x] = { kind: "basic", hp: 1 };
    }
  }

  if (designer.style === "boss-core" || (request.level % 5 === 0 && designer.difficulty >= 4)) {
    for (const [x, y] of [
      [6, 2],
      [7, 2],
      [6, 3],
      [7, 3]
    ]) {
      rows[y][x] = { kind: "boss", hp: clamp(4 + designer.difficulty + Math.floor(request.level / 4), 5, 12) };
    }
  }
  return rows;
}

export type DesignerBriefShape = "heart" | "diamond" | "circle" | "triangle" | "cross" | "x";

export interface DesignerBriefAnalysis {
  exclusiveKind?: BrickKind;
  preferredKind?: BrickKind;
  mentionedKinds: BrickKind[];
  shape?: DesignerBriefShape;
}

export function analyzeDesignerBrief(brief: string): DesignerBriefAnalysis {
  const text = brief.toLowerCase();
  const kinds = brickKindsFromBrief(text);
  const kind = kinds[0];
  const exclusive = kind && /\b(all|only|nothing but|entirely|exclusively|just)\b/.test(text);
  return {
    exclusiveKind: exclusive ? kind : undefined,
    preferredKind: !exclusive && kinds.length === 1 ? kind : undefined,
    mentionedKinds: kinds,
    shape: shapeFromBrief(text)
  };
}

function brickKindsFromBrief(text: string): BrickKind[] {
  const matches: BrickKind[] = [];
  const add = (kind: BrickKind, pattern: RegExp) => {
    if (pattern.test(text) && !matches.includes(kind)) matches.push(kind);
  };
  add("bomb", /\b(explod|bomb|blast|detonat)/);
  add("boss", /\b(boss|core|bosses)\b/);
  add("hard", /\b(hard|metal|armou?r|shield)/);
  add("prize", /\b(prize|reward|gift|green)/);
  add("penalty", /\b(penalty|hazard|red|bad)\b/);
  add("laser", /\b(laser|beam)\b/);
  add("grab", /\b(grab|catch|sticky)\b/);
  add("fire", /\b(fire|flame|burn)\b/);
  add("thru", /\b(thru|ghost|phase|pierc)/);
  add("split", /\b(split|multi[- ]?ball|multiball)\b/);
  add("wide", /\b(wide|expand|big paddle)\b/);
  add("slow", /\b(slow|brake|chill)\b/);
  add("basic", /\b(basic|plain|normal)\b/);
  return matches;
}

function shapeFromBrief(text: string): DesignerBriefShape | undefined {
  if (/\b(heart|love|valentine)\b/.test(text)) return "heart";
  if (/\b(diamond|gem|rhombus)\b/.test(text)) return "diamond";
  if (/\b(circle|round|orb|ring)\b/.test(text)) return "circle";
  if (/\b(triangle|pyramid)\b/.test(text)) return "triangle";
  if (/\b(cross|plus)\b/.test(text)) return "cross";
  if (/\b(x[- ]?shape|letter x|big x)\b/.test(text)) return "x";
  return undefined;
}

function selectFallbackCells(candidates: { x: number; y: number; score: number }[], brief: DesignerBriefAnalysis, targetCount: number) {
  if (!brief.shape) return candidates.slice(0, targetCount);
  const shaped = cellsForShape(brief.shape).map(({ x, y }) => ({ x, y, score: 0 }));
  if (shaped.length >= MIN_BRICKS && shaped.length <= MAX_BRICKS) return shaped;
  if (shaped.length > MAX_BRICKS) return shaped.slice(0, MAX_BRICKS);
  const selected = new Map(shaped.map((cell) => [cellKey(cell), cell]));
  for (const cell of candidates) {
    if (selected.size >= MIN_BRICKS) break;
    selected.set(cellKey(cell), cell);
  }
  return [...selected.values()];
}

function cellsForShape(shape: DesignerBriefShape): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
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
  if (shape === "circle") return cx * cx / 40 + cy * cy / 16 <= 1;
  if (shape === "triangle") return y >= 1 && y <= 8 && Math.abs(cx) <= y * 0.82;
  if (shape === "cross") return (x >= 5 && x <= 8 && y <= 8) || (y >= 3 && y <= 5 && x >= 1 && x <= 12);
  return Math.abs(cx - cy * 1.35) <= 1.1 || Math.abs(cx + cy * 1.35) <= 1.1;
}

function shapeLabel(shape: DesignerBriefShape): string {
  return shape === "x" ? "X-Shaped" : `${shape[0]?.toUpperCase() ?? ""}${shape.slice(1)}`;
}

function applyDesignerBriefConstraints(rows: BrickCell[][], designer: BoardDesignerIntent): BrickCell[][] {
  const brief = analyzeDesignerBrief(designer.brief);
  const exclusiveKind = brief.exclusiveKind;
  const fillKind = exclusiveKind ?? brief.preferredKind ?? "basic";
  let constrained = rows.map((row) => [...row]);

  if (brief.shape) {
    const shapeCells = new Set(cellsForShape(brief.shape).map(cellKey));
    constrained = constrained.map((row, y) =>
      row.map((brick, x) => {
        if (!shapeCells.has(cellKey({ x, y }))) return null;
        return brick ?? brickForKind(fillKind, designer, 1);
      })
    );
  }

  if (exclusiveKind) {
    constrained = constrained.map((row) => row.map((brick) => (brick ? brickForKind(exclusiveKind, designer, 1) : null)));
  }

  return constrained;
}

function brickForKind(kind: BrickKind, designer: BoardDesignerIntent, level: number): BrickSpec {
  if (kind === "hard") return { kind, hp: clamp(1 + Math.ceil(designer.difficulty / 2), 2, 4) };
  if (kind === "boss") return { kind, hp: clamp(4 + designer.difficulty + Math.floor(level / 4), 5, 12) };
  return { kind, hp: 1 };
}

function cellKey(cell: { x: number; y: number }): string {
  return `${cell.x}:${cell.y}`;
}

function pickSpecialKind(style: DesignerStyle, seed: number, x: number, y: number): BrickKind {
  const pools: Record<DesignerStyle, BrickKind[]> = {
    balanced: ["prize", "wide", "split", "laser", "bomb", "slow", "grab", "fire", "thru"],
    "open-lanes": ["wide", "slow", "grab", "split", "prize", "thru"],
    "bomb-chains": ["bomb", "bomb", "fire", "split", "laser", "prize", "penalty"],
    precision: ["thru", "grab", "slow", "laser", "prize"],
    "boss-core": ["fire", "laser", "thru", "split", "bomb", "prize", "penalty"]
  };
  const pool = pools[style];
  return pool[hashNumber(seed, x + 13, y + 29) % pool.length] ?? "prize";
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

function normalizeRows(input: unknown, level: number): BrickCell[][] {
  if (!Array.isArray(input)) return fallbackLevel({ level, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] }).rows;
  const rows: BrickCell[][] = [];
  for (let y = 0; y < BRICK_ROWS; y += 1) {
    const sourceRow = Array.isArray(input[y]) ? input[y] : [];
    const row: BrickCell[] = [];
    for (let x = 0; x < BRICK_COLUMNS; x += 1) {
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

function countBricks(rows: BrickCell[][]): number {
  return rows.flat().filter(Boolean).length;
}

function repairBrickCount(rows: BrickCell[][], level: number): BrickCell[][] {
  const repaired = rows.map((row) => [...row]);
  let count = countBricks(repaired);
  if (count > MAX_BRICKS) {
    for (let y = BRICK_ROWS - 1; y >= 0 && count > MAX_BRICKS; y -= 1) {
      for (let x = (y + level) % 2; x < BRICK_COLUMNS && count > MAX_BRICKS; x += 2) {
        const brick = repaired[y][x];
        if (!brick || brick.kind === "boss") continue;
        repaired[y][x] = null;
        count -= 1;
      }
    }
    for (let y = BRICK_ROWS - 1; y >= 0 && count > MAX_BRICKS; y -= 1) {
      for (let x = (y + level + 1) % 2; x < BRICK_COLUMNS && count > MAX_BRICKS; x += 2) {
        if (!repaired[y][x]) continue;
        repaired[y][x] = null;
        count -= 1;
      }
    }
  }

  if (count < MIN_BRICKS) {
    for (let y = 0; y < BRICK_ROWS && count < MIN_BRICKS; y += 1) {
      for (let x = (y + level) % 3; x < BRICK_COLUMNS && count < MIN_BRICKS; x += 3) {
        if (repaired[y][x]) continue;
        const toughLane = level > 2 && (x + y + level) % 5 === 0;
        repaired[y][x] = toughLane ? { kind: "hard", hp: 2 } : { kind: "basic", hp: 1 };
        count += 1;
      }
    }
  }

  return repaired;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
