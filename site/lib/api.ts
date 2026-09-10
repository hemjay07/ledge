/* The site's client for the lookup API.
   ============================================================================
   NO ARITHMETIC AND NO SENTENCES IN THIS FILE.

   The Worker renders every sentence the reader sees, in worker/src/text.ts,
   and ships them in `text` as one block of lines. This module validates the
   response against the mirrored contract and then SPLITS that block back into
   its slots by walking the lines in the order text.ts wrote them, using the
   structured body only to know which optional lines are present. Nothing is
   reworded, no rate is formatted, no percentage is derived. If a line is
   missing the slot is null and the entry prints one line fewer.

   The alternative — importing the Worker's text builder and running it over
   the response — would put a second renderer of LEDGE's sentences in the
   browser, which is the drift the whole Class A / Class B split exists to
   prevent. */

import {
  errorResponseSchema,
  liveResponseSchema,
  graveyardResponseSchema,
  tokenResponseSchema,
  type ErrorCode,
  type LiveResponse,
  type LiveSortKey,
  type GraveyardResponse,
  type GraveyardSortKey,
  type TokenResponse,
} from "./api-schema";

/* Same origin in production: /api/* is rewritten to the Worker by
   site/vercel.json. Only a dev run sets this, to point at wrangler. */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export const ADDRESS_PATTERN = /0x[0-9a-fA-F]{40}/;

/** A 20-byte address, lowercased, out of a pasted address or a pasted
    ponsfamily.com launch URL. Null when the input holds no address — the
    input is then sent as typed, so the API states the objection in its own
    words rather than the site inventing one. */
export function normaliseLookupInput(input: string): string | null {
  const match = input.trim().match(ADDRESS_PATTERN);
  return match ? match[0].toLowerCase() : null;
}

/* ---- what a lookup can come back as ------------------------------------- */

export type LookupResult =
  | { kind: "token"; body: TokenResponse }
  /* not_indexed and number_unavailable: a 200 carrying both an objection and
     a complete body. Both are rendered. */
  | { kind: "partial"; error: ErrorCode; message: string; body: TokenResponse }
  | { kind: "error"; error: ErrorCode | "unreadable"; message: string };

/** The one sentence on this surface the API did not write, for the case where
    it did not answer at all or answered something that is not its own
    contract. It states the failure and claims nothing else. */
export const UNREADABLE = "The lookup did not answer, and nothing is being estimated.";

