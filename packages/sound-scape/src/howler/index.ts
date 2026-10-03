/**
 * @zkmake/sound-scape/howler: a `SoundscapeAdapter` over Howler 2 (peer dependency). One Howl per
 * sample, made once and replayed; every voice keeps its own base volume so a duck or a level change
 * reaches beds and emitters already playing. Howler clamps volume to 0..1, so loud beds stay at 1.
 */
import { Howl } from "howler";

import {
  createDucker,
  createWarnOnce,
  type DuckOptions,
  type LoadOptions,
  type SampleSource,
  sources,
  type SoundscapeAdapter,
} from "../core/adapter.ts";

type HowlerBusOptions = {
  /** Bus level, 0..1. Default 1. */
  level?: number;
  muted?: boolean;
  /** Defaults for `duck()`. */
  duck?: DuckOptions;
  /** Stream through `<audio>` instead of decoding. No pan or rate per voice then. Default false. */
  html5?: boolean;
  /** A sample still loading after this long counts as settled for `load`. Default 10000. */
  loadTimeoutMs?: number;
};

/** A voice: its Howl and Howler's id for it. The bus hands out its own ids, unique across Howls. */
type Voice = { howl: Howl; sound: number; base: number };

const createHowlerBus = <Sample extends string>(
  samples: Record<Sample, SampleSource>,
  opts: HowlerBusOptions = {},
): SoundscapeAdapter<number> => {
  const howls = new Map<string, Howl>();
  const voices = new Map<number, Voice>();
  let nextId = 1;
  const warn = createWarnOnce("sound-scape/howler");
  let level = opts.level ?? 1;
  let muted = opts.muted ?? false;
  let duckGain = 1;

  const howlFor = (sample: string) => {
    const known = howls.get(sample);

    if (known) {
      return known;
    }

    const source = (samples as Record<string, SampleSource | undefined>)[sample];

    if (source === undefined) {
      warn(sample, "not in the sample map; the fire is skipped");

      return null;
    }

    const howl = new Howl({ src: [...sources(source)], html5: opts.html5 ?? false });

    howl.once("loaderror", (_id, error) => {
      warn(sample, `failed to load (${String(error)}); it stays silent`);
    });
    howls.set(sample, howl);

    return howl;
  };

  const effective = (base: number) => Math.min(1, Math.max(0, base * level * duckGain));

  const fadeTo = ({ howl, sound, base }: Voice, fadeMs: number) => {
    const target = effective(base);

    if (fadeMs <= 0) {
      howl.volume(target, sound);
    } else {
      howl.fade(howl.volume(sound) as number, target, fadeMs, sound);
    }
  };

  const rescale = (fadeMs: number) => {
    for (const voice of voices.values()) {
      fadeTo(voice, fadeMs);
    }
  };

  const ducker = createDucker(opts.duck, (gain, fadeMs) => {
    duckGain = gain;
    rescale(fadeMs);
  });

  const stop = (id: number, fadeOutMs: number) => {
    const voice = voices.get(id);

    if (!voice) {
      return;
    }

    // Forget it now: a dispose straight after must not cut this fade short.
    voices.delete(id);

    const { howl, sound } = voice;

    howl.off("end", undefined, sound);

    if (fadeOutMs <= 0) {
      howl.stop(sound);

      return;
    }

    // Stop when the fade lands, or Howler keeps a silent voice alive.
    howl.once("fade", () => howl.stop(sound), sound);
    howl.fade(howl.volume(sound) as number, 0, fadeOutMs, sound);
  };

  return {
    playBed(sample, { volume, fadeInMs }) {
      const howl = howlFor(sample);

      if (!howl) {
        return null;
      }

      const sound = howl.play();
      const id = nextId++;
      const voice: Voice = { howl, sound, base: volume };

      howl.loop(true, sound);
      howl.mute(muted, sound);
      howl.volume(0, sound);
      voices.set(id, voice);
      fadeTo(voice, fadeInMs);

      return id;
    },

    playEmitter(sample, { volume, rate, pan, onEnd }) {
      if (muted) {
        return null;
      }

      const howl = howlFor(sample);

      if (!howl || howl.state() === "unloaded") {
        return null;
      }

      const sound = howl.play();
      const id = nextId++;
      const voice: Voice = { howl, sound, base: volume };

      howl.loop(false, sound);
      howl.volume(effective(volume), sound);
      howl.rate(rate, sound);

      if (!opts.html5) {
        howl.stereo(pan, sound);
      }

      voices.set(id, voice);
      howl.once(
        "end",
        () => {
          if (voices.get(id) === voice) {
            voices.delete(id);
            onEnd();
          }
        },
        sound,
      );

      return id;
    },

    stop,

    setVolume(id, volume, fadeMs) {
      const voice = voices.get(id);

      if (voice) {
        voice.base = volume;
        fadeTo(voice, fadeMs);
      }
    },

    load(loadOpts: LoadOptions = {}) {
      const names = Object.keys(samples);
      let settled = 0;

      return Promise.all(
        names.map(
          (name) =>
            new Promise<void>((resolve) => {
              const howl = howlFor(name);
              let done = false;
              const finish = () => {
                if (!done) {
                  done = true;
                  settled += 1;
                  loadOpts.onProgress?.(settled, names.length);
                  resolve();
                }
              };

              if (!howl || howl.state() === "loaded") {
                finish();

                return;
              }

              howl.once("load", finish);
              howl.once("loaderror", finish);
              globalThis.setTimeout(finish, opts.loadTimeoutMs ?? 10_000);
            }),
        ),
      ).then(() => undefined);
    },

    duck: ducker.duck,

    get ducked() {
      return ducker.ducked;
    },

    setLevel(next, fadeMs = 0) {
      level = next;
      rescale(fadeMs);
    },

    setMuted(next) {
      muted = next;

      for (const { howl, sound } of voices.values()) {
        howl.mute(muted, sound);
      }
    },

    stopAll(fadeOutMs = 0) {
      for (const id of Array.from(voices.keys())) {
        stop(id, fadeOutMs);
      }
    },

    get voices() {
      return voices.size;
    },

    dispose() {
      for (const { howl, sound } of voices.values()) {
        howl.off("end", undefined, sound);
        howl.stop(sound);
      }

      voices.clear();
      ducker.clear();

      for (const howl of howls.values()) {
        howl.unload();
      }

      howls.clear();
    },
  };
};

export { createHowlerBus };
export type { HowlerBusOptions };
export type { DuckOptions, LoadOptions, SampleSource, SoundscapeAdapter } from "../core/adapter.ts";
