import { defineConfig } from "vitest/config";

/* The pure half of the suite: text, lookups, the ladder, the response schema,
   the card's text tree, and the three lints. None of it touches D1, so none of
   it needs workerd, and the lints need node:fs to read the source they check. */
export default defineConfig({
  test: {
    include: ["tests/node/**/*.test.ts"],
    environment: "node",
  },
});
