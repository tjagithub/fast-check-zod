// Fuzzes the generator: random satisfiable schemas must only ever produce values that safeParse accepts.
import { expect, test } from "bun:test";
import fc from "fast-check";
import { type StringUnit, zodArbitrary } from "../src/index.ts";
import { schema } from "./support/composites.ts";

const RUNS = Number(process.env.FUZZ_RUNS ?? 300);
const unit = fc.constantFrom<StringUnit>("grapheme-ascii", "grapheme", "binary");

test("every random schema yields only valid values", () => {
  fc.assert(
    fc.property(schema, unit, fc.integer(), ({ schema, code }, stringUnit, seed) => {
      const values = fc.sample(zodArbitrary(schema, { stringUnit }), { numRuns: 20, seed });
      for (const v of values) {
        const result = schema.safeParse(v);
        if (!result.success) throw new Error(`${code} (${stringUnit}) generated ${fc.stringify(v)}\n${result.error.message}`);
      }
    }),
    { numRuns: RUNS },
  );
});

test("the schema arbitrary covers composites and leaves", () => {
  const codes = fc.sample(schema, { numRuns: 300, seed: 7 }).map((x) => x.code);
  for (const part of ["z.array(", "z.object(", "z.union(", "z.discriminatedUnion(", "z.intersection(", "z.record(", "z.preprocess("]) {
    expect(codes.some((c) => c.includes(part))).toBe(true);
  }
});
