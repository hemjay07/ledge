/* The router.

   CORS is open, GET and OPTIONS only. CONSTRAINTS 8 makes the data public and
   ungated; locking it to one origin would be an access control on a public
   instrument. Nothing here requires a wallet, an email or an account. */

import type { Env } from "./env";
import { tick } from "./tick";
import { lookupToken } from "./service";
import { renderCard } from "./og";
import { tokenShell } from "./html";
import { headline } from "./text";
import { numberText } from "./text";
import {
  tokenResponseSchema,
  liveResponseSchema,
  graveyardResponseSchema,
  SCHEMA_VERSION,
  type ErrorCode,
} from "./schema";
import { loadNumber, loadPairTokens, KV_NUMBER } from "./numberFile";
import { liveStale, type CursorRow } from "./lookup";
import {
  BOARD_QUERY,
  BOARD_SORT_KEYS,
  buildBoardRows,
  isBoardSortKey,
  pairTokenMapFromRows,
  type BoardDbRow,
} from "./board";

/** Every row of the live pair-token cache, read once per request alongside
    the board/graveyard queries -- never once per row (worker/schema.sql's
    `pair_token` table comment, worker/src/board.ts's pairUnits). */
const PAIR_TOKEN_QUERY = "SELECT address, decimals, symbol FROM pair_token";
interface PairTokenDbRow {
  address: string;
  decimals: number | null;
  symbol: string | null;
}
import {
  GRAVEYARD_QUERY,
  GRAVEYARD_SCOPE_QUERY,
  GRAVEYARD_SORT_KEYS,
  buildGraveyardRows,
  buildGraveyardScope,
  isGraveyardSortKey,
  type GraveyardDbRow,
  type GraveyardScopeDbRow,
} from "./graveyard";
import { ageSeconds, formatAge, normaliseAddress, toIso } from "./format";
import {
  classify,
  sendMessage,
  withinLimits,
  HELP_TEXT,
  UNKNOWN_DM_TEXT,
  type TgUpdate,
} from "./telegram";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200, cache = "no-store"): Response {
  return new Response(JSON.stringify(body, null, status === 200 ? 0 : 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache, ...CORS },
  });
}

function apiError(
  error: ErrorCode,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return json({ schemaVersion: SCHEMA_VERSION, error, message, ...extra }, status);
}

const NOT_A_PONS_TOKEN = (factory: string) =>
  apiError(
    "not_a_pons_token",
    `This address was not launched by the Pons factory ${factory}.`,
    404,
    { factory },
  );

const RPC_DOWN = () =>
  apiError("rpc_down", "The chain RPC did not answer. Nothing is being estimated.", 503, {
    retryAfterSeconds: 30,
  });

/* ---- /api/token/{address} ----------------------------------------------- */

async function handleToken(env: Env, address: string, nowMs: number): Promise<Response> {
  const outcome = await lookupToken(env, address, nowMs);
  if (outcome.kind === "not_a_pons_token") return NOT_A_PONS_TOKEN(env.FACTORY_ADDRESS);
  if (outcome.kind === "rpc_down") return RPC_DOWN();

  const payload = { ...outcome.body, text: outcome.text };
  const parsed = tokenResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("response failed its own schema", JSON.stringify(parsed.error.issues));
    return apiError(
      "not_found",
      "The response did not satisfy the published contract and was withheld.",
      500,
    );
  }

  const cache = "public, max-age=15, stale-while-revalidate=60";

  /* not_indexed and number_unavailable are 200s carrying a partial, because
     the chain still answered and the cohort still applies. Degrading to an
     error would throw away four correct facts to punish one missing one. */
  if (outcome.kind === "not_indexed") {
    return json(
      {
        schemaVersion: SCHEMA_VERSION,
        error: "not_indexed",
        message:
          "Launched more than 7 days ago, or LEDGE has not reached this block yet.",
        lastIndexedBlock: outcome.lastIndexedBlock,
        partial: payload,
      },
      200,
      cache,
    );
  }
  if (outcome.kind === "number_unavailable") {
    return json(
      {
        schemaVersion: SCHEMA_VERSION,
        error: "number_unavailable",
        message: "Cohort figures are not loadable. Live state is shown alone.",
        partial: payload,
      },
      200,
      cache,
    );
  }
  return json(payload, 200, cache);
}

