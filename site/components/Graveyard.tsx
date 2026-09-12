"use client";

/* /graveyard: the 93.5% made concrete. Nobody browses several thousand dead
   launches -- the count is the product and the list beneath it is secondary
   evidence, not the headline (REVAMP.md 2026-09-12, "the amendment", boards
   rebuild). The card leads with the count itself, large, in the same display
   face the homepage LIVE pulse uses -- but plain ink, never `--fill`: this is
   not live good news, it is a dead-launch count, and the one hue this site
   spends on liveness would say the wrong thing about it.

   Reuses /live's own vocabulary -- `.card`, `.card-header`, `.board-controls`,
   `.board-filter-disclosure`, `.board-what-counts`, `.state-tag`, `.live-card`
   -- rather than inventing a second visual language for what is structurally
   the same kind of board: one row per token, sortable by a column every row
   already shows (CONSTRAINTS 1), no score, no grade, no verdict.

   THE SCOPE CAVEAT IS NOT A FOOTNOTE. worker/src/graveyard.ts carries the
   full reasoning: a launch whose entire life happened before LEDGE started
   recording curve activity has no row here at all, and the reader is owed
   that before the table, not after it. It is now stated once, in one
   sentence beside the count, with the full reasoning collapsed into "What
   this can and cannot see" at the bottom, verbatim -- a caveat moved into a
   caption or a details element is not a caveat hidden. */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  fetchGraveyard,
  type GraveyardResult,
  type GraveyardSortKey,
} from "../lib/api";
import { GRAVEYARD_SORT_KEYS } from "../lib/api-schema";
import type { GraveyardResponse } from "../lib/api-schema";
import { FilterNumber, FilterSelect } from "./FilterField";
import { Pager } from "./Pager";
import { TokenPanel } from "./TokenPanel";
import { useTokenPanel } from "../lib/use-token-panel";
import { PAIR_BUCKETS, TAX_BUCKETS, taxBucketOf } from "../lib/board-buckets";
import { clampPage, paginate, totalPagesFor } from "../lib/paginate";
import { mergeQuery, readQuery, readQueryInt } from "../lib/query-state";
import { formatAge, formatCount, pairLabel, taxLabel, taxPercent } from "../lib/format";
import { TokenName } from "./Live";

const REFRESH_MS = 15_000;

/* A visitor here wants to know what most recently crossed the 72-hour gate,
   not the oldest dead launch on record -- so the default ranks by recency.
   Oldest-first stays one click away in the same select. */
const DEFAULT_SORT: GraveyardSortKey = "newest";

type Row = GraveyardResponse["rows"][number];

const SORT_LABEL: Record<GraveyardSortKey, string> = {
  age: "Oldest launch first",
  newest: "Newest launch",
};

function sortFromLocation(): GraveyardSortKey {
  if (typeof window === "undefined") return DEFAULT_SORT;
  const requested = new URLSearchParams(window.location.search).get("sort");
  return (GRAVEYARD_SORT_KEYS as readonly string[]).includes(requested ?? "")
    ? (requested as GraveyardSortKey)
    : DEFAULT_SORT;
}

interface GraveyardFilters {
  pair: string; // "" = all, or a lib/board-buckets PAIR_BUCKETS value
  tax: string; // "" = all, "not-read", or a lib/board-buckets TAX_BUCKETS value
  ageMin: string; // seconds, "" = no lower bound
  ageMax: string; // seconds, "" = no upper bound
}

const DEFAULT_GRAVEYARD_FILTERS: GraveyardFilters = { pair: "", tax: "", ageMin: "", ageMax: "" };

function hasActiveGraveyardFilters(f: GraveyardFilters): boolean {
  return f.pair !== "" || f.tax !== "" || f.ageMin !== "" || f.ageMax !== "";
}

