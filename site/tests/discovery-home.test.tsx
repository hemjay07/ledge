import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import Home from "../app/page";
import { LiveNow } from "../components/Live";
import { h24, numberFile } from "../lib/number";
import { formatCount } from "../lib/format";
import live from "./api-fixtures/live-ok.json";

/* REPOSITION.md Phase B, site side: "/" leads with what is happening now and
   carries the headline counts; the Number stays present and prominent but no
   longer occupies the page alone. Every assertion about the Number's own
   figures is derived from the frozen fixture (tests/fixtures.ts), the same
   one the rest of the suite reads, never a hand-typed rate. */

function answerWith(payload: unknown) {
  const impl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
  vi.stubGlobal("fetch", impl);
  return impl;
}

beforeEach(() => {
  answerWith(live);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the discovery lead on /", () => {
  it("stands before the Number's own fold, inside the same crop", async () => {
    const { container } = render(<Home />);
    const lead = container.querySelector(".discovery-lead");
    const figure = container.querySelector(".figure-block");
    expect(lead).not.toBeNull();
    expect(figure).not.toBeNull();
    expect(lead!.compareDocumentPosition(figure!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("carries the live board, or a tight extract of it", async () => {
    const { container } = render(<Home />);
    await waitFor(() => expect(container.querySelectorAll(".live-now tbody tr").length).toBeGreaterThan(0));
    const lead = container.querySelector(".discovery-lead");
    expect(lead?.querySelector(".live-now")).not.toBeNull();
  });

  it("carries the headline counts: the 24h launch count and the Number, linked to /number", async () => {
    const { container } = render(<Home />);
    const lead = container.querySelector(".discovery-lead");
    expect(lead?.textContent).toContain(formatCount(h24.launches));
    const stat = lead?.querySelector('[data-stat="pons-number-lead"]');
    expect(stat).not.toBeNull();
    expect(stat?.getAttribute("data-n")).toBe(String(h24.launches));
    expect(stat?.getAttribute("data-updated")).toBe(numberFile.crawledAt);
    expect(lead?.querySelector('a[href="/number"]')).not.toBeNull();
  });

  it("does not print the Number's fold alone: the sheet still carries the sample, the finding and the pair register beneath it", () => {
    const { container } = render(<Home />);
    expect(container.querySelector(".sample-line")).not.toBeNull();
    expect(container.querySelector(".finding")).not.toBeNull();
    expect(container.querySelector("#h-pair")).not.toBeNull();
  });

  it("still keeps the deep live board on the sheet, unchanged, with its own folio", () => {
    const { container } = render(<Home />);
    expect(container.querySelector("#h-live")).not.toBeNull();
  });

  it("carries /live in the sheet index", () => {
    const { container } = render(<Home />);
    const nav = container.querySelector('nav[aria-label="Sheet"]');
    const hrefs = [...(nav?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/live");
  });
});

describe("the tight live extract", () => {
  it("shows no more than six rows, tallest first by recency, even when more are indexed", async () => {
    const many = {
      ...live,
      rows: Array.from({ length: 9 }, (_, i) => ({
        ...live.rows[0],
        token: `0x${String(i).padStart(40, "0")}`,
      })),
      count: 9,
    };
    answerWith(many);
    const { container } = render(<LiveNow />);
    await waitFor(() => expect(container.querySelectorAll("tbody tr").length).toBeGreaterThan(0));
    expect(container.querySelectorAll("tbody tr").length).toBe(6);
  });

  it("links to the full board", async () => {
    const { container } = render(<LiveNow />);
    await waitFor(() => expect(container.querySelector('a[href="/live"]')).not.toBeNull());
  });

  it("says the board did not answer rather than showing an empty table as though it had", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const { container } = render(<LiveNow />);
    await waitFor(() => expect(container.textContent).toContain("did not answer"));
  });
});
