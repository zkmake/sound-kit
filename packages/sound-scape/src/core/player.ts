import { Soundscape } from "./soundscape.ts";
import { type SoundscapeBus, type SoundscapeDef, type SoundscapeOptions } from "./types.ts";

type SoundscapePlayerOptions = SoundscapeOptions & {
  /** Swap time between two soundscapes: the old bed fades out while the new one fades in. Default 1000. */
  crossfadeMs?: number;
  /**
   * `"stop"` (default) fades the soundscape out while the tab is hidden and back in when it
   * returns, so a background tab doesn't play to itself. `"play"` leaves it alone.
   */
  whenHidden?: "stop" | "play";
};

const DEFAULT_CROSSFADE_MS = 1000;

/** Two defs with the same content are the same soundscape, so an inline def doesn't restart the bed. */
const signature = (def: SoundscapeDef) => JSON.stringify(def);

/**
 * Plays one soundscape at a time over a bus and swaps between them: `play(def)` starts it, a
 * different def crossfades to it, the same def again (by content, not identity) does nothing, and
 * `play(null)` fades out. It also follows tab visibility. This is what a scene manager or a React
 * effect wants; use `Soundscape` directly for full control.
 */
class SoundscapePlayer<Id = unknown> {
  private readonly bus: SoundscapeBus<Id>;
  private readonly opts: SoundscapePlayerOptions;
  private scape: Soundscape<Id> | null = null;
  private key: string | null = null;
  private hidden = false;
  private disposed = false;
  private readonly onVisibility = () => {
    this.hidden = document.visibilityState === "hidden";

    if (this.hidden) {
      this.scape?.stop();
    } else {
      this.scape?.start();
    }
  };

  constructor(bus: SoundscapeBus<Id>, opts: SoundscapePlayerOptions = {}) {
    this.bus = bus;
    this.opts = opts;

    if ((opts.whenHidden ?? "stop") === "stop" && typeof document !== "undefined") {
      this.hidden = document.visibilityState === "hidden";
      document.addEventListener("visibilitychange", this.onVisibility);
    }
  }

  /** Play `def`, crossfading from whatever plays now. `null` fades out. */
  play(def: SoundscapeDef | null, opts: { crossfadeMs?: number } = {}) {
    if (this.disposed) {
      return;
    }

    const key = def === null ? null : signature(def);

    if (key === this.key) {
      return;
    }

    const crossfadeMs = opts.crossfadeMs ?? this.opts.crossfadeMs ?? DEFAULT_CROSSFADE_MS;
    const previous = this.scape;
    // Only a soundscape that is actually playing is crossfaded from.
    const crossfading = previous?.isRunning ?? false;

    previous?.dispose({ fadeOutMs: crossfadeMs });
    this.key = key;
    this.scape = def === null ? null : new Soundscape(def, this.bus, this.opts);

    if (this.scape && !this.hidden) {
      this.scape.start(crossfading ? { fadeInMs: crossfadeMs } : {});
    }
  }

  /** Fade out and forget the current soundscape. */
  stop(opts: { fadeOutMs?: number } = {}) {
    this.scape?.dispose(opts);
    this.scape = null;
    this.key = null;
  }

  /** The soundscape playing now, for `fire`, `suppressEmitters` or `setBedGain`. */
  get current() {
    return this.scape;
  }

  dispose(opts: { fadeOutMs?: number } = {}) {
    if (this.disposed) {
      return;
    }

    this.stop(opts);
    this.disposed = true;

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
  }
}

export { SoundscapePlayer };
export type { SoundscapePlayerOptions };
