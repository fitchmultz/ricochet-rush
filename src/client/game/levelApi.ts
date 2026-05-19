import type { LevelRequest, LevelResponse } from "../../shared/evolution";

export const LEVEL_GENERATION_TIMEOUT_MS = 65_000;

interface LevelGenerationOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export async function requestGeneratedLevel(request: LevelRequest, options: LevelGenerationOptions = {}): Promise<LevelResponse> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? LEVEL_GENERATION_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetcher("/api/level", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Level generation failed with ${response.status}`);
    return (await response.json()) as LevelResponse;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(levelGenerationTimeoutMessage(timeoutMs));
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function levelGenerationTimeoutMessage(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  const label = seconds >= 10 ? String(Math.round(seconds)) : String(Number(seconds.toFixed(1)));
  return `Level generation timed out after ${label} seconds.`;
}

export function isLevelGenerationNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name === "typeerror" ||
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("connection refused") ||
    message.includes("err_connection")
  );
}

export function levelGenerationServerHint(): string {
  return "Start the local server with `npm run dev` or `npm run preview` so /api/level can reach the board designer.";
}
