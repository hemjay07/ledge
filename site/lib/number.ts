import raw from "../../data/number.json";
import { numberSchema, type NumberFile, type WindowData } from "./schema";

/* The only place the site touches the raw file. Validation runs at module load,
   so a malformed measurement fails the build rather than reaching a reader. */

const parsed = numberSchema.safeParse(raw);

if (!parsed.success) {
  throw new Error(
    "LEDGE: data/number.json does not match the published schema.\n" +
      JSON.stringify(parsed.error.issues, null, 2),
  );
}

export const numberFile: NumberFile = parsed.data;

export const h24: WindowData = numberFile.h24;
export const allTime: WindowData = numberFile.allTime;

export const SITE_URL = "https://ledge.tools";
export const REPO_URL = "https://github.com/hemjay07/ledge";

export type { NumberFile, WindowData };
export type { CohortRow, HistogramRow } from "./schema";
