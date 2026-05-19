import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApiServer } from "../server/api";

async function withStaticServer(files: Record<string, string>, run: (baseUrl: string) => Promise<void>) {
  const staticDir = await mkdtemp(join(tmpdir(), "ricochet-static-"));
  for (const [name, contents] of Object.entries(files)) {
    const filePath = join(staticDir, name);
    await mkdir(join(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
  const server = createApiServer({ staticDir });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP port");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      });
    });
  }
}

describe("static file confinement", () => {
  it("serves files under the static root", async () => {
    await withStaticServer({ "index.html": "<html>ok</html>" }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("ok");
    });
  });

  it("serves nested asset paths", async () => {
    await withStaticServer({ "assets/powerups.png": "png-bytes" }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/assets/powerups.png`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("png-bytes");
    });
  });

  it("rejects path traversal outside the static root", async () => {
    await withStaticServer({ "index.html": "<html>ok</html>" }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/..%2F..%2Fetc%2Fpasswd`);
      expect(response.status).toBe(404);
    });
  });

  it("rejects requests that normalize outside the static root", async () => {
    await withStaticServer({ "index.html": "<html>ok</html>" }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/..%2F..%2F..%2Fetc%2Fpasswd`);
      expect(response.status).toBe(404);
    });
  });
});
