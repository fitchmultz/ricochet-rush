import { BRICK_COLUMNS, BRICK_ROWS, type BrickCell, type BrickKind, type LevelBlueprint, type LevelRequest, normalizeLevel } from "./evolution";

export const SAVED_DESIGNS_PACK_ID = "saved-designs";

export interface AuthoredBoard {
  id: string;
  name: string;
  briefing: string;
  paddleHint: string;
  speed: number;
  pattern: readonly string[];
}

export interface BoardPack {
  id: string;
  name: string;
  description: string;
  boards: readonly AuthoredBoard[];
}

export interface PackProgress {
  cleared: number;
  bestScore: number;
  unlocked: boolean;
}

export type PackProgressState = Record<string, PackProgress>;

export interface SavedBoardEntry {
  id: string;
  createdAt: string;
  levelName: string;
  levelBlueprint: LevelBlueprint;
  sourcePrompt: string;
  bestScore: number;
}

export const BUILT_IN_PACKS = [
  {
    id: "starter",
    name: "Starter",
    description: "Readable lanes, useful prizes, and safe bank-shot practice.",
    boards: [
      board("starter-gates", "Starter Gates", "Break the center gates and learn the side lanes.", "Clip the inner edges to open the middle.", 1.0, [
        "bbbbbbbbbbbbbb",
        "b..w....s..w.b",
        "bbbbb..bbbbbbb",
        "..p..bbbb..p..",
        "bbb..h..h..bbb",
        ".b..b....b..b.",
        "..............",
        "..............",
        ".............."
      ]),
      board("starter-wave", "Starter Wave", "A soft wave teaches shallow returns.", "Use the wide paddle brick before chasing prizes.", 1.04, [
        "..bbbbbbbbbb..",
        ".bb..w..s..bb.",
        "bbb..bbbb..bbb",
        "....bb..bb....",
        "pbbbb....bbbbp",
        "..h..b..b..h..",
        "..............",
        "..............",
        ".............."
      ]),
      board("starter-lock", "Starter Lock", "Hard corners protect a simple prize lane.", "Bank under the hard corners to reach the prize row.", 1.08, [
        "hhbbbbbbbbbbhh",
        "b..p..w..p..b",
        "bb..bbbbbb..bb",
        "..bb..ss..bb..",
        "bbbb......bbbb",
        ".h..b....b..h.",
        "..............",
        "..............",
        ".............."
      ])
    ]
  },
  {
    id: "classic",
    name: "Classic",
    description: "Dense arcade walls with bombs, lasers, and stronger corners.",
    boards: [
      board("classic-lanes", "Classic Lanes", "Alternating walls reward clean diagonal control.", "Open a diagonal before grabbing laser bricks.", 1.1, [
        "hhhhbbbbbbhhhh",
        "bllb....bllb..",
        "bbbbbbbbbbbbbb",
        "..bb....bb....",
        "bb..ssss..bb..",
        "..pbbbbbbbbp..",
        "..............",
        "..............",
        ".............."
      ]),
      board("classic-bombs", "Classic Bombs", "Bomb pockets can clear the center fast.", "Hit the bomb pockets after widening the paddle.", 1.14, [
        "bbbbbbbbbbbbbb",
        "b..o..hh..o..b",
        "bbb..bbbb..bbb",
        "..w..b..b..w..",
        "bbbo......obbb",
        ".hhbbbbbbbbhh.",
        "..............",
        "..............",
        ".............."
      ]),
      board("classic-ramp", "Classic Ramp", "A ramp of hard bricks pushes speed control.", "Use the lower holes to avoid flat returns.", 1.18, [
        "bbbboooooobbbb",
        ".bbbbhhhhbbbb.",
        "..bbbbbbbbbb..",
        "...bbbllbbb...",
        "p...bbbbbb...p",
        "hhbb......bbhh",
        "..............",
        "..............",
        ".............."
      ])
    ]
  },
  {
    id: "chaos",
    name: "Chaos",
    description: "Risky specials, falling pressure, and fast board clears.",
    boards: [
      board("chaos-pocket", "Chaos Pocket", "Prizes and penalties sit close together.", "Take the split lane before the penalty row drops.", 1.2, [
        "oobbbbxxbbbboo",
        "bb..s....s..bb",
        "x..bbbbbbbb..x",
        "bb..f.oo.f..bb",
        "..bb..gg..bb..",
        "p..bbbbbbbb..p",
        "..............",
        "..............",
        ".............."
      ]),
      board("chaos-cascade", "Chaos Cascade", "Bomb chains can erase half the wall.", "Set off bombs from the side, not the center.", 1.25, [
        "boboobbbboboob",
        "xbb..ff..bb..x",
        "bbbb..oo..bbbb",
        "..ssbbbbbbss..",
        "bb..x....x..bb",
        ".pbbbbbbbbbbp.",
        "..............",
        "..............",
        ".............."
      ]),
      board("chaos-surge", "Chaos Surge", "Fast penalties and lasers test recovery.", "Slow the ball before touching the laser row.", 1.3, [
        "llbbxxbbxxbbll",
        "bb..cc..cc..bb",
        "x.bbbbbbbbbb.x",
        "bb..o....o..bb",
        "..bbffffffbb..",
        "pp..bbbbbb..pp",
        "..............",
        "..............",
        ".............."
      ])
    ]
  },
  {
    id: "precision",
    name: "Precision",
    description: "Thin openings and protected rewards for deliberate aiming.",
    boards: [
      board("precision-needles", "Precision Needles", "Needle gaps ask for confident bank shots.", "Aim through the two lower windows first.", 1.18, [
        "hhhhhhhhhhhhhh",
        "b....tt....b..",
        "bbb.hhhh.bbb..",
        "..b..pp..b....",
        "bbb.hhhh.bbb..",
        "b....gg....b..",
        "..............",
        "..............",
        ".............."
      ]),
      board("precision-cross", "Precision Cross", "A hard cross hides soft weak points.", "Hit weak corners before drilling the center.", 1.22, [
        "..hhhhhhhhhh..",
        "bb..bbbb..bb..",
        "bb..hhhh..bb..",
        "ppbb..tt..bbpp",
        "bb..hhhh..bb..",
        "..bbbbbbbbbb..",
        "..............",
        "..............",
        ".............."
      ]),
      board("precision-vault", "Precision Vault", "Prizes sit inside a narrow vault.", "Use thru bricks to pierce the vault roof.", 1.26, [
        "hhhhbbbbbbhhhh",
        "h..t....t..h..",
        "h.bbbbbbbb.h..",
        "h.b.pppp.b.h..",
        "h.bbbbbbbb.h..",
        "hhbb....bbhh..",
        "..............",
        "..............",
        ".............."
      ])
    ]
  },
  {
    id: "boss-rush",
    name: "Boss Rush",
    description: "Heavy boss cores and reward routes for power play.",
    boards: [
      board("boss-twins", "Boss Twins", "Twin boss cores split the arena.", "Use side prizes to arm lasers before the bosses.", 1.24, [
        "bbbbhhbbhhbbbb",
        "p..bbbbbbbb..p",
        "bb..BB..BB..bb",
        "bb..BB..BB..bb",
        "..ll..ff..ll..",
        "bbbb..ss..bbbb",
        "..............",
        "..............",
        ".............."
      ]),
      board("boss-crown", "Boss Crown", "A boss crown guards bomb chains.", "Crack the crown from below, then trigger bombs.", 1.32, [
        "ooohhBBBBhhooo",
        "bbbbBBBBbbbb..",
        "..bb..BB..bb..",
        "ll..bbbbbb..ll",
        "ppbb..oo..bbpp",
        "hhhhbbbbbbhhhh",
        "..............",
        "..............",
        ".............."
      ]),
      board("boss-core", "Boss Core", "The final core rewards committed angles.", "Save fire or thru power for the center core.", 1.42, [
        "hhhhBBBBBBhhhh",
        "bb..BBBBBB..bb",
        "llbb..BB..bbll",
        "pp..ffffff..pp",
        "bb..ooBBoo..bb",
        "hhhhbbbbbbhhhh",
        "..............",
        "..............",
        ".............."
      ])
    ]
  }
] as const satisfies readonly BoardPack[];

