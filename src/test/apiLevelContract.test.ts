import { describe, expect, it } from "vitest";
import { DESIGNER_BRICK_ROWS, CURSOR_MODEL, type LevelRequest, type LevelResponse } from "../shared/evolution";
import { withApiServer } from "./helpers/apiServer";

const request: LevelRequest = {
  level: 4,
  score: 2400,
  lives: 2,
  clearedLevels: 3,
  recentEvents: ["Wall cleared."]
};

function expectLevelResponseContract(body: unknown): LevelResponse {
  expect(body).toEqual(
    expect.objectContaining({
      source: expect.stringMatching(/^(cursor-sdk|fallback)$/),
      model: expect.objectContaining({ id: expect.any(String) })
    })
  );
  const response = body as LevelResponse;
  expect(response.level).toEqual(
    expect.objectContaining({
      name: expect.any(String),
      briefing: expect.any(String),
      paddleHint: expect.any(String),
      speed: expect.any(Number),
      rows: expect.any(Array)
    })
  );
  expect(response.level.rows).toHaveLength(DESIGNER_BRICK_ROWS);
  for (const row of response.level.rows) {
    expect(Array.isArray(row)).toBe(true);
  }
  return response;
}

describe("level generation HTTP contract", () => {
  it("POST /api/level returns a LevelResponse with required fields", async () => {
    process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";
    try {
      await withApiServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/level`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request)
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("application/json");
        expectLevelResponseContract(await response.json());
      });
    } finally {
      delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    }
  });

  it("POST /api/evolve is an alias for /api/level", async () => {
    process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";
    try {
      await withApiServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/evolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request)
        });
        expect(response.status).toBe(200);
        const body = expectLevelResponseContract(await response.json());
        expect(body.source).toBe("fallback");
        expect(body.model).toEqual(CURSOR_MODEL);
      });
    } finally {
      delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;
    }
  });

  it("rejects invalid JSON bodies with a stable error contract", async () => {
    await withApiServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/level`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not-json"
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid JSON body." });
    });
  });

  it("rejects non-POST methods on generation routes", async () => {
    await withApiServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/level`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    });
  });
});
