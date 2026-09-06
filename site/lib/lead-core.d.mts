/* Types for lib/lead-core.mjs. The module itself is plain JavaScript so that
   scripts/og.mjs can import it on bare node; this declaration is how the
   site's TypeScript sees it. It is deliberately typed as the union rather
   than as the current literal, so both branches of every `LEAD === …` are
   type-checked whichever value is set. */

export type Lead = "raw" | "excludingFast";

export const LEAD: Lead;
