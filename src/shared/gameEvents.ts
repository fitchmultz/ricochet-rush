export type GameEventAudience = "player" | "technical";

export interface GameEventRecord {
  text: string;
  audience: GameEventAudience;
}

export function gameEvent(text: string, audience: GameEventAudience = "player"): GameEventRecord {
  return { text, audience };
}

export function gameEventText(event: string | GameEventRecord): string {
  return typeof event === "string" ? event : event.text;
}

export function gameEventAudience(event: string | GameEventRecord, fallback: GameEventAudience = "player"): GameEventAudience {
  return typeof event === "string" ? fallback : event.audience;
}

/** Legacy saves and API payloads may only have plain strings. */
export function normalizeGameEvent(input: unknown, fallbackAudience: GameEventAudience = "player"): GameEventRecord | null {
  if (typeof input === "string" && input.trim().length > 0) {
    const text = input.trim();
    return { text, audience: inferTechnicalAudience(text) ? "technical" : fallbackAudience };
  }
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) return null;
    const audience = record.audience === "technical" ? "technical" : "player";
    return { text, audience };
  }
  return null;
}

export function normalizeGameEvents(input: unknown, limit = 6): GameEventRecord[] {
  if (!Array.isArray(input)) return [];
  const events: GameEventRecord[] = [];
  for (const entry of input) {
    const normalized = normalizeGameEvent(entry);
    if (normalized) events.push(normalized);
    if (events.length >= limit) break;
  }
  return events;
}

export function gameEventsToStrings(events: readonly GameEventRecord[]): string[] {
  return events.map((event) => event.text);
}

export function inferTechnicalAudience(event: string): boolean {
  const normalized = event.toLowerCase();
  return (
    normalized.includes("generated power-up atlas") ||
    normalized.includes("power-up icons are ready") ||
    normalized.includes("power-up icons switched") ||
    normalized.includes("power-up art failed") ||
    normalized.includes("cursor sdk") ||
    normalized.includes("api failure") ||
    normalized.includes("parse") ||
    normalized.includes("trace") ||
    normalized.includes("fallback") ||
    normalized.includes("local backup") ||
    normalized.includes("checkpoint saved") ||
    normalized.includes("saved board rebuilt") ||
    normalized.startsWith("generated ")
  );
}
