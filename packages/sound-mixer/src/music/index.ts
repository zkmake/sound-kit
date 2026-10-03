/**
 * @zkmake/sound-mixer/music: playlists that stream through a mixer bus. Tracks play from
 * `<audio>` elements routed into the graph (a 2-minute track decoded whole is ~40 MB of PCM),
 * so bus levels, ducks, mute and the limiter apply; they pause with the mixer and follow its rate.
 */
import { type SoundMixer } from "../core/mixer.ts";
import { type SampleSource } from "../core/types.ts";
import { createWarnOnce, pickNotLast, playable, rampTo, sources } from "../core/util.ts";

type Track = { name?: string; src: SampleSource };

type PlaylistOptions<Bus extends string> = {
  tracks: readonly (Track | SampleSource)[];
  /** Default `"music"`. */
  bus?: Bus;
  /**
   * `"shuffle"` (default) never plays the same track twice in a row; `"sequence"` goes in order
   * and wraps; `"repeat"` loops one track.
   */
  order?: "shuffle" | "sequence" | "repeat";
  /** Overlap between tracks, ms. Default 0: the next starts when the last ends. */
  crossfadeMs?: number;
  /** Fade on `play`, `resume` and a switch. Default 1000. */
  fadeMs?: number;
  /** Default 1. */
  volume?: number;
  /** Default `"anonymous"`: a cross-origin track without CORS headers would play silent through Web Audio. */
  crossOrigin?: "anonymous" | "use-credentials" | null;
  random?: () => number;
};

type Deck = {
  index: number;
  element: HTMLAudioElement;
  gain: GainNode;
};

/** Media elements go quiet or refuse outside this range in some browsers. */
const RATE_RANGE = [0.5, 4] as const;

const isTrack = (track: Track | SampleSource): track is Track =>
  typeof track === "object" && !Array.isArray(track) && "src" in track;

/**
 * A playlist on a mixer bus. `play()` from a gesture (or let it retry on the next press), then
 * `pause`/`resume` keep the place mid-bar, `next` moves on, `play(name)` switches with a fade.
 */
class Playlist<Bus extends string = string> {
  private readonly mixer: SoundMixer<string, Bus>;
  private readonly tracks: readonly Track[];
  private readonly opts: PlaylistOptions<Bus>;
  private readonly random: () => number;
  private readonly warn = createWarnOnce("sound-mixer/music");
  private readonly elements = new Map<number, { element: HTMLAudioElement; gain: GainNode }>();
  private output: GainNode | null = null;
  private deck: Deck | null = null;
  private wanted = false;
  private heldByMixer = false;
  private disposed = false;
  private cancelRetry: (() => void) | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(mixer: SoundMixer<string, Bus>, opts: PlaylistOptions<Bus>) {
    this.mixer = mixer;
    this.opts = { ...opts };
    this.random = opts.random ?? Math.random;
    this.tracks = opts.tracks.map((track) => (isTrack(track) ? track : { src: track }));
    this.offs.push(
      mixer.on("state", () => this.followMixer()),
      mixer.on("rate", () => this.applyRate()),
    );
  }

  private get bus() {
    return (this.opts.bus ?? "music") as Bus;
  }

  private get fadeMs() {
    return this.opts.fadeMs ?? 1000;
  }

  /** Track names (or their first URL), in order. */
  get names(): readonly string[] {
    return this.tracks.map((_track, index) => this.nameOf(index));
  }

  /** The track playing or paused now. */
  get current(): string | null {
    return this.deck ? this.nameOf(this.deck.index) : null;
  }

  /** Whether it's meant to be playing (it may be held while the mixer is suspended). */
  get playing() {
    return this.wanted;
  }

  private nameOf(index: number) {
    const track = this.tracks[index];

    return track?.name ?? sources(track?.src ?? "")[0] ?? String(index);
  }

