import fc from "fast-check";
import type { Built } from "./types.js";

type Def = Record<string, any>;

const NUMBER_FORMATS: Record<string, [number, number, boolean]> = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true],
  int32: [-(2 ** 31), 2 ** 31 - 1, true],
  uint32: [0, 2 ** 32 - 1, true],
  float32: [-3.4028234663852886e38, 3.4028234663852886e38, false],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE, false],
};

const BIGINT_FORMATS: Record<string, [bigint, bigint]> = {
  int64: [-(2n ** 63n), 2n ** 63n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
};

/** Collects bounds shared by number, bigint and date checks; flags anything else. */
function collect<T>(defs: Def[], known: string[]) {
  let min: { value: T; inclusive: boolean } | undefined;
  let max: { value: T; inclusive: boolean } | undefined;
  const multiples: T[] = [];
  const formats: string[] = [];
  let exact = true;
  for (const d of defs) {
    if (d.check === "greater_than") {
      if (!min || d.value > min.value || (d.value === min.value && !d.inclusive)) min = d as any;
    } else if (d.check === "less_than") {
      if (!max || d.value < max.value || (d.value === max.value && !d.inclusive)) max = d as any;
    } else if (d.check === "multiple_of") multiples.push(d.value);
    else if (known.includes(d.check)) formats.push(d.format);
    else exact = false;
  }
  return { min, max, multiples, formats, exact };
}

export function numberArb(defs: Def[]): Built {
  const c = collect<number>(defs, ["number_format"]);
  let lo = -Number.MAX_VALUE;
  let hi = Number.MAX_VALUE;
  let loEx = false;
  let hiEx = false;
  let int = false;
  for (const f of c.formats) {
    const [a, b, isInt] = NUMBER_FORMATS[f]!;
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    int ||= isInt;
  }
  if (c.min && (c.min.value > lo || (c.min.value === lo && !c.min.inclusive))) {
    lo = c.min.value;
    loEx = !c.min.inclusive;
  }
  if (c.max && (c.max.value < hi || (c.max.value === hi && !c.max.inclusive))) {
    hi = c.max.value;
    hiEx = !c.max.inclusive;
  }
  let exact = c.exact && c.multiples.length <= 1;
  const step = c.multiples[0];
  if (step === 0) throw new RangeError("fast-check-zod: multipleOf(0) accepts no number");

  if (int || step !== undefined) {
    // Generate k and emit k * step, so multipleOf and integer checks hold by construction.
    const m = step === undefined ? 1 : Math.abs(step);
    let kLo = Math.ceil(lo / m);
    let kHi = Math.floor(hi / m);
    if (loEx && kLo * m <= lo) kLo++;
    if (hiEx && kHi * m >= hi) kHi--;
    if (!Number.isInteger(m)) exact = false;
    kLo = Math.max(kLo, Number.MIN_SAFE_INTEGER);
    kHi = Math.min(kHi, Number.MAX_SAFE_INTEGER);
    if (kLo > kHi) throw new RangeError(`fast-check-zod: no number satisfies the bounds [${lo}, ${hi}] step ${m}`);
    return { arb: fc.integer({ min: kLo, max: kHi }).map((k) => k * m + 0), exact };
  }
  if (lo > hi || (lo === hi && (loEx || hiEx))) {
    throw new RangeError(`fast-check-zod: no number satisfies the bounds [${lo}, ${hi}]`);
  }
  const arb = fc.double({ min: lo, max: hi, minExcluded: loEx, maxExcluded: hiEx, noNaN: true, noDefaultInfinity: true });
  return { arb, exact };
}

const ceilDiv = (a: bigint, b: bigint) => (a >= 0n ? (a + b - 1n) / b : -(-a / b));
const floorDiv = (a: bigint, b: bigint) => (a >= 0n ? a / b : -((-a + b - 1n) / b));

export function bigintArb(defs: Def[]): Built {
  const c = collect<bigint>(defs, ["bigint_format"]);
  let lo: bigint | undefined;
  let hi: bigint | undefined;
  for (const f of c.formats) {
    const [a, b] = BIGINT_FORMATS[f]!;
    lo = lo === undefined || a > lo ? a : lo;
    hi = hi === undefined || b < hi ? b : hi;
  }
  if (c.min) {
    const v = c.min.inclusive ? c.min.value : c.min.value + 1n;
    lo = lo === undefined || v > lo ? v : lo;
  }
  if (c.max) {
    const v = c.max.inclusive ? c.max.value : c.max.value - 1n;
    hi = hi === undefined || v < hi ? v : hi;
  }
  if (lo !== undefined && hi !== undefined && lo > hi) {
    throw new RangeError(`fast-check-zod: no bigint satisfies the bounds [${lo}, ${hi}]`);
  }
  const step = c.multiples[0];
  if (step === 0n) throw new RangeError("fast-check-zod: multipleOf(0n) accepts no bigint");
  if (step === undefined) return { arb: fc.bigInt({ min: lo, max: hi }), exact: c.exact };
  const m = step < 0n ? -step : step;
  const kLo = lo === undefined ? undefined : ceilDiv(lo, m);
  const kHi = hi === undefined ? undefined : floorDiv(hi, m);
  if (kLo !== undefined && kHi !== undefined && kLo > kHi) {
    throw new RangeError(`fast-check-zod: no bigint multiple of ${m} lies in [${lo}, ${hi}]`);
  }
  return { arb: fc.bigInt({ min: kLo, max: kHi }).map((k) => k * m), exact: c.exact && c.multiples.length === 1 };
}

export function dateArb(defs: Def[]): Built {
  const c = collect<Date>(defs, []);
  const min = c.min && new Date(c.min.value.getTime() + (c.min.inclusive ? 0 : 1));
  const max = c.max && new Date(c.max.value.getTime() - (c.max.inclusive ? 0 : 1));
  if (min && max && min > max) throw new RangeError("fast-check-zod: no date satisfies the bounds");
  return { arb: fc.date({ min, max, noInvalidDate: true }), exact: c.exact };
}
