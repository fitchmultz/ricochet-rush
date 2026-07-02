import { describe, expect, it } from "vitest";
import { withStaticServer } from "./helpers/apiServer";

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

  it("returns not found when a path descends through a file", async () => {
    await withStaticServer({ "index.html": "<html>ok</html>" }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/index.html/child`);
      expect(response.status).toBe(404);
    });
  });

  it("rejects encoded control-character paths before filesystem reads", async () => {
    await withStaticServer({ "index.html": "<html>ok</html>", "\u0080": "control" }, async (baseUrl) => {
      const nulResponse = await fetch(`${baseUrl}/%00`);
      expect(nulResponse.status).toBe(404);
      const c1Response = await fetch(`${baseUrl}/%C2%80`);
      expect(c1Response.status).toBe(404);
    });
  });
});
