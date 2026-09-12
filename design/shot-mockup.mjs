// Screenshot a standalone HTML mockup at phone and desktop widths, both themes.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
const run = promisify(execFile);
const CHROME = process.env.LEDGE_CHROME ?? "/Users/mujeeb/.cache/puppeteer/chrome-headless-shell/mac_arm-145.0.7632.77/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const file = process.argv[2];
const name = file.replace(/\.html$/, "");
for (const [w, h, tag] of [[390, 1600, "mobile"], [1280, 1400, "desktop"]]) {
  for (const theme of ["light", "dark"]) {
    // force the theme by injecting a color-scheme override via a wrapper page
    const html = readFileSync(file, "utf8");
    const forced = html.replace("<head>", `<head><style>:root{color-scheme:${theme}}</style>`);
    const tmp = `/tmp/mock-${theme}.html`;
    writeFileSync(tmp, forced);
    const out = `${name}-${theme}-${tag}.png`;
    await run(CHROME, ["--headless", "--disable-gpu", `--window-size=${w},${h}`, "--hide-scrollbars",
      `--force-dark-mode=${theme === "dark"}`, "--virtual-time-budget=3000", `--screenshot=${out}`, `file://${tmp}`]);
    console.log("shot:", out);
  }
}
