import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* Decode the PNG header rather than trusting the generator's own report. */
function pngSize(buffer: Buffer): { width: number; height: number } {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error("not a PNG");
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("no IHDR chunk");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("the share card", () => {
  it("is a 1200x630 PNG", () => {
    const png = readFileSync(join(process.cwd(), "public", "og", "number.png"));
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  });
});