export async function fetchToken(
  input: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<LookupResult> {
  const address = normaliseLookupInput(input) ?? input.trim();
  let payload: unknown;
  try {
    const response = await fetchImpl(`${API_BASE}/api/token/${encodeURIComponent(address)}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    payload = await response.json();
  } catch {
    return { kind: "error", error: "unreadable", message: UNREADABLE };
  }
  return readLookup(payload);
}

/** The response, classified. Exported so the render can be tested against the
    fixtures without a network. */
export function readLookup(payload: unknown): LookupResult {
  const token = tokenResponseSchema.safeParse(payload);
  if (token.success) return { kind: "token", body: token.data };

  const failure = errorResponseSchema.safeParse(payload);
  if (failure.success) {
    const partial = tokenResponseSchema.safeParse(failure.data.partial);
    if (partial.success) {
      return {
        kind: "partial",
        error: failure.data.error,
        message: failure.data.message,
        body: partial.data,
      };
    }
    return { kind: "error", error: failure.data.error, message: failure.data.message };
  }
  return { kind: "error", error: "unreadable", message: UNREADABLE };
}

/* ---- the sentences, taken back apart ------------------------------------ */

export interface LookupLines {
  /** shortened address · Pons */
  identity: string | null;
  /** pair class · creator tax · phase */
  config: string | null;
  /** the death-card line: minute N · outcome · cohort · pair · tax */
  headline: string | null;
  /** the API's objection, where it sent one inside the body */
  notice: string | null;
  /** one sentence per published window, each carrying its own n */
  cohort: string[];
  /** where the launch sits on the published table, or the API's reason */
  placement: string | null;
  /** the quote-side fill, or the note saying why there is none */
  fill: string | null;
  /** this token's own indexed curve activity: its buys and sells with the
      window they were counted over, its first buy and last activity, and the
      distinct buyers in its own launch block. Empty when the API sent no
      activity block, which is a different silence from a zero. */
  activity: string[];
  /** when the cohort figures were measured */
  stamp: string | null;
  /** the live layer's own staleness, in the API's words */
  staleNote: string | null;
  methodUrl: string | null;
}

const EMPTY: LookupLines = {
  identity: null,
  config: null,
  headline: null,
  notice: null,
  cohort: [],
  placement: null,
  fill: null,
  activity: [],
  stamp: null,
  staleNote: null,
  methodUrl: null,
};

/** worker/src/text.ts `lookupText` writes its lines in a fixed order, and
    which optional lines it wrote is decided by fields that travel in the same
    response. So the block is walked, not pattern-matched: a cohort sentence is
    whichever line stands where text.ts put it, whatever it says. */
export function splitLookupText(body: TokenResponse): LookupLines {
  const lines = body.text.split("\n");
  let i = 0;
  const next = (): string | null => (i < lines.length ? (lines[i++] as string) : null);

  const out: LookupLines = { ...EMPTY, cohort: [], activity: [] };
  out.identity = next();
  out.config = next();
  out.headline = next();
  if (body.notice !== null) out.notice = next();

  const windows = [body.cohort?.allTime ?? null, body.cohort?.h24 ?? null].filter(
    (w) => w !== null,
  );
  if (windows.length === 0) {
    /* text.ts says so in one line rather than leaving a gap */
    const none = next();
    if (none !== null) out.cohort.push(none);
  } else {
    for (const _ of windows) {
      const line = next();
      if (line !== null) out.cohort.push(line);
    }
  }

  out.placement = next();
  out.fill = next();
  /* worker/src/text.ts `activitySentences` writes exactly three lines when the
     response carries an activity block and none at all when it does not, so
     the count is read off the same field the Worker branched on rather than
     matched against the text. */
  if (body.activity !== null) {
    for (let n = 0; n < 3; n += 1) {
      const line = next();
      if (line !== null) out.activity.push(line);
    }
  }
  if (body.cohort !== null) out.stamp = next();
  if (body.live.stale) out.staleNote = next();
  out.methodUrl = next();
  return out;
}

/* ---- the live board ------------------------------------------------------ */

export type LiveResult =
  | { kind: "live"; body: LiveResponse }
  | { kind: "error"; message: string };

/** The response, classified -- exported so a render can be tested against a
    fixture without a network, the same reason readLookup is exported. A
    payload the Worker sent as an objection (bad_sort, rate_limited, ...)
    still carries its own words rather than falling through to UNREADABLE. */
export function readLive(payload: unknown): LiveResult {
  const live = liveResponseSchema.safeParse(payload);
  if (live.success) return { kind: "live", body: live.data };

  const failure = errorResponseSchema.safeParse(payload);
  if (failure.success) return { kind: "error", message: failure.data.message };

  return { kind: "error", message: UNREADABLE };
}

export async function fetchLive(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  sort?: LiveSortKey,
): Promise<LiveResult> {
  const query = sort ? `?sort=${encodeURIComponent(sort)}` : "";
  try {
    const response = await fetchImpl(`${API_BASE}/api/live${query}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    return readLive(await response.json());
  } catch {
    return { kind: "error", message: UNREADABLE };
  }
}

/* ---- the graveyard ------------------------------------------------------- */

export type GraveyardResult =
  | { kind: "graveyard"; body: GraveyardResponse }
  | { kind: "error"; message: string };

/** The response, classified -- same reason readLive is exported: a render
    can be tested against a fixture without a network, and a payload the
    Worker sent as an objection (bad_sort, ...) still carries its own words. */
export function readGraveyard(payload: unknown): GraveyardResult {
  const graveyard = graveyardResponseSchema.safeParse(payload);
  if (graveyard.success) return { kind: "graveyard", body: graveyard.data };

  const failure = errorResponseSchema.safeParse(payload);
  if (failure.success) return { kind: "error", message: failure.data.message };

  return { kind: "error", message: UNREADABLE };
}

export async function fetchGraveyard(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
  sort?: GraveyardSortKey,
): Promise<GraveyardResult> {
  const query = sort ? `?sort=${encodeURIComponent(sort)}` : "";
  try {
    const response = await fetchImpl(`${API_BASE}/api/graveyard${query}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    return readGraveyard(await response.json());
  } catch {
    return { kind: "error", message: UNREADABLE };
  }
}

/** CONSTRAINTS 2: no address is a subject on this site, and the board is a
    view of the population rather than a list of things to open. The Worker
    already strips them; this strips them again on the way to the DOM, because
    a defence that lives only on the other side of a network call is not one. */
export function stripAddresses(value: string): string {
  return value.replace(/0x[0-9a-f]{40}/gi, "");
}

export { LIVE_SORT_KEYS, GRAVEYARD_SORT_KEYS } from "./api-schema";
export type { LiveResponse, LiveSortKey, GraveyardResponse, GraveyardSortKey, TokenResponse, ErrorCode };
