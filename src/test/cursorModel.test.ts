import { describe, expect, it } from "vitest";
import { CURSOR_MODEL } from "../shared/evolution";
import { resolveCursorModelSelection, selectCursorModelFromCatalog } from "../server/cursorModel";

describe("Cursor SDK model selection", () => {
  it("selects the current composer-2.5 fast SDK model from the discovered catalog", () => {
    expect(
      selectCursorModelFromCatalog([
        {
          id: "composer-2.5",
          displayName: "Composer 2.5",
          aliases: ["composer-latest", "composer", "composer-2-5"],
          parameters: [
            {
              id: "fast",
              displayName: "Fast",
              values: [{ value: "false" }, { value: "true", displayName: "Fast" }]
            }
          ],
          variants: [
            { params: [{ id: "fast", value: "true" }], displayName: "Composer 2.5", isDefault: true },
            { params: [{ id: "fast", value: "false" }], displayName: "Composer 2.5" }
          ]
        }
      ])
    ).toEqual(CURSOR_MODEL);
  });

  it("falls back to auto only when the SDK catalog no longer exposes composer-2.5", () => {
    expect(selectCursorModelFromCatalog([{ id: "other-model", displayName: "Other Model" }])).toEqual({ id: "auto" });
  });

  it("bounds model catalog discovery so generation can enter its retry budget", async () => {
    const model = await resolveCursorModelSelection("test-key", {
      timeoutMs: 1,
      loadCatalog: () => new Promise(() => {})
    });

    expect(model).toEqual(CURSOR_MODEL);
  });
});
