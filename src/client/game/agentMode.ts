export const AGENT_MODE_QUERY_PARAM = "agentMode";
export const AGENT_PADDLE_QUERY_PARAM = "agentPaddle";
export const AGENT_MODE_STORAGE_KEY = "ricochet-rush-agent-mode";
export const AGENT_MANUAL_TIME_SCALE = 0.32;

export type AgentPaddleMode = "manual" | "auto";

export interface AgentModeConfig {
  enabled: boolean;
  timeScale: number;
  paddleMode: AgentPaddleMode;
}

interface AgentModeStorage {
  getItem(key: string): string | null;
}

const ENABLED_VALUES = new Set(["", "1", "true", "yes", "on", "slow"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

export function resolveAgentMode(search: string, storage?: AgentModeStorage | null): AgentModeConfig {
  const params = new URLSearchParams(search);
  const paramValue = params.get(AGENT_MODE_QUERY_PARAM);
  const storageValue = readStoredAgentMode(storage);
  const enabled = paramValue === null ? storageValue : parseAgentModeFlag(paramValue);
  const paddleMode = enabled ? parsePaddleMode(params.get(AGENT_PADDLE_QUERY_PARAM)) : "manual";
  return {
    enabled,
    timeScale: enabled && paddleMode === "manual" ? AGENT_MANUAL_TIME_SCALE : 1,
    paddleMode
  };
}

function readStoredAgentMode(storage?: AgentModeStorage | null): boolean {
  if (!storage) return false;
  try {
    const value = storage.getItem(AGENT_MODE_STORAGE_KEY);
    return value === null ? false : parseAgentModeFlag(value);
  } catch {
    return false;
  }
}

function parseAgentModeFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (DISABLED_VALUES.has(normalized)) return false;
  return ENABLED_VALUES.has(normalized);
}

function parsePaddleMode(value: string | null): AgentPaddleMode {
  return value?.trim().toLowerCase() === "auto" ? "auto" : "manual";
}
