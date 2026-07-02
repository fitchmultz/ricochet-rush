export const DEBUG_GAME_QUERY_PARAM = "debugGame";
export const DEBUG_GAME_STORAGE_KEY = "ricochet-rush-debug";

export interface DebugSurfaceStorage {
  getItem(key: string): string | null;
}

export function isDebugSurfaceEnabled(search: string, storage?: DebugSurfaceStorage | null): boolean {
  const params = new URLSearchParams(search);
  if (params.has(DEBUG_GAME_QUERY_PARAM)) return true;
  if (!storage) return false;
  try {
    return storage.getItem(DEBUG_GAME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
