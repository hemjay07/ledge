import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insufficientFile, insufficientRaw, numberFile, raw } from "./fixtures";
import type { Lead } from "../lib/lead-core.mjs";

afterEach(cleanup);

const AT_CRAWL = Date.parse(raw.crawledAt);
const h24 = numberFile.h24;
const insufficient = insufficientFile().h24;

/* LEAD is read at render time from lib/lead-core.mjs, so a test can set it the
   way a release would — by changing that one constant — and see the whole
   surface follow: the fold on both pages, the sentences that leave the page,
   and the share card. Modules are reloaded per value because the constant is
   read through a module import, not a prop. */
async function withLead(lead: Lead) {
  vi.resetModules();
  vi.doMock("../lib/lead-core.mjs", () => ({ LEAD: lead }));
  const [{ Fold }, summary, og] = await Promise.all([
    import("../components/Fold"),
    import("../lib/summary"),
    import("../scripts/og.mjs"),
  ]);
  return { Fold, ...summary, ...og };
}

function text(el: Element | null): string {
  return el?.textContent ?? "";
}

const LEADS: Lead[] = ["raw", "excludingFast"];

describe.each(LEADS)("the fold, leading with %s", (lead) => {
  it("renders both figures over the same n, window and measurement", async () => {
    const { Fold } = await withLead(lead);
    const { container } = render(
      <Fold w={h24} crawledAt={raw.crawledAt} staleAfterSeconds={7200} secondaryCounts />,
    );

    const pons = container.querySelector('[data-stat="pons-number"]');
    const exFast = container.querySelector('[data-stat="excluding-fast"]');
    expect(pons).not.toBeNull();
    expect(exFast).not.toBeNull();

    for (const el of [pons, exFast]) {
      expect((el as HTMLElement).dataset.n).toBe(String(h24.launches));
      expect((el as HTMLElement).dataset.window).toBe("24h");
      expect((el as HTMLElement).dataset.updated).toBe(raw.crawledAt);
    }

    // the fine print of both is on the sheet, whichever one posters
    expect(container.textContent).toContain("excluding launches that graduated inside");
    expect(container.textContent).toContain(`of ${h24.launches.toLocaleString("en-US")}`);
  });

  it("posters the figure LEAD names, and only that one", async () => {
    const { Fold } = await withLead(lead);
    const { container } = render(
      <Fold w={h24} crawledAt={raw.crawledAt} staleAfterSeconds={7200} />,
    );
    const poster = text(container.querySelector(".figure"));
    const second = text(container.querySelector(".second .figure-2"));

    if (lead === "raw") {
      expect(poster).toBe("1.81%");
      expect(second).toBe("0.53%");
      expect(container.textContent).toContain("1 in 190");
      expect(container.textContent).not.toContain("counting every graduation");
    } else {
      expect(poster).toBe("1 in 190");
      // the rate the restatement restates is set beside the poster
      expect(text(container.querySelector(".one-in .figure-2"))).toBe("0.53%");
      expect(second).toBe("1.81%");
      expect(container.textContent).toContain(
        "graduated, excluding launches that graduated inside 5 minutes",
      );
      expect(container.textContent).toContain("counting every graduation · 107 of 5,900");
    }
  });

  it("prints no percentage, and no bare 1 in, for an insufficient window", async () => {
    const { Fold } = await withLead(lead);
    const { container } = render(
      <Fold w={insufficient} crawledAt={raw.crawledAt} staleAfterSeconds={7200} />,
    );
    expect(container.textContent).not.toContain("%");
    expect(container.textContent).not.toContain("1 in");
    expect(text(container.querySelector(".figure"))).toBe("not enough data (n=12)");
    // both figures are still rendered, both saying what they cannot say
    expect(container.querySelectorAll('[data-insufficient="true"]').length).toBe(2);
  });

  it("carries the same lead into the sentences that leave the page", async () => {
    const { posterSentence, secondarySentence, shareSummary } = await withLead(lead);
    const cutoff = "5 minutes";
    const poster = posterSentence(h24, cutoff, raw.crawledAt);
    const second = secondarySentence(h24, cutoff, true);
    const summary = shareSummary(h24, cutoff);

    expect(poster).toContain("Measured 6 Sep 2026");
    if (lead === "raw") {
      expect(poster.startsWith("1.81%")).toBe(true);
      expect(second.startsWith("0.53%")).toBe(true);
      expect(summary.startsWith("1.81%")).toBe(true);
    } else {
      expect(poster.startsWith("0.53% excluding launches")).toBe(true);
      expect(second.startsWith("1.81%")).toBe(true);
      expect(summary.startsWith("0.53%")).toBe(true);
    }

    const none = shareSummary(insufficient, cutoff);
    expect(none).not.toContain("%");
    expect(none).toContain("not enough data (n=12)");
  });

  it("carries the same lead onto the share card", async () => {
    const { cardText, cardTree } = await withLead(lead);
    const card = cardText(cardTree(raw, AT_CRAWL)).join(" | ");

    if (lead === "raw") {
      expect(card).toContain("1.81%");
      expect(card).toContain("excluding under 5 min · 1 in 190");
      expect(card).toContain("n = 5,900 · 107 graduations · updated");
      expect(card).not.toContain("counting every graduation");
    } else {
      expect(card).toContain("1 in 190");
      expect(card).toContain("0.53%");
      expect(card).toContain("graduated, excluding under 5 min");
      expect(card).toContain("n = 5,900 · 31 graduations · updated");
      expect(card).toContain("1.81% counting every graduation · 107 of 5,900");
    }

    const empty = cardText(cardTree(insufficientRaw(), AT_CRAWL)).join(" | ");
    expect(empty).not.toContain("%");
    expect(empty).not.toContain("1 in");
    expect(empty).toContain("not enough data (n=12)");
  });
});
