"use client";

/* The discovery layer's own board (REPOSITION.md Phase B1).

   Two faces share one fetch loop and one row model:

     LiveBoardFull  -- the dense /live page. Every column CONSTRAINTS 1 lets
                        a ranking be judged against, sort controls that name
                        the column they order by, and the fill rule against
                        each launch's own graduation threshold.

     LivePulse      -- the two-number pulse that leads "/" (the 2026-09
                        front-door rebuild): how many of the tracked curves
                        are taking buys right now, and how many launched in
                        the last hour. No table, no sort control -- the rows
                        are read down to two counts, because the front door's
                        job is to show that something is happening, not to be
                        a second copy of the board underneath it.

   Neither face ranks, scores or grades a token. Every sortable quantity is a
   plain column on the same row a reader can already see (CONSTRAINTS 1);
   nothing here composes a verdict out of them. */

import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from "react";
import { fetchLive, stripAddresses, type LiveResult, type LiveSortKey } from "../lib/api";
import { LIVE_SORT_KEYS } from "../lib/api-schema";
import type { LiveResponse } from "../lib/api-schema";
import { FilterNumber, FilterSelect } from "./FilterField";
import { Pager } from "./Pager";
import { PAIR_BUCKETS, TAX_BUCKETS, taxBucketOf } from "../lib/board-buckets";
import { clampPage, paginate, totalPagesFor } from "../lib/paginate";
import { mergeQuery, readQuery, readQueryInt } from "../lib/query-state";
import {
  formatAge,
  formatBigDecimal,
  formatCount,
  fillPercent,
  pairLabel,
  pairQuantity,
  taxLabel,
} from "../lib/format";

const REFRESH_MS = 15_000;
const DEFAULT_SORT: LiveSortKey = "lastActivity";

type Row = LiveResponse["rows"][number];

const SORT_LABEL: Record<LiveSortKey, string> = {
  buys: "Most buys",
  lastActivity: "Most recent activity",
  age: "Oldest launch first",
  netQuote: "Highest net quote",
  newest: "Newest launch",
};

/** Reads `?sort=` off the address bar once, on mount. A value the schema does
    not recognise is not sent to the API -- the caller falls back to the same
    default a first visit gets, rather than a page that never asked for the
    live board erroring on a stray query string. */
function sortFromLocation(): LiveSortKey {
  if (typeof window === "undefined") return DEFAULT_SORT;
  const requested = new URLSearchParams(window.location.search).get("sort");
  return (LIVE_SORT_KEYS as readonly string[]).includes(requested ?? "")
    ? (requested as LiveSortKey)
    : DEFAULT_SORT;
}

/* Page and every filter (REVAMP.md pagination and filters), all read off the
   address bar once on mount the same way sortFromLocation reads `?sort=`.
   /live already fetches every row it will ever hold for a given sort in one
   request -- the API caps at 200 -- so page and filters narrow what is
   already in hand rather than triggering a second fetch. */
interface LiveFilters {
  pair: string; // "" = all, or a lib/board-buckets PAIR_BUCKETS value
  tax: string; // "" = all, "not-read", or a lib/board-buckets TAX_BUCKETS value
  hasBuys: string; // "" = all, "yes", "no"
  ageMin: string; // seconds, "" = no lower bound
  ageMax: string; // seconds, "" = no upper bound
}

const DEFAULT_LIVE_FILTERS: LiveFilters = { pair: "", tax: "", hasBuys: "", ageMin: "", ageMax: "" };

function hasActiveLiveFilters(f: LiveFilters): boolean {
  return f.pair !== "" || f.tax !== "" || f.hasBuys !== "" || f.ageMin !== "" || f.ageMax !== "";
}

function liveStateFromLocation(): { sort: LiveSortKey; page: number; filters: LiveFilters } {
  return {
    sort: sortFromLocation(),
    page: readQueryInt("page") ?? 1,
    filters: {
      pair: readQuery("pair") ?? "",
      tax: readQuery("tax") ?? "",
      hasBuys: readQuery("buys") ?? "",
      ageMin: readQuery("ageMin") ?? "",
      ageMax: readQuery("ageMax") ?? "",
    },
  };
}

