import { describe, expect, it } from "vitest";

import { fakeBus, fakeTimers } from "../../tests/fakes.ts";
import { seededRandom } from "./random.ts";
import { Soundscape } from "./soundscape.ts";
import { type SoundscapeDef, type Timers } from "./types.ts";

const DEF: SoundscapeDef = {
  bed: { sample: "wind", volume: 0.5, fadeInMs: 800, fadeOutMs: 600 },
  emitters: [
    {
      name: "birds",
      samples: ["bird-1", "bird-2", "bird-3"],
      intervalMs: [4000, 9000],
      volume: [0.2, 0.3],
      rate: [0.95, 1.05],
      pan: [-0.4, 0.4],
    },
  ],
  maxConcurrent: 2,
};

/** A scape over fakes, with the clock shared so fires are stamped with the time they happened. */
const setup = (def: SoundscapeDef = DEF, seed = 1) => {
  const time = fakeTimers();
  const fake = fakeBus(time);
  const events: string[] = [];
  const scape = new Soundscape(def, fake.bus, {
    random: seededRandom(seed),
    timers: time.timers,
    onEmitter: ({ emitter, sample, phase }) => events.push(`${phase} ${emitter} ${sample}`),
  });

  return { ...time, ...fake, scape, events };
};

describe("Soundscape", () => {
  it("fades the bed in on start, out on stop, and cuts the emitters quickly", () => {
    const { scape, calls, emitters, pending, advance, endAll } = setup();

    scape.start();
    expect(calls).toEqual(["bed wind 0.5 in 800"]);
    expect(pending.size).toBe(1);

    advance(9000);
    expect(emitters.length).toBe(1);

    scape.stop();
    expect(calls.slice(1)).toEqual(["stop 100 out 600", `stop ${emitters[0]?.id} out 250`]);
    expect(pending.size).toBe(0);
    expect(scape.liveEmitters).toBe(0);

    endAll();
    advance(60_000);
    expect(calls.length).toBe(3);
  });

  it("fires each emitter on its own randomised interval, within the ranges", () => {
    const { scape, emitters, advance, endAll } = setup(DEF, 7);

    scape.start();

    // Small steps, so each fire ends before the next and the cap never bites.
    for (let step = 0; step < 600; step++) {
      advance(100);
      endAll();
    }

    expect(emitters.length).toBeGreaterThan(5);
    // The first comes sooner than a full interval; the gaps after that are in range.
    expect(emitters[0]?.at).toBeLessThanOrEqual(9000 * 0.75);

    for (let index = 1; index < emitters.length; index++) {
      const gap = (emitters[index]?.at ?? 0) - (emitters[index - 1]?.at ?? 0);

      expect(gap).toBeGreaterThanOrEqual(4000);
      expect(gap).toBeLessThanOrEqual(9000);
    }

    for (const fired of emitters) {
      expect(fired.volume).toBeGreaterThanOrEqual(0.2);
      expect(fired.volume).toBeLessThanOrEqual(0.3);
      expect(fired.rate).toBeGreaterThanOrEqual(0.95);
      expect(fired.rate).toBeLessThanOrEqual(1.05);
      expect(Math.abs(fired.pan)).toBeLessThanOrEqual(0.4);
    }
  });

  it("never plays the same sample twice in a row", () => {
    const { scape, emitters, advance, endAll } = setup(DEF, 3);

    scape.start();

    for (let step = 0; step < 400; step++) {
      advance(500);
      endAll();
    }

    expect(emitters.length).toBeGreaterThan(20);

    for (let index = 1; index < emitters.length; index++) {
      expect(emitters[index]?.sample).not.toBe(emitters[index - 1]?.sample);
    }
  });

  it("drops a fire past the cap, and counts the ends back down", () => {
    const { scape, emitters, advance, endAll } = setup(DEF, 5);

    scape.start();
    // Nothing ever ends: after two, every fire is dropped.
    advance(120_000);
    expect(emitters.length).toBe(2);
    expect(scape.liveEmitters).toBe(2);

    endAll();
    expect(scape.liveEmitters).toBe(0);
    advance(30_000);
    expect(emitters.length).toBeGreaterThan(2);
  });

  it("fills in the defaults: tight ranges, a 500 ms bed fade, a cap of 4", () => {
    const def: SoundscapeDef = {
      bed: { sample: "room", volume: 0.4 },
      emitters: [{ samples: ["a", "b", "c"], intervalMs: [100, 200] }],
    };
    const { scape, calls, emitters, advance } = setup(def, 11);

    scape.start();
    advance(60_000);

    expect(calls[0]).toBe("bed room 0.4 in 500");
    expect(emitters.length).toBe(4);

    for (const fired of emitters) {
      expect(fired.volume).toBeGreaterThanOrEqual(0.7);
      expect(fired.volume).toBeLessThanOrEqual(1);
      expect(fired.rate).toBeGreaterThanOrEqual(0.95);
      expect(fired.rate).toBeLessThanOrEqual(1.05);
      expect(Math.abs(fired.pan)).toBeLessThanOrEqual(0.4);
    }

    scape.stop();
    expect(calls).toContain("stop 100 out 700");
  });

  it("runs with no bed, and with no emitters", () => {
    const noBed = setup({ emitters: DEF.emitters, maxConcurrent: 1 });

    noBed.scape.start();
    noBed.advance(10_000);
    expect(noBed.calls).toEqual([]);
    expect(noBed.emitters.length).toBe(1);

    const bedOnly = setup({ bed: { sample: "hum", volume: 1 } });

    bedOnly.scape.start();
    bedOnly.advance(10_000);
    expect(bedOnly.calls).toEqual(["bed hum 1 in 500"]);
    expect(bedOnly.pending.size).toBe(0);
  });

  it("starts again after a stop, and does nothing once disposed", () => {
    const { scape, calls, pending, advance } = setup(DEF, 9);

    scape.start();
    scape.stop();
    scape.start();
    expect(calls.filter((call) => call.startsWith("bed ")).length).toBe(2);
    expect(scape.isRunning).toBe(true);

    scape.dispose();
    scape.dispose();
    expect(scape.isRunning).toBe(false);
    expect(scape.isDisposed).toBe(true);
    expect(pending.size).toBe(0);

    scape.start();
    expect(scape.isRunning).toBe(false);
    expect(scape.fire(0)).toBe(false);
    advance(60_000);
    expect(calls.filter((call) => call.startsWith("bed ")).length).toBe(2);
  });

  it("ignores a timer that fires after dispose, even if the host never cleared it", () => {
    const queued: (() => void)[] = [];
    const leaky: Timers = { set: (callback) => queued.push(callback), clear: () => {} };
    const fake = fakeBus();
    const scape = new Soundscape(DEF, fake.bus, { timers: leaky, random: seededRandom(2) });

    scape.start();
    scape.dispose();
    queued.forEach((callback) => callback());

    expect(fake.emitters.length).toBe(0);
    expect(queued.length).toBe(1);
  });

  it("stops only its own emitters when two share a bus", () => {
    const time = fakeTimers();
    const fake = fakeBus(time);
    const one = new Soundscape(DEF, fake.bus, { timers: time.timers, random: seededRandom(1) });
    const two = new Soundscape({ ...DEF, bed: null }, fake.bus, {
      timers: time.timers,
      random: seededRandom(4),
    });

    one.start();
    two.start();
    time.advance(20_000);
    expect(one.liveEmitters).toBeGreaterThan(0);
    expect(two.liveEmitters).toBeGreaterThan(0);

    const theirs = two.liveEmitters;

    one.stop();
    expect(one.liveEmitters).toBe(0);
    expect(two.liveEmitters).toBe(theirs);
    expect(fake.ends.size).toBe(theirs);
  });

  it("holds emitters back while suppressed, fading out the ones playing", () => {
    const { scape, calls, emitters, advance, endAll } = setup(DEF, 6);

    scape.start();
    advance(9000);

    const playing = scape.liveEmitters;

    expect(playing).toBeGreaterThan(0);

    scape.suppressEmitters(true);
    expect(calls.slice(-playing)).toEqual(
      emitters.slice(-playing).map(({ id }) => `stop ${id} out 300`),
    );
    expect(scape.liveEmitters).toBe(0);

    const before = emitters.length;

    advance(60_000);
    expect(emitters.length).toBe(before);
    expect(scape.emittersSuppressed).toBe(true);

    scape.suppressEmitters(false);
    advance(9000);
    endAll();
    expect(emitters.length).toBeGreaterThan(before);
  });

  it("fires on demand by name or index, within the cap", () => {
    const { scape, emitters } = setup();

    expect(scape.emitterNames).toEqual(["birds"]);
    expect(scape.fire("birds")).toBe(true);
    expect(scape.fire(0)).toBe(true);
    expect(scape.fire("birds")).toBe(false);
    expect(scape.fire("nope")).toBe(false);
    expect(emitters.length).toBe(2);
  });

  it("scales the bed live and keeps the gain for the next start", () => {
    const { scape, calls } = setup();

    scape.setBedGain(0.5);
    scape.start();
    expect(calls[0]).toBe("bed wind 0.25 in 800");

    scape.setBedGain(2, { fadeMs: 300 });
    expect(calls.at(-1)).toBe("volume 100 1 over 300");
  });

  it("reports emitter starts and ends, including ones it cuts", () => {
    const { scape, events, advance, emitters, end } = setup(DEF, 8);

    scape.start();
    advance(9000);

    const first = emitters[0];

    expect(events).toEqual([`start birds ${first?.sample}`]);
    end(first?.id ?? 0);
    expect(events.at(-1)).toBe(`end birds ${first?.sample}`);

    advance(20_000);
    expect(scape.liveEmitters).toBeGreaterThan(0);
    scape.stop();

    const starts = events.filter((event) => event.startsWith("start")).length;
    const ends = events.filter((event) => event.startsWith("end")).length;

    expect(starts).toBeGreaterThan(1);
    expect(ends).toBe(starts);
  });

  it("skips a fire the bus can't play, without counting it or marking it last", () => {
    const { scape, emitters, missing } = setup({
      emitters: [{ samples: ["gone", "here"], intervalMs: [1, 1] }],
    });

    missing.add("gone");

    let tries = 0;

    while (emitters.length === 0 && tries < 50) {
      scape.fire(0);
      tries += 1;
    }

    expect(emitters[0]?.sample).toBe("here");
    expect(scape.liveEmitters).toBe(1);
  });

  it("starts with overridden fades", () => {
    const { scape, calls } = setup();

    scape.start({ fadeInMs: 2000 });
    scape.stop({ fadeOutMs: 100 });
    expect(calls).toEqual(["bed wind 0.5 in 2000", "stop 100 out 100"]);
  });
});
