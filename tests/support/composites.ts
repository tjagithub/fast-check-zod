import fc from "fast-check";
import { z } from "zod";
import { key, leaf, type S, s } from "./schemas.ts";

const opt = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });
const list = (xs: S[]) => xs.map((x) => x.code).join(", ");

type Field = [string, S, "" | "optional" | "nullable" | "nullish"];

function shapeOf(fields: Field[]) {
  const shape: Record<string, z.ZodType> = {};
  const code: string[] = [];
  for (const [k, v, mod] of fields) {
    shape[k] = (mod ? v.schema[mod]() : v.schema) as z.ZodType;
    code.push(`${k}: ${v.code}${mod ? `.${mod}()` : ""}`);
  }
  return { shape, code: `{ ${code.join(", ")} }` };
}

/** Random schemas built from `leaf`, nested a few levels deep. */
export const schema: fc.Arbitrary<S> = fc.letrec<{ node: S }>((tie) => {
  const node = tie("node");
  const field = fc.tuple(key, node, fc.constantFrom("", "optional", "nullable", "nullish")) as fc.Arbitrary<Field>;
  const fields = (max: number) => fc.uniqueArray(field, { maxLength: max, selector: (f) => f[0] });

  const array = fc.tuple(node, opt(fc.nat(3)), opt(fc.nat(3))).map(([el, min, extra]) => {
    let a = z.array(el.schema);
    let code = `z.array(${el.code})`;
    if (min !== undefined) [a, code] = [a.min(min), `${code}.min(${min})`];
    if (extra !== undefined) [a, code] = [a.max((min ?? 0) + extra), `${code}.max(${(min ?? 0) + extra})`];
    return s(a, code);
  });

  const object = fc.tuple(fields(4), fc.constantFrom("object", "strictObject", "looseObject", "catchall")).map(([fs, mode]) => {
    const { shape, code } = shapeOf(fs);
    if (mode === "catchall") return s(z.object(shape).catchall(z.number()), `z.object(${code}).catchall(z.number())`);
    return s(z[mode](shape), `z.${mode}(${code})`);
  });

  const tuple = fc.tuple(fc.array(node, { minLength: 1, maxLength: 3 }), opt(node)).map(([items, rest]) =>
    rest
      ? s(z.tuple(items.map((i) => i.schema) as [z.ZodType], rest.schema), `z.tuple([${list(items)}], ${rest.code})`)
      : s(z.tuple(items.map((i) => i.schema) as [z.ZodType]), `z.tuple([${list(items)}])`),
  );

  const union = fc
    .array(node, { minLength: 2, maxLength: 3 })
    .map((os) => s(z.union(os.map((o) => o.schema) as [z.ZodType, z.ZodType]), `z.union([${list(os)}])`));

  const discriminated = fc.array(fields(2), { minLength: 2, maxLength: 3 }).map((variants) => {
    const options = variants.map((fs, i) => {
      const kind: Field = ["kind", s(z.literal(i), `z.literal(${i})`), ""];
      const { shape, code } = shapeOf([...fs, kind]);
      return { schema: z.object(shape), code };
    });
    const code = `z.discriminatedUnion("kind", [${options.map((o) => `z.object(${o.code})`).join(", ")}])`;
    return s(z.discriminatedUnion("kind", options.map((o) => o.schema) as [z.ZodObject<{ kind: z.ZodLiteral<number> }>]), code);
  });

  const intersection = fc.tuple(fields(4), fc.nat(4)).map(([fs, cut]) => {
    const left = shapeOf(fs.slice(0, cut));
    const right = shapeOf(fs.slice(cut));
    return s(z.intersection(z.object(left.shape), z.object(right.shape)), `z.intersection(z.object(${left.code}), z.object(${right.code}))`);
  });

  const record = fc.tuple(fc.boolean(), node).map(([enumKeys, v]) =>
    enumKeys
      ? s(z.record(z.enum(["k1", "k2"]), v.schema), `z.record(z.enum(["k1", "k2"]), ${v.code})`)
      : s(z.record(z.string(), v.schema), `z.record(z.string(), ${v.code})`),
  );

  const map = fc.tuple(leaf, node).map(([k, v]) => s(z.map(k.schema, v.schema), `z.map(${k.code}, ${v.code})`));
  const set = fc
    .tuple(fc.constantFrom(["z.string()", z.string()], ["z.int()", z.int()], ["z.number()", z.number()]), fc.nat(2))
    .map(([[code, el], min]) => s(z.set(el as z.ZodType).min(min), `z.set(${code}).min(${min})`));

  const wrapped = fc
    .tuple(node, fc.constantFrom("optional", "nullable", "nullish", "readonly", "refine", "preprocess", "lazy", "pipe"))
    .map(([n, how]): S => {
      const t = n.schema;
      switch (how) {
        case "refine":
          return s(t.refine(() => true), `${n.code}.refine(() => true)`);
        case "preprocess":
          return s(z.preprocess((v) => v, t), `z.preprocess((v) => v, ${n.code})`);
        case "lazy":
          return s(z.lazy(() => t), `z.lazy(() => ${n.code})`);
        case "pipe":
          return s(z.unknown().pipe(t), `z.unknown().pipe(${n.code})`);
        default:
          return s(t[how](), `${n.code}.${how}()`);
      }
    });

  return {
    node: fc.oneof(
      { depthSize: "small", withCrossShrink: true },
      leaf,
      array,
      object,
      tuple,
      union,
      discriminated,
      intersection,
      record,
      map,
      set,
      wrapped,
    ),
  };
}).node;