function applyLiveFilters(rows: Row[], f: LiveFilters): Row[] {
  const ageMin = f.ageMin === "" ? null : Number(f.ageMin);
  const ageMax = f.ageMax === "" ? null : Number(f.ageMax);
  return rows.filter((row) => {
    if (f.pair !== "" && row.pairClass !== f.pair) return false;
    if (f.tax === "not-read") {
      if (row.creatorTaxBps !== null) return false;
    } else if (f.tax !== "" && taxBucketOf(row.creatorTaxBps) !== f.tax) {
      return false;
    }
    if (f.hasBuys === "yes" && !(row.buys > 0)) return false;
    if (f.hasBuys === "no" && row.buys > 0) return false;
    if (ageMin !== null && Number.isFinite(ageMin) && row.ageSeconds < ageMin) return false;
    if (ageMax !== null && Number.isFinite(ageMax) && row.ageSeconds > ageMax) return false;
    return true;
  });
}

function useLiveBoard(sort: LiveSortKey) {
  const [result, setResult] = useState<LiveResult | null>(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const load = async () => {
      const next = await fetchLive(fetch, controller.signal, sort);
      if (!live) return;
      setResult(next);
    };
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      live = false;
      controller.abort();
      window.clearInterval(id);
    };
  }, [sort]);

  return result;
}

/* The stale state and the fill rule spend two different colours (globals.css
   `--stale`, `--fill`) so neither can be misread as the other on the same
   row: `--stale` never touches the fill bar or its figures, and `--fill`
   never touches the "updated ... ago" text or the live.stale note. */
function stalenessNote(body: LiveResponse): ReactElement | null {
  if (!body.live.stale) return null;
  return (
    <p className="note note--fine is-stale">
      The live index has not completed a run recently. These rows are the last it read, not a
      current reading.
    </p>
  );
}

/* ---- the pulse: leads "/" ----------------------------------------------
   Two readings off the same rows the board already fetches -- no second
   fetcher, per REPOSITION.md. Both are plain counts, not rates, so neither
   needs a denominator to be a legal figure (CONSTRAINTS 3 requires a window,
   which a plain count still carries); the first prints one anyway, because
   the live board's own population is right there in body.count. The one hue
   this site spends on liveness (globals.css `--fill`, the same accent the
   fill bar uses) marks both numbers so the reader's eye lands on the thing
   that is moving before it lands on anything else. */

const HOUR_SECONDS = 3600;

export function LivePulse(): ReactElement {
  const result = useLiveBoard(DEFAULT_SORT);
  const body = result?.kind === "live" ? result.body : null;

  /* The failure state is the first line a visitor reads when the live layer is
     unreachable, so it says which reading is missing and nothing else. It used
     to print the API's own message, which is written for the token lookup and
     opens "The lookup did not answer" -- the wrong noun, and a failure as the
     first sentence on the page. The rest of the page is static and correct
     without this, so nothing here is estimated and nothing is filled in. */
  if (result !== null && result.kind === "error") {
    return (
      <p className="pulse-quiet">
        The live count is not reachable right now — everything below is unaffected.
      </p>
    );
  }
  if (body === null) {
    return <div className="hairline-pulse" />;
  }

  const takingBuys = body.rows.filter((r) => r.buys > 0).length;
  const lastHour = body.rows.filter((r) => r.ageSeconds <= HOUR_SECONDS).length;
  const ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(body.observedAt)) / 1000));

  return (
    <div className="live-pulse">
      <div className="pulse-reading">
        <span className="pulse-figure mono">{formatCount(takingBuys)}</span>
        <p className="pulse-caption">
          of <span className="mono">{formatCount(body.count)}</span> tracked curves taking buys
          right now
        </p>
      </div>
      <div className="pulse-reading">
        <span className="pulse-figure mono">{formatCount(lastHour)}</span>
        <p className="pulse-caption">launched in the last hour</p>
      </div>
      <p className="note note--fine pulse-age">
        {body.live.stale ? (
          <span className="mono is-stale">the live index has not run recently</span>
        ) : (
          <>
            {/* The one piece of motion on this block, and it carries
                information rather than decorating a number: the key is the
                measurement's own timestamp, so React remounts this span and
                replays its animation exactly when a fetch lands with newer
                data, and not otherwise. A reader watching sees the tick and
                knows something arrived. Nothing animates while nothing is
                happening. Purely decorative, so it is aria-hidden. */}
            <span key={body.observedAt} className="pulse-tick" aria-hidden="true" />
            as of <span className="mono">{formatAge(ageSeconds)}</span> ago · updates every 15s
          </>
        )}
      </p>
    </div>
  );
}

