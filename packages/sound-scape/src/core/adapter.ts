import { type SoundscapeBus } from "./types.ts";

/** The source of a sample: a URL, or URLs in order of preference (`[opus, m4a]`). The first one the browser plays wins. */
type SampleSource = string | readonly string[];

type DuckOptions = {
  /** How far the bus dips, in dB. Default −12. */
  db?: number;
  /** Default 120. */
  attackMs?: number;
  /** Default 450. */
  releaseMs?: number;
};

type LoadOptions = {
  /** Called as each sample settles, loaded or not, so a loading bar never stalls on a bad file. */
  onProgress?: (settled: number, total: number) => void;
};

/**
 * What both shipped adapters give the game on top of the engine's four functions: loading,
 * ducking, a level, mute and teardown. The bus is the ambience bus; share one between soundscapes
 * and its duck and level carry across a swap.
 */
type SoundscapeAdapter<Id = unknown> = SoundscapeBus<Id> & {
  /** Fetch and decode every sample. Never rejects: a sample that fails logs once and stays silent. */
  load(opts?: LoadOptions): Promise<void>;
  /**
   * Dip every voice on the bus, ones already playing included, and return the release. Ducks
   * count: the bus comes back up when the last one is released.
   */
  duck(opts?: DuckOptions): () => void;
  readonly ducked: boolean;
  /** The bus level, 0..1 (the Web Audio adapter allows more), for a settings slider. */
  setLevel(level: number, fadeMs?: number): void;
  /** Mute in place: beds keep their phase and come back without a click; emitters don't fire while muted. */
  setMuted(muted: boolean): void;
  /** Stop every voice on the bus. */
  stopAll(fadeOutMs?: number): void;
  /** Voices playing now: beds and emitters. */
  readonly voices: number;
  dispose(): void;
};

const DEFAULT_DUCK = { db: -12, attackMs: 120, releaseMs: 450 } as const;

const dbToGain = (db: number) => 10 ** (db / 20);

const sources = (source: SampleSource): readonly string[] =>
  typeof source === "string" ? [source] : source;

/**
 * Ref-counted ducking: `duck()` returns a release that works once. The deepest duck held wins;
 * releasing it eases back to the next deepest, or to full. `apply(gain, ms)` moves the adapter's
 * duck multiplier.
 */
const createDucker = (
  defaults: DuckOptions | undefined,
  apply: (gain: number, fadeMs: number) => void,
) => {
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
      const db = opts.db ?? defaults?.db ?? DEFAULT_DUCK.db;
      const attackMs = opts.attackMs ?? defaults?.attackMs ?? DEFAULT_DUCK.attackMs;
      const releaseMs = opts.releaseMs ?? defaults?.releaseMs ?? DEFAULT_DUCK.releaseMs;
      const token = Symbol("duck");

      held.set(token, dbToGain(db));
      update(attackMs);

      return () => {
        if (held.delete(token)) {
          update(releaseMs);
        }
      };
    },
    get ducked() {
      return held.size > 0;
    },
    clear() {
      held.clear();
      current = 1;
    },
  };
};

/** Warn once per sample: a missing file shouldn't flood the console every fire. */
const createWarnOnce = (label: string) => {
  const warned = new Set<string>();

  return (sample: string, message: string) => {
    if (!warned.has(sample)) {
      warned.add(sample);
      // oxlint-disable-next-line no-console
      console.warn(`[${label}] ${sample}: ${message}`);
    }
  };
};

export { createDucker, createWarnOnce, dbToGain, DEFAULT_DUCK, sources };
export type { DuckOptions, LoadOptions, SampleSource, SoundscapeAdapter };
