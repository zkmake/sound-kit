import { describe, expect, it } from "vitest";

import { between, pickNotLast, seededRandom } from "./random.ts";

describe("pickNotLast", () => {
  it("never returns the last pick when there is a choice", () => {
    const random = seededRandom(1);
    let last: string | null = null;

    for (let index = 0; index < 500; index++) {
      const pick: string | undefined = pickNotLast(["a", "b", "c"], last, random);

      expect(pick).not.toBe(last);
      last = pick ?? null;
    }
  });

  it("repeats a pool of one, and returns undefined for an empty pool", () => {
    expect(pickNotLast(["only"], "only", Math.random)).toBe("only");
    expect(pickNotLast([], null, Math.random)).toBeUndefined();
  });

  it("reaches every other sample", () => {
    const random = seededRandom(4);
    const seen = new Set<string>();

    for (let index = 0; index < 100; index++) {
      seen.add(pickNotLast(["a", "b", "c", "d"], "a", random) ?? "");
    }

    expect([...seen].sort()).toEqual(["b", "c", "d"]);
  });

  it("stays in range even when random returns 1", () => {
    expect(pickNotLast(["a", "b"], null, () => 1)).toBe("b");
  });
});

describe("seededRandom", () => {
  it("repeats for a seed and stays in [0, 1)", () => {
    const one = seededRandom(42);
    const two = seededRandom(42);

    for (let index = 0; index < 1000; index++) {
      const value = one();

      expect(value).toBe(two());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("between", () => {
  it("maps random onto the range", () => {
    expect(between(() => 0, [2, 4])).toBe(2);
    expect(between(() => 0.5, [2, 4])).toBe(3);
  });
});
