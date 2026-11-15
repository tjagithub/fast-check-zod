import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { z } from "zod";
import { type StringUnit, zodArbitrary } from "../src/index.ts";

const UNITS: StringUnit[] = ["grapheme", "grapheme-composite", "binary", "grapheme-ascii", "binary-ascii"];

describe("stringUnit", () => {
  const schemas: Record<string, z.ZodType> = {
    bounded: z.string().min(2).max(4),
    exact: z.string().length(3),
    affixes: z.string().startsWith("ab").endsWith("z").includes("q").max(9),
    lowercase: z.string().lowercase().min(1).max(6),
    keys: z.record(z.string().min(1), z.int()),
    catchall: z.object({ a: z.int() }).catchall(z.string()),
  };
  for (const unit of UNITS) {
    for (const [name, schema] of Object.entries(schemas)) {
      test(`${unit} ${name}`, () => {
        const arb = zodArbitrary(schema, { stringUnit: unit });
        fc.assert(fc.property(arb, (v) => schema.safeParse(v).success), { numRuns: 200 });
      });
    }
  }

  // zod 4.6 counts code points, so a 4-character string of astral characters is 8 UTF-16 units but still fits max(4).
  test("binary produces characters outside the BMP, measured in code points", () => {
    const strings = fc.sample(zodArbitrary(z.string().max(4), { stringUnit: "binary" }), { numRuns: 500, seed: 1 });
    expect(strings.some((s) => s.length > 4)).toBe(true);
    expect(strings.every((s) => [...s].length <= 4)).toBe(true);
  });

  test("includes is inserted between code points, never inside a surrogate pair", () => {
    const schema = z.string().includes("q").length(5);
    const strings = fc.sample(zodArbitrary(schema, { stringUnit: "binary" }), { numRuns: 300, seed: 2 });
    expect(strings.every((s) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s))).toBe(true);
  });

  test("the default stays ASCII", () => {
    const strings = fc.sample(zodArbitrary(z.string()), { numRuns: 200, seed: 1 });
    expect(strings.every((s) => /^[\x20-\x7e]*$/.test(s))).toBe(true);
  });
});

describe("overrides match copies that share a definition", () => {
  const custom = z.instanceof(URL);
  const url = fc.webUrl().map((u) => new URL(u));
  const valid = (schema: z.ZodType, overrides: [z.ZodType, fc.Arbitrary<unknown>][]) =>
    fc.assert(fc.property(zodArbitrary(schema, { overrides }), (v) => schema.safeParse(v).success));

  test(".meta() copy of an overridden schema", () => valid(z.object({ link: custom.meta({ title: "link" }) }), [[custom, url]]));
  test(".describe() copy of an overridden schema", () => valid(z.object({ link: custom.describe("link") }), [[custom, url]]));
  test("override given on the copy", () => valid(z.object({ link: custom }), [[custom.meta({ id: "x" }), url]]));

  test("a schema changed by a check does not match", () => {
    const base = z.string();
    const arb = zodArbitrary(base.min(3), { overrides: [[base, fc.constant("x")]] });
    expect(fc.sample(arb, 20).every((s) => s.length >= 3)).toBe(true);
  });
});
