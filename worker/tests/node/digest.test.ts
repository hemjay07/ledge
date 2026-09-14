import { describe, expect, it } from "vitest";
import { DIGEST_CRON, DIGEST_HOUR_UTC, digestDayKey, digestText, shouldPostDigest } from "../../src/digest";
import { fixtureNumber, NOW_SECONDS } from "./helpers";

/* BRAINSTORM-2026-09-13 §2: the room is the first push channel, and the
   digest is one message a day from number.json. The Worker formats what
   stats.py published; it computes nothing (gate 2). */
describe("the daily digest text", () => {
  const file = fixtureNumber();
  const text = digestText(file, NOW_SECONDS * 1000, "https://ledge.tools");

  it("prints the 24-hour launches and graduations with their rate and n", () => {
    expect(text).toContain(String(file.h24.launches).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
    expect(text).toContain("graduated");
    expect(text).toMatch(/n=|not enough data/);
  });

  it("carries the measurement stamp, its age, and the method page", () => {
    expect(text).toContain("Measured");
    expect(text).toContain("ago");
    expect(text).toContain("https://ledge.tools/method");
  });

  it("prints 'not enough data (n=...)' instead of a rate below the floor", () => {
    const thin = {
      ...file,
      h24: { ...file.h24, launches: 12, graduations: 1, rate: null, insufficient: true },
    };
    const t = digestText(thin, NOW_SECONDS * 1000, "https://ledge.tools");
    expect(t).toContain("not enough data (n=12)");
  });

  it("states only the facts: no emoji, no verdict", () => {
    expect(text).not.toMatch(/rug|dead|safe|predict|will (pump|moon|graduate|succeed|fail)/i);
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/[\u{1F000}-\u{1FAFF}☀-➿]/u);
  });
});

describe("the once-a-day gate", () => {
  const atHour = (hour: number, minute = 0): number =>
    Math.floor(Date.UTC(2026, 8, 13, hour, minute, 0) / 1000);

  it("names the UTC day the post belongs to", () => {
    expect(digestDayKey(atHour(DIGEST_HOUR_UTC))).toBe("2026-09-13");
  });

  it("posts at the digest hour when nothing has been posted for the day", () => {
    expect(shouldPostDigest(atHour(DIGEST_HOUR_UTC, 7), null)).toBe(true);
  });

  it("does not post outside the digest hour", () => {
    expect(shouldPostDigest(atHour(DIGEST_HOUR_UTC - 1, 59), null)).toBe(false);
    expect(shouldPostDigest(atHour(DIGEST_HOUR_UTC + 1), null)).toBe(false);
  });

  it("does not post twice on one day", () => {
    expect(shouldPostDigest(atHour(DIGEST_HOUR_UTC, 30), "2026-09-13")).toBe(false);
  });

  it("posts again the next day", () => {
    expect(shouldPostDigest(atHour(DIGEST_HOUR_UTC), "2026-09-12")).toBe(true);
  });
});

describe("the cron Cloudflare keeps", () => {
  it("fires inside the digest hour, so the gate accepts it", () => {
    const [minute, hour] = DIGEST_CRON.split(" ");
    expect(Number(hour)).toBe(DIGEST_HOUR_UTC);
    expect(Number(minute)).toBeGreaterThanOrEqual(0);
    expect(Number(minute)).toBeLessThan(60);
  });
});