  /** Start, or switch to `name` with a fade. With a track paused, resume it. */
  play(name?: string) {
    if (this.disposed || this.tracks.length === 0) {
      return;
    }

    if (name !== undefined) {
      const index = this.tracks.findIndex((_track, at) => this.nameOf(at) === name);

      if (index < 0) {
        this.warn(name, "not in this playlist");

        return;
      }

      if (this.deck?.index !== index) {
        this.switchTo(index, this.fadeMs);

        return;
      }
    }

    if (this.deck) {
      this.resume();
    } else {
      this.switchTo(this.pick(null), this.fadeMs);
    }
  }

  /** Fade out and hold the place. */
  pause(fadeMs = 300) {
    this.wanted = false;

    const deck = this.deck;

    if (!deck) {
      return;
    }

    rampTo(deck.gain.gain, 0, this.mixer.context.currentTime, fadeMs);
    this.mixer.after(fadeMs, () => {
      if (!this.wanted && this.deck === deck) {
        deck.element.pause();
      }
    });
  }

  /** Pick up where `pause` left off, fading back in. */
  resume(fadeMs = this.fadeMs) {
    const deck = this.deck;

    if (!deck || this.disposed) {
      return;
    }

    this.wanted = true;
    this.start(deck, fadeMs);
  }

  /** Move to the next track by the playlist's order, fading. */
  next(fadeMs = this.fadeMs) {
    if (this.tracks.length > 0 && !this.disposed) {
      this.switchTo(this.pick(this.deck?.index ?? null), fadeMs);
    }
  }

  /** Fade out and forget the place; `play` starts a fresh track. */
  stop(fadeMs = 300) {
    const deck = this.deck;

    this.wanted = false;
    this.deck = null;

    if (deck) {
      this.retire(deck, fadeMs);
    }
  }

  setVolume(volume: number, fadeMs = 300) {
    this.opts.volume = volume;

    if (this.output) {
      rampTo(this.output.gain, volume, this.mixer.context.currentTime, fadeMs);
    }
  }

  private pick(last: number | null) {
    const order = this.opts.order ?? "shuffle";

    if (order === "repeat") {
      return last ?? 0;
    }

    if (order === "sequence") {
      return last === null ? 0 : (last + 1) % this.tracks.length;
    }

    return (
      pickNotLast(
        this.tracks.map((_track, index) => index),
        last,
        this.random,
      ) ?? 0
    );
  }

  private ensureOutput() {
    if (!this.output) {
      const { context } = this.mixer;

      this.output = context.createGain();
      this.output.gain.value = this.opts.volume ?? 1;
      this.output.connect(this.mixer.input(this.bus));
    }

    return this.output;
  }

  /** One element per track, made once: a media element can feed only one source node, ever. */
  private elementFor(index: number) {
    const known = this.elements.get(index);

    if (known) {
      return known;
    }

    const { context } = this.mixer;
    const urls = playable(sources(this.tracks[index]!.src));
    const element = new Audio();
    let tried = 0;

    element.preload = "auto";
    element.crossOrigin = this.opts.crossOrigin === undefined ? "anonymous" : this.opts.crossOrigin;
    element.addEventListener("error", () => {
      tried += 1;

      if (tried < urls.length) {
        element.src = urls[tried]!;
      } else {
        this.warn(this.nameOf(index), "no source played");
      }
    });
    element.addEventListener("ended", () => this.onEnded(index));
    element.addEventListener("timeupdate", () => this.onTime(index));
    element.src = urls[0] ?? "";

    const gain = context.createGain();

    gain.gain.value = 0;
    context.createMediaElementSource(element).connect(gain);
    gain.connect(this.ensureOutput());

    const made = { element, gain };

    this.elements.set(index, made);
    this.applyRate();

    return made;
  }

