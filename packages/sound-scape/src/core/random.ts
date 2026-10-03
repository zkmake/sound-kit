import { type Range } from "./types.ts";

/** A value drawn uniformly from `[low, high]`. */
const between = (random: () => number, [low, high]: Range) => low + random() * (high - low);

/**
 * One of `pool` at random, never `last` when there is a choice. With one sample it repeats; with
 * two it alternates; with three or more the ear stops hearing a pattern.
 */
const pickNotLast = <T>(
  pool: readonly T[],
  last: T | null,
  random: () => number,
): T | undefined => {
  const choices = pool.length > 1 ? pool.filter((item) => item !== last) : pool;
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));

  return choices[index] ?? pool[0];
};

/**
 * A small seeded generator (mulberry32) in `Math.random`'s shape: the same seed plays the same
 * soundscape, for tests and for demos you want to reproduce.
 */
const seededRandom = (seed: number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export { between, pickNotLast, seededRandom };
