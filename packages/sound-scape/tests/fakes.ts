import { type SoundscapeBus, type Timers } from "../src/index.ts";

/** Timers that fire only when the test advances the clock. */
const fakeTimers = () => {
  const pending = new Map<number, { at: number; callback: () => void }>();
  let now = 0;
  let next = 1;
  const timers: Timers = {
    set: (callback, ms) => {
      const id = next++;

      pending.set(id, { at: now + ms, callback });

      return id;
    },
    clear: (id) => {
      pending.delete(id as number);
    },
  };

  const advance = (ms: number) => {
    const until = now + ms;

    for (;;) {
      const due = [...pending.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];

      if (!due) {
        break;
      }

      const [id, timer] = due;

      pending.delete(id);
      now = timer.at;
      timer.callback();
    }

    now = until;
  };

  return {
    timers,
    advance,
    pending,
    get now() {
      return now;
    },
  };
};

type Fired = { id: number; sample: string; volume: number; rate: number; pan: number; at: number };

/** A bus that only takes notes; `end(id)` finishes an emitter, `endAll()` every live one. */
const fakeBus = (clock: { readonly now: number } = { now: 0 }) => {
  const calls: string[] = [];
  const ends = new Map<number, () => void>();
  const emitters: Fired[] = [];
  const volumes = new Map<number, number>();
  const missing = new Set<string>();
  let next = 100;
  const bus: SoundscapeBus<number> = {
    playBed: (sample, { volume, fadeInMs }) => {
      if (missing.has(sample)) {
        return null;
      }

      const id = next++;

      volumes.set(id, volume);
      calls.push(`bed ${sample} ${volume} in ${fadeInMs}`);

      return id;
    },
    playEmitter: (sample, { volume, rate, pan, onEnd }) => {
      if (missing.has(sample)) {
        return null;
      }

      const id = next++;

      emitters.push({ id, sample, volume, rate, pan, at: clock.now });
      ends.set(id, onEnd);

      return id;
    },
    stop: (id, fadeOutMs) => {
      ends.delete(id);
      calls.push(`stop ${id} out ${fadeOutMs}`);
    },
    setVolume: (id, volume, fadeMs) => {
      volumes.set(id, volume);
      calls.push(`volume ${id} ${volume} over ${fadeMs}`);
    },
  };

  return {
    bus,
    calls,
    emitters,
    ends,
    missing,
    volumes,
    end: (id: number) => {
      const onEnd = ends.get(id);

      ends.delete(id);
      onEnd?.();
    },
    endAll: () => {
      for (const [id, onEnd] of Array.from(ends)) {
        ends.delete(id);
        onEnd();
      }
    },
  };
};

export { fakeBus, fakeTimers };
