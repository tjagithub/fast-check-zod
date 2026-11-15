// Random satisfiable zod schemas, each paired with the code that builds it so counterexamples read as code.
import fc from "fast-check";
import { z } from "zod";

export interface S {
  schema: z.ZodType;
  code: string;
}

export const s = (schema: unknown, code: string): S => ({
  schema: schema as z.ZodType,
  code,
  [fc.toStringMethod]: () => code,
} as S);

const word = fc.stringMatching(/^[a-z]{1,4}$/);
const key = fc.constantFrom("a", "b", "c", "d", "e", "id", "name");
const opt = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });

const FORMATS: Array<[string, () => unknown]> = [
  ["z.email()", () => z.email()],
  ["z.uuid()", () => z.uuid()],
  ["z.url()", () => z.url()],
  ["z.httpUrl()", () => z.httpUrl()],
  ["z.iso.datetime()", () => z.iso.datetime()],
  ["z.iso.datetime({ offset: true, local: true })", () => z.iso.datetime({ offset: true, local: true })],
  ["z.iso.date()", () => z.iso.date()],
  ["z.iso.time()", () => z.iso.time()],
  ["z.iso.duration()", () => z.iso.duration()],
  ["z.ipv4()", () => z.ipv4()],
  ["z.ipv6()", () => z.ipv6()],
  ["z.cidrv4()", () => z.cidrv4()],
  ["z.base64()", () => z.base64()],
  ["z.base64url()", () => z.base64url()],
  ["z.jwt()", () => z.jwt()],
  ["z.emoji()", () => z.emoji()],
  ["z.nanoid()", () => z.nanoid()],
  ["z.ulid()", () => z.ulid()],
  ["z.cuid2()", () => z.cuid2()],
  ["z.e164()", () => z.e164()],
  ["z.hostname()", () => z.hostname()],
  ["z.creditCard()", () => z.creditCard()],
  ["z.iban()", () => z.iban()],
  ["z.mac()", () => z.mac()],
  ["z.hex()", () => z.hex()],
  ["z.currencyCode()", () => z.currencyCode()],
  ['z.hash("sha256")', () => z.hash("sha256")],
  ["z.string().regex(/^[a-z]{2,5}$/)", () => z.string().regex(/^[a-z]{2,5}$/)],
  ["z.string().regex(/^\\d{3}-\\d{4}$/)", () => z.string().regex(/^\d{3}-\d{4}$/)],
];

const format = fc.constantFrom(...FORMATS).map(([code, make]) => s(make(), code));

/** Plain strings: length bounds always leave room for the affixes. */
const plainString = fc
  .record({ min: opt(fc.nat(5)), extra: opt(fc.nat(8)), prefix: opt(word), suffix: opt(word), includes: opt(word), lower: fc.boolean() })
  .map((o) => {
    let schema = z.string();
    let code = "z.string()";
    const add = (next: z.ZodString, text: string) => {
      schema = next;
      code += text;
    };
    if (o.min !== undefined) add(schema.min(o.min), `.min(${o.min})`);
    if (o.extra !== undefined) {
      const fixed = (o.prefix?.length ?? 0) + (o.suffix?.length ?? 0) + (o.includes?.length ?? 0);
      const max = Math.max(o.min ?? 0, fixed) + o.extra;
      add(schema.max(max), `.max(${max})`);
    }
    if (o.prefix) add(schema.startsWith(o.prefix), `.startsWith(${JSON.stringify(o.prefix)})`);
    if (o.suffix) add(schema.endsWith(o.suffix), `.endsWith(${JSON.stringify(o.suffix)})`);
    if (o.includes) add(schema.includes(o.includes), `.includes(${JSON.stringify(o.includes)})`);
    if (o.lower) add(schema.lowercase(), ".lowercase()");
    return s(schema, code);
  });

