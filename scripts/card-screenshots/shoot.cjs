// Screenshots each <name>.host.html in a directory at desktop and phone width.
// The window is sized to the card first: a full-page capture of a tall cross-origin frame repeats tiles.
//   node shoot.cjs <dir> [channel]
const { chromium } = require("playwright");
const { readdirSync } = require("node:fs");
const { join, resolve } = require("node:path");

const dir = resolve(process.argv[2]);
const channel = process.argv[3] || "chrome";
const SIZES = { desktop: 1280, phone: 390 };

(async () => {
  const browser = await chromium.launch(channel === "chromium" ? {} : { channel });
  try {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".host.html")).sort()) {
      const name = file.replace(/\.host\.html$/, "");
      for (const [label, width] of Object.entries(SIZES)) {
        const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
        await page.goto("file://" + join(dir, file));
        await page.waitForSelector("body[data-ready]", { timeout: 15000 });
        const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(300);
        const out = join(dir, `${name}-${label}.png`);
        await page.screenshot({ path: out });
        console.log(out);
        // An interactive card: press its button on desktop, print what the view asked the host, shoot the result.
        if (label === "desktop" && (await page.evaluate(() => document.body.dataset.interact)) === "send") {
          const view = page.frames().find((f) => f !== page.mainFrame());
          await view.locator("textarea").fill((await view.locator("textarea").inputValue()).replace("Friday 2026-10-31", "Friday 2026-10-31 (end of day)"));
          await view.locator("button.primary").click();
          await view.locator(".pill.done").waitFor({ timeout: 15000 });
          await page.waitForTimeout(400);
          const height = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
          await page.setViewportSize({ width, height });
          const after = join(dir, `${name}-approved-${label}.png`);
          await page.screenshot({ path: after });
          console.log(after);
          const log = await page.evaluate(() => window.__hostLog.filter((m) => m.method === "tools/call" || m.method === "ui/message").map((m) => m.method === "tools/call" ? `tools/call ${m.params.name} ${JSON.stringify(Object.keys(m.params.arguments))}` : `ui/message ${JSON.stringify(m.params.content[0].text.slice(0, 80))}`));
          console.log("  view → host: " + log.join(" | "));
        }
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
