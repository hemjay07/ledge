/* D1 over Cloudflare's HTTP API, for a plain Node host.

   The tick (worker/src/tick.ts and everything it imports -- activity.ts,
   graveyard.ts, reserve.ts, telegram.ts) uses exactly this subset of the
   D1Database interface: `prepare(sql)` returning a statement with
   `bind(...args)`, `run()`, `all<T>()`, `first<T>(col?)`, and `db.batch(...)`.
   `raw()` is part of the D1PreparedStatement surface but is never called by
   the tick's own code (grepped: no `.raw(` anywhere in worker/src) -- it is
   implemented here only so a caller that reaches for it fails loudly rather
   than silently, never used in production.

   Endpoint: POST https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/query
   Body: { sql, params }. A normal (non-batch) call sends one statement with
   its bound params as `?` placeholders, exactly as documented. `batch()` is
   different -- see the comment above its implementation for why and how,
   backed by an empirical probe against the real database (see
   worker/host/PROGRESS or the implementation report for the exact requests
   and results). */

const D1_API_BASE = "https://api.cloudflare.com/client/v4";

/** 5xx and network errors get up to 3 retries at this backoff. A 429 is
    handled separately (Retry-After, honored once). 4xx is never retried. */
const RETRY_BACKOFFS_MS = [250, 1000, 2000];

export type Sleeper = (ms: number) => Promise<void>;
const realSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Injectable so tests never touch the network or real time. Matches the
    shape of the global `fetch`. */
export type FetchLike = typeof fetch;

export class D1HttpError extends Error {}

interface D1QueryResult<T = unknown> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1RawResponse {
  success: boolean;
  result?: Array<{
    results?: unknown[];
    success?: boolean;
    meta?: Record<string, unknown>;
  }>;
  errors?: Array<{ code?: number; message?: string }>;
}

/** A single-quoted SQLite literal, or the bare literal for numbers/NULL.
    Only used by batch(), where a shared HTTP request cannot carry one bound
    parameter list per statement -- see the comment on batch() below. Never
    used for the normal prepare/bind path, which sends real bound params. */
export function inlineSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new D1HttpError(`cannot inline non-finite number ${value} into a batch statement`);
    }
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new D1HttpError(`cannot inline a value of type ${typeof value} into a batch statement`);
}

/** Substitutes `?` placeholders in `sql`, in order, with inlined literals.
    Used only by batch(). Throws if the placeholder count does not match the
    param count -- a mismatch here means a miscounted statement, not a value
    worth guessing at. */
export function inlineParams(sql: string, params: unknown[]): string {
  let i = 0;
  const out = sql.replace(/\?/g, () => {
    if (i >= params.length) {
      throw new D1HttpError(`sql has more '?' placeholders than bound params: ${sql}`);
    }
    return inlineSqlLiteral(params[i++]);
  });
  if (i !== params.length) {
    throw new D1HttpError(`sql has fewer '?' placeholders than bound params: ${sql}`);
  }
  return out;
}

/** A bound statement. `prepare()` returns one with no params; `bind()`
    returns a new one carrying them -- D1 statements are immutable, so a
    prepared statement can be bound more than once without the calls
    interfering with each other. */
export class D1HttpStatement {
  constructor(
    private readonly client: D1HttpClient,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...args: unknown[]): D1HttpStatement {
    return new D1HttpStatement(this.client, this.sql, args);
  }

  async run<T = unknown>(): Promise<D1QueryResult<T>> {
    return this.client.executeOne<T>(this.sql, this.params);
  }

  async all<T = unknown>(): Promise<D1QueryResult<T>> {
    return this.client.executeOne<T>(this.sql, this.params);
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const result = await this.client.executeOne<Record<string, unknown>>(this.sql, this.params);
    const row = result.results[0];
    if (row === undefined) return null;
    if (column !== undefined) return (row[column] as T | undefined) ?? null;
    return row as unknown as T;
  }

  raw<T = unknown>(): T[] {
    throw new D1HttpError("D1HttpStatement.raw() is not implemented: the tick never calls it");
  }
}

export interface D1HttpClientOptions {
  accountId: string;
  databaseId: string;
  apiToken: string;
  fetchImpl?: FetchLike;
  sleep?: Sleeper;
}

export class D1HttpClient {
  private readonly accountId: string;
  private readonly databaseId: string;
  private readonly apiToken: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleeper;

  constructor(options: D1HttpClientOptions) {
    this.accountId = options.accountId;
    this.databaseId = options.databaseId;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? realSleep;
  }

  prepare(sql: string): D1HttpStatement {
    return new D1HttpStatement(this, sql);
  }

