import {
  BUILT_IN_PACKS,
  DAILY_PACK_ID,
  SAVED_DESIGNS_PACK_ID,
  boardCountForPack,
  getBuiltInPack,
  getNextBuiltInPack,
  localDateKey,
  materializeDailyBoard,
  previewRowsFromLevel,
  type DailyProgressState,
  type PackProgressState,
  type SavedBoardEntry
} from "../../shared/boardPacks";
import { clamp } from "../../shared/util";
import type { HudPackItem } from "../ui/hud";
import type { BoardContext, RunStats, SummaryStat } from "./gameEntityTypes";
import { formatRunDuration, savedBoardPackId } from "./gameRuntimeHelpers";

export function packNameFor(packId: string): string {
  if (packId === DAILY_PACK_ID) return "Today's Board";
  if (packId === SAVED_DESIGNS_PACK_ID) return "Saved Designs";
  return getBuiltInPack(packId)?.name ?? "Board Pack";
}

export function nextLevelCompleteStep(
  context: BoardContext,
  level: number,
  packProgress: PackProgressState,
  savedBoardCount: number
): { body: string; actionLabel: string; status: string } {
  if (context.source === "pack") {
    const total = boardCountForPack(context.packId, savedBoardCount);
    if (context.boardIndex + 1 < total) {
      return {
        body: `Continue to board ${context.boardIndex + 2} in ${packNameFor(context.packId)}.`,
        actionLabel: "Next Board",
        status: "Level cleared. Next pack board is ready."
      };
    }
    const nextPack = getNextBuiltInPack(context.packId);
    if (nextPack && packProgress[nextPack.id]?.unlocked) {
      return {
        body: `${packNameFor(context.packId)} complete. Continue into ${nextPack.name}.`,
        actionLabel: "Next Pack",
        status: `${nextPack.name} unlocked.`
      };
    }
    return {
      body: `${packNameFor(context.packId)} complete. Continue to a generated board.`,
      actionLabel: "Generate Board",
      status: `${packNameFor(context.packId)} complete.`
    };
  }
  return {
    body: `The board is frozen. Continue when you want the Board Designer to generate Level ${level + 1}.`,
    actionLabel: "Continue",
    status: "Level cleared. Continue when ready."
  };
}

export interface PackHudSnapshot {
  boardContext: BoardContext;
  dailyProgress: DailyProgressState;
  packProgress: PackProgressState;
  savedBoards: SavedBoardEntry[];
}

export function collectPackItems(snapshot: PackHudSnapshot): HudPackItem[] {
  const { boardContext, dailyProgress, packProgress, savedBoards } = snapshot;
  const todayKey = localDateKey();
  const dailyLevel = materializeDailyBoard(todayKey);
  const todayProgress = dailyProgress[todayKey] ?? { bestScore: 0, completed: false };
  const dailyItem: HudPackItem = {
    id: DAILY_PACK_ID,
    name: "Today's Board",
    description: `Local-only daily challenge for ${todayKey}. Same date, same app version, same board; no remote service needed.`,
    progressLabel: todayProgress.completed ? "completed today" : "open today",
    bestScore: todayProgress.bestScore,
    unlocked: true,
    active: boardContext.source === "pack" && boardContext.packId === DAILY_PACK_ID,
    empty: false,
    previewRows: previewRowsFromLevel(dailyLevel),
    kind: "pack",
    actionLabel: "Play daily"
  };
  const builtInItems = BUILT_IN_PACKS.map((pack) => {
    const progress = packProgress[pack.id] ?? { cleared: 0, bestScore: 0, unlocked: pack.id === "starter" };
    const previewIndex = progress.cleared >= pack.boards.length ? 0 : clamp(progress.cleared, 0, pack.boards.length - 1);
    return {
      id: pack.id,
      name: pack.name,
      description: pack.description,
      progressLabel: progress.unlocked ? `${progress.cleared}/${pack.boards.length} cleared` : "locked",
      bestScore: progress.bestScore,
      unlocked: progress.unlocked,
      active: boardContext.source === "pack" && boardContext.packId === pack.id,
      empty: false,
      previewRows: [...pack.boards[previewIndex].pattern],
      kind: "pack" as const
    };
  });
  const savedProgress = packProgress[SAVED_DESIGNS_PACK_ID] ?? { cleared: 0, bestScore: 0, unlocked: savedBoards.length > 0 };
  const savedPreview = savedBoards[0] ? previewRowsFromLevel(savedBoards[0].levelBlueprint) : [];
  const savedCollection: HudPackItem = {
    id: SAVED_DESIGNS_PACK_ID,
    name: "Saved Designs Gallery",
    description: "Replay boards you kept from the Designer. New saves appear as cards below.",
    progressLabel: savedBoards.length > 0 ? `${savedProgress.cleared}/${savedBoards.length} cleared` : "empty",
    bestScore: savedProgress.bestScore,
    unlocked: savedBoards.length > 0,
    active: boardContext.source === "pack" && boardContext.packId === SAVED_DESIGNS_PACK_ID,
    empty: savedBoards.length === 0,
    previewRows: savedPreview,
    kind: "pack",
    actionLabel: "Browse"
  };
  const savedItems: HudPackItem[] = savedBoards.map((board, index) => ({
    id: savedBoardPackId(index),
    name: board.levelName,
    description: "Saved generated board. Replay this layout, remix from its prompt, or discard later by keeping stronger designs.",
    progressLabel: "saved design",
    bestScore: board.bestScore,
    unlocked: true,
    active: boardContext.source === "pack" && boardContext.packId === SAVED_DESIGNS_PACK_ID && boardContext.boardIndex === index,
    empty: false,
    previewRows: previewRowsFromLevel(board.levelBlueprint),
    kind: "saved-board",
    sourcePrompt: board.sourcePrompt,
    createdAt: board.createdAt,
    actionLabel: "Replay saved board"
  }));
  return [dailyItem, ...builtInItems, savedCollection, ...savedItems];
}

export function buildRunSummaryStats(
  mode: "clear" | "gameOver" | "debug",
  score: number,
  bestScore: number,
  runStats: RunStats
): SummaryStat[] {
  const bestDelta = Math.max(0, bestScore - runStats.bestScoreAtRunStart);
  const now = Date.now();
  const elapsed = mode === "clear" ? now - runStats.levelStartedAt : now - runStats.runStartedAt;
  return [
    { label: "Score", value: score.toLocaleString(), tone: "reward" },
    { label: "Best Delta", value: bestDelta > 0 ? `+${bestDelta.toLocaleString()}` : "Even", tone: bestDelta > 0 ? "reward" : "neutral" },
    { label: "Bricks Broken", value: runStats.bricksBroken.toLocaleString(), tone: "neutral" },
    { label: "Longest Streak", value: `x${runStats.longestCombo.toFixed(1)}`, tone: runStats.longestCombo >= 2 ? "reward" : "neutral" },
    { label: "Power-Ups Caught", value: runStats.powerupsCaught.toLocaleString(), tone: "neutral" },
    { label: "Boards Cleared", value: runStats.boardsCleared.toLocaleString(), tone: runStats.boardsCleared > 0 ? "reward" : "neutral" },
    { label: mode === "clear" ? "Clear Time" : "Survival Time", value: formatRunDuration(elapsed), tone: "neutral" }
  ];
}