/* null and 0 are different findings: the launch block was never indexed,
   versus it was indexed and nobody bought in it. Collapsing them to the
   same reading would erase that difference. Shared by the table cell and the
   card stat, so both faces of the board read it the same way. */
function firstBlockBuyersText(value: number | null): ReactElement {
  return value === null ? <>not indexed</> : <>{formatCount(value)}</>;
}

function firstBlockBuyersCell(value: number | null): ReactElement {
  return value === null ? (
    <td className="thin">not indexed</td>
  ) : (
    <td className="fig n">{formatCount(value)}</td>
  );
}

/* The progress rule's own figures, shared by the table cell and the card:
   a launch's own net quote against its own threshold, never a borrowed
   constant. Both figures stand beside the bar -- the raw base-unit integers
   LEDGE indexed, since this payload carries no decimals to scale them by and
   guessing would be exactly the fake precision CONSTRAINTS 4 bans. A
   percentage may stand beside them; it never stands alone. A row with no
   threshold renders no bar at all. */
function FillBody({ row }: { row: Row }): ReactElement {
  const pct = fillPercent(row.netQuoteWei, row.fill!.graduationThresholdWei);
  const width = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  /* In the pair token's own units where they are known -- "1.5232 of 4.2 ETH"
     rather than two 19-digit integers. Where they are not known the raw base
     units are printed and said to be raw, because decimals.ts forbids
     guessing an exponent: a wrong one moves the figure by orders of
     magnitude. The threshold is this launch's OWN, never 4.2 assumed. */
  const net = pairQuantity(row.netQuoteWei, row.pairDecimals, null);
  const threshold = pairQuantity(row.fill!.graduationThresholdWei, row.pairDecimals, row.pairSymbol);
  const figures = `${net.text} of ${threshold.text}`;
  return (
    <div className="fill" role="img" aria-label={`${figures} against this launch's own threshold`}>
      <div className="fill-track">
        <div className="fill-bar" style={{ width: `${width}%` }} />
      </div>
      <p className="fill-figures mono">
        {figures}
        {pct === null ? null : <> · {pct.toFixed(1)}%</>}
      </p>
      {threshold.scaled ? null : (
        <p className="note note--fine">
          Raw base units. This pair token&rsquo;s decimals are not known, so the figures are not
          scaled.
        </p>
      )}
      <p className="note note--fine">{row.fill!.label}</p>
    </div>
  );
}

function FillCell({ row }: { row: Row }): ReactElement {
  if (row.fill === null) {
    return <td className="thin">no threshold indexed</td>;
  }
  return (
    <td className="fill-cell">
      <FillBody row={row} />
    </td>
  );
}

function windowLine(row: Row): ReactElement {
  return (
    <>
      {row.window.label}
      {row.window.partial ? <span className="mono is-partial"> · partial</span> : null}
    </>
  );
}

function windowCell(row: Row): ReactElement {
  return <td className="thin window-cell">{windowLine(row)}</td>;
}

/* The address, shortened the way Graduated.tsx and worker/src/text.ts shorten
   it, so the same token reads identically on every board. The full address
   is the link target and the title, so nothing is lost. */
function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

function lastActivityAgo(row: Row, observedAt: string): string {
  const observed = Date.parse(observedAt);
  const at = Date.parse(row.lastActivityAt);
  if (Number.isNaN(observed) || Number.isNaN(at)) return "unreadable";
  return formatAge(Math.max(0, Math.round((observed - at) / 1000)));
}

/* ---- the card: below the table's breakpoint, one per token -------------

   Thirteen columns do not fit a phone (REVAMP.md 1.2), so below globals.css's
   table breakpoint the board stops being a table and becomes one card per
   token. The card leads with what answers "is anything real here" -- the
   link to the token's own page, the fill rule against its own threshold,
   buys, sells, distinct first-block buyers -- then age and state, then the
   analyst columns (launch block, the counted-over window) quieter, as fine
   print rather than dropped. CONSTRAINTS 3 requires every count to carry its
   window; on the table that window is its own column, once per row, so here
   it is its own line, once per card. The partial marker travels with it. */
