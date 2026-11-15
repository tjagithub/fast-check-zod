# fast-check-zod

Make [fast-check](https://fast-check.dev) arbitraries from [zod](https://zod.dev) 4 schemas.

```ts
import fc from "fast-check";
import { z } from "zod";
import { zodArbitrary, zodOutputArbitrary } from "fast-check-zod";

const User = z.object({
  id: z.uuid(),
  email: z.email(),
  age: z.int().min(0).max(120).optional(),
  tags: z.array(z.enum(["a", "b"])).max(3),
});

fc.assert(fc.property(zodArbitrary(User), (input) => User.safeParse(input).success));
```

- `zodArbitrary(schema)` makes values that `schema.safeParse` accepts (schema input, before transforms).
- `zodOutputArbitrary(schema)` makes parsed values (after defaults and transforms). Sync schemas only.

## Supported zod variants

- `zod` (classic), `zod/mini` / `@zod/mini`, and `zod/v4/core` schemas all work, because they share core's `_zod.def`.
- Schemas compiled by `zod/compile` work too; only their parser changes.
- `zod/v3` is not supported and throws a `TypeError`.

## How it works

The builder walks `schema._zod.def`. Bounds, lengths, sizes, `multipleOf`, integer formats and string affixes are built into the generators. String formats use fast-check's `stringMatching` on zod's regex, or a hand-written generator where the regex cannot be inverted (duration, emoji, hostname, base64, JWT, credit card, IBAN, URL). If a node has a constraint that is not built in, such as `.refine()`, `.trim()`, `z.xor()`, intersections or pipes, its values are filtered through `safeParse`.

Recursion works with `z.lazy()` and with getter-based recursive objects. Once recursion goes past `maxDepth` levels (default 3), arrays, sets, maps and records use their minimum size, and unions and optionals favour their first branch.

## Options

```ts
zodArbitrary(schema, {
  overrides: [[UrlSchema, fc.webUrl().map((u) => new URL(u))]], // per schema instance
  maxDepth: 3,
  maxExtraKeys: 3, // extra keys for looseObject / catchall
  maxFilterAttempts: 1000, // rejected values in a row before a filtered schema throws
});
```

Use `overrides` for `z.custom()`, `z.instanceof()`, and refinements that random values rarely pass.

## Limits

- A schema whose input type is `never` fails to compile, for example `z.never()`, `z.intersection(z.string(), z.number())` or `z.literal("a").and(z.literal("b"))`. zod does not put bounds in its types, so bounds no value can meet, like `.min(5).max(4)` or `.multipleOf(0)`, throw a `RangeError` when you build the arbitrary instead.
- Async refinements cannot run inside a filter, so those values are not checked.
- Filtered schemas give up after `maxFilterAttempts` rejected values in a row. They throw an error that names the schema, for example `gave up after 1000 rejected values for custom`, instead of looping forever. This affects `z.custom()` and `z.instanceof()` without an override, and constraints that rarely pass, such as a regex with a tight `.max()`.
- `z.preprocess()` gets values generated for its target schema, so your function never sees random values. Other pipes mix values for their input and their output.

## Testing

- `bun test` runs the suites.
- `bun run coverage` checks 100% line and function coverage. Bun writes no branch records (`BRDA`) to LCOV.
- `bun run coverage:branches` runs the same files under vitest with V8 coverage (`bun:test` is aliased to `vitest`). It requires 100% of statements, branches, functions and lines.
- `tests/fuzz.test.ts` builds random satisfiable schemas (`tests/support/`) and checks that every generated value passes `safeParse`. It runs 300 schemas by default; set `FUZZ_RUNS=5000` for a longer search. Counterexamples print as `z.…` code.
- `tests/surface.test.ts` has one sample for each zod schema type, check kind and string format. The tables are typed with zod's own unions, so `bun check` fails when a new zod release adds a kind without a sample.
