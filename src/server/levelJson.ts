export interface ParsedLevelJsonCandidate {
  parsed: unknown;
  rawText: string;
  jsonText: string;
}

export function parseLevelJsonFromCandidates(candidates: readonly (string | undefined)[]): ParsedLevelJsonCandidate {
  const uniqueCandidates = [...new Set(candidates.map((candidate) => candidate?.trim() ?? "").filter((candidate) => candidate.length > 0))];
  const errors: string[] = [];
  let bestCandidate: ParsedLevelJsonCandidate | undefined;
  let bestScore = 0;
  if (uniqueCandidates.length === 0) throw new Error("Cursor SDK returned no assistant text.");

  for (const rawText of uniqueCandidates) {
    const jsonCandidates = extractJsonObjects(rawText).reverse();
    for (const jsonText of jsonCandidates) {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        if (!isLevelLike(parsed)) continue;
        const score = levelCandidateScore(parsed);
        if (score > bestScore) {
          bestCandidate = { parsed, rawText, jsonText };
          bestScore = score;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  if (bestCandidate) return bestCandidate;

  const suffix = errors.length > 0 ? ` ${errors[0]}` : "";
  throw new Error(`Cursor SDK returned invalid JSON.${suffix}`.trim());
}

export function extractJsonObjects(text: string): string[] {
  const objects: string[] = [];
  const seen = new Set<string>();

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    const end = findJsonObjectEnd(text, start);
    if (end === -1) continue;
    const candidate = text.slice(start, end + 1);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    objects.push(candidate);
  }

  return objects;
}

function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char !== "}") continue;
    depth -= 1;
    if (depth === 0) return index;
    if (depth < 0) return -1;
  }

  return -1;
}

function isLevelLike(value: unknown): value is { rows?: unknown[]; grid?: unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { rows?: unknown; grid?: unknown };
  return Array.isArray(record.rows) || Array.isArray(record.grid);
}

function levelCandidateScore(value: { rows?: unknown[]; grid?: unknown[] }): number {
  const record = value as Record<string, unknown>;
  let score = 10;
  if (typeof record.name === "string" && record.name.trim().length > 0) score += 2;
  if (typeof record.briefing === "string" && record.briefing.trim().length > 0) score += 2;
  if (typeof record.paddleHint === "string" && record.paddleHint.trim().length > 0) score += 2;
  if (typeof record.speed === "number" && Number.isFinite(record.speed)) score += 1;
  score += Math.min(value.rows?.length ?? value.grid?.length ?? 0, 9);
  if (Array.isArray(value.grid)) score += 2;
  return score;
}
