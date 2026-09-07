import { defineConfig, devices } from "@playwright/test";

/* Gate 8, ARCHITECTURE-PHASE2-4.md section 9.

   These run against the STATIC EXPORT in site/out, served the way Vercel
   serves it — not against a dev server. What is checked here is what ships:
   the recompute gate proves the numbers are right, and this proves the
   built page carries them, in one <h1>, with every figure's denominator
   reachable by a screen reader.

   `serve` is intentionally run WITHOUT -s: single-page rewriting would make
   /cohorts return the landing page's HTML and every route would pass. */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    /* `serve --config` resolves its path against the SERVED directory, so the
       config is passed absolute. It is needed because the export writes both
       `method.html` and a `method/` directory of RSC payloads, and a static
       file server picks the directory, finds no index.html in it, and 404s
       the real URL. Vercel routes this correctly; `serve` needs telling. */
    command:
      "npx --yes serve ../out --config \"$PWD/serve.json\" --listen 4173 --no-clipboard",
    url: "http://127.0.0.1:4173/number.json",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
