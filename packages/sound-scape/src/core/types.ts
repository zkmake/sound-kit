/** `[low, high]`: each fire draws a value uniformly between them. */
type Range = readonly [number, number];

/**
 * The looping layer under the emitters: room tone, wind, traffic. It is never positional (room
 * tone comes from everywhere) and never silent while the soundscape runs.
 */
type BedDef<Sample extends string = string> = {
  sample: Sample;
  volume: number;
  /** Default 500. A bed that starts at full level is heard as a seam. */
  fadeInMs?: number;
  /** Default 700. */
  fadeOutMs?: number;
};

/**
 * Short, non-musical samples fired on a random timer, each fire with its own volume, rate and pan.
 * Every emitter is its own metronome: it waits a random interval, fires, and re-arms.
 */
type EmitterDef<Sample extends string = string> = {
  /** Used by `fire(name)` and `onEmitter`. Defaults to the emitter's index. */
  name?: string;
  /** The pool. A fire picks one at random, never the one this emitter played last. 3–6 is plenty. */
  samples: readonly Sample[];
  /** Wait between fires, ms. */
  intervalMs: Range;
  /** Default `[0.7, 1]`. */
  volume?: Range;
  /** Playback rate. Default `[0.95, 1.05]`: past about ±5% a sample turns chipmunk or sluggish. */
  rate?: Range;
  /** Stereo pan, −1..1. Default `[-0.4, 0.4]`. */
  pan?: Range;
};

type SoundscapeDef<Sample extends string = string> = {
  bed?: BedDef<Sample> | null;
  emitters?: readonly EmitterDef<Sample>[];
  /** Emitter voices allowed at once across this soundscape. A fire past the cap is dropped, not queued. Default 4. */
  maxConcurrent?: number;
};

/**
 * Everything the engine asks of the audio backend: four functions. An adapter (`./howler`,
 * `./web-audio`, or your own) implements them over its own voices and buses; ducking, muting and
 * levels are the adapter's business, not the engine's.
 *
 * Ids are the adapter's own; the engine only hands them back.
 */
type SoundscapeBus<Id = unknown> = {
  /** Start a looping bed, fading in from silence. `null` when the sample is missing or can't play. */
  playBed(sample: string, opts: { volume: number; fadeInMs: number }): Id | null;
  /**
   * Start a one-shot. Call `onEnd` once when it finishes by itself; a voice stopped through
   * `stop` need not call it. `null` when it can't play: the fire is skipped.
   */
  playEmitter(
    sample: string,
    opts: { volume: number; rate: number; pan: number; onEnd: () => void },
  ): Id | null;
  /**
   * Fade a voice to silence over `fadeOutMs` (0: at once), then stop it. Must forget the id
   * synchronously, so a fade in flight survives a dispose that follows.
   */
  stop(id: Id, fadeOutMs: number): void;
  /** Move a live voice's volume (before any bus level or duck), over `fadeMs`. */
  setVolume(id: Id, volume: number, fadeMs: number): void;
};

/** `setTimeout`'s shape, so a test can drive time by hand. */
type Timers = {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

type EmitterPhase = "start" | "end";

type SoundscapeOptions = {
  /** `Math.random`'s shape. Pass `seededRandom(n)` for a soundscape that plays the same way each time. */
  random?: () => number;
  timers?: Timers;
  /** Called when an emitter voice starts and when it ends. For captions, debug panels or tests. */
  onEmitter?: (event: { emitter: string; sample: string; phase: EmitterPhase }) => void;
};

export type {
  BedDef,
  EmitterDef,
  EmitterPhase,
  Range,
  SoundscapeBus,
  SoundscapeDef,
  SoundscapeOptions,
  Timers,
};
