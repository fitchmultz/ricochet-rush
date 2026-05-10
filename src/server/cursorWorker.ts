import { Agent } from "@cursor/sdk";
import { CURSOR_MODEL, normalizeLevelRequest } from "../shared/evolution.js";
import { buildPrompt } from "./cursorAgent.js";

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
    settingSources: ["project", "user"]
  }
});

const startAt = Date.now();
try {
  const run = await agent.send(buildPrompt(request), {
    model: CURSOR_MODEL,
    local: { force: true }
  });
  const result = await run.wait();
  process.stdout.write(JSON.stringify({ parsed: parseJson(result.result), rawOutput: result.result, durationMs: Date.now() - startAt }));
} finally {
  agent.close();
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

function parseJson(text: string | undefined): unknown {
  if (!text) return {};
  const trimmed = text.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return {};
  return JSON.parse(trimmed.slice(first, last + 1));
}
