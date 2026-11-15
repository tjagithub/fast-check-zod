import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { z } from "zod";
import { Capped, Deferred, Depth } from "../src/depth.ts";
import { zodArbitrary } from "../src/index.ts";

type Tree = { v: number; kids: Tree[] };
const Tree: z.ZodType<Tree, Tree> = z.lazy(() => z.object({ v: z.int(), kids: z.array(Tree) }));
const size = (t: Tree): number => 1 + t.kids.reduce((n, k) => n + size(k), 0);

describe("shrinking recursive values", () => {
  test("generated counterexamples shrink to the smallest failing tree", () => {
    const out = fc.check(fc.property(zodArbitrary(Tree), (t) => size(t) < 3), { seed: 1 });
    expect(out.failed).toBe(true);
    expect(size(out.counterexample![0])).toBe(3);
  });

  test("user-supplied examples are reported but not shrunk", () => {
    const big: Tree = { v: 5, kids: [{ v: 1, kids: [{ v: 2, kids: [] }] }, { v: 3, kids: [] }] };
    const out = fc.check(fc.property(zodArbitrary(Tree), (t) => size(t) < 3), { examples: [[big]], numRuns: 1 });
    expect(out.failed).toBe(true);
    // Objects are built with .map() and no unmapper, so fast-check cannot shrink values it did not generate.
    expect(out.counterexample![0]).toEqual(big);
  });
});

describe("depth wrappers", () => {
  test("delegate context-free shrink checks", () => {
    const depth = new Depth(1);
    expect(new Deferred(() => fc.nat(), depth).canShrinkWithoutContext(3)).toBe(true);
    expect(new Capped(fc.nat(), fc.constant(0), depth).canShrinkWithoutContext(3)).toBe(true);
    expect(new Capped(fc.nat(), fc.constant(0), depth).canShrinkWithoutContext("x")).toBe(false);
  });
});

describe("fallbacks", () => {
  test("regex syntax fast-check cannot invert falls back to filtered strings", () => {
    const schema = z.string().regex(/^(?!x)/);
    fc.assert(fc.property(zodArbitrary(schema), (s) => schema.safeParse(s).success));
  });

  test("errors thrown by refinements propagate", () => {
    const schema = z.string().refine(() => {
      throw new Error("boom");
    });
    expect(() => fc.sample(zodArbitrary(schema), 1)).toThrow("boom");
  });

  test("async refinements are accepted inside filters", async () => {
    const schema = z.string().refine(async (s) => s.length < 1000);
    const values = fc.sample(zodArbitrary(schema), 20);
    for (const v of values) expect((await schema.safeParseAsync(v)).success).toBe(true);
  });
});

describe("errors at build time", () => {
  test("empty number and bigint ranges", () => {
    expect(() => zodArbitrary(z.number().gt(1).lt(1))).toThrow(RangeError);
    expect(() => zodArbitrary(z.bigint().min(5n).max(4n))).toThrow(RangeError);
    expect(() => zodArbitrary(z.bigint().multipleOf(10n).min(1n).max(9n))).toThrow(RangeError);
  });

  test("unknown schema types", () => {
    const fake = { _zod: { def: { type: "bogus" } } } as unknown as z.ZodType;
    expect(() => zodArbitrary(fake)).toThrow(/unsupported schema type "bogus"/);
  });
});