export function materializeAuthoredBoard(packId: string, boardIndex: number, request: LevelRequest): LevelBlueprint | null {
  const pack = getBuiltInPack(packId);
  const authored = pack?.boards[boardIndex];
  if (!authored) return null;
  return normalizeLevel(
    {
      name: authored.name,
      briefing: authored.briefing,
      paddleHint: authored.paddleHint,
      speed: authored.speed,
      rows: patternToRows(authored.pattern)
    },
    authoredBoardRequest(request)
  );
}

function authoredBoardRequest(request: LevelRequest): LevelRequest {
  return {
    level: request.level,
    score: request.score,
    lives: request.lives,
    clearedLevels: request.clearedLevels,
    recentEvents: request.recentEvents
  };
}

export function getBuiltInPack(packId: string): BoardPack | undefined {
  return BUILT_IN_PACKS.find((pack) => pack.id === packId);
}

export function getNextBuiltInPack(packId: string): BoardPack | null {
  const index = BUILT_IN_PACKS.findIndex((pack) => pack.id === packId);
  return index >= 0 ? BUILT_IN_PACKS[index + 1] ?? null : null;
}

export function boardCountForPack(packId: string, savedBoardCount: number): number {
  if (packId === SAVED_DESIGNS_PACK_ID) return savedBoardCount;
  return getBuiltInPack(packId)?.boards.length ?? 0;
}

