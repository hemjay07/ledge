import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { GraveyardBoard } from "../components/Graveyard";
import Graveyard from "../app/graveyard/page";
import graveyard from "./api-fixtures/graveyard-ok.json";

/* 2026-09-12 (REVAMP.md "the amendment", boards rebuilt page by page): the
   job of this board is "the 93.5% made concrete" -- the count leads, large,
   as its own figure, and the row list beneath it is deliberately quieter:
   six columns (Token, Pair, Creator tax, Age, Sells, First-block buyers),
   the "Buys" column dropped because it is always zero by definition and adds
   no information, "Launch block" and "Counted from" dropped in favour of a
   shortened, linked address with a `partial` state-tag carrying the same
   window label in its own `title`. Assertions describing the old eight-wide
   table with a full address printed in the first cell are rewritten below;
   assertions guarding a CONSTRAINT (the denominator, the partial marker, no
   verdict, no wallet) are carried forward. */

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

describe("the graveyard's own row model", () => {
  it("renders one row per token, shortened, with the full address as the link target and title", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(graveyard.rows.length));
    for (const row of graveyard.rows) {
      const link = container.querySelector(`tbody a[href="/t/${row.token}"]`);
      expect(link).not.toBeNull();
      expect(link?.textContent).toBe(`${row.token.slice(0, 10)}…${row.token.slice(-6)}`);
      expect(link?.getAttribute("title")).toBe(row.token);
    }
  });

  it("prints six column heads: no Buys column, since every row is zero by definition", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));
    const heads = [...container.querySelectorAll(".graveyard-table-wrap thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["Token", "Pair", "Creator tax", "Age", "Sells", "First-block buyers"]);
  });

  it("tells apart a first block never indexed from one indexed with no buyers", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));
    const rows = [...container.querySelectorAll("tbody tr")];
    // row 0: firstBlockBuyers 0 -- indexed, nobody bought
    expect(rows[0]?.textContent).toContain("0");
    // row 1: firstBlockBuyers null -- never indexed
    expect(rows[1]?.textContent).toContain("not read"); // 2026-09-12: a state says what it means
  });

  it("marks a partial row's address with a `partial` tag carrying its own window label, and leaves a non-partial row untagged", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));

    const partialRow = graveyard.rows.find((r) => r.window.partial)!;
    const nonPartialRow = graveyard.rows.find((r) => !r.window.partial)!;
    const rows = [...container.querySelectorAll("tbody tr")];

    const partialIndex = graveyard.rows.indexOf(partialRow);
    const nonPartialIndex = graveyard.rows.indexOf(nonPartialRow);
    const tag = rows[partialIndex]!.querySelector(".is-partial");
    expect(tag).not.toBeNull();
    expect(tag?.getAttribute("title")).toBe(partialRow.window.label);
    expect(rows[nonPartialIndex]!.querySelector(".is-partial")).toBeNull();
  });

  it("explains the partial marker once, in the table's caption", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));

    const caption = container.querySelector("caption")?.textContent ?? "";
    // 2026-09-12 copy pass: one plain sentence; the consequence ("its true
    // totals can only be higher") lives under "What this can and cannot see"
    expect(caption).toMatch(/partial count/i);
    expect(caption).toMatch(/before the index began/i);
  });

  it("states no score, no grade, no verdict word anywhere on the page", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));
    expect(container.textContent ?? "").not.toMatch(/\bscore\b|\bgrade\b|\brisk\b|\bpredict/i);
  });
});

describe("the lead figure and the scope caveat", () => {
  it("leads with the count as its own figure, plain ink, above the table", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.textContent ?? "").toContain(String(graveyard.count)));
    const figure = container.querySelector(".graveyard-figure");
    expect(figure).not.toBeNull();
    expect(figure?.textContent).toBe(String(graveyard.count));
    const figureIndex = (container.textContent ?? "").indexOf(figure!.textContent!);
    const tableIndex = (container.textContent ?? "").indexOf(graveyard.rows[0]!.token.slice(0, 10));
    expect(figureIndex).toBeGreaterThan(-1);
    expect(figureIndex).toBeLessThan(tableIndex);
  });

  it("states the denominator once beside the count: the activity index's own total and its oldest launch", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.textContent ?? "").toContain(String(graveyard.scope.indexedLaunches)));
    // 2026-09-12 copy pass: "no buy after 72 hours, of the N the index has watched since <date>"
    expect(container.textContent).toMatch(/after 72 hours/);
    expect(container.textContent).toMatch(/watched since/i);
  });

  /* THE HONESTY TEST, at the page's own boundary: a graveyard with an empty
     row set from an API that still reports a nonzero scope must say so --
     the page must never let "0 rows" read as "0 dead launches" when the
     index simply has not observed any yet. */
  it("never lets zero rows read as zero dead launches when the scope explains why", async () => {
    answerWith({ ...graveyard, rows: [], count: 0 });
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.textContent ?? "").toContain(String(graveyard.scope.indexedLaunches)));
    expect(container.querySelectorAll("tbody tr").length).toBe(0);
    expect(container.textContent).toContain("currently meets the age and zero-buys gate");
  });
});

describe("the graveyard page", () => {
  /* The scope caveat moved from the page's own static prose into the
     board's own "What this can and cannot see" details on 2026-09-12
     (REVAMP.md "the amendment"), the same way /live's "How these are
     counted" lives inside LiveBoardFull rather than in app/live/page.tsx --
     so this now needs the board's own data before the caveat renders. */
  it("states the 72-hour scope caveat in its own copy, not only in the API payload", async () => {
    answerWith(graveyard);
    const { container } = render(<Graveyard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(graveyard.rows.length));
    expect(container.textContent).toContain("72 hours");
    expect(container.textContent).toMatch(/never measured|was never measured|not measured/i);
  });

  it("names no wallet or deployer, only the token and the pons factory context", async () => {
    answerWith(graveyard);
    const { container } = render(<Graveyard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(graveyard.rows.length));
    expect(container.textContent ?? "").not.toMatch(/deployer/i);
  });
});
