import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { z } from "zod";
import { Bounded } from "../src/filter.ts";
import { zodArbitrary } from "../src/index.ts";

const ok = (schema: z.ZodType) =>
  fc.assert(fc.property(zodArbitrary(schema), (v) => schema.safeParse(v).success), { numRuns: 200 });

describe("schemas that used to hang or crash now generate", () => {
  test("url with a custom protocol", () => ok(z.url({ protocol: /^ftp$/ })));
  test("url with a custom hostname", () => ok(z.url({ hostname: /^api\.example\.(com|org)$/ })));
  test("url with a lookahead hostname regex", () => ok(z.url({ hostname: z.regexes.domain })));
  test("preprocess into a format", () => ok(z.preprocess((v) => String(v).trim(), z.email())));
  test("string piped into a format", () => ok(z.string().pipe(z.email())));
  // zod marks preprocess optional, but a missing key still runs the pipe on undefined.
  test("object key holding a preprocess (found by the fuzz test)", () =>
    ok(z.object({ a: z.preprocess((v) => v, z.templateLiteral([z.boolean()])) })));
  test("object key holding a preprocess that throws on undefined", () =>
    ok(
      z.object({
        a: z.preprocess((v) => {
          if (v === undefined) throw new Error("no value");
          return v;
        }, z.string()),
      }),
    ));
  test("codec", () => ok(z.codec(z.iso.date(), z.date(), { decode: (s) => new Date(s), encode: (d) => d.toISOString() })));
});

describe("unsatisfiable filters throw instead of hanging", () => {
  test("a refinement nothing passes names the schema", () => {
    const schema = z.custom(() => false);
    expect(() => fc.sample(zodArbitrary(schema), 1)).toThrow(/gave up after 1000 rejected values for custom/);
  });

  test("maxFilterAttempts sets the budget", () => {
    const schema = z.string().refine(() => false);
    expect(() => fc.sample(zodArbitrary(schema, { maxFilterAttempts: 5 }), 1)).toThrow(/after 5 rejected values for string \("custom"\)/);
  });

  test("nonoptional of undefined", () => {
    // @ts-expect-error: zod types this as never, so it is a compile error as well.
    expect(() => fc.sample(zodArbitrary(z.undefined().nonoptional()), 1)).toThrow(/nonoptional/);
  });

  test("record keys that cannot be object keys", () => {
    // zod's types forbid bigint keys; sample many, since an empty record never asks for a key.
    const keys = z.bigint() as unknown as z.ZodString;
    expect(() => fc.sample(zodArbitrary(z.record(keys, z.string())), 100)).toThrow(/bigint/);
  });
});

test("schemas with a never input type fail to compile", () => {
  // @ts-expect-error: string & number has no values.
  expect(() => fc.sample(zodArbitrary(z.intersection(z.string(), z.number())), 1)).toThrow(/gave up/);
  // @ts-expect-error: "a" & "b" has no values.
  expect(() => fc.sample(zodArbitrary(z.literal("a").and(z.literal("b"))), 1)).toThrow(/gave up/);
});

test("Bounded keeps shrinks and context-free checks inside the predicate", () => {
  const even = new Bounded(fc.nat(), (n) => n % 2 === 0, () => "even", 100);
  expect(even.canShrinkWithoutContext(4)).toBe(true);
  expect(even.canShrinkWithoutContext(3)).toBe(false);
  const shrunk = [...even.shrink(40, undefined).take(10)].map((v) => v.value);
  expect(shrunk.length).toBeGreaterThan(0);
  for (const n of shrunk) expect(n % 2).toBe(0);
});
