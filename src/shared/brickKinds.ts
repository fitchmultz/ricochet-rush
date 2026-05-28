import { clamp } from "./util";

export const BRICK_KIND_VALUES = [
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
] as const;

export type BrickKind = (typeof BRICK_KIND_VALUES)[number];

export interface BrickSpec {
  kind: BrickKind;
  hp: number;
}

export type BrickCell = BrickSpec | null;

export const BRICK_KINDS = new Set<BrickKind>(BRICK_KIND_VALUES);

export const COMPACT_GRID_KINDS: Record<string, BrickKind> = {
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

export const BRIEF_KIND_MATCH_ORDER: BrickKind[] = ["bomb", "boss", "hard", "prize", "penalty", "laser", "grab", "fire", "thru", "split", "wide", "slow", "basic"];

const KIND_MATCHER_SOURCES: Record<BrickKind, string> = {
  bomb: "(?:bombs?|explod\\w*|explos\\w*|blasts?|detonat\\w*)",
  boss: "(?:boss(?:es)?|cores?)",
  hard: "(?:hard|metals?|armou?rs?|shields?)",
  prize: "(?:prizes?|rewards?|gifts?|green)",
  penalty: "(?:penalties|penalty|hazards?|reds?|bad)",
  laser: "(?:lasers?|beams?)",
  grab: "(?:grabs?|catches|catch|sticky)",
  fire: "(?:fires?|flames?|burn(?:s|ing|ed)?)",
  thru: "(?:thru|ghosts?|phases?|pierc\\w*)",
  split: "(?:splits?|multi[- ]?balls?|multiballs?)",
  wide: "(?:wide|expands?|expanded|big\\s+paddles?)",
  slow: "(?:slows?|brakes?|chill)",
  basic: "(?:basics?|plain|normal)"
};

export function kindMatcherSource(kind: BrickKind): string {
  return KIND_MATCHER_SOURCES[kind];
}

export function eyeFeatureKindMatcherSource(kind: BrickKind): string {
  return kind === "boss" ? "(?:boss(?:es)?)" : kindMatcherSource(kind);
}

export function brickForKind(kind: BrickKind, difficulty: number, level: number): BrickSpec {
  if (kind === "hard") return { kind, hp: clamp(1 + Math.ceil(difficulty / 2), 2, 4) };
  if (kind === "boss") return { kind, hp: clamp(4 + difficulty + Math.floor(level / 4), 5, 12) };
  return { kind, hp: 1 };
}

