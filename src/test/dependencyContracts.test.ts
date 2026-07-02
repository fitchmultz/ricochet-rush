import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Agent } from "@cursor/sdk";
import { SqliteLocalAgentStore } from "@cursor/sdk/sqlite";
import { createConnectTransport } from "@connectrpc/connect-node";

describe("reviewed dependency contracts", () => {
  it("Cursor SDK sqlite storage opens and disposes for a workspace", async () => {
    const stateRoot = await mkdtemp(join(tmpdir(), "ricochet-sdk-state-"));
    const store = await SqliteLocalAgentStore.open({ workspaceRef: stateRoot, stateRoot });
    expect(store.workspaceRef).toBe(stateRoot);
    expect(store.stateRoot).toBe(stateRoot);
    await store.dispose();
  });

  it("connect-node transport initializes with the overridden undici package", () => {
    const transport = createConnectTransport({ baseUrl: "http://127.0.0.1:1", httpVersion: "1.1" });
    expect(transport).toBeTruthy();
  });

  it("Cursor SDK exports Agent.create", () => {
    expect(typeof Agent.create).toBe("function");
  });
});