function graveyardStateFromLocation(): { sort: GraveyardSortKey; page: number; filters: GraveyardFilters } {
  return {
    sort: sortFromLocation(),
    page: readQueryInt("page") ?? 1,
    filters: {
      pair: readQuery("pair") ?? "",
      tax: readQuery("tax") ?? "",
      ageMin: readQuery("ageMin") ?? "",
      ageMax: readQuery("ageMax") ?? "",
    },
  };
}

function applyGraveyardFilters(rows: Row[], f: GraveyardFilters): Row[] {
  const ageMin = f.ageMin === "" ? null : Number(f.ageMin);
  const ageMax = f.ageMax === "" ? null : Number(f.ageMax);
  return rows.filter((row) => {
    if (f.pair !== "" && row.pairClass !== f.pair) return false;
    if (f.tax === "not-read") {
      if (row.creatorTaxBps !== null) return false;
    } else if (f.tax !== "" && taxBucketOf(row.creatorTaxBps) !== f.tax) {
      return false;
    }
    if (ageMin !== null && Number.isFinite(ageMin) && row.ageSeconds < ageMin) return false;
    if (ageMax !== null && Number.isFinite(ageMax) && row.ageSeconds > ageMax) return false;
    return true;
  });
}

function useGraveyard(sort: GraveyardSortKey) {
  const [result, setResult] = useState<GraveyardResult | null>(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const load = async () => {
      const next = await fetchGraveyard(fetch, controller.signal, sort);
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

/* null and 0 are different findings, exactly as on /live: the launch block
   was never indexed, versus it was indexed and nobody bought in it. */
function firstBlockBuyersCell(value: number | null): ReactElement {
  return value === null ? (
    <td className="thin">not read</td>
  ) : (
    <td className="fig n">{formatCount(value)}</td>
  );
}

function firstBlockBuyersText(value: number | null): string {
  return value === null ? "first block not read" : `${formatCount(value)} first-block buyers`;
}

/** A UTC calendar date, no time -- "6 Sep 2026" -- for the scope sentence's
    "oldest launched {date}". Local, not lib/format-core.mjs: no other caller
    on the site needs a date without a time, and format-core.mjs is shared
    with scripts/og.mjs's own card renderer. */
function dateOnly(iso: string | null): string {
  if (iso === null) return "an unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "an unreadable time";
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function stalenessNote(body: GraveyardResponse): ReactElement | null {
  if (!body.live.stale) return null;
  return (
    <p className="note note--fine is-stale">
      The live index has not completed a run recently. These rows are the last it read, not a
      current reading.
    </p>
  );
}

/* One quiet row per token below the table's own breakpoint -- deliberately
   smaller than /live's or /graduated's own cards, because this board's job
   is not to be browsed. */
function GraveyardCard({
  row,
  onOpen,
}: {
  row: Row;
  onOpen: (address: string, trigger: HTMLElement | null) => void;
}): ReactElement {
  return (
    <li
      className="live-card graveyard-card row-clickable"
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("a")) return;
        onOpen(row.token, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if ((event.target as HTMLElement).closest("a")) return;
        event.preventDefault();
        onOpen(row.token, event.currentTarget);
      }}
    >
      <a className="live-card-token mono" href={`/t/${row.token}`} title={row.token}>
        <TokenName symbol={row.symbol} name={row.name} />
        {`${row.token.slice(0, 10)}…${row.token.slice(-6)}`}
      </a>
      {row.window.partial ? (
        <span className="mono state-tag is-partial" title={row.window.label}>
          partial count
        </span>
      ) : null}
      <p className="note note--fine live-card-analyst">
        {formatAge(row.ageSeconds)} old · 0 buys · {formatCount(row.sells)} sells ·{" "}
        {firstBlockBuyersText(row.firstBlockBuyers)}
      </p>
      <p className="note note--fine live-card-analyst">
        {pairLabel(row.pairClass)} ·{" "}
        {taxPercent(row.creatorTaxBps)}
      </p>
    </li>
  );
}

export function GraveyardBoard(): ReactElement {
  const [sort, setSort] = useState<GraveyardSortKey>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<GraveyardFilters>(DEFAULT_GRAVEYARD_FILTERS);
  const panel = useTokenPanel();
  const filterDetailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const next = graveyardStateFromLocation();
    setSort(next.sort);
    setPage(next.page);
    setFilters(next.filters);
  }, []);

  useEffect(() => {
    const details = filterDetailsRef.current;
    if (!details || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    details.open = window.matchMedia("(min-width: 64rem)").matches;
  }, []);

  const result = useGraveyard(sort);
  const body = result?.kind === "graveyard" ? result.body : null;

  const filtered = hasActiveGraveyardFilters(filters);
  const filteredRows = useMemo(
    () => (body === null ? [] : applyGraveyardFilters(body.rows, filters)),
    [body, filters],
  );
  const pages = totalPagesFor(filteredRows.length);
  const clampedPage = clampPage(page, pages);
  const pageRows = useMemo(() => paginate(filteredRows, clampedPage), [filteredRows, clampedPage]);

  function chooseSort(key: GraveyardSortKey) {
    setSort(key);
    setPage(1);
    mergeQuery({ sort: key === DEFAULT_SORT ? null : key, page: null });
  }

  function updateFilters(patch: Partial<GraveyardFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    setPage(1);
    mergeQuery({
      pair: next.pair || null,
      tax: next.tax || null,
      ageMin: next.ageMin || null,
      ageMax: next.ageMax || null,
      page: null,
    });
  }

  function resetFilters() {
    setFilters(DEFAULT_GRAVEYARD_FILTERS);
    setPage(1);
    mergeQuery({ pair: null, tax: null, ageMin: null, ageMax: null, page: null });
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

  function countLine(body: GraveyardResponse): string {
    const shown = formatCount(pageRows.length);
    const matched = formatCount(filteredRows.length);
    if (!filtered) {
      return `${shown} of ${matched} launches at zero buys, 72 h or older, shown`;
    }
    return `${shown} of ${matched} matching launches shown (${matched} of ${formatCount(body.count)} total)`;
  }

  const ageText =
    result !== null && result.kind === "error"
      ? "unreachable"
      : body === null
        ? "…"
        : `updated ${formatAge(Math.max(0, Math.round((Date.now() - Date.parse(body.observedAt)) / 1000)))} ago`;

  return (
    <div className="card graveyard-board">
      <div className="card-header">
        <span className="kicker card-kicker">GRAVEYARD</span>
        <span className="note note--fine mono">{ageText}</span>
      </div>

      {body !== null ? (
        <div className="graveyard-lead">
          <span className="graveyard-figure mono">{formatCount(body.count)}</span>
          <p className="note graveyard-lead-caption">
            launches with no buy after 72 hours, of the {formatCount(body.scope.indexedLaunches)}{" "}
            the index has watched since {dateOnly(body.scope.earliestIndexedLaunchAt)}.
          </p>
        </div>
      ) : null}

      <div className="board-controls">
        <p className="picker-field live-sort-field">
          <label className="picker-label" htmlFor="graveyard-sort">
            Sort
          </label>
          <span className="picker-line">
            <select
              className="picker-select mono"
              id="graveyard-sort"
              value={sort}
              onChange={(event) => chooseSort(event.target.value as GraveyardSortKey)}
            >
              {GRAVEYARD_SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {SORT_LABEL[key]}
                </option>
              ))}
            </select>
            <span className="picker-caret" aria-hidden="true">
              ▾
            </span>
          </span>
        </p>

        <details className="board-filter-disclosure" ref={filterDetailsRef}>
          <summary>{filtered ? "Filter · active" : "Filter"}</summary>
          <div className="board-filters" role="group" aria-label="Filter the graveyard">
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
        </details>
      </div>

      {result === null ? <div className="hairline-pulse" /> : null}
      {result !== null && result.kind === "error" ? (
        <p className="lookup-line-plain">{result.message}</p>
      ) : null}

      {body !== null ? (
        <>
          <div
            className="scroller graveyard-table-wrap"
            tabIndex={0}
            role="group"
            aria-label="Launches at zero buys, sortable"
          >
            <table>
              <caption>
                Every row: no buy since launch, at least {formatAge(body.scope.ageCutoffSeconds)} ago. A
                row marked &ldquo;partial count&rdquo; launched before the index began.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Pair</th>
                  <th scope="col">Creator tax</th>
                  <th scope="col">Age</th>
                  <th scope="col">Sells</th>
                  <th scope="col">First-block buyers</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row: Row) => (
                  <tr
                    key={row.token}
                    className="row-clickable"
                    tabIndex={0}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a")) return;
                      panel.open(row.token, event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if ((event.target as HTMLElement).closest("a")) return;
                      event.preventDefault();
                      panel.open(row.token, event.currentTarget);
                    }}
                  >
                    <th scope="row" className="mono">
                      <a href={`/t/${row.token}`} title={row.token}>
                        <TokenName symbol={row.symbol} name={row.name} />
                        {`${row.token.slice(0, 10)}…${row.token.slice(-6)}`}
                      </a>
                      {row.window.partial ? (
                        <span className="mono state-tag is-partial" title={row.window.label}>
                          {" "}
                          partial
                        </span>
                      ) : null}
                    </th>
                    <td className="fig n">{pairLabel(row.pairClass)}</td>
                    <td className="fig n">
                      {taxPercent(row.creatorTaxBps)}
                    </td>
                    <td className="fig n">{formatAge(row.ageSeconds)}</td>
                    <td className="fig n">{formatCount(row.sells)}</td>
                    {firstBlockBuyersCell(row.firstBlockBuyers)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="graveyard-cards" aria-label="Launches at zero buys, sortable">
            {pageRows.map((row) => (
              <GraveyardCard key={row.token} row={row} onOpen={panel.open} />
            ))}
          </ul>

          <p className="note note--fine">
            {countLine(body)} · page {clampedPage} of {pages} · sorted by{" "}
            {SORT_LABEL[body.sortedBy]}
            {" · "}
            <span className={body.live.stale ? "mono is-stale" : "mono"}>
              observed {formatAge(Math.max(0, Math.round((Date.now() - Date.parse(body.observedAt)) / 1000)))} ago
            </span>
          </p>
          {stalenessNote(body)}

          <Pager page={clampedPage} totalPages={pages} onChange={choosePage} label="Page through the graveyard" />

          {body.rows.length === 0 ? (
            <p className="note note--fine">
              No launch in the activity index's own window currently meets the age and zero-buys
              gate.
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="note note--fine">No launch matches these filters.</p>
          ) : null}

          <details className="board-what-counts">
            <summary>What this can and cannot see</summary>
            <p className="note">
              A launch is listed after 72 hours with no buy since its launch block. The index only
              began watching curves recently: a launch that lived and died before then has no row,
              and its absence means &ldquo;not measured&rdquo;, not &ldquo;took a buy&rdquo;. The
              count of launches watched, and the oldest, is printed above the table.
            </p>
            <p className="note">
              Buys and sells are counted from the curve&rsquo;s own trade events. A launch older
              than the index has a partial count, and its row says so.
            </p>
            <p className="note">
              First-block buyers is the number of distinct wallets that bought in the block the
              token launched in. &ldquo;Not read&rdquo; means that block was never indexed; 0 means
              it was, and nobody bought.
            </p>
          </details>
        </>
      ) : null}
      {panel.token ? (
        <TokenPanel token={panel.token} onClose={panel.close} returnFocusTo={panel.returnFocusTo} />
      ) : null}
    </div>
  );
}
