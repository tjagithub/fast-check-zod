// One sample per zod 4 schema type, check kind and string format. The mapped types make
// `bun check` fail when a zod release adds a kind that has no sample here.
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { z } from "zod";
import type * as core from "zod/v4/core";
import { zodArbitrary } from "../src/index.ts";
import { checkDefs, type SchemaType } from "../src/util.ts";

type Schema = core.$ZodType;
type CheckKind = core.$ZodChecks["_zod"]["def"]["check"];
type StringFormat = core.$ZodStringFormatChecks["_zod"]["def"]["format"];
type HashAlgorithm = Parameters<typeof z.hash>[0];
type HashEncoding = NonNullable<NonNullable<Parameters<typeof z.hash>[1]>["enc"]>;

const algorithms = ["md5", "sha1", "sha256", "sha384", "sha512"] as const satisfies readonly HashAlgorithm[];
const encodings = ["hex", "base64", "base64url"] as const satisfies readonly HashEncoding[];
// Fails to compile if zod adds a hash algorithm or encoding missing from the lists above.
const _allHashes: [Exclude<HashAlgorithm, (typeof algorithms)[number]>, Exclude<HashEncoding, (typeof encodings)[number]>] extends [never, never]
  ? true
  : never = true;
const hashes = Object.fromEntries(
  algorithms.flatMap((alg) => encodings.map((enc) => [`${alg}_${enc}`, z.hash(alg, { enc })])),
) as unknown as Record<`${HashAlgorithm}_${HashEncoding}`, Schema>;

const Lazy: z.ZodType = z.lazy(() => z.array(Lazy));

// "never" has no values and "int" is a type-only tag zod never builds at runtime.
const types: Record<Exclude<SchemaType, "never" | "int">, Schema> = {
  string: z.string(),
  number: z.number(),
  bigint: z.bigint(),
  boolean: z.boolean(),
  symbol: z.symbol(),
  null: z.null(),
  undefined: z.undefined(),
  void: z.void(),
  any: z.any(),
  unknown: z.unknown(),
  date: z.date(),
  object: z.object({ a: z.string() }),
  record: z.record(z.string(), z.number()),
  file: z.file(),
  array: z.array(z.number()),
  tuple: z.tuple([z.string(), z.number()]),
  union: z.union([z.string(), z.number()]),
  intersection: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
  map: z.map(z.string(), z.number()),
  set: z.set(z.string()),
  enum: z.enum(["a", "b"]),
  literal: z.literal(42),
  nullable: z.nullable(z.string()),
  optional: z.optional(z.string()),
  nonoptional: z.string().optional().nonoptional(),
  success: z.success(z.string()),
  transform: z.transform((v) => typeof v),
  default: z.string().default("x"),
  prefault: z.string().prefault("x"),
  catch: z.string().catch("x"),
  nan: z.nan(),
  pipe: z.string().pipe(z.string().min(1)),
  readonly: z.object({ a: z.string() }).readonly(),
  template_literal: z.templateLiteral(["id-", z.number()]),
  promise: z.promise(z.number()),
  lazy: Lazy,
  function: z.function({ input: [z.string()], output: z.number() }),
  custom: z.custom(),
};

const checks: Record<CheckKind, Schema> = {
  less_than: z.number().lt(5),
  greater_than: z.number().gt(5),
  multiple_of: z.number().multipleOf(4),
  number_format: z.int32(),
  bigint_format: z.int64(),
  max_size: z.set(z.int()).max(2),
  min_size: z.set(z.int()).min(1),
  size_equals: z.set(z.int()).size(2),
  max_length: z.string().max(3),
  min_length: z.string().min(3),
  length_equals: z.string().length(3),
  string_format: z.email(),
  property: z.object({ a: z.string() }).check(z.property("a", z.string().min(2))),
  mime_type: z.file().mime("image/png"),
  overwrite: z.string().trim(),
};

const formats: Record<StringFormat, Schema> = {
  ...hashes,
  email: z.email(),
  url: z.url(),
  emoji: z.emoji(),
  uuid: z.uuid(),
  guid: z.guid(),
  nanoid: z.nanoid(),
  cuid: z.cuid(),
  cuid2: z.cuid2(),
  ulid: z.ulid(),
  xid: z.xid(),
  ksuid: z.ksuid(),
  datetime: z.iso.datetime(),
  date: z.iso.date(),
  time: z.iso.time(),
  duration: z.iso.duration(),
  ipv4: z.ipv4(),
  ipv6: z.ipv6(),
  mac: z.mac(),
  cidrv4: z.cidrv4(),
  cidrv6: z.cidrv6(),
  base64: z.base64(),
  base64url: z.base64url(),
  e164: z.e164(),
  credit_card: z.creditCard(),
  iban: z.iban(),
  jwt: z.jwt(),
  hex: z.hex(),
  hostname: z.hostname(),
  currency_code: z.currencyCode(),
  lowercase: z.string().lowercase(),
  uppercase: z.string().uppercase(),
  regex: z.string().regex(/^[a-z]{2}\d$/),
  starts_with: z.string().startsWith("pre"),
  ends_with: z.string().endsWith("post"),
  includes: z.string().includes("mid"),
};

// promise schemas only parse asynchronously, so every sample uses safeParseAsync.
const valid = (schema: Schema) =>
  fc.assert(
    fc.asyncProperty(zodArbitrary(schema), async (v) => (await (schema as z.ZodType).safeParseAsync(v)).success),
    { numRuns: 100 },
  );

describe("every schema type", () => {
  for (const [type, schema] of Object.entries(types)) {
    test(type, async () => {
      expect(schema._zod.def.type).toBe(type as SchemaType);
      await valid(schema);
    });
  }
  test("never throws", () => {
    // @ts-expect-error: z.never() is rejected at compile time too.
    expect(() => zodArbitrary(z.never())).toThrow(TypeError);
  });
});

describe("every check kind", () => {
  for (const [kind, schema] of Object.entries(checks)) {
    test(kind, async () => {
      expect(checkDefs(schema._zod.def).map((d) => d.check)).toContain(kind);
      await valid(schema);
    });
  }
});

describe("every string format", () => {
  for (const [format, schema] of Object.entries(formats)) {
    test(format, async () => {
      expect(checkDefs(schema._zod.def).map((d) => d.format)).toContain(format);
      await valid(schema);
    });
  }
});