function LiveCard({ row, observedAt }: { row: Row; observedAt: string }): ReactElement {
  return (
    <li className="live-card">
      <a className="live-card-token mono" href={`/t/${row.token}`} title={row.token}>
        {shortAddress(row.token)}
      </a>
      {row.fill === null ? <p className="thin">no threshold indexed</p> : <FillBody row={row} />}
      <div className="live-card-stats">
        <div className="live-card-stat">
          <span className="live-card-stat-v mono">{formatCount(row.buys)}</span>
          <span className="live-card-stat-k">buys</span>
        </div>
        <div className="live-card-stat">
          <span className="live-card-stat-v mono">{formatCount(row.sells)}</span>
          <span className="live-card-stat-k">sells</span>
        </div>
        <div className="live-card-stat">
          <span className="live-card-stat-v mono">{firstBlockBuyersText(row.firstBlockBuyers)}</span>
          <span className="live-card-stat-k">first-block buyers</span>
        </div>
      </div>
      <p className="note">
        {formatAge(row.ageSeconds)} old · last activity {lastActivityAgo(row, observedAt)} ago ·{" "}
        {row.graduated ? "graduated" : "on the curve"}
      </p>
      <p className="note note--fine live-card-analyst">
        {stripAddresses(pairLabel(row.pairClass))} · creator tax{" "}
        {row.creatorTaxBps === null ? "not read" : `${row.creatorTaxBps} bps`} · launch block{" "}
        {formatCount(row.launchBlock)} · {windowLine(row)}
      </p>
    </li>
  );
}

/* ---- the full board: /live ------------------------------------------- */

