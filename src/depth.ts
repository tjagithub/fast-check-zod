import fc from "fast-check";

/** Tracks how many recursive schema references are open while a value is generated. */
export class Depth {
  level = 0;
  readonly identifier = fc.createDepthIdentifier();
  private readonly context = fc.getDepthContextFor(this.identifier);

  constructor(readonly max: number) {}

  /** Runs `fn` one recursion level deeper; fc's oneof and option then favour their first branch. */
  enter<T>(fn: () => T): T {
    this.level++;
    this.context.depth++;
    try {
      return fn();
    } finally {
      this.level--;
      this.context.depth--;
    }
  }

  get exhausted(): boolean {
    return this.level >= this.max;
  }
}

/** Stands in for a schema that is still being built, which marks a recursive reference. */
export class Deferred<T> extends fc.Arbitrary<T> {
  constructor(
    private readonly resolve: () => fc.Arbitrary<T>,
    private readonly depth: Depth,
  ) {
    super();
  }

  generate(mrng: fc.Random, bias: number | undefined): fc.Value<T> {
    return this.depth.enter(() => this.resolve().generate(mrng, bias));
  }

  canShrinkWithoutContext(value: unknown): value is T {
    return this.resolve().canShrinkWithoutContext(value);
  }

  shrink(value: T, context: unknown): fc.Stream<fc.Value<T>> {
    return this.resolve().shrink(value, context);
  }
}

interface CappedContext<T> {
  source: fc.Arbitrary<T>;
  inner: unknown;
}

/** Uses `minimal` instead of `full` once the recursion budget is spent, so recursive values stay finite. */
export class Capped<T> extends fc.Arbitrary<T> {
  constructor(
    private readonly full: fc.Arbitrary<T>,
    private readonly minimal: fc.Arbitrary<T>,
    private readonly depth: Depth,
  ) {
    super();
  }

  private wrap(source: fc.Arbitrary<T>, v: fc.Value<T>): fc.Value<T> {
    return new fc.Value(v.value_, { source, inner: v.context } satisfies CappedContext<T>);
  }

  generate(mrng: fc.Random, bias: number | undefined): fc.Value<T> {
    const source = this.depth.exhausted ? this.minimal : this.full;
    return this.wrap(source, source.generate(mrng, bias));
  }

  canShrinkWithoutContext(value: unknown): value is T {
    return this.full.canShrinkWithoutContext(value);
  }

  shrink(value: T, context: unknown): fc.Stream<fc.Value<T>> {
    const ctx = context as CappedContext<T> | undefined;
    const source = ctx?.source ?? this.full;
    return source.shrink(value, ctx?.inner).map((v) => this.wrap(source, v));
  }
}
