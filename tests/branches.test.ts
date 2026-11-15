// Branch coverage: each case takes a side of a condition the main suites leave unexercised.
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { z } from "zod";
import { Capped, Depth } from "../src/depth.ts";
import { zodArbitrary } from "../src/index.ts";

const valid: Record<string, z.ZodType> = {
  stackedGt: z.number().gt(1).gt(3).gte(3).gt(0),
  stackedLt: z.number().lt(9).lt(5).lte(5).lt(10),
  minBelowFormat: z.uint32().min(-5),
  minAtFormatInclusive: z.uint32().min(0),
  minAtFormatExclusive: z.uint32().gt(0),
  maxAboveFormat: z.int32().max(1e12),
  maxAtFormatInclusive: z.int32().max(2 ** 31 - 1),
  maxAtFormatExclusive: z.int32().lt(2 ** 31 - 1),
  intExclusiveOnStep: z.int().gt(2).lt(5),
  intExclusiveOffStep: z.int().gt(2.5).lt(4.5),
  singlePoint: z.number().min(1).max(1),
  twoBigintFormats: z.int64().check(z.uint64()),
  twoBigintFormatsReversed: z.uint64().check(z.int64()),
  bigintExclusive: z.bigint().gt(1n).lt(10n),
  bigintInsideFormat: z.int64().min(0n).max(5n),
  bigintOutsideFormat: z.int64().min(-(2n ** 70n)).max(2n ** 70n),
  bigintNegativeRange: z.bigint().multipleOf(3n).min(-10n).max(-1n),
  bigintNegativeStep: z.bigint().multipleOf(-4n).min(-20n).max(20n),
  bigintStepMinOnly: z.bigint().multipleOf(5n).min(7n),
  bigintStepMaxOnly: z.bigint().multipleOf(5n).max(-7n),
  dateExclusive: z.date().check(z.gt(new Date(0)), z.lt(new Date(1000))),
  dateMinOnly: z.date().min(new Date(0)),
  dateMaxOnly: z.date().max(new Date(0)),
  prefixesLongFirst: z.string().startsWith("ab").startsWith("a"),
  prefixesShortFirst: z.string().startsWith("a").startsWith("ab"),
  suffixesLongFirst: z.string().endsWith("yz").endsWith("z"),
  suffixesShortFirst: z.string().endsWith("z").endsWith("yz"),
  uppercase: z.string().uppercase().min(1),
  customEmailPattern: z.email({ pattern: z.regexes.html5Email }),
  formatWithoutPattern: z.stringFormat("three", (s) => s.length === 3),
  numberKeyRecord: z.record(z.number(), z.string()),
  symbolKeyRecord: z.record(z.symbol(), z.string()),
  mixedKeyRecord: z.record(z.union([z.string(), z.symbol()]), z.string()),
  scalarIntersection: z.intersection(z.string(), z.string().min(1)),
  functionWithoutOutput: z.function(),
  refinedArray: z.array(z.int()).refine((xs) => xs.length !== 1),
};

describe("branch cases generate valid values", () => {
  for (const [name, schema] of Object.entries(valid)) {
    test(name, () => {
      fc.assert(fc.property(zodArbitrary(schema), (v) => schema.safeParse(v).success), { numRuns: 100 });
    });
  }
});

describe("branch cases that throw", () => {
  test("empty bounds", () => {
    expect(() => zodArbitrary(z.number().gt(1).lte(1))).toThrow(RangeError);
    expect(() => zodArbitrary(z.number().gte(1).lt(1))).toThrow(RangeError);
    expect(() => zodArbitrary(z.number().min(2).max(1))).toThrow(RangeError);
    expect(() => zodArbitrary(z.date().min(new Date(5)).max(new Date(4)))).toThrow(RangeError);
    expect(() => zodArbitrary(z.array(z.string()).min(3).max(2))).toThrow(RangeError);
    expect(() => zodArbitrary(z.number().multipleOf(0))).toThrow(/multipleOf\(0\)/);
    expect(() => zodArbitrary(z.bigint().multipleOf(0n))).toThrow(/multipleOf\(0n\)/);
  });

  test("empty enum and union", () => {
    expect(() => zodArbitrary(z.enum([] as unknown as [string]))).toThrow(/empty enum/);
    expect(() => zodArbitrary(z.union([] as unknown as [z.ZodString]))).toThrow(/empty union/);
  });

  test("non-schemas", () => {
    expect(() => zodArbitrary(undefined as unknown as z.ZodType)).toThrow(/zod 4 schema/);
  });
});

test("Capped shrinks values without context through the full arbitrary", () => {
  const capped = new Capped(fc.nat(), fc.constant(0), new Depth(1));
  const shrunk = [...capped.shrink(10, undefined).take(3)].map((v) => v.value);
  expect(shrunk.length).toBeGreaterThan(0);
  for (const v of shrunk) expect(v).toBeLessThan(10);
});
