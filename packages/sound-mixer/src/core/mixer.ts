import { createSettings, type SettingsOptions } from "./settings.ts";
import {
  type BusOptions,
  type DefaultBus,
  type DuckOptions,
  type LoadOptions,
  type MixerSettings,
  type PlayOptions,
  type SoundDef,
  type Voice,
} from "./types.ts";
import {
  createDucker,
  createWarnOnce,
  draw,
  pickNotLast,
  playable,
  rampTo,
  sources,
} from "./util.ts";

type MixerOptions<Name extends string, Bus extends string> = {
  /** The registry: every sound the game plays, by name. Wrap it in `defineSounds` for typed names. */
  sounds: { readonly [K in Name]: SoundDef<NoInfer<Bus>> };
  /** Bus names and their default levels. Default: music, sfx, ambience, ui and voice, all at 1. */
  buses?: { readonly [B in Bus]: number | BusOptions };
  /** Share the game's context. Default: one made on first use, closed on `dispose`. */
  context?: AudioContext;
  /** Where the master goes. Default: the context's destination. */
  destination?: AudioNode;
  /** A brick-wall limiter after master, so a pile of loud voices can't clip. Default true. */
  limiter?: boolean;
  /** Persist mute, levels and bus switches to localStorage under this key. Default `null`: don't. */
  storageKey?: string | null;
  migrate?: SettingsOptions<Bus>["migrate"];
  /** `"suspend"` (default) suspends the context while the tab is hidden; `"play"` leaves it. */
  whenHidden?: "suspend" | "play";
  /** Resume the context on pointer and key presses (browsers start it suspended, iOS interrupts it). Default true. */
  autoUnlock?: boolean;
  /**
   * iOS: `"playback"` plays through the silent switch, `"ambient"` respects it and mixes with
   * other apps' audio. Default: leave the browser's choice.
   */
  audioSession?: "ambient" | "playback";
  /** A sample still loading after this long counts as failed. Default 15000. */
  loadTimeoutMs?: number;
  /** `Math.random`'s shape, for variants and ranges. */
  random?: () => number;
};

type InternalVoice = Voice & {
  readonly started: number;
  /** Re-apply the bus's global rate. */
  refreshRate(fadeMs: number): void;
};

type BusNode = {
  input: GainNode;
  duck: GainNode;
  ducker: ReturnType<typeof createDucker>;
  voices: Set<InternalVoice>;
  cap: number;
  rate: number;
  analyser: AnalyserNode | null;
};

type Graph = {
  context: AudioContext;
  master: GainNode;
  /** Where meters and `after` timers go to be pulled without being heard. */
  silent: GainNode;
  buses: Map<string, BusNode>;
  masterAnalyser: AnalyserNode | null;
  own: boolean;
};

type MixerEvent = "state" | "rate";

/** Live levels of a bus or the master, for meters. Both are linear, 0..1 (above 1 is clipping). */
type Meter = { peak(): number; rms(): number };

const DEFAULT_BUSES: Record<DefaultBus, number> = {
  music: 1,
  sfx: 1,
  ambience: 1,
  ui: 1,
  voice: 1,
};

const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

/** Identity, for typed sound names: `defineSounds({ ... })` keeps every key as a literal. */
const defineSounds = <const T extends Record<string, SoundDef>>(sounds: T): T => sounds;

/**
 * The mixer: one `AudioContext`, buses as gain nodes (so levels above 1, ducking and muting
 * reach voices already playing), a limiter after master, and a registry of sounds by name with
 * variants, ranges and voice caps. Nothing touches the browser until the first `load` or `play`.
 */
