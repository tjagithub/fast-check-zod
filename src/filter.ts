import fc from "fast-check";

/** Like `arb.filter(pred)`, but throws after `tries` rejections in a row instead of looping forever. */
export class Bounded<T> extends fc.Arbitrary<T> {
  constructor(
    private readonly arb: fc.Arbitrary<T>,
    private readonly pred: (value: T) => boolean,
    private readonly label: () => string,
    private readonly tries: number,
  ) {
    super();
  }

  generate(mrng: fc.Random, bias: number | undefined): fc.Value<T> {
    for (let i = 0; i < this.tries; i++) {
      const v = this.arb.generate(mrng, bias);
      if (this.pred(v.value_)) return v;
    }
    throw new Error(
      `fast-check-zod: gave up after ${this.tries} rejected values for ${this.label()}. ` +
        "Pass an override for this schema, or raise maxFilterAttempts.",
    );
  }

  canShrinkWithoutContext(value: unknown): value is T {
    return this.arb.canShrinkWithoutContext(value) && this.pred(value);
  }

  shrink(value: T, context: unknown): fc.Stream<fc.Value<T>> {
    return this.arb.shrink(value, context).filter((v) => this.pred(v.value_));
  }
}
