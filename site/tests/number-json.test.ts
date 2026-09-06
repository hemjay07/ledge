import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* SPEC 8: the published endpoint equals the committed measurement,
   byte for byte. */
describe("/number.json", () => {
  it("is byte-identical to data/number.json", () => {
    const source = readFileSync(join(process.cwd(), "..", "data", "number.json"));
    const published = readFileSync(join(process.cwd(), "public", "number.json"));
    expect(published.equals(source)).toBe(true);
  });

  it("parses as the same object", () => {
    const source = JSON.parse(
      readFileSync(join(process.cwd(), "..", "data", "number.json"), "utf8"),
    );
    const published = JSON.parse(
      readFileSync(join(process.cwd(), "public", "number.json"), "utf8"),
    );
    expect(published).toEqual(source);
  });
});
