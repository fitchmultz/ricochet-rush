import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "@cursor/sdk";
import { SqliteLocalAgentStore } from "@cursor/sdk/sqlite";

describe("reviewed dependency contracts", () => {
  it("Cursor SDK sqlite storage opens and disposes for a workspace", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ricochet-sdk-state-"));
    const store = await SqliteLocalAgentStore.open({ workspaceRef: stateRoot, stateRoot });
    expect(store.workspaceRef).toBe(stateRoot);
    expect(store.stateRoot).toBe(stateRoot);
    await store.dispose();
  });

  it("Cursor SDK exports Agent.create", () => {
    expect(typeof Agent.create).toBe("function");
  });
});
