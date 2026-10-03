import { type DuckOptions, type Param, type SampleSource } from "./types.ts";

const DEFAULT_DUCK = { db: -12, attackMs: 120, releaseMs: 450 } as const;

const dbToGain = (db: number) => (db === -Infinity ? 0 : 10 ** (db / 20));

/** A fixed value, or one drawn from a range. */
const draw = (param: Param | undefined, fallback: number, random: () => number) => {
  if (param === undefined) {
    return fallback;
  }

  return typeof param === "number" ? param : param[0] + random() * (param[1] - param[0]);
};

/** One of `pool` at random, never `last` when there is a choice. */
const pickNotLast = <T>(
  pool: readonly T[],
  last: T | null,
  random: () => number,
): T | undefined => {
  const choices = pool.length > 1 ? pool.filter((item) => item !== last) : pool;
  const index = Math.min(choices.length - 1, Math.floor(random() * choices.length));

  return choices[index] ?? pool[0];
};

const sources = (source: SampleSource): readonly string[] =>
  typeof source === "string" ? [source] : source;

/** Ramps start from where the param is now, so a fade that interrupts a fade doesn't jump. */
const rampTo = (param: AudioParam, target: number, now: number, ms: number) => {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  // Never an instant step: 8 ms is below hearing a fade, above hearing a click.
  param.linearRampToValueAtTime(target, now + Math.max(ms, 8) / 1000);
};

/**
 * Ref-counted ducking: `duck()` returns a release that works once. The deepest duck held wins;
 * releasing it eases back to the next deepest, or to full.
 */
const createDucker = (apply: (gain: number, fadeMs: number) => void) => {
  const held = new Map<symbol, number>();
  let current = 1;

  const update = (fadeMs: number) => {
    const target = Math.min(1, ...held.values());

    if (target !== current) {
      current = target;
      apply(target, fadeMs);
    }
  };

  return {
    duck(opts: DuckOptions = {}) {
      const token = Symbol("duck");
      const releaseMs = opts.releaseMs ?? DEFAULT_DUCK.releaseMs;

      held.set(token, dbToGain(opts.db ?? DEFAULT_DUCK.db));
      update(opts.attackMs ?? DEFAULT_DUCK.attackMs);

      return () => {
        if (held.delete(token)) {
          update(releaseMs);
        }
      };
    },
    get ducked() {
      return held.size > 0;
    },
    get gain() {
      return current;
    },
  };
};

/** Warn once per key: a missing file shouldn't flood the console every play. */
const createWarnOnce = (label: string) => {
  const warned = new Set<string>();

  return (key: string, message: string) => {
    if (!warned.has(key)) {
      warned.add(key);
      // oxlint-disable-next-line no-console
      console.warn(`[${label}] ${key}: ${message}`);
    }
  };
};

const MIME: Record<string, string> = {
  aac: "audio/mp4",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: 'audio/ogg; codecs="opus"',
  wav: "audio/wav",
  webm: "audio/webm",
};

/** Sources the browser says it may play, in the order given; unknown extensions are kept. */
const playable = (urls: readonly string[]) => {
  if (typeof document === "undefined") {
    return urls;
  }

  const probe = document.createElement("audio");

  return urls.filter((url) => {
    const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
    const mime = extension ? MIME[extension] : undefined;

    return mime === undefined || probe.canPlayType(mime) !== "";
  });
};

export {
  createDucker,
  createWarnOnce,
  dbToGain,
  DEFAULT_DUCK,
  draw,
  pickNotLast,
  playable,
  rampTo,
  sources,
};
