import fc from "fast-check";
import * as core from "zod/v4/core";
import { Capped, Deferred, Depth } from "./depth.ts";
import { Bounded } from "./filter.ts";
import { bigintArb, dateArb, numberArb } from "./numbers.ts";
import { type StringUnit, stringArb } from "./strings.ts";
import type { Built } from "./types.ts";
import { ABSENT, assign, bounds, checkDefs, type Def, describe, isPlainObject, isValid, omittable, type Schema, type SchemaType, unsupported } from "./util.ts";

type Overrides = Map<Schema, fc.Arbitrary<unknown>> | Iterable<readonly [Schema, fc.Arbitrary<unknown>]>;

export interface ZodArbitraryOptions {
  /** Arbitraries for specific schemas, e.g. z.custom() or z.instanceof(); copies made by .meta() or .describe() match too. */
  overrides?: Overrides;
  /** Maximum number of extra keys for loose objects and catchalls. Default: 3. */
  maxExtraKeys?: number;
  /** Recursion levels after which collections in recursive schemas use their minimum size. Default: 3. */
  maxDepth?: number;
  /** Rejected values in a row before a filtered schema throws instead of looping forever. Default: 1000. */
  maxFilterAttempts?: number;
  /** Characters for plain strings, as in fc.string(); "grapheme" or "binary" add full Unicode. Default: "grapheme-ascii". */
  stringUnit?: StringUnit;
}

export type { StringUnit };

/** Compile error for schemas whose input type is `never`, such as z.intersection(z.string(), z.number()). */
type Satisfiable<T extends Schema> = [core.input<T>] extends [never]
  ? { "fast-check-zod: this schema accepts no values": never }
  : unknown;

/** Arbitrary of values that `schema.safeParse` accepts (schema inputs, before transforms). */
export function zodArbitrary<T extends Schema>(
  schema: T & Satisfiable<T>,
  options: ZodArbitraryOptions = {},
): fc.Arbitrary<core.input<T>> {
  return new Builder(options).build(schema) as fc.Arbitrary<core.input<T>>;
}

/** Arbitrary of parsed values (schema outputs, after defaults and transforms). Sync schemas only. */
export function zodOutputArbitrary<T extends Schema>(schema: T & Satisfiable<T>, options: ZodArbitraryOptions = {}): fc.Arbitrary<core.output<T>> {
  return zodArbitrary(schema, options).map((v) => core.parse(schema, v));
}

class Builder {
  // Keyed by def: .meta(), .describe() and .clone() copy the schema but share its def.
  private readonly overrides = new Map<object, fc.Arbitrary<unknown>>();
  private readonly cache = new Map<Schema, fc.Arbitrary<unknown>>();
  private readonly building = new Set<Schema>();
  private readonly depth: Depth;
  private readonly maxExtraKeys: number;
  private readonly maxFilterAttempts: number;
  private readonly unit: StringUnit;

  constructor(options: ZodArbitraryOptions) {
    for (const [schema, arb] of options.overrides ?? []) this.overrides.set(schema._zod.def, arb);
    this.maxExtraKeys = options.maxExtraKeys ?? 3;
    this.depth = new Depth(options.maxDepth ?? 3);
    this.maxFilterAttempts = options.maxFilterAttempts ?? 1000;
    this.unit = options.stringUnit ?? "grapheme-ascii";
  }

  build(schema: Schema): fc.Arbitrary<unknown> {
    if (!schema?._zod) throw new TypeError("fast-check-zod: expected a zod 4 schema (zod, zod/mini or zod/v4/core); zod/v3 is not supported");
    const found = this.overrides.get(schema._zod.def) ?? this.cache.get(schema);
    if (found) return found;
    if (this.building.has(schema)) return new Deferred(() => this.cache.get(schema)!, this.depth);
    this.building.add(schema);
    let built: Built;
    try {
      built = this.node(schema);
    } finally {
      this.building.delete(schema);
    }
    const { arb, exact } = built;
    const out = exact ? arb : this.filter(arb, (v) => isValid(schema, v), schema);
    this.cache.set(schema, out);
    return out;
  }

  private filter<T>(arb: fc.Arbitrary<T>, pred: (v: T) => boolean, schema: Schema): fc.Arbitrary<T> {
    return new Bounded(arb, pred, () => describe(schema), this.maxFilterAttempts);
  }