/* ---- /api/live ------------------------------------------------------------

   The discovery board (REPOSITION.md Phase B1): one row per token with
   indexed curve activity. Every figure comes from D1 -- worker/src/board.ts
   carries the full reasoning for why the curve itself is never read here --
   so this handler costs the same two D1 reads regardless of how many tokens
   are on the board. */

async function handleLive(env: Env, nowMs: number, url: URL): Promise<Response> {
  const nowSeconds = Math.floor(nowMs / 1000);

  const sortParam = url.searchParams.get("sort") ?? "lastActivity";
  if (!isBoardSortKey(sortParam)) {
    return apiError(
      "bad_sort",
      `Unknown sort key "${sortParam}". Use one of ${BOARD_SORT_KEYS.join(", ")}.`,
      400,
    );
  }

  /* The pair-token map, for units only: it is already in KV and already read
     once a minute by the tick, and it lets a row say "4.2 ETH" instead of
     4200000000000000000. No decimals() call per row -- 121 rows could never
     afford one, and decimals.ts forbids guessing the exponent. */
  const [[rowsResult, cursorResult, pairTokenResult], pairTokens] = await Promise.all([
    env.LEDGE_DB.batch([
    env.LEDGE_DB.prepare(BOARD_QUERY),
    env.LEDGE_DB.prepare(
      "SELECT last_indexed_block, last_success_at, consecutive_failures FROM cursor WHERE id = 1",
    ),
    env.LEDGE_DB.prepare(PAIR_TOKEN_QUERY),
    ]),
    loadPairTokens(env, nowMs),
  ]);
  const cursor = (cursorResult?.results[0] as CursorRow | undefined) ?? null;
  const dbRows = (rowsResult?.results ?? []) as unknown as BoardDbRow[];
  const dbPairTokens = pairTokenMapFromRows((pairTokenResult?.results ?? []) as unknown as PairTokenDbRow[]);
  const rows = buildBoardRows(dbRows, cursor, nowSeconds, sortParam, 200, pairTokens, dbPairTokens);

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    observedAt: toIso(nowSeconds),
    lastIndexedBlock: cursor ? cursor.last_indexed_block : null,
    sortedBy: sortParam,
    count: rows.length,
    rows,
    live: {
      stale: liveStale(cursor, nowSeconds),
      lastSuccessAt: cursor ? toIso(cursor.last_success_at) : null,
      lastIndexedBlock: cursor ? cursor.last_indexed_block : null,
    },
  };
  const parsed = liveResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("live response failed its own schema", JSON.stringify(parsed.error.issues));
    return apiError("not_found", "The response did not satisfy the published contract.", 500);
  }
  return json(payload, 200, "public, max-age=15, stale-while-revalidate=45");
}

/* ---- /api/graveyard --------------------------------------------------------

   Launches LEDGE has indexed that took zero buys, at least 72 hours after
   their own launch block (worker/src/graveyard.ts carries the full reasoning,
   including why `scope` is not optional: a launch older than the activity
   index has no row and is not counted, and the reader is owed that in the
   payload, not only in a comment). Same cost profile as /api/live: D1 only,
   no chain read regardless of row count. */

