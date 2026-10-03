/** A URL, or URLs in order of preference (`[opus, m4a]`): the first one the browser decodes wins. */
type SampleSource = string | readonly string[];

/** `[low, high]`: each play draws a value uniformly between them. */
type Range = readonly [number, number];

/** A fixed value, or a range drawn per play. */
type Param = number | Range;

/** The buses a mixer gets when you don't name your own. */
type DefaultBus = "music" | "sfx" | "ambience" | "ui" | "voice";

type SoundDef<Bus extends string = string> = {
  /** One sample. Use `variants` instead for a pool. */
  src?: SampleSource;
  /** A pool: each play picks one at random, never the one this sound played last. */
  variants?: readonly SampleSource[];
  /** Default `"sfx"`. */
  bus?: Bus;
  /** Default 1. Above 1 is fine: it's a GainNode, not an `<audio>` volume. */
  volume?: Param;
  /** Playback rate, which shifts pitch too. Default 1. Keep ranges within about ±5%. */
  rate?: Param;
  /** Stereo pan, −1..1. Default 0. */
  pan?: Param;
  loop?: boolean;
  /** Fade in from silence, ms. Default 0 (a loop gets 8 ms so it never clicks in). */
  fadeInMs?: number;
  /** Voices of this sound at once. Default 8. */
  voices?: number;
  /** At the cap: `"steal"` (default) stops the oldest voice; `"drop"` skips the new one. */
  onLimit?: "steal" | "drop";
  /** Load with `load()`. Default true; `false` loads on first play instead. */
  preload?: boolean;
};

type BusOptions = {
  /** Default 1. */
  level?: number;
  /** Voices on the bus at once, across its sounds. Default unlimited. */
  voices?: number;
};

type PlayOptions = {
  /** Overrides the def's volume (before the bus level, duck and master). */
  volume?: number;
  rate?: number;
  pan?: number;
  loop?: boolean;
  fadeInMs?: number;
  /** Start this long from now, on the audio clock. */
  delayMs?: number;
  /** Start this far into the sample, seconds. */
  offset?: number;
  /** Override the def's bus. */
  bus?: string;
  /**
   * Route the voice into this node instead of its bus input: for a panner or an effect that then
   * connects to `mixer.input(bus)` itself.
   */
  output?: AudioNode;
  /** Called once when the voice ends by itself, not when it is stopped. */
  onEnd?: () => void;
};

/** A playing sound. Every method is safe to call after it ended. */
type Voice = {
  readonly id: number;
  readonly sound: string;
  readonly bus: string;
  /** False once it ended or was stopped. */
  readonly playing: boolean;
  /** Fade out (default 30 ms, never an instant cut), then stop. */
  stop(fadeOutMs?: number): void;
  setVolume(volume: number, fadeMs?: number): void;
  /** Before the bus's global rate. */
  setRate(rate: number, fadeMs?: number): void;
  setPan(pan: number, fadeMs?: number): void;
};

type MixerSettings<Bus extends string = string> = {
  muted: boolean;
  /** `master` and every bus, 0..1 (above 1 is allowed). */
  levels: Record<Bus | "master", number>;
  /** Buses switched off, as a settings screen's "Music: off" toggle does. */
  mutedBuses: readonly Bus[];
};

type DuckOptions = {
  /** How far the bus dips, dB. Default −12. */
  db?: number;
  /** Default 120. */
  attackMs?: number;
  /** Default 450. */
  releaseMs?: number;
};

type LoadOptions<Name extends string = string> = {
  /** Only these sounds. Default: every sound without `preload: false`. */
  only?: readonly Name[];
  /** Called as each file settles, loaded or not, so a loading bar never stalls on a bad file. */
  onProgress?: (settled: number, total: number) => void;
};

export type {
  BusOptions,
  DefaultBus,
  DuckOptions,
  LoadOptions,
  MixerSettings,
  Param,
  PlayOptions,
  Range,
  SampleSource,
  SoundDef,
  Voice,
};
