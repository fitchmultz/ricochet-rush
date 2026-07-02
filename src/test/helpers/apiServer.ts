import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiServer } from "../../server/api";

export async function withApiServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = createApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("API test server did not expose a TCP port.");
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      });
    });
  }
}

export async function withStaticServer(files: Record<string, string>, run: (baseUrl: string) => Promise<void>): Promise<void> {
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
