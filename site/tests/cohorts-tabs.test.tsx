import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Cohorts from "../app/cohorts/page";

afterEach(cleanup);

/* /cohorts printed every cut of the Number for both windows — ten register
   tables in one document, about 4,800 px on a phone — with no way to reach the
   one you wanted except scrolling past the others. It is tabbed now.

   The thing these tests exist to protect is that tabbing showed LESS. It does
   not: CONSTRAINTS 5's guarantee is about a figure being reachable, and every
   register is still rendered and still in the document, hidden with the
   `hidden` attribute rather than unmounted. A tab is a shorter path than a
   scroll, not a longer one. If a future change starts unmounting the inactive
   panels, these fail. */
describe("the cohort registers, tabbed", () => {
  it("still renders every register, including the ones not on screen", () => {
    const { container } = render(<Cohorts />);
    const panels = container.querySelectorAll('[role="tabpanel"]');
    // five cuts per window, two windows published
    expect(panels.length).toBeGreaterThanOrEqual(5);
    /* Not every cut is a table — the fast-graduation cut is prose and figures
       — so what is asserted is that no panel is EMPTY. A tab that selects
       nothing is the failure this guards against. */
    for (const panel of panels) {
      const text = (panel.textContent ?? "").trim();
      expect(text.length, "a tab panel with nothing in it").toBeGreaterThan(20);
      expect(
        panel.querySelector("table, [data-stat]"),
        "a tab panel carrying neither a table nor a figure",
      ).not.toBeNull();
    }
  });

  it("hides rather than removes the panels a reader is not looking at", () => {
    const { container } = render(<Cohorts />);
    const hidden = [...container.querySelectorAll('[role="tabpanel"][hidden]')];
    expect(hidden.length).toBeGreaterThan(0);
    // hidden, but present: the tables are in the document for a crawler and
    // for a reader whose JavaScript has not run
    for (const panel of hidden) {
      expect(panel.querySelectorAll("tr").length).toBeGreaterThan(0);
    }
  });

  it("shows exactly one panel per strip, and marks the tab that selects it", () => {
    const { container } = render(<Cohorts />);
    const strips = container.querySelectorAll('[role="tablist"]');
    expect(strips.length).toBeGreaterThan(0);
    for (const strip of strips) {
      const selected = strip.querySelectorAll('[aria-selected="true"]');
      expect(selected.length).toBe(1);
    }
  });

  it("switches the visible register when a tab is chosen", () => {
    const { container } = render(<Cohorts />);
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    const tabs = [...strip.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    expect(tabs.length).toBeGreaterThan(1);

    const second = tabs[1]!;
    fireEvent.click(second);
    expect(second.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("false");

    const shown = container.querySelector(`#${second.getAttribute("aria-controls")}`);
    expect(shown?.hasAttribute("hidden")).toBe(false);
  });

  it("names every tab for a reader rather than by its internal key", () => {
    const { container } = render(<Cohorts />);
    const labels = [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? "");
    for (const label of labels) {
      expect(label.trim().length).toBeGreaterThan(2);
      expect(label, "a raw key reached the strip").not.toMatch(/^(dep|tax|pair|fast)$/);
    }
  });
});
