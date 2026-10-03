/**
 * @zkmake/sound-scape/web-audio: a `SoundscapeAdapter` on the Web Audio API, no dependencies.
 * Graph: each voice is source → gain → stereo pan → bus gain (level, mute) → duck gain → out.
 * Gain above 1 works. The context is created on first use, never at import, and resumes on the
 * first pointer or key press (browsers start it suspended).
 */
import {
  createDucker,
  createWarnOnce,
  type DuckOptions,
  type LoadOptions,
  type SampleSource,
  sources,
  type SoundscapeAdapter,
} from "../core/adapter.ts";

type WebAudioBusOptions = {
  /** Share the game's context. Default: one made on first use, closed on `dispose`. */
  context?: AudioContext;
  /** Where the bus ends up. Default: the context's destination. */
  destination?: AudioNode;
  /** Bus level. Default 1; above 1 is allowed. */
  level?: number;
  muted?: boolean;
  duck?: DuckOptions;
  /** Resume the context on the first pointer or key press, and again after an interruption. Default true. */
  autoUnlock?: boolean;
};

type Voice = {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  pan: StereoPannerNode;
  base: number;
  onEnd: (() => void) | null;
};

/** Gain ramps start from where the param is now, so a fade that interrupts a fade doesn't jump. */
const rampTo = (param: AudioParam, target: number, now: number, ms: number) => {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  // Never an instant step: 8 ms is below hearing a fade, above hearing a click.
  param.linearRampToValueAtTime(target, now + Math.max(ms, 8) / 1000);
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

const createWebAudioBus = <Sample extends string>(
  samples: Record<Sample, SampleSource>,
  opts: WebAudioBusOptions = {},
): SoundscapeAdapter<number> & {
  /** The context, made on first access. */
  readonly context: AudioContext;
} => {
  const warn = createWarnOnce("sound-scape/web-audio");
  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  const decoded = new Map<string, AudioBuffer | null>();
  const voices = new Map<number, Voice>();
  let nextId = 1;
  let level = opts.level ?? 1;
  let muted = opts.muted ?? false;
  let graph: { context: AudioContext; bus: GainNode; duck: GainNode } | null = null;
  let detachUnlock: (() => void) | null = null;

  const attachUnlock = (context: AudioContext) => {
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const resume = () => {
      if (context.state !== "running" && context.state !== "closed") {
        void context.resume();
      }
    };
    const onState = () => {
      // Safari reports "interrupted" after a call or Siri; the next gesture brings it back.
      if (context.state === "running" || context.state === "closed") {
        events.forEach((event) => globalThis.removeEventListener(event, resume, true));
      } else {
        events.forEach((event) => globalThis.addEventListener(event, resume, true));
      }
    };

    context.addEventListener("statechange", onState);
    onState();

    return () => {
      context.removeEventListener("statechange", onState);
      events.forEach((event) => globalThis.removeEventListener(event, resume, true));
    };
  };

  const ensure = () => {
    if (graph) {
      return graph;
    }

    const context = opts.context ?? new AudioContext();
    const bus = context.createGain();
    const duck = context.createGain();

    bus.gain.value = muted ? 0 : level;
    bus.connect(duck);
    duck.connect(opts.destination ?? context.destination);
    graph = { context, bus, duck };

    if ((opts.autoUnlock ?? true) && typeof globalThis.addEventListener === "function") {
      detachUnlock = attachUnlock(context);
    }

    return graph;
  };

  const decode = async (context: AudioContext, sample: string, urls: readonly string[]) => {
    for (const url of playable(urls)) {
      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await context.decodeAudioData(await response.arrayBuffer());
      } catch (error) {
        warn(`${sample} (${url})`, `failed to load (${String(error)})`);
      }
    }

    warn(sample, "no source played; it stays silent");

    return null;
  };

  const bufferFor = (sample: string) => {
    const known = buffers.get(sample);

    if (known) {
      return known;
    }

    const source = (samples as Record<string, SampleSource | undefined>)[sample];

    if (source === undefined) {
      warn(sample, "not in the sample map; the fire is skipped");

      return null;
    }

    const pending = decode(ensure().context, sample, sources(source)).then((buffer) => {
      decoded.set(sample, buffer);

      return buffer;
    });

    buffers.set(sample, pending);

    return pending;
  };

  const startVoice = (
    id: number,
    voice: Voice,
    buffer: AudioBuffer,
    { loop, rate, fadeInMs }: { loop: boolean; rate: number; fadeInMs: number },
  ) => {
    const { context } = ensure();
    const source = context.createBufferSource();
    const now = context.currentTime;

    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    source.connect(voice.gain);
    voice.source = source;
    source.onended = () => {
      voice.gain.disconnect();
      voice.pan.disconnect();

      if (voices.get(id) === voice) {
        voices.delete(id);
        voice.onEnd?.();
      }
    };

    if (fadeInMs > 0) {
      voice.gain.gain.setValueAtTime(0, now);
      voice.gain.gain.linearRampToValueAtTime(voice.base, now + fadeInMs / 1000);
    } else {
      voice.gain.gain.value = voice.base;
    }

    source.start(now);
  };

  const makeVoice = (base: number, pan: number, onEnd: (() => void) | null): Voice => {
    const { context, bus } = ensure();
    const gain = context.createGain();
    const panner = context.createStereoPanner();

    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.connect(panner);
    panner.connect(bus);

    return { source: null, gain, pan: panner, base, onEnd };
  };

  const ducker = createDucker(opts.duck, (gain, fadeMs) => {
    const { context, duck } = ensure();

    rampTo(duck.gain, gain, context.currentTime, fadeMs);
  });

  const stop = (id: number, fadeOutMs: number) => {
    const voice = voices.get(id);

    if (!voice) {
      return;
    }

    voices.delete(id);

    const { context } = ensure();
    const now = context.currentTime;

    if (!voice.source) {
      // A bed still decoding: it never starts.
      voice.gain.disconnect();
      voice.pan.disconnect();

      return;
    }

    rampTo(voice.gain.gain, 0, now, fadeOutMs);
    voice.source.stop(now + Math.max(fadeOutMs, 8) / 1000 + 0.02);
  };

  return {
    get context() {
      return ensure().context;
    },

    playBed(sample, { volume, fadeInMs }) {
      const pending = bufferFor(sample);

      if (!pending) {
        return null;
      }

      const id = nextId++;
      const voice = makeVoice(volume, 0, null);

      voices.set(id, voice);
      // Beds may start before their sample has loaded: they come in when it arrives.
      void pending.then((buffer) => {
        if (buffer && voices.get(id) === voice) {
          startVoice(id, voice, buffer, { loop: true, rate: 1, fadeInMs });
        }
      });

      return id;
    },

    playEmitter(sample, { volume, rate, pan, onEnd }) {
      if (muted || !bufferFor(sample)) {
        return null;
      }

      // Emitters only fire once loaded: a late bird is worse than a skipped one.
      const buffer = decoded.get(sample);

      if (!buffer) {
        return null;
      }

      const id = nextId++;
      const voice = makeVoice(volume, pan, onEnd);

      voices.set(id, voice);
      startVoice(id, voice, buffer, { loop: false, rate, fadeInMs: 0 });

      return id;
    },

    stop,

    setVolume(id, volume, fadeMs) {
      const voice = voices.get(id);

      if (voice) {
        voice.base = volume;
        rampTo(voice.gain.gain, volume, ensure().context.currentTime, fadeMs);
      }
    },

    async load(loadOpts: LoadOptions = {}) {
      const names = Object.keys(samples);
      let settled = 0;

      await Promise.all(
        names.map(async (name) => {
          await bufferFor(name);
          settled += 1;
          loadOpts.onProgress?.(settled, names.length);
        }),
      );
    },

    duck: ducker.duck,

    get ducked() {
      return ducker.ducked;
    },

    setLevel(next, fadeMs = 0) {
      level = next;

      if (graph && !muted) {
        rampTo(graph.bus.gain, level, graph.context.currentTime, fadeMs);
      }
    },

    setMuted(next) {
      muted = next;

      if (graph) {
        rampTo(graph.bus.gain, muted ? 0 : level, graph.context.currentTime, 30);
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
      for (const voice of voices.values()) {
        voice.onEnd = null;
        voice.source?.stop();
      }

      voices.clear();
      ducker.clear();
      detachUnlock?.();
      detachUnlock = null;

      if (graph) {
        graph.duck.disconnect();

        if (!opts.context) {
          void graph.context.close();
        }
      }

      graph = null;
      buffers.clear();
      decoded.clear();
    },
  };
};

export { createWebAudioBus };
export type { WebAudioBusOptions };
export type { DuckOptions, LoadOptions, SampleSource, SoundscapeAdapter } from "../core/adapter.ts";
