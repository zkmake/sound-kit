import { between, pickNotLast } from "./random.ts";
import {
  type EmitterDef,
  type Range,
  type SoundscapeBus,
  type SoundscapeDef,
  type SoundscapeOptions,
  type Timers,
} from "./types.ts";

const DEFAULT_VOLUME: Range = [0.7, 1];
const DEFAULT_RATE: Range = [0.95, 1.05];
const DEFAULT_PAN: Range = [-0.4, 0.4];
const DEFAULT_BED_FADE_IN_MS = 500;
const DEFAULT_BED_FADE_OUT_MS = 700;
const DEFAULT_MAX_CONCURRENT = 4;
/** Emitters cut by `stop` or suppression fade this fast at most, so a cut bird doesn't click. */
const EMITTER_CUT_MS = 250;

type EmitterState = {
  name: string;
  def: EmitterDef;
  timer: unknown;
  armed: boolean;
  last: string | null;
};

const defaultTimers: Timers = {
  set: (callback, ms) => globalThis.setTimeout(callback, ms),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * A soundscape: one looping bed under emitters that fire on their own random timers, each fire
 * with a fresh sample (never the last one), volume, rate and pan. A concurrency cap drops fires
 * that would muddy the mix. Every audio call goes through a `SoundscapeBus`, so the engine runs on
 * Howler, raw Web Audio or a fake in a test.
 *
 * `start` and `stop` can alternate any number of times; `dispose` is final and safe to call twice.
 * Every timer checks a disposed flag before it fires or re-arms, so a timer queued before a
 * teardown (React StrictMode, a scene swap in the same tick) does nothing.
 */
class Soundscape<Id = unknown> {
  readonly def: SoundscapeDef;
  private readonly bus: SoundscapeBus<Id>;
  private readonly random: () => number;
  private readonly timers: Timers;
  private readonly onEmitter: SoundscapeOptions["onEmitter"];
  private readonly emitters: EmitterState[];
  /** Live emitter voices, ours only: a bus shared with another soundscape keeps its voices. */
  private readonly live = new Map<Id, { emitter: string; sample: string }>();
  private bedId: Id | null = null;
  private bedGain = 1;
  private running = false;
  private disposed = false;
  private suppressed = false;

  constructor(def: SoundscapeDef, bus: SoundscapeBus<Id>, opts: SoundscapeOptions = {}) {
    this.def = def;
    this.bus = bus;
    this.random = opts.random ?? Math.random;
    this.timers = opts.timers ?? defaultTimers;
    this.onEmitter = opts.onEmitter;
    this.emitters = (def.emitters ?? []).map((emitter, index) => ({
      name: emitter.name ?? String(index),
      def: emitter,
      timer: null,
      armed: false,
      last: null,
    }));
  }

  /** Fade the bed in and arm the emitters. Does nothing while running or once disposed. */
  start(opts: { fadeInMs?: number } = {}) {
    if (this.disposed || this.running) {
      return;
    }

    this.running = true;

    const bed = this.def.bed;

    if (bed) {
      this.bedId = this.bus.playBed(bed.sample, {
        volume: bed.volume * this.bedGain,
        fadeInMs: opts.fadeInMs ?? bed.fadeInMs ?? DEFAULT_BED_FADE_IN_MS,
      });
    }

    for (const emitter of this.emitters) {
      // The first fire comes sooner than a full interval, so the scene isn't mute for a while.
      this.arm(emitter, 0.25 + this.random() * 0.5);
    }
  }

  /** Fade the bed out and cut the emitters. `start` brings it all back. */
  stop(opts: { fadeOutMs?: number } = {}) {
    if (!this.running) {
      return;
    }

    this.running = false;

    for (const emitter of this.emitters) {
      this.disarm(emitter);
    }

    const fadeOutMs = opts.fadeOutMs ?? this.def.bed?.fadeOutMs ?? DEFAULT_BED_FADE_OUT_MS;

    if (this.bedId !== null) {
      this.bus.stop(this.bedId, fadeOutMs);
      this.bedId = null;
    }

    this.cutEmitters(Math.min(fadeOutMs, EMITTER_CUT_MS));
  }

  /** Stop for good. Safe to call twice; `start` does nothing afterwards. */
  dispose(opts: { fadeOutMs?: number } = {}) {
    if (this.disposed) {
      return;
    }

    this.stop(opts);
    this.disposed = true;
  }

  /**
   * Hold the emitters back, for dialog or narration: one-shots compete with a voice line and with
   * screen readers even when ducked. Voices already playing fade out; the timers keep ticking and
   * fires resume when lifted. The bed plays on (duck it through the adapter if it should dip).
   */
  suppressEmitters(suppressed: boolean, opts: { fadeOutMs?: number } = {}) {
    if (this.suppressed === suppressed) {
      return;
    }

    this.suppressed = suppressed;

    if (suppressed) {
      this.cutEmitters(opts.fadeOutMs ?? 300);
    }
  }

  /**
   * Fire one emitter now, by name or index, whether or not the soundscape is running. Still
   * respects the cap. Returns whether a voice started. For debug panels and tests.
   */
  fire(emitter: string | number) {
    const state =
      typeof emitter === "number"
        ? this.emitters[emitter]
        : this.emitters.find((candidate) => candidate.name === emitter);

    if (!state || this.disposed) {
      return false;
    }

    return this.play(state);
  }

  /** Scale the bed's volume, for a scene that wants it lower or a debug slider. Kept across restarts. */
  setBedGain(gain: number, opts: { fadeMs?: number } = {}) {
    this.bedGain = gain;

    if (this.bedId !== null && this.def.bed) {
      this.bus.setVolume(this.bedId, this.def.bed.volume * gain, opts.fadeMs ?? 0);
    }
  }

  get isRunning() {
    return this.running;
  }

  get isDisposed() {
    return this.disposed;
  }

  get emittersSuppressed() {
    return this.suppressed;
  }

  /** Emitter voices playing right now. */
  get liveEmitters() {
    return this.live.size;
  }

  get emitterNames(): readonly string[] {
    return this.emitters.map((emitter) => emitter.name);
  }

  /** Schedule the next fire; `share` scales the interval, for the first one. */
  private arm(emitter: EmitterState, share = 1) {
    if (this.disposed || !this.running) {
      return;
    }

    const wait = between(this.random, emitter.def.intervalMs) * share;

    emitter.armed = true;
    emitter.timer = this.timers.set(() => {
      emitter.armed = false;
      emitter.timer = null;

      if (this.disposed || !this.running) {
        return;
      }

      if (!this.suppressed) {
        this.play(emitter);
      }

      this.arm(emitter);
    }, wait);
  }

  private disarm(emitter: EmitterState) {
    if (emitter.armed) {
      this.timers.clear(emitter.timer);
      emitter.armed = false;
      emitter.timer = null;
    }
  }

  private play(emitter: EmitterState) {
    if (this.live.size >= (this.def.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)) {
      return false;
    }

    const sample = pickNotLast(emitter.def.samples, emitter.last, this.random);

    if (sample === undefined) {
      return false;
    }

    let ended = false;
    let id: Id | null = null;

    id = this.bus.playEmitter(sample, {
      volume: between(this.random, emitter.def.volume ?? DEFAULT_VOLUME),
      rate: between(this.random, emitter.def.rate ?? DEFAULT_RATE),
      pan: between(this.random, emitter.def.pan ?? DEFAULT_PAN),
      onEnd: () => {
        // An adapter may end a voice before `playEmitter` returns (a zero-length sample).
        ended = true;

        if (id !== null) {
          this.release(id);
        }
      },
    });

    if (id === null) {
      return false;
    }

    emitter.last = sample;
    this.onEmitter?.({ emitter: emitter.name, sample, phase: "start" });

    if (ended) {
      this.onEmitter?.({ emitter: emitter.name, sample, phase: "end" });
    } else {
      this.live.set(id, { emitter: emitter.name, sample });
    }

    return true;
  }

  private release(id: Id) {
    const voice = this.live.get(id);

    if (voice) {
      this.live.delete(id);
      this.onEmitter?.({ ...voice, phase: "end" });
    }
  }

  private cutEmitters(fadeOutMs: number) {
    for (const id of Array.from(this.live.keys())) {
      this.bus.stop(id, fadeOutMs);
      this.release(id);
    }
  }
}

export { Soundscape };
