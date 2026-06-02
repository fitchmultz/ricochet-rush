import { describe, expect, it } from "vitest";
import { AGENT_MANUAL_TIME_SCALE, AGENT_MODE_STORAGE_KEY, resolveAgentMode } from "../client/game/agentMode";

function storage(value: string | null) {
  return {
    getItem(key: string) {
      expect(key).toBe(AGENT_MODE_STORAGE_KEY);
      return value;
    }
  };
}

describe("resolveAgentMode", () => {
  it("keeps normal play unchanged by default", () => {
    expect(resolveAgentMode("", storage(null))).toEqual({ enabled: false, timeScale: 1, paddleMode: "manual" });
  });

  it("enables the fixed slow-game mode from the URL", () => {
    expect(resolveAgentMode("?agentMode=1", storage(null))).toEqual({ enabled: true, timeScale: AGENT_MANUAL_TIME_SCALE, paddleMode: "manual" });
    expect(resolveAgentMode("?agentMode", storage(null))).toEqual({ enabled: true, timeScale: AGENT_MANUAL_TIME_SCALE, paddleMode: "manual" });
  });

  it("lets the URL override stored agent-mode preferences", () => {
    expect(resolveAgentMode("?agentMode=0", storage("1"))).toEqual({ enabled: false, timeScale: 1, paddleMode: "manual" });
    expect(resolveAgentMode("?agentMode=true", storage("0"))).toEqual({ enabled: true, timeScale: AGENT_MANUAL_TIME_SCALE, paddleMode: "manual" });
  });

  it("can be enabled from local storage for a headed interactive session", () => {
    expect(resolveAgentMode("", storage("on"))).toEqual({ enabled: true, timeScale: AGENT_MANUAL_TIME_SCALE, paddleMode: "manual" });
  });

  it("keeps autonomous paddle control as an explicit debug option", () => {
    expect(resolveAgentMode("?agentMode=1&agentPaddle=auto", storage(null))).toEqual({
      enabled: true,
      timeScale: 1,
      paddleMode: "auto"
    });
    expect(resolveAgentMode("?agentPaddle=auto", storage(null))).toEqual({ enabled: false, timeScale: 1, paddleMode: "manual" });
  });
});
