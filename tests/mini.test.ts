import { describe, test } from "bun:test";
import fc from "fast-check";
import { z } from "zod/mini";
import { zodArbitrary, zodOutputArbitrary } from "../src/index.ts";

const Node: z.ZodMiniType<{ v: number; kids: unknown[] }> = z.lazy(() =>
  z.object({ v: z.int(), kids: z.array(Node) }),
);

const cases: Record<string, z.ZodMiniType> = {
  string: z.string().check(z.minLength(2), z.maxLength(6)),
  affixes: z.string().check(z.startsWith("a"), z.endsWith("z"), z.toLowerCase()),
  regex: z.string().check(z.regex(/^[0-9]{3}$/)),
  email: z.email(),
  uuid: z.uuid(),
  datetime: z.iso.datetime(),
  int: z.int().check(z.minimum(-5), z.maximum(5)),
  multipleOf: z.number().check(z.multipleOf(3), z.positive(), z.lt(100)),
  bigint: z.bigint().check(z.gte(1n), z.lte(9n)),
  optional: z.optional(z.string()),
  nullable: z.nullable(z.number()),
  defaulted: z._default(z.boolean(), false),
  array: z.array(z.string()).check(z.minLength(1), z.maxLength(3)),
  object: z.object({ a: z.string(), b: z.optional(z.int()) }),
  strict: z.strictObject({ a: z.string() }),
  union: z.union([z.literal("x"), z.int()]),
  discriminated: z.discriminatedUnion("t", [
    z.object({ t: z.literal("a") }),
    z.object({ t: z.literal("b"), n: z.number() }),
  ]),
  record: z.record(z.enum(["k1", "k2"]), z.number()),
  set: z.set(z.int()).check(z.minSize(1)),
  tuple: z.tuple([z.string(), z.boolean()]),
  refined: z.int().check(z.refine((n) => n % 2 === 0)),
  pipe: z.pipe(z.string(), z.transform((s) => s.length)),
  tree: Node,
};

describe("zod/mini schemas", () => {
  for (const [name, schema] of Object.entries(cases)) {
    test(name, () => {
      fc.assert(fc.property(zodArbitrary(schema), (v) => z.safeParse(schema, v).success), { numRuns: 200 });
    });
  }

  test("output arbitrary", () => {
    const schema = z.object({ n: z._default(z.number(), 1) });
    fc.assert(fc.property(zodOutputArbitrary(schema), (v) => typeof v.n === "number"));
  });
});
