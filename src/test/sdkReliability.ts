import { blueprintFingerprint } from "../shared/boardPacks";
import { DEFAULT_DESIGNER_INTENT, nextDesignerSeed, type BoardDesignerIntent, type LevelRequest } from "../shared/evolution";
import { requestEvolution } from "../server/cursorAgent";

const cursorApiKey = process.env.CURSOR_API_KEY?.trim();
if (!cursorApiKey) {
  console.log("sdk:reliability skipped: CURSOR_API_KEY is not set.");
  process.exit(0);
}
process.env.CURSOR_API_KEY = cursorApiKey;
delete process.env.RICOCHET_RUSH_FORCE_FALLBACK;

const runCount = Number(process.env.SDK_RELIABILITY_RUNS ?? 5);
const maxRuns = Number.isFinite(runCount) && runCount > 0 ? Math.min(Math.floor(runCount), 10) : 5;

let designer: BoardDesignerIntent = { ...DEFAULT_DESIGNER_INTENT, style: "open-lanes", difficulty: 2, density: 0.45, specialBias: 0.32, seed: "reliability", brief: "symmetric arcade wall with open bank lanes" };
let request: LevelRequest = {
  level: 1,
  score: 0,
  lives: 3,
  clearedLevels: 0,
  recentEvents: ["Reliability batch."],
  designer
};

const names = new Set<string>();
const layouts = new Set<string>();
let fallbackCount = 0;

for (let run = 1; run <= maxRuns; run += 1) {
  const result = await requestEvolution(request);
  const fingerprint = blueprintFingerprint(result.level);
  names.add(result.level.name);
  layouts.add(fingerprint);

  if (result.source !== "cursor-sdk") {
    fallbackCount += 1;
    console.error(`run ${run}/${maxRuns} FALLBACK: ${result.warning ?? "unknown warning"}`);
    process.exit(1);
  }

  console.log(`run ${run}/${maxRuns} ok: ${result.level.name} · ${result.trace?.durationMs ?? 0}ms`);
  request = {
    ...request,
    level: request.level + 1,
    score: request.score + 1_500,
    clearedLevels: request.clearedLevels + 1,
    recentEvents: [`Cleared ${result.level.name}.`, "Designing the next wall."],
    designer: {
      ...designer,
      seed: nextDesignerSeed(designer.seed, request, run + 1)
    }
  };
  designer = request.designer!;
}

console.log(`sdk:reliability passed: ${maxRuns}/${maxRuns} cursor-sdk boards, ${names.size} unique names, ${layouts.size} unique layouts.`);
