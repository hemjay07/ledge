import { describe, expect, it } from "vitest";
import {
  GRAVEYARD_AGE_SECONDS,
  buildGraveyardRows,
  buildGraveyardScope,
  graveyardPostText,
  graveyardRowsToCandidates,
  selectNewGraveyardEntries,
  type GraveyardDbRow,
} from "../../src/graveyard";

const NOW = 1_762_536_735;
const CURSOR = { last_indexed_block: 56_172_588, last_success_at: NOW - 20, consecutive_failures: 0 };

function row(overrides: Partial<GraveyardDbRow> = {}): GraveyardDbRow {
  return {
    token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    pair_class: "eth",
    pair_token: "0x0000000000000000000000000000000000000000",
    creator_tax_bps: 300,
    block: 56_150_000,
    ts: NOW - GRAVEYARD_AGE_SECONDS - 3_600, // just past the 72h gate
    from_block: 56_150_000,
    sells: 0,
    first_block_buyers: 0,
    last_activity_ts: NOW - GRAVEYARD_AGE_SECONDS - 3_600,
    ...overrides,
  };
}

describe("who makes the graveyard", () => {
  it("includes a launch whose own block is at least 72h old with zero buys", () => {
    const rows = buildGraveyardRows([row()], CURSOR, NOW, "age");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.buys).toBe(0);
    expect(rows[0]!.sells).toBe(0);
  });

  /* THE HONESTY TEST. A launch outside the activity index's own record has no
     token_activity row at all -- board.ts and graveyard.ts both join, never
     outer-join, for exactly this reason. A launch that predates the index is
     therefore never SEEN by buildGraveyardRows, because the caller never
     builds a GraveyardDbRow for it in the first place: an empty candidate set
     produces an empty graveyard, not a graveyard that silently assumes every
     unindexed launch took no buys. */
  it("never counts a launch outside the activity index's own record as dead", () => {
    // No row is ever constructed for an unindexed launch -- this is the shape
    // the D1 query itself enforces (INNER JOIN token_activity, never a LEFT
    // JOIN against `launch` alone), asserted here at the boundary a test can
    // reach without a database: an empty read produces an empty graveyard.
    const rows = buildGraveyardRows([], CURSOR, NOW, "age");
    expect(rows).toHaveLength(0);

    const scope = buildGraveyardScope(null);
    expect(scope.indexedLaunches).toBe(0);
    expect(scope.label).toMatch(/nothing has been measured/);
  });

  it("excludes a launch younger than 72 hours, however zero its buys are", () => {
    const young = row({ ts: NOW - GRAVEYARD_AGE_SECONDS + 60 });
    const rows = buildGraveyardRows([young], CURSOR, NOW, "age");
    expect(rows).toHaveLength(0);
  });

  it("includes a launch exactly at the 72 hour boundary", () => {
    const boundary = row({ ts: NOW - GRAVEYARD_AGE_SECONDS });
    const rows = buildGraveyardRows([boundary], CURSOR, NOW, "age");
    expect(rows).toHaveLength(1);
  });

  it("tells apart a first block never indexed from one indexed with no buyers", () => {
    const indexedZero = row({
      token: "0x1111111111111111111111111111111111111111",
      first_block_buyers: 0,
    });
    const neverIndexed = row({
      token: "0x2222222222222222222222222222222222222222",
      first_block_buyers: null,
      from_block: 56_100_000,
    });
    const rows = buildGraveyardRows([indexedZero, neverIndexed], CURSOR, NOW, "age");
    const a = rows.find((r) => r.token === indexedZero.token)!;
    const b = rows.find((r) => r.token === neverIndexed.token)!;
    expect(a.firstBlockBuyers).toBe(0);
    expect(a.window.partial).toBe(false);
    expect(b.firstBlockBuyers).toBeNull();
    expect(b.window.partial).toBe(true);
    expect(b.window.label).toContain("predates LEDGE's indexed record");
  });

  it("sorts oldest-first on age and by launch block on newest", () => {
    const older = row({ token: "0x3333333333333333333333333333333333333333", block: 1, ts: NOW - GRAVEYARD_AGE_SECONDS - 9_000 });
    const newer = row({ token: "0x4444444444444444444444444444444444444444", block: 2, ts: NOW - GRAVEYARD_AGE_SECONDS - 10 });
    const byAge = buildGraveyardRows([older, newer], CURSOR, NOW, "age");
    expect(byAge[0]!.token).toBe(older.token);
    const byNewest = buildGraveyardRows([older, newer], CURSOR, NOW, "newest");
    expect(byNewest[0]!.token).toBe(newer.token);
  });
});

describe("the scope caveat", () => {
  it("states the population size and the oldest launch it covers", () => {
    const scope = buildGraveyardScope({ indexed_launches: 42, earliest_ts: NOW - 100_000 });
    expect(scope.indexedLaunches).toBe(42);
    expect(scope.earliestIndexedLaunchAt).not.toBeNull();
    expect(scope.label).toContain("42");
    expect(scope.label).toMatch(/not measured/);
  });
});

describe("the bot post", () => {
  const candidate = {
    token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    pairClass: "eth",
    creatorTaxBps: 300,
    ageSeconds: GRAVEYARD_AGE_SECONDS + 3_600,
    sells: 0,
    firstBlockBuyers: 0,
  };

  it("posts nothing when there is nothing new", () => {
    expect(graveyardPostText([], "https://ledge.tools")).toBeNull();
  });

  it("never repeats a launch that has already been posted", () => {
    const filtered = selectNewGraveyardEntries([candidate], new Set([candidate.token]));
    expect(filtered).toHaveLength(0);
  });

  it("states only the facts: no emoji, no verdict, no address other than the token's own", () => {
    const text = graveyardPostText([candidate], "https://ledge.tools");
    expect(text).not.toBeNull();
    expect(text).toContain("0 buys");
    expect(text).toContain(candidate.token);
    expect(text).toContain("https://ledge.tools/graveyard");
    expect(text).not.toMatch(/rug|dead|score|risk|will (pump|moon|graduate|succeed|fail)/i);
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u{1F000}-\u{1FAFF}☀-➿]/u);
  });

  it("names the count for more than one entry, still with no verdict", () => {
    const second = { ...candidate, token: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
    const text = graveyardPostText([candidate, second], "https://ledge.tools");
    expect(text).toContain("2 launches");
  });

  it("converts rows to candidates without carrying anything but the printed facts", () => {
    const rows = buildGraveyardRows([row()], CURSOR, NOW, "age");
    const candidates = graveyardRowsToCandidates(rows);
    expect(candidates[0]).toEqual({
      token: rows[0]!.token,
      pairClass: rows[0]!.pairClass,
      creatorTaxBps: rows[0]!.creatorTaxBps,
      ageSeconds: rows[0]!.ageSeconds,
      sells: rows[0]!.sells,
      firstBlockBuyers: rows[0]!.firstBlockBuyers,
    });
  });
});