  private option(arb: fc.Arbitrary<unknown>, nil: unknown) {
    return fc.option(arb, { nil, depthIdentifier: this.depth.identifier });
  }

  /** Collections fall back to `minimal` once recursion is deep enough. */
  private capped<T>(full: fc.Arbitrary<T>, minimal: fc.Arbitrary<T>): fc.Arbitrary<T> {
    return new Capped(full, minimal, this.depth);
  }

  private array<T>(item: fc.Arbitrary<T>, b: { minLength: number; maxLength?: number } = { minLength: 0 }) {
    const full = fc.array(item, { ...b, depthIdentifier: this.depth.identifier });
    return this.capped(full, fc.array(item, { minLength: b.minLength, maxLength: b.minLength }));
  }

  private node(schema: Schema): Built {
    const def = schema._zod.def as Def;
    const defs = checkDefs(def);
    const plain = defs.length === 0;
    const ok = (arb: fc.Arbitrary<unknown>, exact = plain): Built => ({ arb, exact });

    const type = def.type as SchemaType;
    switch (type) {
      case "string":
        return stringArb(defs, this.unit);
      case "number":
      case "int":
        return numberArb(defs);
      case "bigint":
        return bigintArb(defs);
      case "date":
        return dateArb(defs);
      case "boolean":
        return ok(fc.boolean());
      case "null":
        return ok(fc.constant(null));
      case "undefined":
      case "void":
        return ok(fc.constant(undefined));
      case "nan":
        return ok(fc.constant(Number.NaN));
      case "symbol":
        return ok(fc.string({ unit: this.unit }).map((s) => Symbol(s)));
      case "any":
      case "unknown":
        return ok(fc.anything());
      case "success":
        return ok(this.build(def.innerType));
      case "never":
        throw new TypeError("fast-check-zod: z.never() has no values to generate");
      case "literal":
        return ok(fc.constantFrom(...def.values));
      case "enum": {
        const values = [...schema._zod.values!];
        if (values.length === 0) throw new TypeError("fast-check-zod: empty enum has no values");
        return ok(fc.constantFrom(...values));
      }
      case "template_literal":
        return ok(fc.stringMatching(schema._zod.pattern!), false);
      case "optional":
      case "default":
      case "prefault":
        return ok(this.option(this.build(def.innerType), undefined));
      case "nullable":
        return ok(this.option(this.build(def.innerType), null));
      case "nonoptional":
        return ok(this.filter(this.build(def.innerType), (v) => v !== undefined, schema));
      case "catch":
      case "readonly":
        return ok(this.build(def.innerType));
      case "promise":
        return ok(this.build(def.innerType).map((v) => Promise.resolve(v)), true);
      case "lazy":
        return ok(this.build((schema._zod as any).innerType));
      case "pipe":
        return ok(this.pipe(def), false);
      case "transform":
        return ok(fc.anything(), false);
      case "custom":
        return ok(fc.anything(), false);
      case "function":
        return ok(fc.func(this.build(def.output)));
      case "array": {
        const b = bounds(defs, "length");
        return ok(this.array(this.build(def.element), b), b.exact);
      }
      case "set": {
        const b = bounds(defs, "size");
        const item = this.build(def.valueType);
        const unique = (max?: number) =>
          fc.uniqueArray(item, { ...b, maxLength: max, comparator: "SameValueZero", depthIdentifier: this.depth.identifier });
        return ok(this.capped(unique(b.maxLength), unique(b.minLength)).map((xs) => new Set(xs)), b.exact);
      }
      case "map": {
        const entry = fc.tuple(this.build(def.keyType), this.build(def.valueType));
        return ok(this.array(entry).map((es) => new Map(es)), false);
      }
      case "file":
        return this.file(defs);
      case "tuple":
        return this.tuple(def, plain);
      case "object":
        return this.object(def, plain);
      case "record":
        return this.record(def);
      case "union":
        return this.union(def, plain);
      case "intersection":
        return this.intersection(def);
      default:
        return unsupported(type);
    }
  }

