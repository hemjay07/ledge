import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

/* The half of the suite that needs a real D1 and the real router: the minute
   tick, and the API responses end to end. Bindings and vars come from
   wrangler.toml, so the tests run against the configuration that ships. */
export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    include: ["tests/workers/**/*.test.ts"],
  },
});