/** Numbers: when a step is set, the range always holds at least one multiple. */
const number = fc
  .record({
    int: fc.boolean(),
    lo: opt(fc.integer({ min: -1000, max: 1000 })),
    span: opt(fc.nat(1000)),
    exclusive: fc.boolean(),
    step: opt(fc.constantFrom(2, 3, 5, 10)),
  })
  .map((o) => {
    let schema = o.int ? z.int() : z.number();
    let code = o.int ? "z.int()" : "z.number()";
    const add = (next: z.ZodNumber, text: string) => {
      schema = next;
      code += text;
    };
    const [gt, lt] = o.exclusive ? (["gt", "lt"] as const) : (["gte", "lte"] as const);
    if (o.step !== undefined) add(schema.multipleOf(o.step), `.multipleOf(${o.step})`);
    if (o.lo !== undefined) add(schema[gt](o.lo), `.${gt}(${o.lo})`);
    if (o.span !== undefined) {
      const hi = (o.lo ?? 0) + o.span + (o.step ?? 1) * 2 + 1;
      add(schema[lt](hi), `.${lt}(${hi})`);
    }
    return s(schema, code);
  });

const bigint = fc
  .record({ lo: opt(fc.bigInt(-1000n, 1000n)), span: opt(fc.bigInt(0n, 1000n)), step: opt(fc.constantFrom(2n, 7n)) })
  .map((o) => {
    let schema = z.bigint();
    let code = "z.bigint()";
    if (o.step !== undefined) [schema, code] = [schema.multipleOf(o.step), `${code}.multipleOf(${o.step}n)`];
    if (o.lo !== undefined) [schema, code] = [schema.min(o.lo), `${code}.min(${o.lo}n)`];
    if (o.span !== undefined) {
      const hi = (o.lo ?? 0n) + o.span + (o.step ?? 1n);
      [schema, code] = [schema.max(hi), `${code}.max(${hi}n)`];
    }
    return s(schema, code);
  });

const date = fc.record({ t: opt(fc.integer({ min: 0, max: 2e12 })), span: opt(fc.nat(1e10)) }).map((o) => {
  let schema = z.date();
  let code = "z.date()";
  if (o.t !== undefined) [schema, code] = [schema.min(new Date(o.t)), `${code}.min(new Date(${o.t}))`];
  if (o.span !== undefined) {
    const hi = (o.t ?? 0) + o.span;
    [schema, code] = [schema.max(new Date(hi)), `${code}.max(new Date(${hi}))`];
  }
  return s(schema, code);
});

const literal = fc.oneof(word, fc.integer({ min: -9, max: 9 }), fc.boolean()).map((v) => s(z.literal(v), `z.literal(${JSON.stringify(v)})`));
const enumS = fc.uniqueArray(word, { minLength: 1, maxLength: 4 }).map((vs) => s(z.enum(vs as [string]), `z.enum(${JSON.stringify(vs)})`));

const templatePart = fc.oneof(
  word.map((w) => [w, JSON.stringify(w)] as const),
  fc.constant([z.int().min(0), "z.int().min(0)"] as const),
  fc.constant([z.enum(["x", "y"]), 'z.enum(["x", "y"])'] as const),
  fc.constant([z.boolean(), "z.boolean()"] as const),
);
const template = fc
  .array(templatePart, { minLength: 1, maxLength: 3 })
  .map((ps) => s(z.templateLiteral(ps.map((p) => p[0]) as [string]), `z.templateLiteral([${ps.map((p) => p[1]).join(", ")}])`));

type Tree = { v: number; kids: Tree[] };
const Tree: z.ZodType<Tree> = z.lazy(() => z.object({ v: z.int(), kids: z.array(Tree).max(3) }));

const leaf: fc.Arbitrary<S> = fc.oneof(
  plainString,
  format,
  number,
  bigint,
  date,
  literal,
  enumS,
  template,
  fc.constantFrom(
    s(z.boolean(), "z.boolean()"),
    s(z.null(), "z.null()"),
    s(z.undefined(), "z.undefined()"),
    s(z.nan(), "z.nan()"),
    s(z.symbol(), "z.symbol()"),
    s(z.any(), "z.any()"),
    s(z.unknown(), "z.unknown()"),
    s(z.int32(), "z.int32()"),
    s(z.uint32(), "z.uint32()"),
    s(z.float32(), "z.float32()"),
    s(z.int64(), "z.int64()"),
    s(Tree, "Tree"),
  ),
);

export { key, leaf, word };
