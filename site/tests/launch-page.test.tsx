import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LaunchPage from "../app/launch/page";
import { readLaunch } from "../lib/launch";

/* /launch (2026-09-17): the pre-registration for the reader a post sends
   here. Five blocks, every rate with its n, the commit hash that proves the
   order of events, and no verdict word. The figures are the document's own
   (dated 12 Sep 2026), not the live record. */

afterEach(cleanup);

describe("/launch", () => {
  it("states the base rate with its n and dates it to the document's crawl", () => {
    const { container } = render(<LaunchPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("2.52% graduated (588 of 23,353)");
    expect(text).toContain("record as of 12 Sep 2026");
  });

  it("carries the three commitments and the commit hash from data/launch.json", () => {
    const { container } = render(<LaunchPage />);
    const text = container.textContent ?? "";
    expect(text).toContain("The creator wallet does not buy on the curve.");
    expect(text).toContain("No buys are arranged.");
    expect(text).toContain("Every reading is published as it happens.");
    const launch = readLaunch();
    expect(launch).not.toBeNull();
    expect(text).toContain(`committed as ${launch?.preregistrationCommit}`);
    expect(container.querySelector(`a[href="https://github.com/hemjay07/ledge/commit/${launch?.preregistrationCommit}"]`)).not.toBeNull();
  });

  it("says n=1 proves nothing, and uses no verdict word", () => {
    const { container } = render(<LaunchPage />);
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).toContain("n=1");
    for (const banned of ["score", "rug", "safe", "risk", "likely", "predict", "odds", "chance", "moon"]) {
      expect(text.includes(banned), banned).toBe(false);
    }
  });
});
