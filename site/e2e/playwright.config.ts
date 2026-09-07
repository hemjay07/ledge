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
    /* Python's stdlib server: serves `dir/index.html` for `/dir/` and 301s
       `/dir` to `/dir/`, exactly what a `trailingSlash` export needs and what
       Vercel does. `serve` was used before and its directory handling
       changed between versions. */
    command: "python3 -m http.server 4173 --directory ../out --bind 127.0.0.1",
    url: "http://127.0.0.1:4173/number.json",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
