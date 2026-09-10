import raw from "../public/graduated.json";
import { graduatedFileSchema, type GraduatedFile } from "./graduated-schema";

/* public/graduated.json is generated at build time by
   scripts/generate-graduated.mjs (npm run prebuild runs it, the same way
   scripts/copy-number.mjs stages public/number.json) and is gitignored — see
   site/.gitignore. Running `npm test` regenerates it via the "pretest" hook
   so this import always resolves, whether the caller ran `npm run build`
   first or not.

   Validation runs at module load, exactly as lib/number.ts validates
   data/number.json: a malformed row list fails the build rather than
   reaching a reader. */

const parsed = graduatedFileSchema.safeParse(raw);

if (!parsed.success) {
  throw new Error(
    "LEDGE: site/public/graduated.json does not match the published schema.\n" +
      JSON.stringify(parsed.error.issues, null, 2),
  );
}

export const graduatedFile: GraduatedFile = parsed.data;

export type { GraduatedFile, GraduatedRow } from "./graduated-schema";
