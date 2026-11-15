import fc from "fast-check";
import { regexes } from "zod/v4/core";
import type { Built } from "./types.ts";

type Def = Record<string, any>;

const AFFIXES = new Set(["starts_with", "ends_with", "includes", "lowercase", "uppercase"]);
const EMOJI = ["😀", "🎉", "🚀", "❤️", "👍", "🔥", "🌍", "🇫🇷", "1️⃣", "🧪"];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const digits = (min: number, max: number) =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: min, maxLength: max }).map((d) => d.join(""));

function luhnComplete(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    let d = Number(body[body.length - 1 - i]);
    if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return body + ((10 - (sum % 10)) % 10);
}

function ibanComplete(country: string, bban: string): string {
  const moved = (bban + country + "00").replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of moved) rem = (rem * 10 + Number(ch)) % 97;
  return country + String(98 - rem).padStart(2, "0") + bban;
}

const label = fc.stringMatching(/^[a-z0-9](?:[a-z0-9-]{0,10}[a-z0-9])?$/);
const tld = fc.stringMatching(/^[a-z]{2,6}$/);
const durationPart = (unit: string) => fc.option(fc.nat({ max: 999 }).map((n) => `${n}${unit}`), { nil: "" });

/** Builds strings from a regex, falling back to plain strings for syntax fast-check cannot invert. */
function fromPattern(pattern: RegExp | undefined): fc.Arbitrary<string> {
  if (!pattern) return fc.string();
  // A leading length lookahead such as (?=.{1,253}$) cannot be inverted; the schema filter enforces it.
  const source = pattern.source.replace(/^\^\(\?=\.\{\d*,?\d*\}\$\)/, "^");
  try {
    return fc.stringMatching(new RegExp(source, pattern.flags));
  } catch {
    return fc.string();
  }
}

/** Arbitrary for one string format check; callers filter the result against the schema. */
function formatArb(d: Def): fc.Arbitrary<string> {
  switch (d.format) {
    case "email":
      // zod's default email regex inverts to noisy strings; build readable ones unless a custom pattern is set.
      if (String(d.pattern) !== String(regexes.email)) return fromPattern(d.pattern);
      return fc
        .tuple(fc.array(label, { minLength: 1, maxLength: 2 }), fc.array(label, { minLength: 1, maxLength: 2 }), tld)
        .map(([local, host, top]) => `${local.join(".")}@${host.join(".")}.${top}`);
    case "url": {
      // zod tests url.protocol (no colon) and url.hostname against these regexes separately.
      const protocol = d.protocol ? fromPattern(d.protocol).map((p) => p.toLowerCase()) : fc.constantFrom("http", "https");
      const host = d.hostname ? fromPattern(d.hostname) : fc.domain();
      return fc.tuple(protocol, host, fc.webPath()).map(([p, h, path]) => `${p}://${h}${path}`);
    }
    case "base64":
      return fc.uint8Array({ maxLength: 48 }).map((b) => Buffer.from(b).toString("base64"));
    case "base64url":
      return fc.uint8Array({ maxLength: 48 }).map((b) => Buffer.from(b).toString("base64url"));
    case "emoji":
      return fc.array(fc.constantFrom(...EMOJI), { minLength: 1, maxLength: 5 }).map((e) => e.join(""));
    case "hostname":
      return fc.array(label, { minLength: 1, maxLength: 4 }).map((l) => l.join("."));
    case "duration":
      return fc
        .tuple(durationPart("Y"), durationPart("M"), fc.nat({ max: 999 }), durationPart("H"), durationPart("M"), durationPart("S"))
        .map(([y, mo, d, h, mi, s]) => {
          const time = h + mi + s;
          return `P${y}${mo}${d}D${time && `T${time}`}`;
        });
    case "credit_card":
      return digits(12, 18).map((body) => luhnComplete(body.replace(/^0/, "4")));
    case "iban":
      return fc
        .tuple(fc.constantFrom(...LETTERS), fc.constantFrom(...LETTERS), fc.stringMatching(/^[A-Z0-9]{11,30}$/))
        .map(([a, b, bban]) => ibanComplete(a + b, bban));
    case "jwt": {
      const header = b64url(JSON.stringify({ alg: d.alg ?? "HS256", typ: "JWT" }));
      return fc
        .tuple(fc.dictionary(fc.string(), fc.jsonValue()), fc.uint8Array({ minLength: 1, maxLength: 32 }))
        .map(([payload, sig]) => `${header}.${b64url(JSON.stringify(payload))}.${Buffer.from(sig).toString("base64url")}`);
    }
    default:
      return fromPattern(d.pattern);
  }
}

export function stringArb(defs: Def[]): Built {
  let min = 0;
  let max: number | undefined;
  let exact = true;
  let prefix = "";
  let suffix = "";
  const includes: string[] = [];
  let casing: "lowercase" | "uppercase" | undefined;
  const formats: Def[] = [];

  for (const d of defs) {
    if (d.check === "min_length") min = Math.max(min, d.minimum);
    else if (d.check === "max_length") max = Math.min(max ?? Infinity, d.maximum);
    else if (d.check === "length_equals") {
      min = Math.max(min, d.length);
      max = Math.min(max ?? Infinity, d.length);
    } else if (d.check === "string_format" && AFFIXES.has(d.format)) {
      exact = false;
      if (d.format === "starts_with") prefix = d.prefix.length > prefix.length ? d.prefix : prefix;
      else if (d.format === "ends_with") suffix = d.suffix.length > suffix.length ? d.suffix : suffix;
      else if (d.format === "includes") includes.push(d.includes);
      else casing = d.format;
    } else if (d.check === "string_format") formats.push(d);
    else exact = false;
  }
  if (max !== undefined && min > max) throw new RangeError(`fast-check-zod: string length bounds [${min}, ${max}] are empty`);

  if (formats.length > 0) return { arb: formatArb(formats[0]!), exact: false };

  const fixed = prefix.length + suffix.length + includes.reduce((n, s) => n + s.length, 0);
  const core = fc.string({
    minLength: Math.max(0, min - fixed),
    maxLength: max === undefined ? undefined : Math.max(0, max - fixed),
  });
  let arb: fc.Arbitrary<string> = includes.length
    ? fc.tuple(core, fc.nat()).map(([s, at]) => {
        const i = at % (s.length + 1);
        return s.slice(0, i) + includes.join("") + s.slice(i);
      })
    : core;
  if (prefix || suffix) arb = arb.map((s) => prefix + s + suffix);
  if (casing === "lowercase") arb = arb.map((s) => s.toLowerCase());
  if (casing === "uppercase") arb = arb.map((s) => s.toUpperCase());
  return { arb, exact };
}