async function handleGraveyard(env: Env, nowMs: number, url: URL): Promise<Response> {
  const nowSeconds = Math.floor(nowMs / 1000);

  const sortParam = url.searchParams.get("sort") ?? "age";
  if (!isGraveyardSortKey(sortParam)) {
    return apiError(
      "bad_sort",
      `Unknown sort key "${sortParam}". Use one of ${GRAVEYARD_SORT_KEYS.join(", ")}.`,
      400,
    );
  }

  const [[rowsResult, scopeResult, cursorResult, pairTokenResult], pairTokens] = await Promise.all([
    env.LEDGE_DB.batch([
      env.LEDGE_DB.prepare(GRAVEYARD_QUERY),
      env.LEDGE_DB.prepare(GRAVEYARD_SCOPE_QUERY),
      env.LEDGE_DB.prepare(
        "SELECT last_indexed_block, last_success_at, consecutive_failures FROM cursor WHERE id = 1",
      ),
      env.LEDGE_DB.prepare(PAIR_TOKEN_QUERY),
    ]),
    loadPairTokens(env, nowMs),
  ]);
  const cursor = (cursorResult?.results[0] as CursorRow | undefined) ?? null;
  const dbRows = (rowsResult?.results ?? []) as unknown as GraveyardDbRow[];
  const scopeRow = (scopeResult?.results[0] as GraveyardScopeDbRow | undefined) ?? null;
  const dbPairTokens = pairTokenMapFromRows((pairTokenResult?.results ?? []) as unknown as PairTokenDbRow[]);
  const rows = buildGraveyardRows(dbRows, cursor, nowSeconds, sortParam, 200, pairTokens, dbPairTokens);
  const scope = buildGraveyardScope(scopeRow);

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    observedAt: toIso(nowSeconds),
    lastIndexedBlock: cursor ? cursor.last_indexed_block : null,
    sortedBy: sortParam,
    count: rows.length,
    rows,
    scope,
    live: {
      stale: liveStale(cursor, nowSeconds),
      lastSuccessAt: cursor ? toIso(cursor.last_success_at) : null,
      lastIndexedBlock: cursor ? cursor.last_indexed_block : null,
    },
  };
  const parsed = graveyardResponseSchema.safeParse(payload);
  if (!parsed.success) {
    console.error("graveyard response failed its own schema", JSON.stringify(parsed.error.issues));
    return apiError("not_found", "The response did not satisfy the published contract.", 500);
  }
  return json(payload, 200, "public, max-age=15, stale-while-revalidate=45");
}

/* ---- /api/number, /api/health ------------------------------------------- */

async function handleNumber(env: Env): Promise<Response> {
  const raw = await env.LEDGE_KV.get(KV_NUMBER, "text");
  if (raw) {
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        ...CORS,
      },
    });
  }
  const file = await loadNumber(env);
  if (!file) {
    return apiError("number_unavailable", "The published reading is not loadable.", 503);
  }
  return json(file, 200, "public, max-age=300");
}

async function handleHealth(env: Env, nowMs: number): Promise<Response> {
  const cursor = await env.LEDGE_DB.prepare(
    "SELECT last_indexed_block, last_success_at, consecutive_failures, last_error FROM cursor WHERE id = 1",
  ).first<CursorRow & { last_error: string | null }>();
  const file = await loadNumber(env, nowMs);
  /* Curve logs the index could not place: their curve belongs to a launch
     older than the record, or to one that has been evicted. Published rather
     than swallowed, so the size of what the index cannot see is readable. */
  const unattributed = await env.LEDGE_DB.prepare(
    "SELECT logs, last_seen_at FROM activity_unattributed WHERE id = 1",
  ).first<{ logs: number; last_seen_at: number | null }>();
  return json(
    {
      schemaVersion: SCHEMA_VERSION,
      lastIndexedBlock: cursor?.last_indexed_block ?? null,
      unattributedCurveLogs: unattributed?.logs ?? 0,
      lastSuccessAt: cursor ? toIso(cursor.last_success_at) : null,
      consecutiveFailures: cursor?.consecutive_failures ?? null,
      lastError: cursor?.last_error ?? null,
      numberCrawledAt: file?.crawledAt ?? null,
    },
    200,
  );
}

/* ---- /t/{address} and its card ------------------------------------------ */

async function handleShell(env: Env, address: string, nowMs: number): Promise<Response> {
  const outcome = await lookupToken(env, address, nowMs);
  if (outcome.kind === "not_a_pons_token") {
    return new Response("This address was not launched by the Pons factory.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
    });
  }
  if (outcome.kind === "rpc_down") {
    return new Response("The chain RPC did not answer. Nothing is being estimated.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30", ...CORS },
    });
  }
  const title = headline(outcome.body, outcome.observedMaxSeconds);
  return new Response(
    tokenShell(outcome.body, outcome.text, title, env.SITE_ORIGIN, outcome.observedMaxSeconds),
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=60",
        ...CORS,
      },
    },
  );
}

async function handleCard(env: Env, address: string, nowMs: number): Promise<Response> {
  const outcome = await lookupToken(env, address, nowMs);
  if (outcome.kind === "not_a_pons_token") return new Response("not found", { status: 404 });
  if (outcome.kind === "rpc_down") return new Response("upstream", { status: 503 });
  const png = await renderCard(outcome.body, outcome.observedMaxSeconds);
  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=300",
      ...CORS,
    },
  });
}

/* ---- Telegram ----------------------------------------------------------- */

