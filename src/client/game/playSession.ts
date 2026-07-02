export const AGENT_MODE_QUERY_PARAM = "agentMode";
export const AGENT_PADDLE_QUERY_PARAM = "agentPaddle";
export const AGENT_MODE_STORAGE_KEY = "ricochet-rush-agent-mode";
export const AGENT_MANUAL_TIME_SCALE = 0.32;

export type PlayMode = "normal" | "agent-manual" | "agent-auto";

export interface PlaySessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ENABLED_VALUES = new Set(["", "1", "true", "yes", "on", "slow"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

export function resolvePlayMode(search: string, storage?: PlaySessionStorage | null): PlayMode {
  const params = new URLSearchParams(search);
  const agentModeParam = params.get(AGENT_MODE_QUERY_PARAM);
  const parsedFromUrl = agentModeParam === null ? null : parseAgentModeFlag(agentModeParam);
  const agentModeActive = parsedFromUrl !== null ? parsedFromUrl : readStoredAgentMode(storage);
  if (!agentModeActive) return "normal";
  return params.get(AGENT_PADDLE_QUERY_PARAM)?.trim().toLowerCase() === "auto" ? "agent-auto" : "agent-manual";
}

export function isRecognizedAgentModeUrl(search: string): boolean {
  const param = new URLSearchParams(search).get(AGENT_MODE_QUERY_PARAM);
  return param !== null && parseAgentModeFlag(param) === true;
}

export function playClockScale(mode: PlayMode): number {
  switch (mode) {
    case "agent-manual":
      return AGENT_MANUAL_TIME_SCALE;
    case "normal":
    case "agent-auto":
      return 1;
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

export function blockPassiveMouseHover(mode: PlayMode): boolean {
  return mode === "agent-manual";
}

export function agentModeBoardMetaSuffix(mode: PlayMode): string {
  switch (mode) {
    case "normal":
      return "";
    case "agent-manual":
      return " • Agent mode";
    case "agent-auto":
      return " • Agent mode auto paddle";
    default: {
      const unreachable: never = mode;
      return unreachable;
    }
  }
}

export function persistAgentModePreference(search: string, storage?: PlaySessionStorage | null): void {
  if (!storage) return;
  const params = new URLSearchParams(search);
  if (!params.has(AGENT_MODE_QUERY_PARAM)) return;
  const parsed = parseAgentModeFlag(params.get(AGENT_MODE_QUERY_PARAM) ?? "");
  if (parsed === null) return;
  try {
    storage.setItem(AGENT_MODE_STORAGE_KEY, parsed ? "1" : "0");
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

function readStoredAgentMode(storage?: PlaySessionStorage | null): boolean {
  if (!storage) return false;
  try {
    const value = storage.getItem(AGENT_MODE_STORAGE_KEY);
    return value === null ? false : parseAgentModeFlag(value) === true;
  } catch {
    return false;
  }
}

function parseAgentModeFlag(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (DISABLED_VALUES.has(normalized)) return false;
  if (ENABLED_VALUES.has(normalized)) return true;
  return null;
}
