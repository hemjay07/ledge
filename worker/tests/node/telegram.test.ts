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

  it("answers /number@ledgebot in a group", () => {
    expect(classify({ ...group, text: "/number@ledgebot" }, "ledgebot")).toEqual({ kind: "number" });
  });

  it("names the two things it understands, once, in a direct message", () => {
    expect(classify({ ...dm, text: "hello" }, "ledgebot")).toEqual({ kind: "unknown_dm" });
    expect(UNKNOWN_DM_TEXT).toBe("Two things: /number, or a 20-byte address.");
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
    expect(help).toContain("how many Pons launches graduate");
    expect(help).toContain("https://ledge.tools/method");
    expect(help).not.toMatch(/coming soon|premium|subscribe|join/i);
  });

  it("tells no one what to do with a number", () => {
    expect(help).not.toMatch(/you should|avoid|safe|check before/i);
  });
});
