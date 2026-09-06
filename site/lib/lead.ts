/* The site's view of the fold's lead figure.

   The value itself lives in ./lead-core.mjs, which is plain JavaScript so
   scripts/og.mjs can import the same constant on bare node. Set it there;
   this file only re-exports it, the way lib/format.ts re-exports the
   formatting rules.

   Flipping it requires a dated entry in METHOD.md's "Changelog of
   definitions" — CONSTRAINTS.md §9, never move a definition quietly. */

export * from "./lead-core.mjs";
