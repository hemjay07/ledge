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
import { tokenResponseSchema, liveResponseSchema, SCHEMA_VERSION, type ErrorCode } from "./schema";
import { loadNumber, KV_NUMBER } from "./numberFile";
import { taxBucketOf } from "./buckets";
import { liveStale, type CursorRow } from "./lookup";
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

/* ---- /api/live ---------------------------------------------------------- */

interface LiveRow {
  pair_class: string;
  creator_tax_bps: number | null;
  ts: number;
  graduated: number;
}

/** The board is a view of the population, not a list of things to click:
    no addresses and no tickers, stripped here rather than in the client. */
async function handleLive(env: Env, nowMs: number): Promise<Response> {
  const nowSeconds = Math.floor(nowMs / 1000);
  const [rowsResult, cursorResult] = await env.LEDGE_DB.batch([
    env.LEDGE_DB.prepare(
      /* EXISTS, not a join: a token may hold more than one graduation row
         while a reorg is being reconciled, and a join would then print one
         launch twice on the board. */
      `SELECT l.pair_class, l.creator_tax_bps, l.ts,
              EXISTS (SELECT 1 FROM graduation g WHERE g.token = l.token) AS graduated
         FROM launch l
        ORDER BY l.block DESC LIMIT 200`,
    ),
    env.LEDGE_DB.prepare(
      "SELECT last_indexed_block, last_success_at, consecutive_failures FROM cursor WHERE id = 1",
    ),
  ]);
  const cursor = (cursorResult?.results[0] as CursorRow | undefined) ?? null;
  const rows = ((rowsResult?.results ?? []) as unknown as LiveRow[]).map((row) => ({
    pairClass: row.pair_class,
    taxBucket: taxBucketOf(row.creator_tax_bps),
    ageSeconds: Math.max(0, nowSeconds - row.ts),
    graduated: row.graduated === 1,
  }));

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    observedAt: toIso(nowSeconds),
    lastIndexedBlock: cursor ? cursor.last_indexed_block : null,
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
  return new Response(tokenShell(outcome.body, outcome.text, title, env.SITE_ORIGIN), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ...CORS,
    },
  });
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

    if (path === "/api/live") return handleLive(env, nowMs);
    if (path === "/api/number") return handleNumber(env);
    if (path === "/api/health") return handleHealth(env, nowMs);

    const token = path.match(/^\/api\/token\/(.+)$/);
    if (token) {
      const address = normaliseAddress(decodeURIComponent(token[1] as string));
      if (!address) return apiError("bad_address", "Not a 20-byte hex address.", 400);
      return handleToken(env, address, nowMs);
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