  private switchTo(index: number, fadeMs: number) {
    const previous = this.deck;
    const { element, gain } = this.elementFor(index);
    const deck: Deck = { index, element, gain };

    this.wanted = true;

    if (previous && previous.index !== index) {
      this.retire(previous, fadeMs);
      element.currentTime = 0;
    }

    element.loop = (this.opts.order ?? "shuffle") === "repeat" && !this.opts.crossfadeMs;
    this.deck = deck;
    this.start(deck, fadeMs);
  }

  private retire(deck: Deck, fadeMs: number) {
    rampTo(deck.gain.gain, 0, this.mixer.context.currentTime, fadeMs);
    this.mixer.after(fadeMs, () => {
      if (this.deck?.index !== deck.index) {
        deck.element.pause();
        deck.element.currentTime = 0;
      }
    });
  }

  private start(deck: Deck, fadeMs: number) {
    rampTo(deck.gain.gain, 1, this.mixer.context.currentTime, fadeMs);

    if (!this.heldByMixer) {
      // Before a gesture, play() is refused: try again on the next press.
      void deck.element.play()?.catch(() => this.armRetry());
    }
  }

  private armRetry() {
    if (this.cancelRetry || typeof globalThis.addEventListener !== "function") {
      return;
    }

    const events = ["pointerdown", "keydown", "touchend"] as const;
    const detach = () => {
      events.forEach((event) => globalThis.removeEventListener(event, retry, true));
      this.cancelRetry = null;
    };
    const retry = () => {
      detach();

      if (this.wanted && this.deck && !this.disposed && !this.heldByMixer) {
        void this.deck.element.play()?.catch(() => this.armRetry());
      }
    };

    this.cancelRetry = detach;
    events.forEach((event) => globalThis.addEventListener(event, retry, true));
  }

  private onTime(index: number) {
    const deck = this.deck;
    const crossfadeMs = this.opts.crossfadeMs ?? 0;

    if (!deck || deck.index !== index || crossfadeMs <= 0 || !this.wanted) {
      return;
    }

    const left = (deck.element.duration - deck.element.currentTime) * 1000;

    if (Number.isFinite(left) && left <= crossfadeMs) {
      const nextIndex = this.pick(index);

      if (nextIndex === index) {
        return;
      }

      // The old deck stops being current, so its later time updates and `ended` are ignored.
      this.switchTo(nextIndex, Math.max(left, 50));
    }
  }

  private onEnded(index: number) {
    if (this.deck?.index !== index || !this.wanted) {
      return;
    }

    const nextIndex = this.pick(index);

    if (nextIndex === index) {
      // A playlist of one (or repeat with a crossfade): go round again.
      this.deck.element.currentTime = 0;
      void this.deck.element.play()?.catch(() => this.armRetry());
    } else {
      this.switchTo(nextIndex, 0);
    }
  }

  /** Hold the element while the mixer is suspended (paused, hidden), and carry on after. */
  private followMixer() {
    const held = this.mixer.state !== "running";

    if (held === this.heldByMixer) {
      return;
    }

    this.heldByMixer = held;

    const deck = this.deck;

    if (!deck || !this.wanted) {
      return;
    }

    if (held) {
      deck.element.pause();
    } else {
      void deck.element.play()?.catch(() => this.armRetry());
    }
  }

  private applyRate() {
    const rate = Math.min(RATE_RANGE[1], Math.max(RATE_RANGE[0], this.mixer.rate(this.bus)));

    for (const { element } of this.elements.values()) {
      // Pitch moves with the rate, as it does for the mixer's voices.
      element.preservesPitch = false;
      element.playbackRate = rate;
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.wanted = false;
    this.cancelRetry?.();
    this.offs.forEach((off) => off());

    for (const { element, gain } of this.elements.values()) {
      element.pause();
      element.removeAttribute("src");
      element.load();
      gain.disconnect();
    }

    this.elements.clear();
    this.output?.disconnect();
    this.deck = null;
  }
}

export { Playlist };
export type { PlaylistOptions, Track };
