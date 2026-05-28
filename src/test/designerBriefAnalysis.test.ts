import { describe, expect, it } from "vitest";
import { analyzeDesignerBrief } from "../shared/designerBriefAnalysis";

describe("designer brief analysis", () => {
  it("classifies global-only and feature-scoped bomb prompts separately", () => {
    expect(analyzeDesignerBrief("heart shape with only bomb bricks").exclusiveKind).toBe("bomb");
    expect(analyzeDesignerBrief("create a heart shaped board that has nothing but exploding blocks").exclusiveKind).toBe("bomb");
    const globalOnlyCases = [
      ["all bombs", "bomb"],
      ["bombs only", "bomb"],
      ["only bomb bricks, no hard bricks", "bomb"],
      ["only bomb bricks, no prizes or hard bricks", "bomb"],
      ["only bombs, avoid hard bricks and prizes", "bomb"],
      ["no hard bricks and only bombs", "bomb"],
      ["avoid hard bricks and use only bombs", "bomb"],
      ["no hard bricks and bombs only", "bomb"],
      ["avoid hard bricks and bomb bricks only", "bomb"],
      ["only bombs, boss-free", "bomb"],
      ["heart shape, only bomb bricks with a bright center lane, mirrored bomb pockets, soft corner safety, and a tiny boss-free finish that still feels like a readable gallery preview", "bomb"],
      ["only bomb bricks, but the layout should be a heart", "bomb"],
      ["all occupied bricks are bombs except the center is empty", "bomb"],
      ["all occupied bricks are bombs and only the center is empty", "bomb"],
      ["all occupied bricks are bombs and the eyes are bombs only", "bomb"],
      ["all occupied bricks are bombs and only the eyes are bombs", "bomb"],
      ["all bomb bricks except only the center is empty", "bomb"],
      ["board is nothing but bombs; the corners are bombs only", "bomb"],
      ["heart made only of bomb bricks", "bomb"],
      ["board made entirely of bombs", "bomb"],
      ["heart made only of explosive bricks", "bomb"],
      ["all bosses", "boss"],
      ["only shields", "hard"],
      ["all prizes", "prize"],
      ["all penalties", "penalty"],
      ["only lasers", "laser"],
      ["only catches", "grab"],
      ["only flames", "fire"],
      ["only ghosts", "thru"],
      ["only multiballs", "split"],
      ["only expands", "wide"],
      ["only brakes", "slow"],
      ["only basics", "basic"]
    ] as const;
    for (const [prompt, kind] of globalOnlyCases) {
      expect(analyzeDesignerBrief(prompt).exclusiveKind, prompt).toBe(kind);
    }
  });

  it("keeps eye-only bomb prompts feature-scoped instead of global-exclusive", () => {
    expect(analyzeDesignerBrief("make a smiley face with only the eyes as exploding bricks")).toMatchObject({ exclusiveKind: undefined, preferredKind: undefined, mentionedKinds: ["bomb"] });
    expect(analyzeDesignerBrief("make a smiley face using only bombs for the eyes").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face using only exploding bricks for eyes").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face with bombs only for the eyes").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face where the eyes are only bombs").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face with eyes only bombs").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face where the eyes are bombs only").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face where the eyes should use only bombs").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face where the eyes are exclusively bombs").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face where the eyes are entirely bombs").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face with eyes that are bombs only").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face with eyes made only of bombs").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face with all bomb bricks for the eyes").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face with exploding bricks only for the eyes").exclusiveKind).toBeUndefined();
    expect(analyzeDesignerBrief("make a smiley face with bomb eyes only")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with exploding eyes only")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    for (const prompt of ["use bombs for eyes only", "only use bombs for eyes", "only use exploding bricks for eyes", "eyes should only be bombs", "eyes should only use bombs", "eyes only use bombs"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        exclusiveKind: undefined,
        preferredKind: undefined,
        mentionedKinds: ["bomb"],
        localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
      });
    }
    for (const prompt of ["no hard + eyes should only be bombs", "no hard and eyes should only use bombs", "no hard + eyes only bombs", "no hard or bombs outside the eyes", "no hard and bombs outside the eyes", "no hard bricks and no bombs except the eyes", "no hard bricks and free of bombs except eyes", "no hard bricks and bomb-free except eyes", "no hard bricks with no bombs except eyes", "no hard bricks with free of bombs except eyes", "no hard bricks with bomb-free except eyes", "hard-free with no bombs except eyes", "hard-free and bomb-free except eyes"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        exclusiveKind: undefined,
        preferredKind: undefined,
        mentionedKinds: ["bomb"],
        excludedKinds: ["hard"],
        localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
      });
    }
    for (const prompt of ["no bombs plus eyes should only be bombs", "no bombs and eyes should only be bombs", "no bombs with eyes should only be bombs"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        exclusiveKind: undefined,
        preferredKind: undefined,
        mentionedKinds: ["bomb"],
        excludedKinds: [],
        localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
      });
    }
    expect(analyzeDesignerBrief("make a smiley face with only exploding eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
  });

  it("distinguishes required eye bombs from localized-only eye bombs", () => {
    expect(analyzeDesignerBrief("make a smiley face and the eyes are exploding bricks")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: "bomb",
      mentionedKinds: ["bomb"],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }]),
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("make a smiley face with explosive eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: "bomb",
      mentionedKinds: ["bomb"],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }]),
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("make a smiley face with explosive eyes but no bombs elsewhere")).toMatchObject({ exclusiveKind: undefined, preferredKind: undefined, mentionedKinds: ["bomb"] });
    expect(analyzeDesignerBrief("make a smiley face with no bombs except the eyes")).toMatchObject({ exclusiveKind: undefined, preferredKind: undefined, mentionedKinds: ["bomb"] });
    expect(analyzeDesignerBrief("make a smiley face with no bombs except on the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with no bombs except inside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    for (const prompt of ["make a smiley face with no bombs except exploding eyes", "make a smiley face with no bombs except bomb eyes", "make a smiley face with no bombs but bomb eyes", "make a smiley face with no bombs but exploding eyes"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        exclusiveKind: undefined,
        preferredKind: undefined,
        mentionedKinds: ["bomb"],
        excludedKinds: [],
        localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
      });
    }
    expect(analyzeDesignerBrief("make a smiley face with no bombs apart from the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with no bombs other than the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with no bombs outside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with no exploding bricks outside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with no hard bricks and no bombs outside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: ["hard"],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with no hard bricks plus no bombs outside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: ["hard"],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }]),
      shape: undefined
    });
    for (const prompt of [
      "make a smiley face with no hard bricks and explosive eyes",
      "make a smiley face with no hard bricks plus explosive eyes",
      "make a smiley face with no hard + explosive eyes",
      "make a smiley face with no hard + eyes are exploding bricks",
      "make a smiley face with no hard bricks and eyes are exploding bricks"
    ]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        exclusiveKind: undefined,
        preferredKind: "bomb",
        mentionedKinds: ["bomb"],
        excludedKinds: ["hard"],
        requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }]),
        localizedKindFeatures: []
      });
    }
  });

  it("keeps excluded-kind and shape wording separate from feature exceptions", () => {
    expect(analyzeDesignerBrief("no hard bricks and only bombs")).toMatchObject({ exclusiveKind: "bomb", excludedKinds: ["hard"] });
    expect(analyzeDesignerBrief("avoid hard bricks and use only bombs")).toMatchObject({ exclusiveKind: "bomb", excludedKinds: ["hard"] });
    expect(analyzeDesignerBrief("no hard bricks plus only bombs")).toMatchObject({ exclusiveKind: "bomb", excludedKinds: ["hard"] });
    expect(analyzeDesignerBrief("avoid hard bricks plus use only bombs")).toMatchObject({ exclusiveKind: "bomb", excludedKinds: ["hard"] });
    expect(analyzeDesignerBrief("no hard + only bombs")).toMatchObject({ exclusiveKind: "bomb", excludedKinds: ["hard"] });
    expect(analyzeDesignerBrief("avoid hard + use only bombs")).toMatchObject({ exclusiveKind: "bomb", excludedKinds: ["hard"] });
    expect(analyzeDesignerBrief("make a plus").shape).toBe("cross");
    expect(analyzeDesignerBrief("a plus with no hard bricks")).toMatchObject({ shape: "cross", excludedKinds: ["hard"] });
    expect(analyzeDesignerBrief("all occupied bricks are bombs and only the eyes are bombs")).toMatchObject({
      exclusiveKind: "bomb",
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("make a smiley face with no bombs outside the mouth")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: [],
      excludedKinds: ["bomb"],
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("no hard except corners")).toMatchObject({
      mentionedKinds: [],
      excludedKinds: ["hard"],
      localizedKindFeatures: []
    });
    for (const prompt of ["no hard except hard corners", "hard-free except hard corners"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        preferredKind: undefined,
        mentionedKinds: ["hard"],
        excludedKinds: ["hard"],
        localizedKindFeatures: []
      });
    }
    expect(analyzeDesignerBrief("core with no bosses")).toMatchObject({
      preferredKind: undefined,
      mentionedKinds: ["boss"],
      excludedKinds: ["boss"],
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("make a smiley face with bomb eyes and a bomb mouth")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: "bomb",
      mentionedKinds: ["bomb"],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }]),
      localizedKindFeatures: []
    });
  });

  it("classifies core and boss-core feature constraints", () => {
    for (const prompt of ["boss-core board with no bombs outside the core", "bomb core with no bombs elsewhere", "core bombs with no bombs elsewhere"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        mentionedKinds: ["bomb", "boss"],
        excludedKinds: [],
        requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
        localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }])
      });
    }
    expect(analyzeDesignerBrief("hard core with no hard elsewhere")).toMatchObject({
      mentionedKinds: ["boss", "hard"],
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([{ kind: "hard", feature: "core" }]),
      localizedKindFeatures: expect.arrayContaining([{ kind: "hard", feature: "core" }])
    });
    expect(analyzeDesignerBrief("boss core with no boss bricks elsewhere")).toMatchObject({
      mentionedKinds: ["boss"],
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([{ kind: "boss", feature: "core" }]),
      localizedKindFeatures: expect.arrayContaining([{ kind: "boss", feature: "core" }])
    });
    expect(analyzeDesignerBrief("no bombs outside eyes with hard core")).toMatchObject({
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([
        { kind: "bomb", feature: "eyes" },
        { kind: "hard", feature: "core" }
      ]),
      localizedKindFeatures: [{ kind: "bomb", feature: "eyes" }]
    });
    expect(analyzeDesignerBrief("no bombs outside eyes with hard core").requiredKindFeatures).not.toContainEqual({ kind: "hard", feature: "eyes" });
    expect(analyzeDesignerBrief("boss-core board")).toMatchObject({
      mentionedKinds: ["boss"],
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([{ kind: "boss", feature: "core" }]),
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("boss-core board with no bosses")).toMatchObject({
      mentionedKinds: ["boss"],
      excludedKinds: ["boss"],
      preferredKind: undefined,
      requiredKindFeatures: [],
      localizedKindFeatures: []
    });
    for (const prompt of ["boss-core board with no core bombs", "boss-core board with no bomb core", "boss-core board with no exploding core"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        mentionedKinds: ["boss"],
        excludedKinds: ["bomb"],
        requiredKindFeatures: expect.arrayContaining([{ kind: "boss", feature: "core" }])
      });
    }
    expect(analyzeDesignerBrief("boss-core board with exploding core")).toMatchObject({
      mentionedKinds: ["bomb", "boss"],
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("only core bombs")).toMatchObject({
      mentionedKinds: ["bomb", "boss"],
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }])
    });
    expect(analyzeDesignerBrief("boss core bombs")).toMatchObject({
      mentionedKinds: ["bomb", "boss"],
      excludedKinds: [],
      requiredKindFeatures: [{ kind: "bomb", feature: "core" }],
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("boss-core with only core bombs")).toMatchObject({
      mentionedKinds: ["bomb", "boss"],
      excludedKinds: [],
      requiredKindFeatures: [{ kind: "bomb", feature: "core" }],
      localizedKindFeatures: [{ kind: "bomb", feature: "core" }]
    });
    for (const prompt of ["no hard except core bombs", "no hard except bomb core", "no hard except exploding core"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        mentionedKinds: ["bomb", "boss"],
        excludedKinds: ["hard"],
        requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
        localizedKindFeatures: []
      });
    }
    expect(analyzeDesignerBrief("no bombs and no hard except core bombs")).toMatchObject({
      mentionedKinds: ["bomb", "boss"],
      excludedKinds: ["hard"],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }])
    });
    for (const prompt of ["no boss bricks but core bombs", "no boss bricks but bomb core", "no boss bricks but exploding core"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        mentionedKinds: ["bomb", "boss"],
        excludedKinds: ["boss"],
        requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
        localizedKindFeatures: []
      });
    }
    expect(analyzeDesignerBrief("core is bombs")).toMatchObject({
      mentionedKinds: ["bomb", "boss"],
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
      localizedKindFeatures: []
    });
    expect(analyzeDesignerBrief("bombs in the core")).toMatchObject({
      mentionedKinds: ["bomb", "boss"],
      excludedKinds: [],
      requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
      localizedKindFeatures: []
    });
    for (const prompt of ["no bombs outside the boss core", "no bombs, except core bombs", "no bombs; except core bombs", "no bombs except core bombs", "no bombs except bomb core", "no bombs but exploding core"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        mentionedKinds: expect.arrayContaining(["bomb"]),
        excludedKinds: [],
        requiredKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }]),
        localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "core" }])
      });
    }
    for (const prompt of ["no bombs outside eyes and core", "no bombs outside eyes or core", "no bombs outside eyes or the core", "no bombs outside eyes with core bombs", "bomb eyes and bomb core", "eyes and core are bombs"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        excludedKinds: [],
        requiredKindFeatures: expect.arrayContaining([
          { kind: "bomb", feature: "eyes" },
          { kind: "bomb", feature: "core" }
        ])
      });
    }
  });

  it("respects sentence boundaries and inline exception wording", () => {
    for (const prompt of ["make a smiley face with no bombs, except the eyes", "make a smiley face with no bombs; except the eyes", "make a smiley face that is bomb-free, except eyes"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        exclusiveKind: undefined,
        preferredKind: undefined,
        mentionedKinds: ["bomb"],
        excludedKinds: [],
        localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
      });
    }
    for (const prompt of ["no bombs. except the eyes", "no bombs. except bomb eyes", "no bombs. except exploding eyes", "no bombs. but bomb eyes", "no bombs! except eyes", "no bombs? except eyes", "no bombs\nexcept eyes", "bomb-free. except eyes", "bomb-free. except bomb eyes"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        excludedKinds: ["bomb"],
        requiredKindFeatures: [],
        localizedKindFeatures: []
      });
    }
    for (const prompt of ["bomb-free with bomb eyes", "free of bombs with bomb eyes", "bomb-free, with bomb eyes", "bomb-free; with bomb eyes", "no bombs, with bomb eyes", "no bombs; with bomb eyes", "bomb-free with bomb core", "free of bombs with bomb core", "bomb-free, with bomb core", "free of bombs; with bomb core"]) {
      expect(analyzeDesignerBrief(prompt), prompt).toMatchObject({
        mentionedKinds: expect.arrayContaining(["bomb"]),
        excludedKinds: [],
        localizedKindFeatures: expect.arrayContaining([expect.objectContaining({ kind: "bomb" })])
      });
    }
    expect(analyzeDesignerBrief("make a smiley face that is bomb-free except the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face that is bomb-free except on the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face that is bomb-free except inside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face that is bomb-free outside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face that is free of bombs outside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face that is free of bombs except in the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face that is free of bombs except inside the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face that is free of bombs apart from the eyes")).toMatchObject({
      exclusiveKind: undefined,
      preferredKind: undefined,
      mentionedKinds: ["bomb"],
      excludedKinds: [],
      localizedKindFeatures: expect.arrayContaining([{ kind: "bomb", feature: "eyes" }])
    });
    expect(analyzeDesignerBrief("make a smiley face with no bombs")).toMatchObject({ exclusiveKind: undefined, preferredKind: undefined, mentionedKinds: [] });
    expect(analyzeDesignerBrief("make a smiley face without explosive eyes")).toMatchObject({ exclusiveKind: undefined, preferredKind: undefined, mentionedKinds: [] });
  });

});