  /** One statement, real bound params, exactly the documented shape. */
  async executeOne<T = unknown>(sql: string, params: unknown[]): Promise<D1QueryResult<T>> {
    const raw = await this.send(sql, params);
    const first = raw.result?.[0];
    return {
      results: (first?.results ?? []) as T[],
      success: first?.success ?? raw.success,
      meta: first?.meta ?? {},
    };
  }

  /* ATOMICITY -- verified against the real remote D1 database ("ledge",
     database id ef285d4f-4b56-4771-9d5b-c73ef1df7809) on 2026-09-12 via
     `wrangler d1 execute ledge --remote`, which drives the same
     /accounts/{account}/d1/database/{database}/query endpoint this client
     calls (confirmed by the error response naming that exact path).

     Probe, exact commands and exact results:

       1. CREATE TABLE _shim_probe_1789193890 (id INTEGER PRIMARY KEY, val TEXT)
          -> { "success": true, "meta": { "rows_written": 2, ... } }

       2. One request, three statements, semicolon-joined, the third a
          deliberate PRIMARY KEY collision:
            INSERT INTO _shim_probe_1789193890 (id, val) VALUES (1,'a');
            INSERT INTO _shim_probe_1789193890 (id, val) VALUES (2,'b');
            INSERT INTO _shim_probe_1789193890 (id, val) VALUES (2,'c')
          -> the whole request failed:
             { "error": { "code": 7500, "notes": [{ "text":
               "UNIQUE constraint failed: _shim_probe_1789193890.id: ...
                SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_PRIMARYKEY)" }] } }

       3. SELECT * FROM _shim_probe_1789193890 ORDER BY id
          -> { "results": [], "success": true, ... }
          The two statements that would have succeeded on their own (id=1,
          id=2) are ABSENT. The single HTTP request is atomic: nothing from
          a failed multi-statement request is applied, without needing an
          explicit BEGIN/COMMIT.

       4. DROP TABLE _shim_probe_1789193890 -> { "success": true }, cleanup
          done.

     Conclusion: implement batch() by inlining every statement's params into
     its own SQL text (see inlineParams above -- the /query endpoint takes
     one `sql` string and one `params` array, which cannot address N
     statements' worth of placeholders unambiguously) and joining them with
     ';' into a single request. One request, one transaction, matching the
     tick's requirement that a fold never partially applies (worker/src/tick.ts's
     own comment: "folding a block twice counts every trade in it twice"). */
  async batch<T = unknown>(statements: D1HttpStatement[]): Promise<D1QueryResult<T>[]> {
    if (statements.length === 0) return [];
    const combinedSql = statements.map((s) => inlineParams(s.sql, s.params)).join(";\n");
    const raw = await this.send(combinedSql, []);
    const parts = raw.result ?? [];
    if (parts.length !== statements.length) {
      throw new D1HttpError(
        `d1-http: batch of ${statements.length} statements returned ${parts.length} results`,
      );
    }
    return parts.map((part) => ({
      results: (part.results ?? []) as T[],
      success: part.success ?? raw.success,
      meta: part.meta ?? {},
    }));
  }

  private url(): string {
    return `${D1_API_BASE}/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;
  }

  private async send(sql: string, params: unknown[]): Promise<D1RawResponse> {
    let usedRetryAfter = false;
    for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.url(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiToken}`,
          },
          body: JSON.stringify({ sql, params }),
        });
      } catch (error) {
        if (attempt === RETRY_BACKOFFS_MS.length) {
          throw new D1HttpError(
            `d1-http: network error after ${attempt + 1} attempts: ${String(error)}`,
          );
        }
        await this.sleep(RETRY_BACKOFFS_MS[attempt] as number);
        continue;
      }

      if (response.status === 429) {
        if (usedRetryAfter) {
          throw new D1HttpError("d1-http: rate limited again after honoring Retry-After once");
        }
        usedRetryAfter = true;
        const retryAfter = response.headers.get("retry-after");
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : (RETRY_BACKOFFS_MS[0] as number);
        await this.sleep(Number.isFinite(waitMs) && waitMs > 0 ? waitMs : (RETRY_BACKOFFS_MS[0] as number));
        continue;
      }

      if (response.status >= 500 && response.status < 600) {
        if (attempt === RETRY_BACKOFFS_MS.length) {
          throw new D1HttpError(`d1-http: HTTP ${response.status} after ${attempt + 1} attempts`);
        }
        await this.sleep(RETRY_BACKOFFS_MS[attempt] as number);
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new D1HttpError(`d1-http: HTTP ${response.status}: ${text.slice(0, 500)}`);
      }

      const body = (await response.json()) as D1RawResponse;
      if (!body.success) {
        throw new D1HttpError(`d1-http: query failed: ${JSON.stringify(body.errors ?? []).slice(0, 500)}`);
      }
      return body;
    }
    throw new D1HttpError("d1-http: gave up after repeated transport faults");
  }
}
