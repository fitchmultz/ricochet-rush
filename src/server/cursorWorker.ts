import { Agent, type Run, type SDKMessage } from "@cursor/sdk";
import { CURSOR_MODEL, normalizeLevelRequest, type ComposerStreamStats } from "../shared/evolution.js";
import { buildPrompt } from "./cursorAgent.js";
import { parseLevelJsonFromCandidates } from "./levelJson.js";
import { appendAssistantTextChunk } from "./streamText.js";

const request = normalizeLevelRequest(JSON.parse(await readStdin()));
if (!request) {
  throw new Error("Invalid level request.");
}
const apiKey = process.env.CURSOR_API_KEY?.trim();
if (!apiKey) {
  throw new Error("CURSOR_API_KEY is required for Cursor SDK level generation.");
}

const agent = await Agent.create({
  apiKey,
  name: "Ricochet Rush Level Designer",
  model: CURSOR_MODEL,
  local: {
    cwd: process.cwd(),
    sandboxOptions: { enabled: true },
    settingSources: []
  }
});

let activeRun: Run | undefined;
let disposing = false;
const handleSigterm = () => {
  void shutdownFromSignal("SIGTERM");
};
const handleSigint = () => {
  void shutdownFromSignal("SIGINT");
};
process.once("SIGTERM", handleSigterm);
process.once("SIGINT", handleSigint);

const startAt = Date.now();
try {
  const run = await agent.send(buildPrompt(request), {
    model: CURSOR_MODEL,
    local: { force: true }
  });
  activeRun = run;
  if (!run.supports("wait")) {
    throw new Error(`Cursor SDK run cannot be awaited: ${run.unsupportedReason("wait") ?? "unsupported operation"}.`);
  }
  const streamedOutputPromise = collectAssistantTextSafely(run);
  const result = await run.wait();
  const streamedOutput = await streamedOutputPromise;
  if (result.status !== "finished") {
    throw new Error(`Cursor SDK run ended with status ${result.status}.`);
  }
  process.stdout.write(JSON.stringify(buildWorkerResponse(result.result, streamedOutput, Date.now() - startAt)));
} finally {
  process.off("SIGTERM", handleSigterm);
  process.off("SIGINT", handleSigint);
  if (!disposing) {
    disposing = true;
    await agent[Symbol.asyncDispose]();
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

interface StreamedAssistantText {
  combined: string;
  candidates: string[];
  stats: ComposerStreamStats;
  error?: string;
}

async function collectAssistantText(run: Run): Promise<StreamedAssistantText> {
  const stats = createStreamStats();
  if (!run.supports("stream")) return { combined: "", candidates: [], stats, error: run.unsupportedReason("stream") ?? "stream unsupported" };
  let combined = "";
  const candidates: string[] = [];
  for await (const message of run.stream()) {
    recordStreamStats(stats, message);
    const text = assistantMessageText(message).trim();
    if (!text) continue;
    candidates.push(text);
    combined = appendAssistantTextChunk(combined, text);
  }
  return { combined, candidates, stats };
}

async function collectAssistantTextSafely(run: Run): Promise<StreamedAssistantText> {
  try {
    return await collectAssistantText(run);
  } catch (error) {
    return {
      combined: "",
      candidates: [],
      stats: createStreamStats(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function assistantMessageText(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  return message.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

function buildWorkerResponse(resultText: string | undefined, streamedOutput: StreamedAssistantText, durationMs: number) {
  const candidates = [resultText, ...streamedOutput.candidates.slice().reverse(), streamedOutput.combined].map((candidate) => candidate?.trim() ?? "").filter(Boolean);
  const rawOutput = candidates.length > 0 ? candidates.join("\n\n--- candidate ---\n\n") : "";
  try {
    const parsed = parseLevelJsonFromCandidates(candidates);
    return {
      parsed: parsed.parsed,
      parseStatus: "success",
      rawOutput: parsed.rawText,
      durationMs,
      streamStats: streamedOutput.stats,
      streamError: streamedOutput.error
    };
  } catch (error) {
    return {
      parsed: null,
      parseStatus: "parse-failed",
      parseError: error instanceof Error ? error.message : String(error),
      rawOutput,
      durationMs,
      streamStats: streamedOutput.stats,
      streamError: streamedOutput.error
    };
  }
}

function createStreamStats(): ComposerStreamStats {
  return {
    requestEvents: 0,
    statusEvents: 0,
    thinkingEvents: 0,
    assistantEvents: 0,
    toolCallEvents: 0,
    taskEvents: 0,
    systemEvents: 0,
    userEvents: 0,
    otherEvents: 0,
    firstToolCalls: []
  };
}

function recordStreamStats(stats: ComposerStreamStats, message: SDKMessage): void {
  if (message.type === "request") stats.requestEvents += 1;
  else if (message.type === "status") stats.statusEvents += 1;
  else if (message.type === "thinking") stats.thinkingEvents += 1;
  else if (message.type === "assistant") stats.assistantEvents += 1;
  else if (message.type === "tool_call") {
    stats.toolCallEvents += 1;
    if (stats.firstToolCalls.length < 8) stats.firstToolCalls.push(message.name);
  } else if (message.type === "task") stats.taskEvents += 1;
  else if (message.type === "system") stats.systemEvents += 1;
  else if (message.type === "user") stats.userEvents += 1;
  else stats.otherEvents += 1;
}

async function shutdownFromSignal(signal: "SIGTERM" | "SIGINT"): Promise<void> {
  if (disposing) return;
  disposing = true;
  try {
    await activeRun?.cancel();
  } catch {
    // Best-effort cleanup before the parent escalates to SIGKILL.
  }
  try {
    await agent[Symbol.asyncDispose]();
  } catch {
    // The parent process will handle the timeout result.
  }
  process.exit(signal === "SIGTERM" ? 143 : 130);
}
