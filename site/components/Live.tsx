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

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { fetchLive, stripAddresses, type LiveResult, type LiveSortKey } from "../lib/api";
import { LIVE_SORT_KEYS } from "../lib/api-schema";
import type { LiveResponse } from "../lib/api-schema";
import { FilterNumber, FilterSelect } from "./FilterField";
import { Pager } from "./Pager";
import { TokenPanel } from "./TokenPanel";
import { useTokenPanel } from "../lib/use-token-panel";
import { PAIR_BUCKETS, TAX_BUCKETS, taxBucketOf } from "../lib/board-buckets";
import { clampPage, paginate, totalPagesFor } from "../lib/paginate";
import { mergeQuery, readQuery, readQueryInt } from "../lib/query-state";
import { numberFile } from "../lib/number";
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
export const DEFAULT_SORT: LiveSortKey = "lastActivity";

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

export function useLiveBoard(sort: LiveSortKey) {
  const [result, setResult] = useState<LiveResult | null>(null);

  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const load = async () => {
      const next = await fetchLive(fetch, controller.signal, sort);
      if (!live) return;
      /* A failed poll does not replace a good reading with an error. The
         reading it holds is still true, and its own observedAt keeps ageing
         on screen -- "updated 48 s ago", the stale colour past the threshold
         -- which is the honest state. Swapping it for "not reachable" on one
         dropped request made a phone show that line for minutes on
         2026-09-12 while nothing was down. The first fetch has nothing to
         keep, so an error there is shown. */
      setResult((current) =>
        next.kind === "error" && current !== null && current.kind === "live" ? current : next,
      );
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

/** The pulse's two counts, off the same rows every caller of a live result
    reads. Pulled out so the standalone pulse and the home page's LIVE card
    -- which lifts its own fetch (REVAMP.md 2026-09-12, "do ONE fetch loop
    for the page") -- cannot compute them two different ways. */
export function pulseCounts(body: LiveResponse): { takingBuys: number; lastHour: number } {
  return {
    takingBuys: body.rows.filter((r) => r.buys > 0).length,
    lastHour: body.rows.filter((r) => r.ageSeconds <= HOUR_SECONDS).length,
  };
}

/** The pulse's own age, in seconds, off its own measurement time. */
export function pulseAgeSeconds(body: LiveResponse): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(body.observedAt)) / 1000));
}

/* The failure state is the first line a visitor reads when the live layer is
   unreachable, so it says which reading is missing and nothing else. It used
   to print the API's own message, which is written for the token lookup and
   opens "The lookup did not answer" -- the wrong noun, and a failure as the
   first sentence on the page. The rest of the page is static and correct
   without this, so nothing here is estimated and nothing is filled in. */
export function PulseQuiet(): ReactElement {
  return (
    <p className="pulse-quiet">
      The live count is not reachable right now — everything below is unaffected.
    </p>
  );
}

/** The two readings and the age line, given a result rather than fetching
    one. `LivePulse` below is this, self-fetching, for a caller that owns no
    fetch of its own; the home page's LIVE card renders this same body
    against the fetch it lifted, so the two never read a different rate of
    the same rows. */
