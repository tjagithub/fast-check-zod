import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { z } from "zod";
import { zodArbitrary, zodOutputArbitrary } from "../src/index.ts";

const Node: z.ZodType<{ value: number; children: unknown[] }> = z.lazy(() =>
  z.object({ value: z.int(), children: z.array(Node) }),
);
const Json: z.ZodType = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(Json), z.record(z.string(), Json)]),
);
const Category = z.object({
  name: z.string(),
  get subcategories() {
    return z.array(Category);
  },
});
enum Color {
  Red,
  Green = "green",
}

const cases: Record<string, z.ZodType> = {
  string: z.string(),
  stringBounds: z.string().min(3).max(8),
  stringLength: z.string().length(4),
  affixes: z.string().startsWith("ab").endsWith("yz").includes("mm").max(12),
  lowercase: z.string().lowercase().min(2),
  regex: z.string().regex(/^[a-f0-9]{4,8}$/),
  refined: z.string().refine((s) => s.length % 2 === 0),
  trimmed: z.string().trim().min(1),
  email: z.email(),
  url: z.url(),
  httpUrl: z.httpUrl(),
  uuid: z.uuid(),
  uuidv7: z.uuidv7(),
  nanoid: z.nanoid(),
  cuid2: z.cuid2(),
  ulid: z.ulid(),
  datetime: z.iso.datetime(),
  datetimeOffset: z.iso.datetime({ offset: true, precision: 3 }),
  isoDate: z.iso.date(),
  isoTime: z.iso.time(),
  duration: z.iso.duration(),
  ipv4: z.ipv4(),
  ipv6: z.ipv6(),
  cidrv6: z.cidrv6(),
  base64: z.base64(),
  base64url: z.base64url(),
  emoji: z.emoji(),
  jwt: z.jwt(),
  jwtAlg: z.jwt({ alg: "RS256" }),
  e164: z.e164(),
  hostname: z.hostname(),
  creditCard: z.creditCard(),
  iban: z.iban(),
  jsonSchema: z.json(),
  hash: z.hash("sha256"),
  number: z.number(),
  numberRange: z.number().gt(-1.5).lt(2.5),
  int: z.int().min(-10).max(10),
  int32: z.int32(),
  uint32: z.uint32(),
  float32: z.float32(),
  multipleOf: z.number().multipleOf(0.25).min(-3).max(3),
  intMultiple: z.int().multipleOf(7).positive(),
  bigint: z.bigint().min(-5n).max(10n),
  bigintStep: z.bigint().multipleOf(3n).nonnegative(),
  int64: z.int64(),
  date: z.date().min(new Date("2020-01-01")).max(new Date("2021-01-01")),
  boolean: z.boolean(),
  literal: z.literal(["a", 1, true]),
  enum: z.enum(["x", "y", "z"]),
  nativeEnum: z.enum(Color),
  nan: z.nan(),
  symbol: z.symbol(),
  nullish: z.string().nullish(),
  defaulted: z.number().default(3),
  catch: z.number().catch(0),
  readonly: z.array(z.string()).readonly(),
  array: z.array(z.number()).min(2).max(4),
  nonempty: z.array(z.string()).nonempty(),
  tuple: z.tuple([z.string(), z.int()]),
  tupleRest: z.tuple([z.boolean()], z.string()),
  set: z.set(z.int().min(0).max(100)).min(2).max(5),
  map: z.map(z.string(), z.date()),
  object: z.object({ a: z.string(), b: z.number().optional(), c: z.boolean().default(false) }),
  strictObject: z.strictObject({ a: z.string() }),
  looseObject: z.looseObject({ a: z.string() }),
  catchall: z.object({ a: z.string() }).catchall(z.number()),
  refinedObject: z
    .object({ lo: z.int(), hi: z.int() })
    .refine((o) => o.lo <= o.hi),
  record: z.record(z.string().min(1), z.number()),
  enumRecord: z.record(z.enum(["a", "b"]), z.int()),
  partialRecord: z.partialRecord(z.enum(["a", "b"]), z.int()),
  union: z.union([z.string(), z.int()]),
  discriminated: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("a"), a: z.string() }),
    z.object({ kind: z.literal("b"), b: z.number() }),
  ]),
  xor: z.xor([z.string(), z.email()]),
  intersection: z.intersection(z.object({ a: z.string() }), z.object({ b: z.int() })),
  templateLiteral: z.templateLiteral(["user-", z.int().min(0), "-", z.enum(["a", "b"])]),
  pipe: z.string().transform((s) => s.length).pipe(z.number().max(5)),
  codec: z.codec(z.iso.datetime(), z.date(), {
    decode: (s) => new Date(s),
    encode: (d) => d.toISOString(),
  }),
  tree: Node,
  jsonValue: Json,
  category: Category,
  file: z.file().min(1).max(100).mime(["image/png", "text/plain"]),
  any: z.any(),
};

describe("generated values pass safeParse", () => {
  for (const [name, schema] of Object.entries(cases)) {
    test(name, () => {
      fc.assert(fc.property(zodArbitrary(schema), (v) => schema.safeParse(v).success), { numRuns: 200 });
    });
  }
});

describe("behaviour", () => {
  test("optional object keys are sometimes absent", () => {
    const keys = fc.sample(zodArbitrary(z.object({ a: z.string().optional() })), 200).map((o) => "a" in o);
    expect(keys).toContain(true);
    expect(keys).toContain(false);
  });

  test("overrides replace a schema", () => {
    const custom = z.instanceof(URL);
    const schema = z.object({ link: custom });
    const arb = zodArbitrary(schema, { overrides: [[custom, fc.webUrl().map((u) => new URL(u))]] });
    fc.assert(fc.property(arb, (v) => schema.safeParse(v).success));
  });

  test("output arbitrary applies defaults and transforms", () => {
    const schema = z.object({ n: z.number().default(1), s: z.string().transform((s) => s.length) });
    fc.assert(
      fc.property(zodOutputArbitrary(schema), (v) => typeof v.n === "number" && typeof v.s === "number"),
    );
  });

  test("unsatisfiable bounds throw at build time", () => {
    expect(() => zodArbitrary(z.int().min(5).max(4))).toThrow(RangeError);
    expect(() => zodArbitrary(z.string().min(5).max(4))).toThrow(RangeError);
    // @ts-expect-error: z.never() is rejected at compile time too.
    expect(() => zodArbitrary(z.never())).toThrow(TypeError);
  });

  test("recursive schemas stay finite", () => {
    const sizes = fc.sample(zodArbitrary(Node), 100).map((n) => JSON.stringify(n).length);
    expect(Math.max(...sizes)).toBeLessThan(1_000_000);
  });
});
