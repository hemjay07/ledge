import { describe, expect, it } from "vitest";
import { graduatedFileSchema } from "../lib/graduated-schema";

/* A frozen, hand-built fixture — not public/graduated.json, which is
   regenerated from the live data files on every `npm test` run and would
   make an exact-shape assertion brittle. */
function validFile() {
  return {
    generatedAt: "2026-09-10T12:00:00.000Z",
    staleAfterSeconds: 7200,
    totalGraduationRows: 3,
    excludedNoLaunch: 1,
    excludedUnmatched: 0,
    rows: [
      {
        token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        durationSeconds: 8,
        graduatedAt: "2026-09-10T11:00:08.000Z",
        launchedAt: "2026-09-10T11:00:00.000Z",
        pairClass: "eth",
        creatorTaxBps: 100,
      },
      {
        token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        durationSeconds: 900,
        graduatedAt: "2026-09-10T11:15:00.000Z",
        launchedAt: "2026-09-10T11:00:00.000Z",
        pairClass: null,
        creatorTaxBps: null,
      },
    ],
  };
}

describe("graduatedFileSchema", () => {
  it("accepts a well-formed file", () => {
    const parsed = graduatedFileSchema.safeParse(validFile());
    expect(parsed.success).toBe(true);
  });

  it("rejects a token that is not a 20-byte address", () => {
    const file = validFile();
    file.rows[0]!.token = "not-an-address";
    expect(graduatedFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects a negative durationSeconds", () => {
    const file = validFile();
    file.rows[0]!.durationSeconds = -1;
    expect(graduatedFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects an unreadable timestamp", () => {
    const file = validFile();
    file.generatedAt = "not-a-date";
    expect(graduatedFileSchema.safeParse(file).success).toBe(false);
  });

  it("rejects a non-integer creatorTaxBps but allows null", () => {
    const withNull = validFile();
    expect(graduatedFileSchema.safeParse(withNull).success).toBe(true);

    const withFraction = validFile();
    withFraction.rows[0]!.creatorTaxBps = 1.5;
    expect(graduatedFileSchema.safeParse(withFraction).success).toBe(false);
  });

  it("requires the excluded counts and totalGraduationRows to be present, non-negative integers", () => {
    const file: Record<string, unknown> = validFile();
    delete file.excludedNoLaunch;
    expect(graduatedFileSchema.safeParse(file).success).toBe(false);
  });
});
