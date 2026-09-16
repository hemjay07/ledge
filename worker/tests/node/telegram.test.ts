import { describe, expect, it } from "vitest";
import { classify, HELP_TEXT, UNKNOWN_DM_TEXT } from "../../src/telegram";

const dm = { chat: { id: 1, type: "private" } };
const group = { chat: { id: -1, type: "supergroup" } };

describe("what the bot understands", () => {
  it("answers /number when addressed in a direct message", () => {
    expect(classify({ ...dm, text: "/number" }, "ledgebot")).toEqual({ kind: "number" });
  });

  it("answers a bare address anywhere", () => {
    const address = "0x23FE54B3BF9E1D2816822043C0B02B6A12F98FE2";
    expect(classify({ ...group, text: `  ${address} ` }, "ledgebot")).toEqual({
      kind: "lookup",
      address: address.toLowerCase(),
    });
  });

  it("is silent in a group unless addressed", () => {
    expect(classify({ ...group, text: "/number" }, "ledgebot")).toEqual({ kind: "silence" });
    expect(classify({ ...group, text: "what do you think of this coin" }, "ledgebot")).toEqual({
      kind: "silence",
    });
  });

  it("tells a direct message its own chat id, and never a group", () => {
    expect(classify({ ...dm, text: "/id" }, "ledgebot")).toEqual({ kind: "id" });
    expect(classify({ ...group, text: "/id@ledgebot" }, "ledgebot")).toEqual({ kind: "silence" });
  });

  it("answers /number@ledgebot in a group", () => {
    expect(classify({ ...group, text: "/number@ledgebot" }, "ledgebot")).toEqual({ kind: "number" });
  });

  it("names the two things it understands, once, in a direct message", () => {
    expect(classify({ ...dm, text: "hello" }, "ledgebot")).toEqual({ kind: "unknown_dm" });
    expect(UNKNOWN_DM_TEXT).toBe("Send /number, or a token address.");
  });

  it("has nothing to say to an empty message", () => {
    expect(classify({ ...dm, text: "   " }, "ledgebot")).toEqual({ kind: "silence" });
    expect(classify(dm, "ledgebot")).toEqual({ kind: "silence" });
  });

  it("refuses an address that is not 20 bytes", () => {
    expect(classify({ ...dm, text: "0x1234" }, "ledgebot")).toEqual({ kind: "unknown_dm" });
  });
});

describe("what the bot says about itself", () => {
  const help = HELP_TEXT("https://ledge.tools");

  it("states what is measured and links the method, and sells nothing", () => {
    expect(help).toContain("how many graduate, how fast, and what happens after"); // reworded 2026-09-14
    expect(help).toContain("https://ledge.tools/method");
    expect(help).not.toMatch(/coming soon|premium|subscribe|join/i);
  });

  it("tells no one what to do with a number", () => {
    expect(help).not.toMatch(/you should|avoid|safe|check before/i);
  });
});

/* 2026-09-14 (the bot assessment): the bot is @ledgetools_bot, and the
   webhook classified with a name that did not exist, so a group could never
   address it. Help must describe the product as it is now, and a send must
   report whether Telegram accepted it, so nothing is recorded as posted that
   was never delivered. */
import { BOT_USERNAME, sendMessage } from "../../src/telegram";

describe("the bot's own name", () => {
  it("is the username BotFather issued", () => {
    expect(BOT_USERNAME).toBe("ledgetools_bot");
    expect(classify({ ...group, text: `/number@${BOT_USERNAME}` }, BOT_USERNAME)).toEqual({ kind: "number" });
  });
});

describe("what help says now", () => {
  const help = HELP_TEXT("https://ledge.tools");
  it("names the three things published, not one", () => {
    expect(help).not.toMatch(/one thing/i);
    expect(help).toMatch(/how fast/i);
    expect(help).toMatch(/what happens after/i);
    expect(help).toContain("how many it was counted from");
  });
});

describe("sending", () => {
  const env = { TELEGRAM_BOT_TOKEN: "t" } as unknown as import("../../src/env").Env;
  it("reports true when Telegram accepts the message", async () => {
    const fetchFake = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    expect(await sendMessage(env, 1, "hi", fetchFake)).toBe(true);
  });
  it("reports false when Telegram refuses it, and never throws", async () => {
    const fetchFake = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    expect(await sendMessage(env, 1, "hi", fetchFake)).toBe(false);
    const fetchDown = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    expect(await sendMessage(env, 1, "hi", fetchDown)).toBe(false);
  });
});
