// Screenshot a served page at phone/desktop, light/dark, with reduced motion.
// usage: node design/shot-built.mjs <url> <name-prefix>
import { chromium } from "/Users/mujeeb/ledge/site/e2e/node_modules/playwright/index.mjs";
const [url, name] = process.argv.slice(2);
const browser = await chromium.launch();
for (const [w, h, tag] of [[390, 2000, "mobile"], [1280, 1700, "desktop"]]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${name}-${scheme}-${tag}.png`, fullPage: false });
    await ctx.close();
  }
}
await browser.close();
