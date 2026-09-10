import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Fold } from "../components/Fold";
import NumberCard from "../app/number/page";
import Home from "../app/page";
import { numberSchema } from "../lib/schema";
import { cardText, cardTree } from "../scripts/og.mjs";
import {
  SAMPLE_CLAUSE,
  formatCount,
  formatDayLong,
  sampleProvenance,
  sampleSentence,
} from "../lib/format";
import { S, h24, numberFile, raw } from "./fixtures";

/* The raised-nothing sample: a dated reading with its own n, published as data
   and rendered from it. Nothing in this file types a percentage — every
   expectation is derived from the frozen fixture through the same formatters
   the page uses, so a re-sampling changes the fixture and the assertions
   together or it fails. */

afterEach(cleanup);

const AT_CRAWL = Date.parse(raw.crawledAt);

function plain(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/ /g, " ");
}

function foldWithSample() {
  return render(
    <Fold w={h24} crawledAt={raw.crawledAt} staleAfterSeconds={7200} sample={S} />,
  );
}

describe("the sample, in the file", () => {
  it("is published under a name, with its own n and its own date", () => {
    expect(numberFile.samples?.raisedNothing).toBeDefined();
    expect(S.sampled).toBeGreaterThan(0);
    expect(S.count).toBeLessThanOrEqual(S.sampled as number);
    expect(S.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("parses a file written before samples existed", () => {
    const older = { ...structuredClone(raw) } as Record<string, unknown>;
    delete older.samples;
    const parsed = numberSchema.safeParse(older);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it("parses a file whose samples block is empty", () => {
    const empty = { ...structuredClone(raw), samples: {} };
    expect(numberSchema.safeParse(empty).success).toBe(true);
  });

  it("refuses a share that has no sampled count under it", () => {
    const bad = structuredClone(raw) as Record<string, any>;
    bad.samples = {
      raisedNothing: { measuredAt: "2026-09-08", count: 187, share: 0.935, method: "x" },
    };
    const parsed = numberSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("sampled");
  });

  it("accepts a sample that carries no share at all", () => {
    const ok = structuredClone(raw) as Record<string, any>;
    ok.samples = { raisedNothing: { measuredAt: "2026-09-08", count: 187, method: "x" } };
    expect(numberSchema.safeParse(ok).success).toBe(true);
  });
});

describe("the sample, in the fold", () => {
  it("stands above the poster figure", () => {
    const { container } = foldWithSample();
    const line = container.querySelector(".sample-line");
    const poster = container.querySelector(".figure-block");
    expect(line).not.toBeNull();
    expect(poster).not.toBeNull();
    expect(line!.compareDocumentPosition(poster!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("reads as the shared formatter sets it", () => {
    const { container } = foldWithSample();
    expect(plain(container.querySelector(".sample-line"))).toBe(sampleSentence(S));
  });

  it("routes the figure through Stat, which cannot drop the denominator", () => {
    const { container } = foldWithSample();
    const stat = container.querySelector('[data-stat="raised-nothing"]');
    expect(stat).not.toBeNull();
    expect(stat!.getAttribute("data-n")).toBe(String(S.sampled));
    expect(stat!.getAttribute("data-updated")).toBe(S.measuredAt);
  });

  it("sets its provenance in the fine print immediately beneath", () => {
    const { container } = foldWithSample();
    const fine = container.querySelector(".sample-fine");
    expect(fine).not.toBeNull();
    expect(plain(fine)).toBe(sampleProvenance(S));
    expect(plain(fine)).toContain(`${formatCount(S.count)} of ${formatCount(S.sampled as number)}`);
    expect(plain(fine)).toContain(formatDayLong(S.measuredAt));
  });

  it("says nothing at all when there is no sample", () => {
    const { container } = render(
      <Fold w={h24} crawledAt={raw.crawledAt} staleAfterSeconds={7200} />,
    );
    expect(container.querySelector(".sample-line")).toBeNull();
    expect(container.querySelector(".sample-fine")).toBeNull();
  });

  it("prints not-enough-data rather than a percentage below the gate", () => {
    const thin = { ...S, sampled: 12, count: 11, share: 11 / 12 };
    const { container } = render(
      <Fold w={h24} crawledAt={raw.crawledAt} staleAfterSeconds={7200} sample={thin} />,
    );
    const line = plain(container.querySelector(".sample-line"));
    expect(line).toContain("not enough data (n=12)");
    expect(line).not.toContain("%");
  });

  it("adds under forty words to the fold", () => {
    const { container } = foldWithSample();
    const added = `${plain(container.querySelector(".sample-line"))} ${plain(
      container.querySelector(".sample-fine"),
    )}`;
    const words = added.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    expect(words.length).toBeLessThan(40);
  });

  it("tells no reader what to do with the number", () => {
    const { container } = foldWithSample();
    const added = `${plain(container.querySelector(".sample-line"))} ${plain(
      container.querySelector(".sample-fine"),
    )}`.toLowerCase();
    for (const banned of ["you should", "should buy", "should sell", "dyor", "alpha", "risk"]) {
      expect(added.includes(banned), `"${banned}" is in the fold`).toBe(false);
    }
  });
});

describe("the sample, on both surfaces", () => {
  /* The sample used to be printed in full on the home page as well. It moved
     to /number on 2026-09-10 when the home page stopped reprinting the whole
     instrument, and CONSTRAINTS 5 is the reason this test did not simply lose
     the assertion: never hiding an unflattering number is a guarantee about
     REACHABILITY, not about which page leads. So the home page must still
     carry the figure and a way to the full treatment, and that is asserted
     here rather than deleted. */
  it("is reachable from the sheet, which states the rate and links to it", () => {
    const { container } = render(<Home />);
    /* The value itself is not pinned here: this page renders the LIVE file
       while this suite's fixture is frozen, and pinning a live figure is what
       has broken these tests before. What is pinned is the guarantee — the
       rate is stated with the window and the denominator it was counted over,
       and both the full treatment and the method are one click away. */
    const stated = container.querySelector(".headline-rate");
    expect(stated).not.toBeNull();
    const text = plain(stated);
    expect(text).toMatch(/launches in the last 24 hours/);
    expect(text).toMatch(/\d/);
    expect(container.querySelector('a[href="/number"]')).not.toBeNull();
    expect(container.querySelector('a[href="/method"]')).not.toBeNull();
  });

  it("is on the card page, which is what travels", () => {
    const { container } = render(<NumberCard />);
    expect(plain(container.querySelector(".sample-line"))).toBe(sampleSentence(S));
    expect(plain(container.querySelector(".sample-fine"))).toBe(sampleProvenance(S));
  });
});

describe("the sample, on the share card", () => {
  it("is the top line of the image, above the poster figure", () => {
    const lines = cardText(cardTree(raw, AT_CRAWL));
    const sentence = lines.findIndex((l) => l.includes(SAMPLE_CLAUSE));
    const poster = lines.findIndex((l) => l.includes("launches in the last 24 hours graduated"));
    expect(sentence).toBeGreaterThanOrEqual(0);
    expect(sentence).toBeLessThan(poster);
  });

  it("carries its provenance with it", () => {
    const text = cardText(cardTree(raw, AT_CRAWL)).join(" | ");
    expect(text).toContain(sampleSentence(S));
    expect(text).toContain(sampleProvenance(S));
  });

  it("prints nothing when the file carries no sample", () => {
    const none = structuredClone(raw) as Record<string, any>;
    delete none.samples;
    const text = cardText(cardTree(none, AT_CRAWL)).join(" | ");
    expect(text).not.toContain(SAMPLE_CLAUSE);
  });

  it("prints not-enough-data rather than a percentage below the gate", () => {
    const thin = structuredClone(raw) as Record<string, any>;
    thin.samples = { raisedNothing: { ...S, sampled: 12, count: 11, share: 11 / 12 } };
    const text = cardText(cardTree(thin, AT_CRAWL)).join(" | ");
    expect(text).toContain(`not enough data (n=12) ${SAMPLE_CLAUSE}`);
  });
});
