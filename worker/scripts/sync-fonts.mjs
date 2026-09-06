#!/usr/bin/env node
/* The death card is set in the same two faces as the share card, and there is
   one copy of each in the repo: site/fonts. The bundler cannot reach outside
   the worker directory, so they are copied in here before a build or a test
   run and are not committed. */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "site", "fonts");
const to = join(here, "..", "fonts");

mkdirSync(to, { recursive: true });
for (const face of ["IBMPlexMono-Regular.ttf", "IBMPlexMono-SemiBold.ttf"]) {
  copyFileSync(join(from, face), join(to, face));
}
console.log("sync-fonts: 2 faces copied from site/fonts");
