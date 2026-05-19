import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { requestEvolution } from "./cursorAgent.js";
import { normalizeLevelRequest } from "../shared/evolution.js";

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

type FallbackHandler = (request: IncomingMessage, response: ServerResponse, next?: (error?: unknown) => void) => void;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function createApiServer(options: { staticDir?: string; fallback?: FallbackHandler } = {}) {
  return createServer(async (request, response) => {
    const started = performance.now();
    const method = request.method ?? "GET";
    let pathname = "/";
    try {
      if (!request.url) {
        sendJson(response, 400, { error: "Missing URL" });
        return;
      }

      const url = new URL(request.url, "http://127.0.0.1");
      pathname = url.pathname;
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
            sendJson(response, 500, { error: "Fallback handler failed" });
            return;
          }
          sendJson(response, 404, { error: "Not found" });
        });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: "Internal server error" });
    } finally {
      if (process.env.NODE_ENV !== "production") {
        const elapsedMs = Math.round(performance.now() - started);
        const status = response.statusCode || 0;
        if (status >= 400 || elapsedMs > 750 || pathname.startsWith("/api/")) {
          console.info(`[ricochet-api] ${method} ${pathname} ${status} ${elapsedMs}ms`);
        }
      }
    }
  });
}

async function handleEvolution(request: IncomingMessage, response: ServerResponse) {
  const body = await readBody(request);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
  const levelRequest = normalizeLevelRequest(payload);
  if (!levelRequest) throw new HttpError(400, "Invalid level request.");
  const result = await requestEvolution(levelRequest);
  sendJson(response, 200, result);
}

async function serveStatic(staticDir: string, pathname: string, response: ServerResponse) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    throw new HttpError(404, "Not found");
  }
  const segments = decodedPath.split(/[/\\]/).filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new HttpError(404, "Not found");
  }
  const safePath = normalize(decodedPath)
    .replace(/^(\.\.(\/|\\|$))+/, "")
    .replace(/^[/\\]+/, "");
  const staticRoot = resolve(staticDir);
  const filePath = resolve(join(staticRoot, ...safePath.split(/[/\\]/).filter(Boolean)));
  const relativePath = relative(staticRoot, filePath);
  if (
    relativePath.startsWith("..") ||
    relativePath.includes(`..${sep}`) ||
    (filePath !== staticRoot && !filePath.startsWith(`${staticRoot}${sep}`))
  ) {
    throw new HttpError(404, "Not found");
  }
  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) throw new HttpError(404, "Not found");
    throw error;
  }
  response.writeHead(200, {
    "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream"
  });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodyBytes = 0;
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      bodyBytes += Buffer.byteLength(chunk, "utf8");
      if (bodyBytes > 32_000) {
        rejectOnce(new HttpError(413, "Request body too large."));
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(body);
    });
    request.on("error", rejectOnce);
  });
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
