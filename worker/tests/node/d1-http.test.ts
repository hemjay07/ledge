import { describe, expect, it, vi } from "vitest";
import { D1HttpClient, D1HttpError, inlineParams, inlineSqlLiteral } from "../../host/d1-http";

const ACCOUNT_ID = "test-account";
const DATABASE_ID = "test-database";
const API_TOKEN = "fake-token-for-test";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function d1Success(results: unknown[] = [], meta: Record<string, unknown> = {}) {
  return jsonResponse({ success: true, result: [{ results, success: true, meta }] });
}

describe("inlining values for batch()", () => {
  it("quotes strings and doubles embedded single quotes", () => {
    expect(inlineSqlLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it("passes numbers and bigints through as bare literals", () => {
    expect(inlineSqlLiteral(42)).toBe("42");
    expect(inlineSqlLiteral(9007199254740993n)).toBe("9007199254740993");
  });

  it("renders null and undefined as NULL", () => {
    expect(inlineSqlLiteral(null)).toBe("NULL");
    expect(inlineSqlLiteral(undefined)).toBe("NULL");
  });

  it("refuses a value it cannot represent as a literal", () => {
    expect(() => inlineSqlLiteral({ nope: true })).toThrow(D1HttpError);
  });

  it("substitutes '?' placeholders in order", () => {
    expect(inlineParams("SELECT * FROM t WHERE a = ? AND b = ?", [1, "x"])).toBe(
      "SELECT * FROM t WHERE a = 1 AND b = 'x'",
    );
  });

  it("refuses a placeholder/param count mismatch", () => {
    expect(() => inlineParams("SELECT ? , ?", [1])).toThrow(D1HttpError);
    expect(() => inlineParams("SELECT ?", [1, 2])).toThrow(D1HttpError);
  });
});

describe("request shape", () => {
  it("posts sql and params to the documented endpoint with a bearer token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return d1Success([{ id: 1 }]);
    });
    const client = new D1HttpClient({
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiToken: API_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.prepare("SELECT * FROM t WHERE id = ?").bind(1).all();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    );
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${API_TOKEN}`);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      sql: "SELECT * FROM t WHERE id = ?",
      params: [1],
    });
  });
});

describe("mapping responses to bind/run/all/first shapes", () => {
  function clientWith(results: unknown[]) {
    const fetchImpl = vi.fn(async () => d1Success(results, { changes: 1 }));
    return new D1HttpClient({
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiToken: API_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  it("all() returns results, success and meta", async () => {
    const client = clientWith([{ a: 1 }, { a: 2 }]);
    const result = await client.prepare("SELECT * FROM t").all<{ a: number }>();
    expect(result.results).toEqual([{ a: 1 }, { a: 2 }]);
    expect(result.success).toBe(true);
    expect(result.meta).toEqual({ changes: 1 });
  });

  it("run() returns the same shape as all()", async () => {
    const client = clientWith([]);
    const result = await client.prepare("UPDATE t SET a = 1").run();
    expect(result.results).toEqual([]);
    expect(result.success).toBe(true);
  });

  it("first() returns the first row, or null when there are none", async () => {
    const withRow = clientWith([{ a: 1, b: "x" }]);
    expect(await withRow.prepare("SELECT * FROM t").first()).toEqual({ a: 1, b: "x" });

    const empty = clientWith([]);
    expect(await empty.prepare("SELECT * FROM t").first()).toBeNull();
  });

  it("first(column) returns just that column", async () => {
    const client = clientWith([{ a: 1, b: "x" }]);
    expect(await client.prepare("SELECT * FROM t").first<number>("a")).toBe(1);
  });

  it("bind() returns a fresh statement, reusable independently", async () => {
    const client = clientWith([{ a: 1 }]);
    const stmt = client.prepare("SELECT * FROM t WHERE id = ?");
    const bound1 = stmt.bind(1);
    const bound2 = stmt.bind(2);
    expect(bound1.params).toEqual([1]);
    expect(bound2.params).toEqual([2]);
    expect(stmt.params).toEqual([]);
  });

  it("raw() is not implemented and says so", () => {
    const client = clientWith([]);
    expect(() => client.prepare("SELECT 1").raw()).toThrow(/not implemented/);
  });
});

describe("retry rules", () => {
  it("retries a 5xx up to 3 times with 250/1000/2000ms backoff, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call += 1;
        if (call <= 3) return jsonResponse({}, 503);
        return d1Success([{ ok: 1 }]);
      });
      const client = new D1HttpClient({
        accountId: ACCOUNT_ID,
        databaseId: DATABASE_ID,
        apiToken: API_TOKEN,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const pending = client.prepare("SELECT 1").all();
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchImpl).toHaveBeenCalledTimes(4);

      const result = await pending;
      expect(result.results).toEqual([{ ok: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after exhausting retries on a persistent 5xx", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => jsonResponse({}, 502));
      const client = new D1HttpClient({
        accountId: ACCOUNT_ID,
        databaseId: DATABASE_ID,
        apiToken: API_TOKEN,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const pending = client.prepare("SELECT 1").all();
      const expectation = expect(pending).rejects.toBeInstanceOf(D1HttpError);
      await vi.runAllTimersAsync();
      await expectation;
      expect(fetchImpl).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a network error the same way", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error("ECONNRESET");
        return d1Success([{ ok: 1 }]);
      });
      const client = new D1HttpClient({
        accountId: ACCOUNT_ID,
        databaseId: DATABASE_ID,
        apiToken: API_TOKEN,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const pending = client.prepare("SELECT 1").all();
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.results).toEqual([{ ok: 1 }]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never retries a 4xx", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, errors: [{ message: "bad sql" }] }, 400));
    const client = new D1HttpClient({
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiToken: API_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.prepare("SELECT 1").all()).rejects.toBeInstanceOf(D1HttpError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors a 429's Retry-After header once, then gives up on a second 429", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call += 1;
        return jsonResponse({}, 429, { "retry-after": "3" });
      });
      const client = new D1HttpClient({
        accountId: ACCOUNT_ID,
        databaseId: DATABASE_ID,
        apiToken: API_TOKEN,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const pending = client.prepare("SELECT 1").all();
      const expectation = expect(pending).rejects.toBeInstanceOf(D1HttpError);
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await expectation;
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("succeeds if the retried 429 is answered on the second try", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const fetchImpl = vi.fn(async () => {
        call += 1;
        if (call === 1) return jsonResponse({}, 429, { "retry-after": "1" });
        return d1Success([{ ok: 1 }]);
      });
      const client = new D1HttpClient({
        accountId: ACCOUNT_ID,
        databaseId: DATABASE_ID,
        apiToken: API_TOKEN,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const pending = client.prepare("SELECT 1").all();
      await vi.advanceTimersByTimeAsync(1000);
      const result = await pending;
      expect(result.results).toEqual([{ ok: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("batch() request shape", () => {
  it("inlines params and joins statements with ';' into one request", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(init.body as string).sql);
      return jsonResponse({
        success: true,
        result: [
          { results: [], success: true, meta: {} },
          { results: [], success: true, meta: {} },
        ],
      });
    });
    const client = new D1HttpClient({
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiToken: API_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.batch([
      client.prepare("INSERT INTO t (a, b) VALUES (?, ?)").bind(1, "x"),
      client.prepare("DELETE FROM t WHERE a = ?").bind(2),
    ]);

    expect(calls).toEqual(["INSERT INTO t (a, b) VALUES (1, 'x');\nDELETE FROM t WHERE a = 2"]);
  });

  it("returns one result per statement, in order", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        result: [
          { results: [{ id: 1 }], success: true, meta: {} },
          { results: [], success: true, meta: { changes: 1 } },
        ],
      }),
    );
    const client = new D1HttpClient({
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiToken: API_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const results = await client.batch([
      client.prepare("SELECT * FROM t"),
      client.prepare("UPDATE t SET a = 1"),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]?.results).toEqual([{ id: 1 }]);
    expect(results[1]?.meta).toEqual({ changes: 1 });
  });

  it("an empty batch makes no request", async () => {
    const fetchImpl = vi.fn();
    const client = new D1HttpClient({
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiToken: API_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await client.batch([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates a failure of the whole batch rather than a partial result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, errors: [{ message: "UNIQUE constraint failed" }] }, 400),
    );
    const client = new D1HttpClient({
      accountId: ACCOUNT_ID,
      databaseId: DATABASE_ID,
      apiToken: API_TOKEN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.batch([client.prepare("INSERT INTO t (id) VALUES (1)"), client.prepare("INSERT INTO t (id) VALUES (1)")]),
    ).rejects.toBeInstanceOf(D1HttpError);
  });
});