  private file(defs: Def[]): Built {
    const b = bounds(defs, "size");
    const mimes: string[] | undefined = defs.find((d) => d.check === "mime_type")?.mime;
    const arb = fc
      .tuple(fc.uint8Array({ minLength: b.minLength, maxLength: b.maxLength ?? 64 }), fc.constantFrom(...(mimes ?? [""])))
      .map(([bytes, type]) => {
        const file = new File([bytes], "file", { type });
        // Bun appends ";charset=utf-8" to text types, which breaks exact mime checks.
        Object.defineProperty(file, "type", { value: type });
        return file;
      });
    return { arb, exact: b.exact };
  }

  private tuple(def: Def, plain: boolean): Built {
    const items = fc.tuple(...def.items.map((s: Schema) => this.build(s)));
    if (!def.rest) return { arb: items, exact: plain };
    const rest = this.array(this.build(def.rest));
    return { arb: fc.tuple(items, rest).map(([a, r]) => [...a, ...r]), exact: plain };
  }

  private object(def: Def, plain: boolean): Built {
    const shape: Record<string, Schema> = def.shape;
    const fields: Record<string, fc.Arbitrary<unknown>> = {};
    for (const [key, s] of Object.entries(shape)) {
      const arb = this.build(s);
      assign(fields, key, omittable(s) ? this.option(arb, ABSENT) : arb);
    }
    let arb: fc.Arbitrary<Record<string, unknown>> = fc.record(fields).map((rec) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) if (v !== ABSENT) assign(out, k, v);
      return out;
    });
    const catchall: Schema | undefined = def.catchall;
    if (catchall && catchall._zod.def.type !== "never") {
      const key = fc.string({ unit: this.unit }).filter((k) => !Object.hasOwn(shape, k));
      const extra = this.capped(
        fc.dictionary(key, this.build(catchall), { maxKeys: this.maxExtraKeys, depthIdentifier: this.depth.identifier }),
        fc.constant({}),
      );
      arb = fc.tuple(arb, extra).map(([known, more]) => {
        for (const [k, v] of Object.entries(more)) assign(known, k, v);
        return known;
      });
    }
    return { arb, exact: plain };
  }

  private record(def: Def): Built {
    const keyType: Schema = def.keyType;
    const value = this.build(def.valueType);
    const finite = keyType._zod.values;
    if (finite) {
      const fields: Record<string, fc.Arbitrary<unknown>> = {};
      for (const k of finite) assign(fields, String(k), def.partial ? this.option(value, ABSENT) : value);
      const arb = fc.record(fields).map((rec) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rec)) if (v !== ABSENT) assign(out, k, v);
        return out;
      });
      return { arb, exact: false };
    }
    // Object keys are strings or symbols; zod checks number keys in their string form.
    const key = this.filter(this.build(keyType), (k) => ["string", "number", "symbol"].includes(typeof k), keyType).map(
      (k) => (typeof k === "number" ? String(k) : (k as string | symbol)),
    );
    const dict = fc.dictionary(key, value, { depthIdentifier: this.depth.identifier, noNullPrototype: true });
    return { arb: this.capped(dict, fc.constant({})), exact: false };
  }

  /** Preprocess pipes (transform first) take values meant for their target, so user functions never see junk. */
  private pipe(def: Def): fc.Arbitrary<unknown> {
    if (def.in._zod.def.type === "transform") return this.build(def.out);
    if (def.out._zod.def.type === "transform") return this.build(def.in);
    return fc.oneof(this.build(def.in), this.build(def.out));
  }

  private union(def: Def, plain: boolean): Built {
    const options = def.options.map((s: Schema) => this.build(s));
    if (options.length === 0) throw new TypeError("fast-check-zod: empty union has no values");
    const arb = fc.oneof({ depthIdentifier: this.depth.identifier }, ...options);
    return { arb, exact: plain && def.inclusive !== false };
  }

  private intersection(def: Def): Built {
    const arb = fc.tuple(this.build(def.left), this.build(def.right)).map(([a, b]) => {
      if (!isPlainObject(a) || !isPlainObject(b)) return a;
      const out: Record<string, unknown> = {};
      for (const [k, v] of [...Object.entries(a), ...Object.entries(b)]) assign(out, k, v);
      return out;
    });
    return { arb, exact: false };
  }
}