async function handleTelegram(env: Env, request: Request, secret: string, nowMs: number): Promise<Response> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("not found", { status: 404 });
  }
  if (
    env.TELEGRAM_HEADER_SECRET &&
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_HEADER_SECRET
  ) {
    return new Response("not found", { status: 404 });
  }

  const update = (await request.json().catch(() => ({}))) as TgUpdate;
  // Never reply to an edited message.
  const message = update.message ?? update.channel_post;
  if (!message) return new Response("ok");

  const intent = classify(message, "ledgebot");
  if (intent.kind === "silence") return new Response("ok");

  const chatId = String(message.chat.id);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (!(await withinLimits(env.LEDGE_DB, chatId, nowSeconds))) return new Response("ok");

  let reply: string;
  if (intent.kind === "help") {
    reply = HELP_TEXT(env.SITE_ORIGIN);
  } else if (intent.kind === "method") {
    reply = `${env.SITE_ORIGIN}/method`;
  } else if (intent.kind === "unknown_dm") {
    reply = UNKNOWN_DM_TEXT;
  } else if (intent.kind === "number") {
    const file = await loadNumber(env, nowMs);
    reply = file
      ? numberText(
          file.h24,
          file.crawledAt,
          formatAge(ageSeconds(file.crawledAt, nowMs)),
          `${env.SITE_ORIGIN}/method`,
        )
      : "The published reading is not loadable right now. Nothing is being estimated.";
  } else {
    const outcome = await lookupToken(env, intent.address, nowMs);
    reply =
      outcome.kind === "not_a_pons_token"
        ? `That address was not launched by the Pons factory ${env.FACTORY_ADDRESS}.`
        : outcome.kind === "rpc_down"
          ? "The chain RPC did not answer. Nothing is being estimated."
          : outcome.text;
  }

  await sendMessage(env, message.chat.id, reply);
  return new Response("ok");
}

/* ---- the router --------------------------------------------------------- */

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const nowMs = Date.now();

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const tg = path.match(/^\/tg\/([^/]+)$/);
    if (tg && request.method === "POST") {
      return handleTelegram(env, request, tg[1] as string, nowMs);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: CORS });
    }

    if (path === "/api/live") return handleLive(env, nowMs, url);
    if (path === "/api/graveyard") return handleGraveyard(env, nowMs, url);
    if (path === "/api/number") return handleNumber(env);
    if (path === "/api/health") return handleHealth(env, nowMs);

    const token = path.match(/^\/api\/token\/(.+)$/);
    if (token) {
      const address = normaliseAddress(decodeURIComponent(token[1] as string));
      if (!address) return apiError("bad_address", "Not a 20-byte hex address.", 400);
      return handleToken(env, address, nowMs);
    }

    // The shell's own lookup form (worker/src/html.ts topBar) posts here as a
    // plain GET, so it works with no client script: a bare address, or one
    // inside a pasted ponsfamily.com launch URL, redirects straight to that
    // token's own page. Same address-anywhere-in-the-string match and the
    // same objection wording site/components/TopBar.tsx uses, so a reader
    // gets one answer whether JavaScript ran or not.
    if (path === "/t") {
      const raw = url.searchParams.get("address") ?? "";
      const found = raw.match(/0x[0-9a-fA-F]{40}/);
      if (!found) {
        return new Response("That is not a 20-byte address.", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
        });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: `/t/${found[0].toLowerCase()}`, ...CORS },
      });
    }

    // /og/t/{address}.png is the unfurled card; /t/{address}/og.png is the
    // same image under the shell's own path, so a reader guessing either
    // lands on it.
    const card =
      path.match(/^\/og\/t\/(0x[0-9a-fA-F]{40})\.png$/) ??
      path.match(/^\/t\/(0x[0-9a-fA-F]{40})\/og\.png$/);
    if (card) {
      const address = normaliseAddress(card[1] as string);
      if (!address) return new Response("not found", { status: 404 });
      return handleCard(env, address, nowMs);
    }

    const shell = path.match(/^\/t\/([^/]+)\/?$/);
    if (shell) {
      const address = normaliseAddress(decodeURIComponent(shell[1] as string));
      if (!address) {
        return new Response("Not a 20-byte hex address.", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
        });
      }
      return handleShell(env, address, nowMs);
    }

    return apiError("not_found", "No such route.", 404);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env).then((result) => {
        if (!result.ok) console.error("tick failed", JSON.stringify(result));
      }),
    );
  },
};