class SoundMixer<Name extends string = string, Bus extends string = DefaultBus> {
  private readonly opts: MixerOptions<Name, Bus>;
  private readonly sounds: Record<string, SoundDef | undefined>;
  private readonly busDefs: Record<string, number | BusOptions>;
  private readonly settingsStore: ReturnType<typeof createSettings<Bus>>;
  private readonly random: () => number;
  private readonly warn = createWarnOnce("sound-mixer");
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly decoded = new Map<string, AudioBuffer | null>();
  private readonly lastPick = new Map<string, string>();
  private readonly soundVoices = new Map<string, Set<InternalVoice>>();
  private readonly listeners = new Map<MixerEvent, Set<() => void>>();
  private graph: Graph | null = null;
  private nextId = 1;
  private paused = false;
  private hidden = false;
  private disposed = false;
  private readonly onGesture = () => this.sync();
  private readonly onVisibility = () => {
    this.hidden = document.visibilityState === "hidden";
    this.sync();
  };
  private readonly onState = () => this.emit("state");

  constructor(opts: MixerOptions<Name, Bus>) {
    this.opts = opts;
    this.sounds = opts.sounds as Record<string, SoundDef | undefined>;
    this.busDefs = (opts.buses ?? DEFAULT_BUSES) as Record<string, number | BusOptions>;
    this.random = opts.random ?? Math.random;

    const levels = { master: 1 } as Record<Bus | "master", number>;

    for (const [name, def] of Object.entries(this.busDefs)) {
      levels[name as Bus] = typeof def === "number" ? def : (def.level ?? 1);
    }

    this.settingsStore = createSettings<Bus>({
      defaults: { muted: false, levels, mutedBuses: [] },
      storageKey: opts.storageKey ?? null,
      migrate: opts.migrate,
    });

    if ((opts.whenHidden ?? "suspend") === "suspend" && typeof document !== "undefined") {
      this.hidden = document.visibilityState === "hidden";
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  // Loading -------------------------------------------------------------------------------------

  /**
   * Fetch and decode sounds. Never rejects: a file that fails logs once, its sound stays silent,
   * and progress still counts it.
   */
  async load(opts: LoadOptions<Name> = {}) {
    const names = (opts.only ?? Object.keys(this.sounds)) as string[];
    const keys = new Map<string, readonly string[]>();

    for (const name of names) {
      const def = this.sounds[name];

      if (!def || (opts.only === undefined && def.preload === false)) {
        continue;
      }

      for (const source of def.variants ?? (def.src === undefined ? [] : [def.src])) {
        keys.set(JSON.stringify(sources(source)), sources(source));
      }
    }

    let settled = 0;

    await Promise.all(
      [...keys].map(async ([key, urls]) => {
        await this.bufferFor(key, urls);
        settled += 1;
        opts.onProgress?.(settled, keys.size);
      }),
    );
  }

  private bufferFor(key: string, urls: readonly string[]) {
    const known = this.buffers.get(key);

    if (known) {
      return known;
    }

    const pending = this.decode(urls).then((buffer) => {
      this.decoded.set(key, buffer);

      return buffer;
    });

    this.buffers.set(key, pending);

    return pending;
  }

  private async decode(urls: readonly string[]) {
    const { context } = this.ensure();
    const timeoutMs = this.opts.loadTimeoutMs ?? 15_000;

    for (const url of playable(urls)) {
      try {
        const signal =
          typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
            ? AbortSignal.timeout(timeoutMs)
            : undefined;
        const response = await fetch(url, { signal });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await context.decodeAudioData(await response.arrayBuffer());
      } catch (error) {
        this.warn(url, `failed to load (${String(error)})`);
      }
    }

    this.warn(urls.join(" | "), "no source played; the sound stays silent");

    return null;
  }

  // Playing -------------------------------------------------------------------------------------

  /**
   * Play a sound by name. Returns its voice, or `null` when it can't play: unknown, failed to
   * load, at its cap with `onLimit: "drop"`, or a one-shot not loaded yet (a late one-shot is
   * worse than none; it loads for next time). A loop that isn't loaded yet starts when it is.
   */
  play(name: Name, opts: PlayOptions = {}): Voice | null {
    if (this.disposed) {
      return null;
    }

    const def = this.sounds[name];

    if (!def) {
      this.warn(name, "not in the sound registry");

      return null;
    }

    const pool = def.variants ?? (def.src === undefined ? [] : [def.src]);
    const keys = pool.map((source) => JSON.stringify(sources(source)));
    const key = pickNotLast(keys, this.lastPick.get(name) ?? null, this.random);

    if (key === undefined) {
      this.warn(name, "has no src or variants");

      return null;
    }

    const graph = this.ensure();
    const busName = opts.bus ?? def.bus ?? "sfx";
    const bus = graph.buses.get(busName);

    if (!bus) {
      this.warn(name, `plays on bus "${busName}", which this mixer doesn't have`);

      return null;
    }

    const loop = opts.loop ?? def.loop ?? false;
    const buffer = this.decoded.get(key);

    if (buffer === null) {
      return null;
    }

    if (buffer === undefined) {
      void this.bufferFor(key, sources(pool[keys.indexOf(key)]!));

      if (!loop) {
        return null;
      }
    }

    let mine = this.soundVoices.get(name);

    if (!mine) {
      mine = new Set();
      this.soundVoices.set(name, mine);
    }

    const full =
      mine.size >= (def.voices ?? 8) ? mine : bus.voices.size >= bus.cap ? bus.voices : null;

    if (full) {
      if (def.onLimit === "drop") {
        return null;
      }

      let oldest: InternalVoice | null = null;

      for (const voice of full) {
        if (!oldest || voice.started < oldest.started) {
          oldest = voice;
        }
      }

      oldest?.stop(30);
    }

    this.lastPick.set(name, key);

    const voice = this.createVoice(name, busName, bus, mine, {
      volume: opts.volume ?? draw(def.volume, 1, this.random),
      rate: opts.rate ?? draw(def.rate, 1, this.random),
      pan: opts.pan ?? draw(def.pan, 0, this.random),
      loop,
      fadeInMs: opts.fadeInMs ?? def.fadeInMs ?? (loop ? 8 : 0),
      delayMs: opts.delayMs ?? 0,
      offset: opts.offset ?? 0,
      output: opts.output ?? bus.input,
      onEnd: opts.onEnd,
    });

    if (buffer) {
      voice.begin(buffer);
    } else {
      void this.buffers.get(key)?.then((loaded) => {
        if (loaded && voice.playing) {
          voice.begin(loaded);
        } else if (!loaded) {
          voice.stop(0);
        }
      });
    }

    return voice;
  }

  private createVoice(
    sound: string,
    busName: string,
    bus: BusNode,
    mine: Set<InternalVoice>,
    spec: {
      volume: number;
      rate: number;
      pan: number;
      loop: boolean;
      fadeInMs: number;
      delayMs: number;
      offset: number;
      output: AudioNode;
      onEnd: (() => void) | undefined;
    },
  ) {
    const { context } = this.ensure();
    const gain = context.createGain();
    const panner = context.createStereoPanner();
    const startAt = context.currentTime + spec.delayMs / 1000;
    let source: AudioBufferSourceNode | null = null;
    let playing = true;
    let volume = spec.volume;
    let rate = spec.rate;

    panner.pan.value = Math.max(-1, Math.min(1, spec.pan));
    gain.gain.value = spec.fadeInMs > 0 ? 0 : volume;
    gain.connect(panner);
    panner.connect(spec.output);

    const release = () => {
      playing = false;
      bus.voices.delete(voice);
      mine.delete(voice);
    };

    const disconnect = () => {
      gain.disconnect();
      panner.disconnect();
    };

    const voice: InternalVoice & { begin(buffer: AudioBuffer): void } = {
      id: this.nextId++,
      sound,
      bus: busName,
      started: startAt,
      get playing() {
        return playing;
      },
      begin: (buffer) => {
        const now = context.currentTime;
        const node = context.createBufferSource();
        const at = Math.max(startAt, now);

        node.buffer = buffer;
        node.loop = spec.loop;
        node.playbackRate.value = rate * bus.rate;
        node.connect(gain);
        node.onended = () => {
          disconnect();

          if (playing) {
            release();
            spec.onEnd?.();
          }
        };

        if (spec.fadeInMs > 0) {
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(volume, at + spec.fadeInMs / 1000);
        }

        source = node;
        node.start(at, spec.offset % buffer.duration);
      },
      stop: (fadeOutMs = 30) => {
        if (!playing) {
          return;
        }

        release();

        if (!source) {
          disconnect();

          return;
        }

        const now = context.currentTime;

        rampTo(gain.gain, 0, now, fadeOutMs);
        source.stop(now + Math.max(fadeOutMs, 8) / 1000 + 0.02);
      },
      setVolume: (next, fadeMs = 0) => {
        volume = next;

        if (playing) {
          rampTo(gain.gain, next, context.currentTime, fadeMs);
        }
      },
      setRate: (next, fadeMs = 0) => {
        rate = next;
        voice.refreshRate(fadeMs);
      },
      setPan: (next, fadeMs = 0) => {
        if (playing) {
          rampTo(panner.pan, Math.max(-1, Math.min(1, next)), context.currentTime, fadeMs);
        }
      },
      refreshRate: (fadeMs) => {
        if (playing && source) {
          rampTo(source.playbackRate, rate * bus.rate, context.currentTime, fadeMs);
        }
      },
    };

    bus.voices.add(voice);
    mine.add(voice);

    return voice;
  }

  /** Stop every voice, or every voice on one bus. */
  stopAll(opts: { bus?: Bus; fadeOutMs?: number } = {}) {
    if (!this.graph) {
      return;
    }

    for (const [name, bus] of this.graph.buses) {
      if (opts.bus === undefined || opts.bus === name) {
        for (const voice of Array.from(bus.voices)) {
          voice.stop(opts.fadeOutMs);
        }
      }
    }
  }

  /** Voices playing now, on one bus or all. */
  voiceCount(bus?: Bus) {
    if (!this.graph) {
      return 0;
    }

    let count = 0;

    for (const [name, node] of this.graph.buses) {
      if (bus === undefined || bus === name) {
        count += node.voices.size;
      }
    }

    return count;
  }

  // Levels, ducking, rate ---------------------------------------------------------------------------

  get settings(): MixerSettings<Bus> {
    return this.settingsStore.get();
  }

  /** For `useSyncExternalStore`: called whenever mute, a level or a bus switch changes. */
  readonly subscribe = (listener: () => void) => this.settingsStore.subscribe(listener);

  readonly getSnapshot = () => this.settingsStore.get();

  setLevel(bus: Bus | "master", level: number, fadeMs = 30) {
    const settings = this.settingsStore.get();

    this.settingsStore.set({ levels: { ...settings.levels, [bus]: Math.max(0, level) } });
    this.applyLevels(fadeMs);
  }

  setMuted(muted: boolean, fadeMs = 30) {
    this.settingsStore.set({ muted });
    this.applyLevels(fadeMs);
  }

  /** Switch one bus off or on, as a settings screen's "Music" toggle does. Its level is kept. */
  setBusMuted(bus: Bus, muted: boolean, fadeMs = 30) {
    const current = this.settingsStore.get().mutedBuses;
    const next = muted ? [...new Set([...current, bus])] : current.filter((name) => name !== bus);

    this.settingsStore.set({ mutedBuses: next });
    this.applyLevels(fadeMs);
  }

  private applyLevels(fadeMs: number) {
    const graph = this.graph;

    if (!graph) {
      return;
    }

    const { muted, levels, mutedBuses } = this.settingsStore.get();
    const now = graph.context.currentTime;

    rampTo(graph.master.gain, muted ? 0 : levels.master, now, fadeMs);

    for (const [name, bus] of graph.buses) {
      const off = (mutedBuses as readonly string[]).includes(name);

      rampTo(bus.input.gain, off ? 0 : (levels[name as Bus] ?? 1), now, fadeMs);
    }
  }

  /**
   * Dip one or more buses, voices already playing included, and return the release. Ducks
   * count per bus: it comes back up when the last one is released, and the deepest held wins.
   */
  duck(buses: Bus | readonly Bus[], opts: DuckOptions = {}) {
    const graph = this.ensure();
    const releases = (typeof buses === "string" ? [buses] : buses).flatMap((name) => {
      const bus = graph.buses.get(name);

      return bus ? [bus.ducker.duck(opts)] : [];
    });

    return () => releases.forEach((release) => release());
  }

  isDucked(bus: Bus) {
    return this.graph?.buses.get(bus)?.ducker.ducked ?? false;
  }

  /**
   * Scale playback rate for slow motion or fast-forward: every voice on these buses (default
   * all), playing or future. Pitch moves with it, as tape does. Music playlists follow too.
   */
  setRate(rate: number, opts: { buses?: readonly Bus[]; fadeMs?: number } = {}) {
    const graph = this.ensure();

    for (const [name, bus] of graph.buses) {
      if (opts.buses === undefined || opts.buses.includes(name as Bus)) {
        bus.rate = rate;
        bus.voices.forEach((voice) => voice.refreshRate(opts.fadeMs ?? 0));
      }
    }

    this.emit("rate");
  }

  rate(bus: Bus) {
    return this.graph?.buses.get(bus)?.rate ?? 1;
  }

  // Time, pause, lifecycle ------------------------------------------------------------------------

  /**
   * Run `fn` after `ms` of audio time. Audio time stops while the context is suspended (paused,
   * hidden, not yet unlocked), so a crash's follow-up sound waits with the game. Returns a cancel.
   */
  after(ms: number, fn: () => void) {
    const { context, silent } = this.ensure();
    const node = context.createConstantSource();
    let cancelled = false;

    node.offset.value = 0;
    node.connect(silent);
    node.onended = () => {
      node.disconnect();

      if (!cancelled && !this.disposed) {
        fn();
      }
    };
    node.start();
    node.stop(context.currentTime + Math.max(0, ms) / 1000);

    return () => {
      cancelled = true;
    };
  }

  /** Suspend everything (voices hold their place, `after` timers wait) or carry on. */
  setPaused(paused: boolean) {
    this.paused = paused;
    this.sync();
    this.emit("state");
  }

  get isPaused() {
    return this.paused;
  }

  /** `"idle"` until the first load or play, then the context's state. */
  get state(): AudioContextState | "idle" {
    return this.graph?.context.state ?? "idle";
  }

  /** Listen for `"state"` (context running, suspended, paused) or `"rate"` changes. Returns the unsubscribe. */
  on(event: MixerEvent, listener: () => void) {
    let set = this.listeners.get(event);

    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }

    set.add(listener);

    return () => {
      set.delete(listener);
    };
  }

  private emit(event: MixerEvent) {
    this.listeners.get(event)?.forEach((listener) => listener());
  }

  /** Run the context when the game wants sound and the tab is showing; suspend it otherwise. */
  private sync() {
    const graph = this.graph;

    if (!graph || this.disposed) {
      return;
    }

    const run = !this.paused && !this.hidden;
    const { context } = graph;

    if (run && context.state !== "running" && context.state !== "closed") {
      void context.resume().catch(() => {});
    } else if (!run && context.state === "running") {
      void context.suspend().catch(() => {});
    }
  }

  // Graph -------------------------------------------------------------------------------------------

  /** The context, made on first access. */
  get context() {
    return this.ensure().context;
  }

  /** A bus's input node, for routing your own nodes (a panner, a media element) through the bus. */
  input(bus: Bus) {
    const node = this.ensure().buses.get(bus);

    if (!node) {
      throw new Error(`sound-mixer: no bus "${bus}"`);
    }

    return node.input;
  }

  /** The bus a sound plays on by default. */
  busOf(name: Name): Bus {
    return (this.sounds[name]?.bus ?? "sfx") as Bus;
  }

  get busNames(): readonly Bus[] {
    return Object.keys(this.busDefs) as Bus[];
  }

  /** Peak and RMS of a bus (after its duck) or the master (after the limiter), made on first ask. */
  meter(bus: Bus | "master"): Meter {
    const graph = this.ensure();
    let analyser: AnalyserNode;

    if (bus === "master") {
      analyser = graph.masterAnalyser ??= this.tap(graph.master, graph);
    } else {
      const node = graph.buses.get(bus);

      if (!node) {
        throw new Error(`sound-mixer: no bus "${bus}"`);
      }

      analyser = node.analyser ??= this.tap(node.duck, graph);
    }

    const samples = new Float32Array(analyser.fftSize);

    return {
      peak: () => {
        analyser.getFloatTimeDomainData(samples);

        return samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
      },
      rms: () => {
        analyser.getFloatTimeDomainData(samples);

        return Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
        );
      },
    };
  }