export function normalizePackProgress(input: unknown, savedBoardCount: number): PackProgressState {
  const raw = isRecord(input) ? input : {};
  const progress: PackProgressState = {};
  for (const pack of BUILT_IN_PACKS) {
    const rawEntry = raw[pack.id];
    const entry: Record<string, unknown> = isRecord(rawEntry) ? rawEntry : {};
    progress[pack.id] = {
      cleared: clampInteger(entry.cleared, 0, pack.boards.length),
      bestScore: nonNegativeInteger(entry.bestScore),
      unlocked: typeof entry.unlocked === "boolean" ? entry.unlocked : false
    };
  }

  const rawSavedEntry = raw[SAVED_DESIGNS_PACK_ID];
  const savedEntry: Record<string, unknown> = isRecord(rawSavedEntry) ? rawSavedEntry : {};
  progress[SAVED_DESIGNS_PACK_ID] = {
    cleared: clampInteger(savedEntry.cleared, 0, savedBoardCount),
    bestScore: nonNegativeInteger(savedEntry.bestScore),
    unlocked: savedBoardCount > 0
  };

  return deriveUnlocks(progress, savedBoardCount);
}

export function markPackBoardCleared(input: PackProgressState, packId: string, boardIndex: number, score: number, savedBoardCount: number): PackProgressState {
  const progress = normalizePackProgress(input, savedBoardCount);
  const total = boardCountForPack(packId, savedBoardCount);
  if (total <= 0) return progress;
  const current = progress[packId] ?? { cleared: 0, bestScore: 0, unlocked: packId === "starter" };
  progress[packId] = {
    cleared: clampInteger(Math.max(current.cleared, boardIndex + 1), 0, total),
    bestScore: Math.max(current.bestScore, nonNegativeInteger(score)),
    unlocked: current.unlocked
  };
  return deriveUnlocks(progress, savedBoardCount);
}

export function normalizeSavedBoards(input: unknown): SavedBoardEntry[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeSavedBoard).filter((entry): entry is SavedBoardEntry => entry !== null).slice(0, 24);
}

export function trimSavedBoards(entries: SavedBoardEntry[], max = 24): SavedBoardEntry[] {
  return entries.slice(0, max);
}

export function previewRowsFromLevel(level: LevelBlueprint): string[] {
  return level.rows.slice(0, BRICK_ROWS).map((row) => row.slice(0, BRICK_COLUMNS).map((cell) => (cell ? glyphForKind(cell.kind) : ".")).join("").padEnd(BRICK_COLUMNS, "."));
}

