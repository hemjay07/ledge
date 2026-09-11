import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { GraveyardBoard } from "../components/Graveyard";
import Graveyard from "../app/graveyard/page";
import graveyard from "./api-fixtures/graveyard-ok.json";

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
  it("renders one row per token, with the token itself printed", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(graveyard.rows.length));
    for (const row of graveyard.rows) {
      expect(container.textContent ?? "").toContain(row.token);
    }
  });

  it("prints every row's buys as 0, since that is the gate to appear at all", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));
    const rows = [...container.querySelectorAll("tbody tr")];
    for (const row of rows) {
      const buysCell = row.querySelectorAll("td")[4];
      expect(buysCell?.textContent).toBe("0");
    }
  });

  it("tells apart a first block never indexed from one indexed with no buyers", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));
    const rows = [...container.querySelectorAll("tbody tr")];
    // row 0: firstBlockBuyers 0 -- indexed, nobody bought
    expect(rows[0]?.textContent).toContain("0");
    // row 1: firstBlockBuyers null -- never indexed
    expect(rows[1]?.textContent).toContain("not indexed");
  });

  /* The reason a window is partial is now stated ONCE, in the caption, rather
     than repeated verbatim in every row. It was rendered per row until
     2026-09-11, where a forty-word sentence wrapped inside a narrow column,
     made each row about 450px tall and pushed the token address off screen.
     CONSTRAINTS 3 requires the counts to carry their window; it does not
     require the window to be restated in prose on every line, and a caveat
     nobody can read is not a caveat. The guarantee is unchanged and is
     asserted here in both halves: the explanation is present, and the rows it
     applies to are marked. */
  it("explains a partial window once, and marks every row it applies to", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));

    const caption = container.querySelector("caption")?.textContent ?? "";
    expect(caption).toMatch(/partial/i);
    expect(caption).toMatch(/before this index began recording/i);
    expect(caption).toMatch(/can only be higher/i);

    const marked = container.querySelectorAll("tbody .is-partial");
    const partialRows = graveyard.rows.filter((r) => r.window.partial).length;
    expect(marked.length).toBe(partialRows);
    expect(partialRows).toBeGreaterThan(0);

    // and the row still carries the block its own counts start from
    for (const row of graveyard.rows) {
      expect(container.textContent).toContain(row.window.fromBlock.toLocaleString("en-US"));
    }
  });

  it("states no score, no grade, no verdict word anywhere on the page", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBe(2));
    expect(container.textContent ?? "").not.toMatch(/\bscore\b|\bgrade\b|\brisk\b|\bpredict/i);
  });
});

describe("the scope caveat", () => {
  it("prints the scope label prominently, above the table, not only in a footnote", async () => {
    answerWith(graveyard);
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.textContent ?? "").toContain(graveyard.scope.label));
    // The scope note renders before the table in document order.
    const scopeIndex = (container.textContent ?? "").indexOf(graveyard.scope.label);
    const tableIndex = (container.textContent ?? "").indexOf(graveyard.rows[0]!.token);
    expect(scopeIndex).toBeGreaterThan(-1);
    expect(scopeIndex).toBeLessThan(tableIndex);
  });

  /* THE HONESTY TEST, at the page's own boundary: a graveyard with an empty
     row set from an API that still reports a nonzero scope must say so --
     the page must never let "0 rows" read as "0 dead launches" when the
     index simply has not observed any yet. */
  it("never lets zero rows read as zero dead launches when the scope explains why", async () => {
    answerWith({ ...graveyard, rows: [], count: 0 });
    const { container } = render(<GraveyardBoard />);
    await waitFor(() => expect(container.textContent ?? "").toContain(graveyard.scope.label));
    expect(container.querySelectorAll("tbody tr").length).toBe(0);
    expect(container.textContent).toContain("currently meets the age and zero-buys gate");
  });
});

describe("the graveyard page", () => {
  it("states the 72-hour scope caveat in its own copy, not only in the API payload", () => {
    const { container } = render(<Graveyard />);
    expect(container.textContent).toContain("72 hours");
    expect(container.textContent).toMatch(/never measured|was never measured|not measured/i);
  });

  it("names no wallet or deployer, only the token and the pons factory context", () => {
    const { container } = render(<Graveyard />);
    expect(container.textContent ?? "").not.toMatch(/deployer/i);
  });
});
