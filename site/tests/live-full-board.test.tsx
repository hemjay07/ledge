import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { LiveBoardFull } from "../components/Live";
import Live from "../app/live/page";
import { fillPercent, formatBigDecimal, pairQuantity } from "../lib/format";
import live from "./api-fixtures/live-ok.json";

/* Every expectation below is derived from the frozen fixture through the same
   functions the component renders with — never a hand-typed percentage or
   wei figure — so a re-recording of live-ok.json moves the assertions with
   it, the way tests/fixtures.ts already does for data/number.json. */

function answerWith(payload: unknown) {
  const impl = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("the live board's own row model", () => {
  it("renders one row per token, with the token itself printed (CONSTRAINTS 2 permits it)", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(live.rows.length));
    for (const row of live.rows) {
      expect(container.textContent ?? "").toContain(row.token);
    }
  });

  it("shows the sample the pair, tax, buys, sells, age and state of every row", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    const text = container.textContent ?? "";
    expect(text).toContain("300 bps");
    expect(text).toContain("not read"); // row d, creatorTaxBps: null
    expect(text).toContain("graduated");
    expect(text).toContain("on the curve");
  });

  it("tells apart a first block never indexed from one indexed with no buyers", async () => {
    answerWith({
      ...live,
      rows: [
        { ...live.rows[0], token: "0x1111111111111111111111111111111111111111", firstBlockBuyers: 0 },
        { ...live.rows[3], token: "0x2222222222222222222222222222222222222222" },
      ],
      count: 2,
    });
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[0]?.textContent).toContain("0");
    expect(rows[1]?.textContent).toContain("not indexed");
  });

  it("renders the fill rule against each launch's OWN threshold, both figures beside it, never a lone percentage", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));

    /* Both figures appear, in the pair token's OWN units where the units are
       known and as raw base units where they are not. This asserted the raw
       integers until the board learned to scale by each pair's decimals; the
       raw form is still what a pair with unknown decimals renders, so both
       shapes are accepted here rather than only one. A lone percentage is
       still forbidden, and that is asserted below. */
    const withFill = live.rows.filter((r) => r.fill !== null);
    for (const row of withFill) {
      const net = pairQuantity(row.netQuoteWei, row.pairDecimals, null).text;
      const threshold = pairQuantity(
        row.fill!.graduationThresholdWei,
        row.pairDecimals,
        row.pairSymbol,
      ).text;
      expect(container.textContent).toContain(net);
      expect(container.textContent).toContain(threshold);
    }

    /* The threshold is per pair token and 4.2 ETH is never assumed for one
       that does not use it. Scoped to the stablecoin row's own cells, because
       the ETH rows on this same board legitimately DO read 4.2 ETH -- that is
       their own threshold, read from their own launch. */
    const stableIndex = live.rows.findIndex((r) => r.pairClass === "stable");
    const stableRow = live.rows[stableIndex]!;
    expect(stableRow.fill!.graduationThresholdWei).toBe("8090000000");
    const stableCells = container.querySelectorAll("tbody tr")[stableIndex]!.textContent ?? "";
    expect(stableCells).toContain(formatBigDecimal("8090000000"));
    expect(stableCells).not.toContain("4.2");

    // the fill's own label, verbatim, not paraphrased
    expect(container.textContent).toContain(withFill[0]!.fill!.label);
  });

  it("renders no rule at all for a row with no threshold, rather than an empty or guessed one", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    const rows = [...container.querySelectorAll("tbody tr")];
    const noFillRow = rows.find((r) => r.textContent?.includes("no threshold indexed"));
    expect(noFillRow).toBeTruthy();
    expect(noFillRow?.querySelector(".fill-bar")).toBeNull();
  });

  it("computes the shown percentage the same way fillPercent does, and clamps the bar", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    const row = live.rows[0]!;
    const pct = fillPercent(row.netQuoteWei, row.fill!.graduationThresholdWei);
    expect(pct).not.toBeNull();
    expect(container.textContent).toContain(`${(pct as number).toFixed(1)}%`);
  });

  it("marks a row whose window is partial, visibly, in words", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    const partialRow = live.rows.find((r) => r.window.partial)!;
    expect(container.textContent).toContain(partialRow.window.label);
    const marked = [...container.querySelectorAll(".is-partial")];
    expect(marked.length).toBeGreaterThan(0);
    // a non-partial row's own window carries no "partial" marker
    const nonPartialRow = [...container.querySelectorAll("tbody tr")].find(
      (r) => !r.textContent?.includes("partial"),
    );
    expect(nonPartialRow).toBeTruthy();
  });

  it("names the ranked column for every sort key, so a ranking is always of a shown fact", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    const nav = container.querySelector('nav[aria-label="Sort the live board"]');
    expect(nav).not.toBeNull();
    const options = [...(nav?.querySelectorAll("a, span") ?? [])].map((el) => el.textContent);
    expect(options).toEqual([
      "Most buys",
      "Most recent activity",
      "Oldest launch first",
      "Highest net quote",
      "Newest launch",
    ]);
    // one option stands as the current, un-linked, sort
    expect(nav?.querySelector('[aria-current="true"]')).not.toBeNull();
  });

  it("prints no per-token score, grade or verdict word anywhere on the board", async () => {
    answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
    const lower = (container.textContent ?? "").toLowerCase();
    for (const banned of ["score", "grade", "rating", "safe", "rug", "likely", "trending"]) {
      expect(lower.includes(banned), `"${banned}" is on the live board`).toBe(false);
    }
  });

  it("re-fetches with the chosen sort key when a sort control is used", async () => {
    const fetchMock = answerWith(live);
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));

    const buysLink = [...container.querySelectorAll('nav[aria-label="Sort the live board"] a')].find(
      (a) => a.textContent === "Most buys",
    ) as HTMLAnchorElement;
    expect(buysLink).toBeTruthy();
    fireEvent.click(buysLink);

    await waitFor(() => {
      const lastCall = fetchMock.mock.calls.at(-1)?.[0] as string;
      expect(lastCall).toContain("sort=buys");
    });
  });

  it("says the board did not answer rather than showing an empty table as though it had", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.textContent).toContain("did not answer"));
  });

  it("carries the API's own words for bad_sort rather than a generic error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            error: "bad_sort",
            message: "unrecognised sort key",
          }),
          { status: 400 },
        ),
      ),
    );
    const { container } = render(<LiveBoardFull />);
    await waitFor(() => expect(container.textContent).toContain("unrecognised sort key"));
  });
});

describe("the /live page", () => {
  it("carries the sheet index and links back nowhere it shouldn't", async () => {
    answerWith(live);
    const { container } = render(<Live />);
    const nav = container.querySelector('nav[aria-label="Sheet"]');
    const hrefs = [...(nav?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("/live");
    expect(hrefs).toContain("/");
    expect(hrefs).toContain("/number");
  });

  it("renders the board", async () => {
    answerWith(live);
    const { container } = render(<Live />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(4));
  });
});
