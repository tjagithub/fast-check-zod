import * as core from "zod/v4/core";

export type Schema = core.$ZodType;
export type Def = Record<string, any>;
export type SchemaType = core.$ZodTypeDef["type"];

export const ABSENT = Symbol("absent");

export function isValid(schema: Schema, value: unknown): boolean {
  try {
    return core.safeParse(schema, value).success;
  } catch (e) {
    // Async refinements cannot run inside a filter; accept the value.
    if (e instanceof core.$ZodAsyncError) return true;
    throw e;
  }
}

/** The schema's own format check (as in z.email()) followed by its attached checks. */
export function checkDefs(def: Def): Def[] {
  const own = typeof def.check === "string" ? [def] : [];
  return [...own, ...(def.checks ?? []).map((c: any) => c._zod.def)];
}

/** Reads min/max length or size checks; any other check makes the node inexact. */
export function bounds(defs: Def[], unit: "length" | "size") {
  let min = 0;
  let max: number | undefined;
  let exact = true;
  for (const d of defs) {
    if (d.check === `min_${unit}`) min = Math.max(min, d.minimum);
    else if (d.check === `max_${unit}`) max = Math.min(max ?? Infinity, d.maximum);
    else if (d.check === `${unit}_equals`) {
      min = Math.max(min, d[unit]);
      max = Math.min(max ?? Infinity, d[unit]);
    } else if (d.check !== "mime_type") exact = false;
  }
  if (max !== undefined && min > max) throw new RangeError(`fast-check-zod: ${unit} bounds [${min}, ${max}] are empty`);
  return { minLength: min, maxLength: max, exact };
}

export function assign(target: Record<PropertyKey, unknown>, key: PropertyKey, value: unknown) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

/** Whether an object key may be left out: zod marks z.preprocess() optional even when undefined fails. */
export function omittable(schema: Schema): boolean {
  if (schema._zod.optin !== "optional") return false;
  try {
    return isValid(schema, undefined);
  } catch {
    return false;
  }
}

/** Short schema description for error messages, e.g. `string (format "url")`. */
export function describe(schema: Schema): string {
  const def = schema._zod.def as Def;
  const formats = checkDefs(def).map((d) => d.format ?? d.check);
  return formats.length ? `${def.type} (${formats.map((f) => JSON.stringify(f)).join(", ")})` : def.type;
}

/** Fails type checking when a zod release adds a schema type the switch does not handle. */
export function unsupported(type: never): never {
  throw new TypeError(`fast-check-zod: unsupported schema type "${String(type)}"; pass an override`);
}