function deriveUnlocks(progress: PackProgressState, savedBoardCount: number): PackProgressState {
  let previousComplete = true;
  for (const pack of BUILT_IN_PACKS) {
    const current = progress[pack.id] ?? { cleared: 0, bestScore: 0, unlocked: false };
    const unlocked = pack.id === "starter" || current.unlocked || previousComplete;
    progress[pack.id] = { ...current, unlocked };
    previousComplete = current.cleared >= pack.boards.length;
  }
  const saved = progress[SAVED_DESIGNS_PACK_ID] ?? { cleared: 0, bestScore: 0, unlocked: false };
  progress[SAVED_DESIGNS_PACK_ID] = { ...saved, unlocked: savedBoardCount > 0 };
  return progress;
}

function board(id: string, name: string, briefing: string, paddleHint: string, speed: number, pattern: readonly string[]): AuthoredBoard {
  return { id, name, briefing, paddleHint, speed, pattern };
}

function patternToRows(pattern: readonly string[]): BrickCell[][] {
  const rows: BrickCell[][] = [];
  for (let row = 0; row < BRICK_ROWS; row += 1) {
    const source = pattern[row] ?? "";
    const cells: BrickCell[] = [];
    for (let column = 0; column < BRICK_COLUMNS; column += 1) {
      cells.push(cellFromGlyph(source[column] ?? "."));
    }
    rows.push(cells);
  }
  return rows;
}

function cellFromGlyph(glyph: string): BrickCell {
  const kind = kindForGlyph(glyph);
  if (!kind) return null;
  return { kind, hp: kind === "hard" ? 2 : kind === "boss" ? 6 : 1 };
}

function kindForGlyph(glyph: string): BrickKind | null {
  if (glyph === "b") return "basic";
  if (glyph === "h") return "hard";
  if (glyph === "o") return "bomb";
  if (glyph === "p") return "prize";
  if (glyph === "x") return "penalty";
  if (glyph === "l") return "laser";
  if (glyph === "g") return "grab";
  if (glyph === "f") return "fire";
  if (glyph === "t") return "thru";
  if (glyph === "s") return "split";
  if (glyph === "w") return "wide";
  if (glyph === "c") return "slow";
  if (glyph === "B") return "boss";
  return null;
}

function glyphForKind(kind: BrickKind): string {
  if (kind === "hard") return "h";
  if (kind === "bomb") return "o";
  if (kind === "prize") return "p";
  if (kind === "penalty") return "x";
  if (kind === "laser") return "l";
  if (kind === "grab") return "g";
  if (kind === "fire") return "f";
  if (kind === "thru") return "t";
  if (kind === "split") return "s";
  if (kind === "wide") return "w";
  if (kind === "slow") return "c";
  if (kind === "boss") return "B";
  return "b";
}

function normalizeSavedBoard(input: unknown): SavedBoardEntry | null {
  if (!isRecord(input) || !isRecord(input.levelBlueprint)) return null;
  const id = typeof input.id === "string" && input.id.trim().length > 0 ? input.id.trim().slice(0, 80) : null;
  if (!id) return null;
  const createdAt = typeof input.createdAt === "string" ? input.createdAt : new Date(0).toISOString();
  const levelName = typeof input.levelName === "string" && input.levelName.trim().length > 0 ? input.levelName.trim().slice(0, 80) : "Saved Board";
  const sourcePrompt = typeof input.sourcePrompt === "string" && input.sourcePrompt.trim().length > 0 ? input.sourcePrompt.trim().slice(0, 180) : "Saved from generated board";
  if (!Array.isArray(input.levelBlueprint.rows)) return null;
  const levelBlueprint = normalizeLevel(input.levelBlueprint, { level: 1, score: 0, lives: 3, clearedLevels: 0, recentEvents: [] });
  return { id, createdAt, levelName, levelBlueprint, sourcePrompt, bestScore: nonNegativeInteger(input.bestScore) };
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function clampInteger(value: unknown, min: number, max: number): number {
  return Math.max(min, Math.min(max, nonNegativeInteger(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
