import { once } from "node:events";
import { mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createApiServer } from "../server/api";

process.env.RICOCHET_RUSH_FORCE_FALLBACK = "1";

const outputPath = resolve("docs/media/ricochet-rush-demo.webm");
const videoDir = resolve("docs/media/.capture-tmp");

await mkdir(videoDir, { recursive: true });

const server = createApiServer({ staticDir: resolve("dist") });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Preview server did not expose a TCP port.");

const baseUrl = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 820 } }
  });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready");
  await page.locator("[data-overlay-action]").click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "playing");
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(900);
  await page.locator('[data-tool-panel="designer"]').click();
  await page.waitForTimeout(450);
  await page.selectOption('[data-designer="style"]', "bomb-chains");
  await page.locator('[data-designer="seed"]').fill("demo sparks");
  await page.locator('[data-action="new-board"]').click();
  await page.waitForFunction(() => window.__ricochetRushGame?.debugSnapshot().phase === "ready" && window.__ricochetRushGame?.debugSnapshot().boardSource === "generated");
  await page.waitForTimeout(1200);

  const video = page.video();
  await context.close();
  if (!video) throw new Error("Playwright did not create a video artifact.");
  await rename(await video.path(), outputPath);
  console.log(`Saved demo clip to ${outputPath}`);
} finally {
  await browser.close();
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}
