/* Which figure leads the fold.

   "raw"           — the Pons Number posters; the excluding-fast figure is the
                     second block.
   "excludingFast" — the excluding-fast figure posters, set as "1 in N" with
                     its percentage beside it; the raw rate is the second
                     block, glossed "counting every graduation".

   Both figures are always rendered, over the same n, the same window and the
   same measurement, with their own fine print. This constant chooses which
   one is the poster — nothing else.

   FLIPPING THIS IS A DEFINITION CHANGE. CONSTRAINTS.md §9: a change to which
   figure the page leads with is a change to what the headline number means,
   so it takes a dated entry in METHOD.md's "Changelog of definitions" in the
   same commit. Never flip it quietly.

   This module is plain JavaScript on purpose, exactly as lib/format-core.mjs
   is: it is read by the site (through lib/lead.ts) and by scripts/og.mjs,
   which runs on bare node before the build. One constant, so the sheet and
   the share card cannot lead with different figures. */

export const LEAD = "excludingFast";
