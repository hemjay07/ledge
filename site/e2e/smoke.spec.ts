import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

/* Gate 8 — the smoke tests, against the built static export.

   The recompute gate proves the numbers are correct. These prove the page a
   reader actually receives carries them: that it loads without throwing, that
   the published endpoint is the committed measurement byte for byte, and that
   no figure reaches anyone stripped of its denominator.

   That last one is the point. CONSTRAINTS #3 — "never show a number without
   its denominator" — is enforced in the pipeline by the schema, in the
   renderer by the Stat gate, and here in the DOM, which is the only place a
   reader ever meets it. */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

const ROUTES = ["/", "/cohorts/", "/method/", "/number/"] as const;

/** A denominator, however the sheet chose to spell it: "533 of 26,265",
    "n = 26,265", "(n=812)", or the refusal that stands in for a rate the
    sample cannot support. */
const CARRIES_ITS_N =
  /\d[\d,]*\s+of\s+\d[\d,]*|n\s*=\s*\d[\d,]*|not enough data \(n=\d+\)/i;

/** Everything that would tell a reader the page is broken, collected for the
    life of the page.

    Two things are deliberately NOT counted as problems, and both would
    otherwise make this suite cry wolf until someone turned it off:

      - calls to /api/*. The live board asks the Worker for rows; the Worker
        is not running in a static smoke test, and the board's handling of
        that silence is the behaviour under test, not a defect.
      - net::ERR_ABORTED. The router speculatively prefetches the routes in
        the nav and the browser cancels those when they are not needed. A
        cancelled request is not a failed one.

    A genuinely missing asset still fails, because it arrives as a 4xx/5xx
    RESPONSE, which is caught below and is not excused for anything. */
function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  const isWorkerCall = (url: string) => url.includes("/api/");

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    /* "Failed to load resource: …404" carries no URL, so it cannot be told
       apart from the Worker call the board is meant to survive. The response
       listener below reports the same failures WITH their URL and excuses
       nothing else, so this one is dropped as a duplicate rather than
       excused as a class. */
    if (message.text().startsWith("Failed to load resource")) return;
    problems.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  page.on("response", (response) => {
    const url = response.url();
    if (response.status() >= 400 && !isWorkerCall(url)) {
      problems.push(`http ${response.status()}: ${url}`);
    }
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    const reason = request.failure()?.errorText ?? "";
    if (isWorkerCall(url) || reason.includes("ERR_ABORTED")) return;
    problems.push(`requestfailed: ${url} ${reason}`);
  });

  return problems;
}

test.describe("every route the static export publishes", () => {
  for (const route of ROUTES) {
    test(`${route} loads clean`, async ({ page }) => {
      const problems = watchForErrors(page);
      const response = await page.goto(route, { waitUntil: "networkidle" });

      expect(response?.status(), `${route} did not answer 200`).toBe(200);
      await expect(page.locator("body")).toBeVisible();
      expect(problems, `${route} logged errors`).toEqual([]);
    });
  }
});

test.describe("the fold", () => {
  test("is headed once, and only once", async ({ page }) => {
    await page.goto("/");
    /* More than one h1 is not a style question: it is two documents claiming
       to be the page, and the share card and the reader's outline both take
       the first one they find. */
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).not.toBeEmpty();
  });

  test("puts the headline figure in the HTML, not in a fetch", async ({ page }) => {
    /* The gate only covers what the build wrote. A figure fetched at runtime
       would leave the recompute gate's coverage entirely (section 4). */
    const html = await (await fetch("http://127.0.0.1:4173/")).text();
    expect(html).toMatch(CARRIES_ITS_N);
  });
});

test.describe("no number without its denominator", () => {
  for (const route of ROUTES) {
    test(`${route} keeps every figure's n reachable`, async ({ page }) => {
      await page.goto(route);

      const figures = page.locator(".figure, .figure-2");
      const count = await figures.count();

      /* A page with no figures would pass this loop without executing it, so
         one page has to be required to have them or the check is vacuous.
         That page was "/" until 2026-09-11, when the Number's fold moved to
         /number and the home page stopped carrying display figures. The
         requirement moved with the fold rather than being dropped: /number is
         where the poster figures live now, and it is still the page that
         travels. */
      if (route === "/number/") {
        expect(count, "the fold rendered no display figure at all").toBeGreaterThan(0);
      }

      for (let i = 0; i < count; i += 1) {
        const spoken = await figures.nth(i).evaluate((element) => {
          /* A display figure is hidden from assistive technology and paired
             with a spelled-out sentence, because "1.85%" read aloud is a
             number without its denominator. Find that sentence. */
          const hidden = element.closest('[aria-hidden="true"]');
          if (!hidden) return { hidden: false, text: "" };
          let sibling = hidden.nextElementSibling;
          while (sibling && !sibling.classList.contains("vh")) {
            sibling = sibling.nextElementSibling;
          }
          return { hidden: true, text: sibling?.textContent ?? "" };
        });

        expect(spoken.hidden, `${route}: a display figure is not aria-hidden`).toBe(true);
        expect(
          spoken.text,
          `${route}: a figure has no spelled-out sentence beside it`,
        ).not.toBe("");
        expect(spoken.text, `${route}: a figure's sentence carries no n`).toMatch(CARRIES_ITS_N);
      }
    });
  }

  test("states an n beside every published rate on the cohorts page", async ({ page }) => {
    await page.goto("/cohorts/", { waitUntil: "networkidle" });
    const tables = page.locator("table");
    expect(await tables.count()).toBeGreaterThan(0);

    /* A register states its denominator as a COLUMN, not as inline prose:
       every row carries the launches (or deployers) the rate was computed
       over. So the check is structural — a table that prints percentages
       must also carry the column that denominates them. */
    const offenders = await page.evaluate(() => {
      const denominated = /launches|deployers|\(\s*n\s*\)/i;
      return [...document.querySelectorAll("table")]
        .filter((table) => /%/.test(table.textContent ?? ""))
        .filter((table) => {
          const headers = [...table.querySelectorAll("th")]
            .map((th) => th.textContent ?? "")
            .join(" ");
          return !denominated.test(headers);
        })
        .map((table) => table.getAttribute("aria-label") ?? "unnamed table");
    });

    expect(offenders, "a table prints percentages with no sample-size column").toEqual([]);
  });
});

test("/number.json is byte-identical to the committed measurement", async () => {
  /* SPEC 8. The published endpoint and data/number.json are the same file;
     the site's own vitest asserts it against public/, and this asserts it
     against what the built export actually serves over HTTP. */
  const served = await fetch("http://127.0.0.1:4173/number.json");
  expect(served.status).toBe(200);

  const body = Buffer.from(await served.arrayBuffer());
  const committed = readFileSync(join(REPO_ROOT, "data", "number.json"));
  expect(body.equals(committed)).toBe(true);
});

test("the share card is 1200 by 630", async () => {
  const response = await fetch("http://127.0.0.1:4173/og/number.png");
  expect(response.status).toBe(200);

  const png = Buffer.from(await response.arrayBuffer());
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  /* IHDR is the first chunk: 8-byte signature, 4-byte length, 4-byte type,
     then width and height as big-endian uint32. */
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});