export function LiveBoardFull(): ReactElement {
  const [sort, setSort] = useState<LiveSortKey>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<LiveFilters>(DEFAULT_LIVE_FILTERS);

  useEffect(() => {
    const next = liveStateFromLocation();
    setSort(next.sort);
    setPage(next.page);
    setFilters(next.filters);
  }, []);

  const result = useLiveBoard(sort);
  const body = result?.kind === "live" ? result.body : null;

  const filtered = hasActiveLiveFilters(filters);
  const filteredRows = useMemo(
    () => (body === null ? [] : applyLiveFilters(body.rows, filters)),
    [body, filters],
  );
  const pages = totalPagesFor(filteredRows.length);
  const clampedPage = clampPage(page, pages);
  const pageRows = useMemo(() => paginate(filteredRows, clampedPage), [filteredRows, clampedPage]);

  function chooseSort(key: LiveSortKey) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      setSort(key);
      setPage(1);
      mergeQuery({ sort: key === DEFAULT_SORT ? null : key, page: null });
    };
  }

  function updateFilters(patch: Partial<LiveFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(1);
    mergeQuery({
      pair: next.pair || null,
      tax: next.tax || null,
      buys: next.hasBuys || null,
      ageMin: next.ageMin || null,
      ageMax: next.ageMax || null,
      page: null,
    });
  }

  function resetFilters() {
    setFilters(DEFAULT_LIVE_FILTERS);
    setPage(1);
    mergeQuery({ pair: null, tax: null, buys: null, ageMin: null, ageMax: null, page: null });
  }

  function choosePage(next: number) {
    setPage(next);
    mergeQuery({ page: next === 1 ? null : next });
  }

  const pairOptions = [
    { value: "", label: "All pair tokens" },
    ...PAIR_BUCKETS.map((p) => ({ value: p, label: pairLabel(p) })),
  ];
  const taxOptions = [
    { value: "", label: "All creator tax bands" },
    ...TAX_BUCKETS.map((t) => ({ value: t, label: taxLabel(t) })),
    { value: "not-read", label: "Not read" },
  ];
  const hasBuysOptions = [
    { value: "", label: "All" },
    { value: "yes", label: "Has taken buys" },
    { value: "no", label: "Has taken no buys" },
  ];

  function countLine(body: LiveResponse): string {
    const shown = formatCount(pageRows.length);
    const matched = formatCount(filteredRows.length);
    if (!filtered) {
      return `${shown} of ${matched} tokens with activity in this window shown`;
    }
    return `${shown} of ${matched} matching tokens shown (${matched} of ${formatCount(body.count)} total)`;
  }

  return (
    <div className="live-board">
      <nav className="sheet-nav live-sort" aria-label="Sort the live board">
        {LIVE_SORT_KEYS.map((key) =>
          key === sort ? (
            <span key={key} aria-current="true" className="live-sort-current">
              {SORT_LABEL[key]}
            </span>
          ) : (
            <a key={key} href={`?sort=${key}`} onClick={chooseSort(key)}>
              {SORT_LABEL[key]}
            </a>
          ),
        )}
      </nav>

      <div className="board-filters" role="group" aria-label="Filter the live board">
        <FilterSelect
          label="Pair token"
          value={filters.pair}
          onChange={(value) => updateFilters({ pair: value })}
          options={pairOptions}
        />
        <FilterSelect
          label="Creator tax"
          value={filters.tax}
          onChange={(value) => updateFilters({ tax: value })}
          options={taxOptions}
        />
        <FilterSelect
          label="Buys"
          value={filters.hasBuys}
          onChange={(value) => updateFilters({ hasBuys: value })}
          options={hasBuysOptions}
        />
        <FilterNumber
          label="Age from (s)"
          value={filters.ageMin}
          onChange={(value) => updateFilters({ ageMin: value })}
        />
        <FilterNumber
          label="Age to (s)"
          value={filters.ageMax}
          onChange={(value) => updateFilters({ ageMax: value })}
        />
        {filtered ? (
          <a
            className="board-filters-reset"
            href="?"
            onClick={(event) => {
              event.preventDefault();
              resetFilters();
            }}
          >
            Reset filters
          </a>
        ) : null}
      </div>

      {result === null ? <div className="hairline-pulse" /> : null}
      {result !== null && result.kind === "error" ? (
        <p className="lookup-line-plain">{result.message}</p>
      ) : null}

      {body !== null ? (
        <>
          {/* Below globals.css's table breakpoint this is display:none and
              .live-cards takes over; above it, the reverse. Both read the
              same rows -- no second fetch, no divergent figures. */}
          <div
            className="scroller live-table-wrap"
            tabIndex={0}
            role="group"
            aria-label="Every curve with activity, sortable"
          >
            <table>
              <caption>
                One row per token, ranked only by a column printed on the row itself. Every cell
                is a plain count or a fact about that token's own launch.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Pair</th>
                  <th scope="col">Creator tax</th>
                  <th scope="col">Launch block</th>
                  <th scope="col">Age</th>
                  <th scope="col">Last activity</th>
                  <th scope="col">Buys</th>
                  <th scope="col">Sells</th>
                  <th scope="col">First-block buyers</th>
                  <th scope="col">Net quote</th>
                  <th scope="col">Fill against own threshold</th>
                  <th scope="col">Counted over</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.token}>
                    <th scope="row" className="mono">
                      <a href={`/t/${row.token}`} title={row.token}>
                        {shortAddress(row.token)}
                      </a>
                    </th>
                    <td className="fig n">{stripAddresses(pairLabel(row.pairClass))}</td>
                    <td className="fig n">
                      {row.creatorTaxBps === null ? "not read" : `${row.creatorTaxBps} bps`}
                    </td>
                    <td className="fig n">{formatCount(row.launchBlock)}</td>
                    <td className="fig n">{formatAge(row.ageSeconds)}</td>
                    <td className="fig n">{lastActivityAgo(row, body.observedAt)}</td>
                    <td className="fig n">{formatCount(row.buys)}</td>
                    <td className="fig n">{formatCount(row.sells)}</td>
                    {firstBlockBuyersCell(row.firstBlockBuyers)}
                    <td className="fig n mono">{pairQuantity(row.netQuoteWei, row.pairDecimals, row.pairSymbol).text}</td>
                    <FillCell row={row} />
                    {windowCell(row)}
                    <td className="thin">{row.graduated ? "graduated" : "on the curve"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="live-cards" aria-label="Every curve with activity, sortable">
            {pageRows.map((row) => (
              <LiveCard key={row.token} row={row} observedAt={body.observedAt} />
            ))}
          </ul>

          <Pager page={clampedPage} totalPages={pages} onChange={choosePage} label="Page through the live board" />

          <p className="note note--fine">
            {countLine(body)} · page {clampedPage} of {pages} · sorted by{" "}
            {SORT_LABEL[body.sortedBy]}
            {" · "}
            <span className={body.live.stale ? "mono is-stale" : "mono"}>
              observed {formatAge(Math.max(0, Math.round((Date.now() - Date.parse(body.observedAt)) / 1000)))} ago
            </span>
          </p>
          {stalenessNote(body)}
          {body.rows.length === 0 ? (
            <p className="note note--fine">No launch has activity in the indexed window.</p>
          ) : filteredRows.length === 0 ? (
            <p className="note note--fine">No launch matches these filters.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