  private tap(node: AudioNode, graph: Graph) {
    const analyser = graph.context.createAnalyser();

    analyser.fftSize = 1024;
    node.connect(analyser);
    analyser.connect(graph.silent);

    return analyser;
  }

  private ensure(): Graph {
    if (this.graph) {
      return this.graph;
    }

    if (this.disposed) {
      throw new Error("sound-mixer: used after dispose");
    }

    const own = !this.opts.context;
    const context = this.opts.context ?? new AudioContext();
    const destination = this.opts.destination ?? context.destination;
    const master = context.createGain();
    const silent = context.createGain();
    const buses = new Map<string, BusNode>();

    silent.gain.value = 0;
    silent.connect(context.destination);

    if (this.opts.limiter ?? true) {
      const limiter = context.createDynamicsCompressor();

      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      master.connect(limiter);
      limiter.connect(destination);
    } else {
      master.connect(destination);
    }

    for (const [name, def] of Object.entries(this.busDefs)) {
      const input = context.createGain();
      const duck = context.createGain();

      input.connect(duck);
      duck.connect(master);
      buses.set(name, {
        input,
        duck,
        ducker: createDucker((gain, fadeMs) =>
          rampTo(duck.gain, gain, context.currentTime, fadeMs),
        ),
        voices: new Set(),
        cap: typeof def === "number" ? Infinity : (def.voices ?? Infinity),
        rate: 1,
        analyser: null,
      });
    }

    this.graph = { context, master, silent, buses, masterAnalyser: null, own };

    const session = (globalThis.navigator as { audioSession?: { type: string } } | undefined)
      ?.audioSession;

    if (this.opts.audioSession && session) {
      session.type = this.opts.audioSession;
    }

    context.addEventListener("statechange", this.onState);

    if ((this.opts.autoUnlock ?? true) && typeof globalThis.addEventListener === "function") {
      UNLOCK_EVENTS.forEach((event) => globalThis.addEventListener(event, this.onGesture, true));
    }

    // Levels without a ramp: a fresh graph starts where the settings say.
    const { muted, levels, mutedBuses } = this.settingsStore.get();

    master.gain.value = muted ? 0 : levels.master;

    for (const [name, bus] of buses) {
      bus.input.gain.value = (mutedBuses as readonly string[]).includes(name)
        ? 0
        : (levels[name as Bus] ?? 1);
    }

    this.sync();

    return this.graph;
  }

  /** Stop everything, drop listeners and close the context if the mixer made it. Safe to call twice. */
  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }

    if (typeof globalThis.removeEventListener === "function") {
      UNLOCK_EVENTS.forEach((event) => globalThis.removeEventListener(event, this.onGesture, true));
    }

    const graph = this.graph;

    if (graph) {
      graph.context.removeEventListener("statechange", this.onState);

      for (const bus of graph.buses.values()) {
        bus.voices.forEach((voice) => voice.stop(0));
      }

      graph.master.disconnect();

      if (graph.own) {
        void graph.context.close().catch(() => {});
      }
    }

    this.listeners.clear();
  }
}

export { defineSounds, SoundMixer };
export type { Meter, MixerOptions };
