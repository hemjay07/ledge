"use client";

/* The graveyard: launches LEDGE has indexed that took zero buys, at least 72
   hours after their own launch block. Reuses /live's own vocabulary --
   `.live-board`, `.live-sort`, `.scroller`, `.fig`, `.thin`, `.note--fine` --
   rather than inventing a second visual language for what is structurally
   the same kind of page: one row per token, sortable by a column every row
   already shows (CONSTRAINTS 1), no score, no grade, no verdict.

   THE SCOPE CAVEAT IS NOT A FOOTNOTE. worker/src/graveyard.ts carries the
   full reasoning: a launch whose entire life happened before LEDGE started
   recording curve activity has no row here at all, and the reader is owed
   that before the table, not after it -- a count that looks complete without
   saying so is the denominator defect CONSTRAINTS 3 exists to catch. */

import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from "react";
import {
  fetchGraveyard,
  stripAddresses,
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
import { formatAge, formatCount, pairLabel, taxLabel } from "../lib/format";

const REFRESH_MS = 15_000;
const DEFAULT_SORT: GraveyardSortKey = "age";

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

/* Page and every filter (REVAMP.md pagination and filters), read off the
   address bar once on mount, the same way sortFromLocation already reads
   `?sort=`. /graveyard already fetches every row it will ever hold for a
   given sort in one request -- the API caps at 200 -- so page and filters
   narrow what is already in hand rather than triggering a second fetch. */
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
    <td className="thin">not indexed</td>
  ) : (
    <td className="fig n">{formatCount(value)}</td>
  );
}

function scopeNote(body: GraveyardResponse): ReactElement {
  return (
    <p className="note" style={{ marginBottom: "1rem" }}>
      {body.scope.label}
    </p>
  );
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

export function GraveyardBoard(): ReactElement {
  const [sort, setSort] = useState<GraveyardSortKey>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<GraveyardFilters>(DEFAULT_GRAVEYARD_FILTERS);
  const panel = useTokenPanel();

  useEffect(() => {
    const next = graveyardStateFromLocation();
    setSort(next.sort);
    setPage(next.page);
    setFilters(next.filters);
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
    return (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      setSort(key);
      setPage(1);
      mergeQuery({ sort: key === DEFAULT_SORT ? null : key, page: null });
    };
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

  return (
    <div className="live-board">
      {body !== null ? scopeNote(body) : null}

      <nav className="sheet-nav live-sort" aria-label="Sort the graveyard">
        {GRAVEYARD_SORT_KEYS.map((key) =>
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

      {result === null ? <div className="hairline-pulse" /> : null}
      {result !== null && result.kind === "error" ? (
        <p className="lookup-line-plain">{result.message}</p>
      ) : null}

      {body !== null ? (
        <>
          <p className="note note--fine">
            {countLine(body)} · page {clampedPage} of {pages} · sorted by{" "}
            {SORT_LABEL[body.sortedBy]}
            {" · "}
            <span className={body.live.stale ? "mono is-stale" : "mono"}>
              observed {formatAge(Math.max(0, Math.round((Date.now() - Date.parse(body.observedAt)) / 1000)))} ago
            </span>
          </p>
          {stalenessNote(body)}
          <div className="scroller" tabIndex={0} role="group" aria-label="Launches at zero buys, sortable">
            <table>
              <caption>
                One row per token, ranked only by a column printed on the row itself. Every launch
                here has taken zero buys since its own launch block, at least {formatAge(body.scope.ageCutoffSeconds)}
                {" "}
                ago. Counts run from the block in the last column up to{" "}
                {body.lastIndexedBlock === null
                  ? "the last block this index read"
                  : `block ${formatCount(body.lastIndexedBlock)}`}
                . A row marked{" "}
                <span className="mono is-partial">partial</span> launched before this index began
                recording, so trades before its own start block are not counted and its true totals
                can only be higher.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Pair</th>
                  <th scope="col">Creator tax</th>
                  <th scope="col">Launch block</th>
                  <th scope="col">Age</th>
                  <th scope="col">Buys</th>
                  <th scope="col">Sells</th>
                  <th scope="col">First-block buyers</th>
                  <th scope="col">Counted from</th>
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
                      {row.token}
                    </th>
                    <td className="fig n">{stripAddresses(pairLabel(row.pairClass))}</td>
                    <td className="fig n">
                      {row.creatorTaxBps === null ? "not read" : `${row.creatorTaxBps} bps`}
                    </td>
                    <td className="fig n">{formatCount(row.launchBlock)}</td>
                    <td className="fig n">{formatAge(row.ageSeconds)}</td>
                    <td className="fig n">0</td>
                    <td className="fig n">{formatCount(row.sells)}</td>
                    {firstBlockBuyersCell(row.firstBlockBuyers)}
                    {/* The block this row's counts start from, and a marker
                        when they are partial. NOT the full explanation.

                        This cell used to render `row.window.label` verbatim,
                        which is a forty-word sentence naming both bounds and
                        explaining what partial means. Repeated down two hundred
                        rows it wrapped into a narrow column, made every row
                        about 450px tall, and pushed the token address off the
                        screen. CONSTRAINTS 3 requires the counts to carry their
                        window; it does not require the window to be restated in
                        prose on every line. It is stated once above the table,
                        which is where a reader can actually read it. */}
                    <td className="fig n">
                      {formatCount(row.window.fromBlock)}
                      {row.window.partial ? (
                        <span className="mono is-partial" title="Counts start at this block; trades before it are not counted">
                          {" "}· partial
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pager page={clampedPage} totalPages={pages} onChange={choosePage} label="Page through the graveyard" />

          {body.rows.length === 0 ? (
            <p className="note note--fine">
              No launch in the activity index's own window currently meets the age and zero-buys
              gate.
            </p>
          ) : filteredRows.length === 0 ? (
            <p className="note note--fine">No launch matches these filters.</p>
          ) : null}
        </>
      ) : null}
      {panel.token ? (
        <TokenPanel token={panel.token} onClose={panel.close} returnFocusTo={panel.returnFocusTo} />
      ) : null}
    </div>
  );
}
