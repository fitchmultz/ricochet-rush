import { describe, expect, it } from "vitest";
import { isDebugSurfaceEnabled } from "../client/game/debugSurface";
import {
  AGENT_MANUAL_TIME_SCALE,
  AGENT_MODE_STORAGE_KEY,
  agentModeBoardMetaSuffix,
  blockPassiveMouseHover,
  isRecognizedAgentModeUrl,
  persistAgentModePreference,
  playClockScale,
  resolvePlayMode
} from "../client/game/playSession";
import { keyboardPaddleDirection, keyboardPaddleTargetX, movePaddle } from "../client/game/paddleControl";

function storage(initial: string | null = null) {
  let value = initial;
  return {
    getItem(key: string) {
      expect(key).toBe(AGENT_MODE_STORAGE_KEY);
      return value;
    },
    setItem(key: string, next: string) {
      expect(key).toBe(AGENT_MODE_STORAGE_KEY);
      value = next;
    }
  };
}

describe("resolvePlayMode", () => {
  it("keeps normal play unchanged by default", () => {
    expect(resolvePlayMode("", storage(null))).toBe("normal");
  });

  it("selects manual agent play from the URL", () => {
    expect(resolvePlayMode("?agentMode=1", storage(null))).toBe("agent-manual");
    expect(resolvePlayMode("?agentMode", storage(null))).toBe("agent-manual");
  });

  it("lets the URL override stored agent-mode preferences", () => {
    expect(resolvePlayMode("?agentMode=0", storage("1"))).toBe("normal");
    expect(resolvePlayMode("?agentMode=true", storage("0"))).toBe("agent-manual");
  });

  it("can enable manual agent play from local storage", () => {
    expect(resolvePlayMode("", storage("on"))).toBe("agent-manual");
  });

  it("falls back to stored preferences when the URL flag is unrecognized", () => {
    expect(resolvePlayMode("?agentMode=fast", storage("1"))).toBe("agent-manual");
  });

  it("selects debug auto paddle only when agent mode is active", () => {
    expect(resolvePlayMode("?agentMode=1&agentPaddle=auto", storage(null))).toBe("agent-auto");
    expect(resolvePlayMode("?agentPaddle=auto", storage(null))).toBe("normal");
  });
});

describe("play mode derivations", () => {
  it("derives clock scale, hover blocking, and HUD suffix from play mode", () => {
    expect(playClockScale("agent-manual")).toBe(AGENT_MANUAL_TIME_SCALE);
    expect(playClockScale("agent-auto")).toBe(1);
    expect(playClockScale("normal")).toBe(1);
    expect(blockPassiveMouseHover("agent-manual")).toBe(true);
    expect(blockPassiveMouseHover("agent-auto")).toBe(false);
    expect(agentModeBoardMetaSuffix("agent-manual")).toBe(" • Agent mode");
    expect(agentModeBoardMetaSuffix("agent-auto")).toBe(" • Agent mode auto paddle");
    expect(agentModeBoardMetaSuffix("normal")).toBe("");
  });
});

describe("play session persistence", () => {
  it("persists explicit URL preferences for later headed sessions", () => {
    const store = storage(null);
    persistAgentModePreference("?agentMode=1", store);
    expect(store.getItem(AGENT_MODE_STORAGE_KEY)).toBe("1");
    expect(resolvePlayMode("", store)).toBe("agent-manual");
  });

  it("does not persist unrecognized URL flags", () => {
    const store = storage("1");
    persistAgentModePreference("?agentMode=fast", store);
    expect(store.getItem(AGENT_MODE_STORAGE_KEY)).toBe("1");
  });
});

describe("bootstrap debug surface", () => {
  it("enables debug surface only from recognized agent URLs or explicit debug flags", () => {
    expect(isRecognizedAgentModeUrl("?agentMode=1")).toBe(true);
    expect(isRecognizedAgentModeUrl("?agentMode=fast")).toBe(false);
    expect(isDebugSurfaceEnabled("?debugGame=1", storage(null))).toBe(true);
    expect(isRecognizedAgentModeUrl("") || isDebugSurfaceEnabled("", storage("1"))).toBe(false);
    expect(isRecognizedAgentModeUrl("?agentMode=1") || isDebugSurfaceEnabled("?agentMode=1", storage(null))).toBe(true);
  });
});

describe("paddle control helpers", () => {
  it("computes keyboard paddle motion without feature orchestration", () => {
    const state = { paddleX: 480, paddleWidth: 116, paddleVelocityX: 0 };
    const direction = keyboardPaddleDirection(new Set(["ArrowRight"]));
    const next = movePaddle(state, keyboardPaddleTargetX(state, direction, 0.1), 0.1);
    expect(next.paddleX).toBeGreaterThan(480);
  });
});
