import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { requestEvolution } from "./cursorAgent.js";
import type { LevelRequest } from "../shared/evolution.js";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

type FallbackHandler = (request: IncomingMessage, response: ServerResponse, next?: (error?: unknown) => void) => void;

export function createApiServer(options: { staticDir?: string; fallback?: FallbackHandler } = {}) {
  return createServer(async (request, response) => {
    try {
      if (!request.url) {
        sendJson(response, 400, { error: "Missing URL" });
        return;
      }

      const url = new URL(request.url, "http://127.0.0.1");
      if ((url.pathname === "/api/evolve" || url.pathname === "/api/level") && request.method === "POST") {
        await handleEvolution(request, response);
        return;
      }

      if (options.staticDir) {
        await serveStatic(options.staticDir, url.pathname, response);
        return;
      }

      if (options.fallback) {
        options.fallback(request, response, (error?: unknown) => {
          if (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : "Fallback handler failed" });
            return;
          }
          sendJson(response, 404, { error: "Not found" });
        });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown server error"
      });
    }
  });
}

async function handleEvolution(request: IncomingMessage, response: ServerResponse) {
  const body = await readBody(request);
  const levelRequest = JSON.parse(body) as LevelRequest;
  const result = await requestEvolution(levelRequest);
  sendJson(response, 200, result);
}

async function serveStatic(staticDir: string, pathname: string, response: ServerResponse) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(staticDir, safePath);
  const body = await readFile(filePath);
  response.writeHead(200, {
    "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream"
  });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 32_000) {
        request.destroy(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
