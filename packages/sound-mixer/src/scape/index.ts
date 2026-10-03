/**
 * @zkmake/sound-mixer/scape: run `@zkmake/sound-scape` on a mixer bus. The bus it returns has the
 * shape of sound-scape's `SoundscapeAdapter` (structurally, so neither package imports the other):
 * samples are the mixer's sound names, and duck, level and mute act on the mixer bus.
 */
import { type SoundMixer } from "../core/mixer.ts";
import { type DuckOptions, type LoadOptions, type Voice } from "../core/types.ts";

/** A sound-scape bus on a mixer bus. Default bus `"ambience"`. */
const soundscapeBus = <Name extends string, Bus extends string>(
  mixer: SoundMixer<Name, Bus>,
  bus: Bus = "ambience" as Bus,
) => {
  const voices = new Map<number, Voice>();
  const off = () => {
    const { muted, mutedBuses } = mixer.settings;

    return muted || mutedBuses.includes(bus);
  };

  const stop = (id: number, fadeOutMs: number) => {
    const voice = voices.get(id);

    voices.delete(id);
    voice?.stop(fadeOutMs);
  };

  return {
    playBed(sample: string, opts: { volume: number; fadeInMs: number }) {
      const voice = mixer.play(sample as Name, {
        bus,
        loop: true,
        volume: opts.volume,
        fadeInMs: opts.fadeInMs,
      });

      if (!voice) {
        return null;
      }

      voices.set(voice.id, voice);

      return voice.id;
    },

    playEmitter(
      sample: string,
      opts: { volume: number; rate: number; pan: number; onEnd: () => void },
    ) {
      // Emitters don't fire into a muted bus: no point spending voices on silence.
      if (off()) {
        return null;
      }

      let id = 0;
      const voice = mixer.play(sample as Name, {
        bus,
        loop: false,
        volume: opts.volume,
        rate: opts.rate,
        pan: opts.pan,
        onEnd: () => {
          voices.delete(id);
          opts.onEnd();
        },
      });

      if (!voice) {
        return null;
      }

      id = voice.id;
      voices.set(id, voice);

      return id;
    },

    stop,

    setVolume(id: number, volume: number, fadeMs: number) {
      voices.get(id)?.setVolume(volume, fadeMs);
    },

    /** Loads the mixer's sounds (all of them, or `only`). */
    load(opts: LoadOptions<Name> = {}) {
      return mixer.load(opts);
    },

    duck(opts?: DuckOptions) {
      return mixer.duck(bus, opts);
    },

    get ducked() {
      return mixer.isDucked(bus);
    },

    setLevel(level: number, fadeMs?: number) {
      mixer.setLevel(bus, level, fadeMs);
    },

    setMuted(muted: boolean) {
      mixer.setBusMuted(bus, muted);
    },

    stopAll(fadeOutMs = 0) {
      for (const id of Array.from(voices.keys())) {
        stop(id, fadeOutMs);
      }
    },

    get voices() {
      return voices.size;
    },

    /** Stops this bus's soundscape voices; the mixer stays. */
    dispose() {
      for (const id of Array.from(voices.keys())) {
        stop(id, 0);
      }
    },
  };
};

export { soundscapeBus };