export function PulseBody({ result }: { result: LiveResult | null }): ReactElement {
  const body = result?.kind === "live" ? result.body : null;

  if (result !== null && result.kind === "error") return <PulseQuiet />;
  if (body === null) return <div className="hairline-pulse" />;

  const { takingBuys, lastHour } = pulseCounts(body);
  const ageSeconds = pulseAgeSeconds(body);

  /* Stale: the figures lose the live colour, because a number in the
     liveness accent beside "has not run" says two things at once. They are
     still printed -- they are the last true reading -- in ink, with when. */
  const lastRan =
    body.live.lastSuccessAt === null
      ? null
      : Math.max(0, Math.round((Date.now() - Date.parse(body.live.lastSuccessAt)) / 1000));

  return (
    <div className={body.live.stale ? "live-pulse is-stale-pulse" : "live-pulse"}>
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
          <span className="mono is-stale">
            {lastRan === null
              ? "the live index has not completed a run yet; these are the last counts it held"
              : `the live index last ran ${formatAge(lastRan)} ago; these counts are from then`}
          </span>
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

export function LivePulse(): ReactElement {
  const result = useLiveBoard(DEFAULT_SORT);
  return <PulseBody result={result} />;
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
/* `compact` prints the bar and the figures and leaves the label to the table's
   caption, which states it once. The label is a forty-word sentence; printed
   on every row it made each row ~450 px on a phone (REVAMP.md, "a failure
   worth recording"). The rule -- the threshold travels with what it is
   measured against -- is kept by the caption, not dropped. */
export function FillBody({ row, compact = false }: { row: Row; compact?: boolean }): ReactElement {
  /* The bar is the curve's own reserve (worker/src/reserve.ts), read at a
     named block, never the indexed net quote: on 2026-09-12 that sum was
     measured at -1.40 ETH against a curve holding 0.007 ETH. */
  const pct = fillPercent(row.fill!.reserveWei, row.fill!.graduationThresholdWei);
  const width = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  /* In the pair token's own units where they are known -- "1.5232 of 4.2 ETH"
     rather than two 19-digit integers. Where they are not known the raw base
     units are printed and said to be raw, because decimals.ts forbids
     guessing an exponent: a wrong one moves the figure by orders of
     magnitude. The threshold is this launch's OWN, never 4.2 assumed. */
  const net = pairQuantity(row.fill!.reserveWei, row.pairDecimals, null);
  const threshold = pairQuantity(row.fill!.graduationThresholdWei, row.pairDecimals, row.pairSymbol);
  const figures = `${net.text} of ${threshold.text}`;
  return (
    <div className="fill" role="img" aria-label={`${figures} against this launch's own threshold`}>
      <div className="fill-track">
        <div className="fill-bar" style={{ width: `${width}%` }} />
      </div>
      <p className="fill-figures mono">
        <span className={compact ? "fill-quantities" : undefined}>
          {figures}
          {pct === null ? null : " · "}
        </span>
        {pct === null ? null : <>{pct.toFixed(1)}%</>}
      </p>
      {compact || threshold.scaled ? null : (
        <p className="note note--fine">
          Raw base units. This pair token&rsquo;s decimals are not known, so the figures are not
          scaled.
        </p>
      )}
      {compact ? null : <p className="note note--fine">{row.fill!.label}</p>}
    </div>
  );
}

function FillCell({ row, compact = false }: { row: Row; compact?: boolean }): ReactElement {
  if (row.fill === null) {
    return <td className="thin">no threshold indexed</td>;
  }
  /* A graduated curve is drained to zero (PONS_CONTRACTS.md): its reserve
     reads 0 and a 0% bar would say "empty" about a launch that filled. The
     word is the reading. */
  if (row.graduated) {
    return <td className="thin">graduated</td>;
  }
  return (
    <td className="fill-cell">
      <FillBody row={row} compact={compact} />
    </td>
  );
}

/* The window sentence, stated once for the whole board rather than once per
   row (REVAMP.md 2026-09-12, "the homepage direction" -- the /live pass).
   When every visible row was counted over the same window that sentence is
   printed verbatim; when they differ the caption falls back to the plain
   phrase "the indexed window" rather than picking one row's window to stand
   for all of them. A row whose own window is partial still carries its own
   label -- in the "partial" tag's `title`, not in running text -- so the
   fact is never lost, only moved off the caption's own sentence. */
function windowCaption(rows: readonly Row[]): string {
  if (rows.length === 0) return "the indexed window";
  const first = rows[0]!.window.label;
  return rows.every((r) => r.window.label === first) ? first : "the indexed window";
}

/* The fill rule's own forty-word label, stated once for the board rather than
   once per row -- the defect LIVE-FINDINGS.md recorded ("the 40-word fill
   caveat is printed inside EVERY card"). Distinct labels are kept distinct
   rather than collapsed to one, on the same principle as windowCaption: never
   pick one row's text to stand in for a row that says something else. */
function fillLabels(rows: readonly Row[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const row of rows) {
    if (row.fill === null || seen.has(row.fill.label)) continue;
    seen.add(row.fill.label);
    labels.push(row.fill.label);
  }
  return labels;
}

/** A graduated row, or one whose own window is partial, carries a small mono
    tag after its address -- the one fact CONSTRAINTS 1 permits printing about
    a token's own state, and the one CONSTRAINTS 3 requires for a partial
    count. The partial tag's own `title` carries this row's own window label
    in full, since the caption above only states it when every row shares it. */
function stateTags(row: Row): ReactElement | null {
  if (!row.graduated && !row.window.partial) return null;
  return (
    <>
      {row.graduated ? <span className="mono state-tag"> graduated</span> : null}
      {row.window.partial ? (
        <span className="mono state-tag is-partial" title={row.window.label}>
          {" "}
          partial
        </span>
      ) : null}
    </>
  );
}

/* The address, shortened the way Graduated.tsx and worker/src/text.ts shorten
   it, so the same token reads identically on every board. The full address
   is the link target and the title, so nothing is lost. */
export function shortAddress(address: string): string {
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
function LiveCard({
  row,
  observedAt,
  onOpen,
}: {
  row: Row;
  observedAt: string;
  onOpen: (address: string, trigger: HTMLElement | null) => void;
}): ReactElement {
  return (
    <li
      className="live-card row-clickable"
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
        {shortAddress(row.token)}
      </a>
      {stateTags(row)}
      {row.fill === null ? (
        <p className="thin">no threshold indexed</p>
      ) : row.graduated ? (
        <p className="thin">graduated</p>
      ) : (
        <FillBody row={row} compact />
      )}
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
      <p className="note note--fine live-card-analyst">
        {stripAddresses(pairLabel(row.pairClass))} · creator tax{" "}
        {row.creatorTaxBps === null ? "not read" : `${row.creatorTaxBps} bps`} ·{" "}
        {formatAge(row.ageSeconds)} old · last activity {lastActivityAgo(row, observedAt)} ago
      </p>
    </li>
  );
}

/* ---- the full board: /live ------------------------------------------- */

export function LiveBoardFull(): ReactElement {
  const [sort, setSort] = useState<LiveSortKey>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<LiveFilters>(DEFAULT_LIVE_FILTERS);
  const panel = useTokenPanel();
  const sortId = useId();
  const filterDetailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const next = liveStateFromLocation();
    setSort(next.sort);
    setPage(next.page);
    setFilters(next.filters);
  }, []);

  /* The filter disclosure's own initial state, read once after mount the
     same way sortFromLocation and Tabs.tsx read the URL once after mount:
     the server has no viewport to render against, so the first paint always
     matches the closed, mobile-first markup, and only a client that can ask
     `matchMedia` opens it wide immediately. A user's own click after that is
     never overridden -- this effect runs once, on mount, not on every
     resize. */
  useEffect(() => {
    const details = filterDetailsRef.current;
    if (!details || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    details.open = window.matchMedia("(min-width: 64rem)").matches;
  }, []);

  const result = useLiveBoard(sort);
  const body = result?.kind === "live" ? result.body : null;

  const filtered = hasActiveLiveFilters(filters);
  const activeFilterCount = [filters.pair, filters.tax, filters.hasBuys, filters.ageMin, filters.ageMax].filter(
    (v) => v !== "",
  ).length;
  const filteredRows = useMemo(
    () => (body === null ? [] : applyLiveFilters(body.rows, filters)),
    [body, filters],
  );
  const pages = totalPagesFor(filteredRows.length);
  const clampedPage = clampPage(page, pages);
  const pageRows = useMemo(() => paginate(filteredRows, clampedPage), [filteredRows, clampedPage]);

  function chooseSort(key: LiveSortKey) {
    setSort(key);
    setPage(1);
    mergeQuery({ sort: key === DEFAULT_SORT ? null : key, page: null });
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

  const stale = body !== null && (body.live.stale || pulseAgeSeconds(body) >= numberFile.staleAfterSeconds);
  const ageText =
    result !== null && result.kind === "error"
      ? "unreachable"
      : body === null
        ? "…"
        : `updated ${formatAge(pulseAgeSeconds(body))} ago`;
  const headerCount = body === null ? null : formatCount(body.count);

  const cardsUnscaled = pageRows.some(
    (row) => row.fill !== null && !pairQuantity(row.netQuoteWei, row.pairDecimals, null).scaled,
  );

  return (
    <div className={`card live-board${stale ? " is-stale-card" : ""}`}>
      <div className="card-header">
        <span className={`kicker card-kicker${stale ? " is-stale" : ""}`}>
          LIVE{headerCount === null ? "" : ` · ${headerCount} curve${body?.count === 1 ? "" : "s"} with activity`}
        </span>
        <span className={`note note--fine mono${stale ? " is-stale" : ""}`}>{ageText}</span>
      </div>

      <div className="board-controls">
        <p className="picker-field live-sort-field">
          <label className="picker-label" htmlFor={sortId}>
            Sort
          </label>
          <span className="picker-line">
            <select
              className="picker-select mono"
              id={sortId}
              value={sort}
              onChange={(event) => chooseSort(event.target.value as LiveSortKey)}
            >
              {LIVE_SORT_KEYS.map((key) => (
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
          <summary>{filtered ? `Filter · ${activeFilterCount} active` : "Filter"}</summary>
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
        </details>
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
                is a plain count or a fact about that token's own launch. Counted over{" "}
                {windowCaption(pageRows)}.{" "}
                {fillLabels(pageRows).map((label) => (
                  <span key={label}>{label} </span>
                ))}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Token</th>
                  <th scope="col">Pair</th>
                  <th scope="col">Creator tax</th>
                  <th scope="col">Age</th>
                  <th scope="col">Buys</th>
                  <th scope="col">Sells</th>
                  <th scope="col">First-block buyers</th>
                  <th scope="col">Fill</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
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
                        {shortAddress(row.token)}
                      </a>
                      {stateTags(row)}
                    </th>
                    <td className="fig n">{stripAddresses(pairLabel(row.pairClass))}</td>
                    <td className="fig n">
                      {row.creatorTaxBps === null ? "not read" : `${row.creatorTaxBps} bps`}
                    </td>
                    <td className="fig n">{formatAge(row.ageSeconds)}</td>
                    <td className="fig n">{formatCount(row.buys)}</td>
                    <td className="fig n">{formatCount(row.sells)}</td>
                    {firstBlockBuyersCell(row.firstBlockBuyers)}
                    <FillCell row={row} compact />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {cardsUnscaled ? (
            <p className="note note--fine live-cards-note">
              Raw base units. This pair token&rsquo;s decimals are not known, so the figures are not
              scaled.
            </p>
          ) : null}
          <ul className="live-cards" aria-label="Every curve with activity, sortable">
            {pageRows.map((row) => (
              <LiveCard key={row.token} row={row} observedAt={body.observedAt} onOpen={panel.open} />
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

          <details className="board-what-counts">
            <summary>How these are counted</summary>
            <p className="lede">
              Buys, sells, and quote in and out are counted from indexed curve trades, not read
              from the curve itself: the curve skims a fee and the creator tax off quote in before
              its own reserve sees it, so the net-quote fill here is an upper bound on the curve's
              real reserve, not a live read of it. A launch older than the indexed record has a
              partial count, and its own row says so.
            </p>
            <p className="note">
              Distinct first-block buyers is absent, never zero, when that launch's own block was
              never indexed. Zero means the block was read and nobody bought in it.
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

/* ---- the home page's LIVE and NOW cards (REVAMP.md 2026-09-12) ---------

   The build puts the LIVE card at the top of the page and the NOW card much
   further down, beneath the FINDING card -- two different places in the DOM
   for what has to stay one fetch (REVAMP.md item 6: "do ONE fetch loop for
   the page ... not two"). A single component returning both as siblings
   cannot be placed in two spots, so the fetch is lifted one level further,
   into a context: `HomeLiveProvider` calls `useLiveBoard` once, and
   `HomeLiveCard` and `HomeNowCard` each read the same result back out of it
   from wherever the page's grid puts them. The NOW card's "ranked by buys"
   is a client-side sort of the rows that one fetch already holds -- not a
   second request with a different `sort` -- so the two cards can never show
   a different snapshot of the board. */

const NOW_ROWS = 5;

const HomeLiveContext = createContext<LiveResult | null | undefined>(undefined);

export function HomeLiveProvider({ children }: { children: ReactNode }): ReactElement {
  const result = useLiveBoard(DEFAULT_SORT);
  return <HomeLiveContext.Provider value={result}>{children}</HomeLiveContext.Provider>;
}

function useHomeLiveResult(): LiveResult | null {
  const ctx = useContext(HomeLiveContext);
  if (ctx === undefined) {
    throw new Error("HomeLiveCard/HomeNowCard must render inside a HomeLiveProvider");
  }
  return ctx;
}

export function HomeLiveCard({ staleAfterSeconds }: { staleAfterSeconds: number }): ReactElement {
  const result = useHomeLiveResult();
  const body = result?.kind === "live" ? result.body : null;
  const ageSeconds = body === null ? null : pulseAgeSeconds(body);
  const stale = body !== null && (body.live.stale || (ageSeconds !== null && ageSeconds >= staleAfterSeconds));

  const ageText =
    result !== null && result.kind === "error"
      ? "unreachable"
      : body === null
        ? "…"
        : `updated ${formatAge(ageSeconds ?? 0)} ago`;

  return (
    <section className={`card home-live${stale ? " is-stale-card" : ""}`} aria-label="Live pulse">
      <div className="card-header">
        <span className={`kicker card-kicker${stale ? " is-stale" : ""}`}>LIVE</span>
        <span className={`note note--fine mono${stale ? " is-stale" : ""}`}>{ageText}</span>
      </div>
      <div className="card-body">
        {result !== null && result.kind === "error" ? <PulseQuiet /> : <PulseBody result={result} />}
      </div>
    </section>
  );
}

export function HomeNowCard(): ReactElement {
  const result = useHomeLiveResult();
  const body = result?.kind === "live" ? result.body : null;

  const topByBuys = useMemo(
    () => (body === null ? [] : [...body.rows].sort((a, b) => b.buys - a.buys).slice(0, NOW_ROWS)),
    [body],
  );

  return (
    <section className="card home-now" aria-label="Curves taking buys right now">
      <div className="card-header">
        <span className="kicker card-kicker">NOW · taking buys · ranked by buys</span>
      </div>
      <div className="card-body">
        {result === null ? <div className="hairline-pulse" /> : null}
        {result !== null && result.kind === "error" ? (
          <p className="pulse-quiet">The live board is not reachable right now.</p>
        ) : null}
        {body !== null ? (
          <>
            {/* The note sits outside the scroller so it wraps to the card's width
                instead of scrolling sideways with the table and clipping. */}
            <p className="note note--fine home-now-note">
              Fill is the indexed net quote against each launch&rsquo;s own graduation
              threshold, an upper bound on the curve&rsquo;s reserve; the full reading is on
              each token&rsquo;s own page.
            </p>
            <div className="scroller">
              <table className="home-now-table">
                <caption>The first five tracked curves, ranked by buys.</caption>
                <thead>
                  <tr>
                    <th scope="col">Token</th>
                    <th scope="col">Buys</th>
                    <th scope="col" className="home-now-sells">
                      Sells
                    </th>
                    <th scope="col">First-block buyers</th>
                    <th scope="col">Fill against own threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {topByBuys.map((row) => (
                    <tr key={row.token}>
                      <th scope="row" className="mono">
                        <a href={`/t/${row.token}`} title={row.token}>
                          {shortAddress(row.token)}
                        </a>
                      </th>
                      <td className="fig n" data-unit="buys">
                        {formatCount(row.buys)}
                      </td>
                      <td className="fig n home-now-sells" data-unit="sells">
                        {formatCount(row.sells)}
                      </td>
                      <td
                        className={row.firstBlockBuyers === null ? "thin" : "fig n"}
                        data-unit={row.firstBlockBuyers === null ? undefined : "first-block"}
                      >
                        {firstBlockBuyersText(row.firstBlockBuyers)}
                      </td>
                      <FillCell row={row} compact />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {topByBuys.length === 0 ? (
              <p className="note note--fine">No launch has activity in the indexed window.</p>
            ) : (
              <p className="note note--fine home-now-link">
                <a href="/live">All {formatCount(body.count)} on the live board</a>
              </p>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

