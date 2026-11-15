import type fc from "fast-check";

/** An arbitrary plus whether every value it makes is known to pass the schema. */
export interface Built {
  arb: fc.Arbitrary<unknown>;
  exact: boolean;
}
