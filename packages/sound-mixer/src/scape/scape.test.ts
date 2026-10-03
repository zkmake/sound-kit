import { Soundscape, type SoundscapeAdapter } from "@zkmake/sound-scape";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeContext, fakeFetch, type FakeGain } from "../../tests/fake-audio.ts";
import { seeded } from "../../tests/seeded.ts";
import { defineSounds, SoundMixer } from "../core/mixer.ts";
import { soundscapeBus } from "./index.ts";

const SOUNDS = defineSounds({
  wind: { src: "wind.ogg", bus: "ambience" },
  "bird-1": { src: "bird-1.ogg", bus: "ambience" },
  "bird-2": { src: "bird-2.ogg", bus: "ambience" },
});

describe("soundscapeBus", () => {
  let context: FakeContext;

  beforeEach(() => {
    context = new FakeContext();
    vi.stubGlobal("AudioContext", function AudioContext() {
      return context;
    });
    vi.stubGlobal(
      "fetch",
      fakeFetch({ "wind.ogg": "12", "bird-1.ogg": "0.6", "bird-2.ogg": "0.6" }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setup = async () => {
    const mixer = new SoundMixer({ sounds: SOUNDS, autoUnlock: false });
    // The bus has sound-scape's adapter shape; this line is the type check.
    const bus: SoundscapeAdapter<number> = soundscapeBus(mixer);

    await bus.load();

    return { mixer, bus };
  };

  it("runs a soundscape on the mixer's ambience bus", async () => {
    const { mixer, bus } = await setup();
    const timers: (() => void)[] = [];
    const scape = new Soundscape(
      {
        bed: { sample: "wind", volume: 0.5, fadeInMs: 0 },
        emitters: [{ samples: ["bird-1", "bird-2"], intervalMs: [1000, 2000] }],
      },
      bus,
      { random: seeded(1), timers: { set: (fn) => timers.push(fn), clear: () => {} } },
    );

    scape.start();
    timers.shift()?.();

    const [bed, bird] = context.sources;

    expect(bed?.loop).toBe(true);
    expect(bird?.loop).toBe(false);
    expect(bird?.playbackRate.value).toBeGreaterThanOrEqual(0.95);
    expect(mixer.voiceCount("ambience")).toBe(2);
    expect(bus.voices).toBe(2);
    expect(scape.liveEmitters).toBe(1);

    // The bird ends by itself: the soundscape hears about it.
    context.advance(1);
    expect(scape.liveEmitters).toBe(0);

    scape.dispose();
    expect(bus.voices).toBe(0);
  });

  it("ducks, levels and mutes the mixer bus", async () => {
    const { mixer, bus } = await setup();
    const release = bus.duck({ db: -12 });

    expect(bus.ducked).toBe(true);
    expect(mixer.isDucked("ambience")).toBe(true);
    release();

    bus.setLevel(0.4, 0);
    expect(mixer.settings.levels.ambience).toBe(0.4);
    expect((mixer.input("ambience") as unknown as FakeGain).gain.last).toBe(0.4);

    bus.setMuted(true);
    expect(mixer.settings.mutedBuses).toEqual(["ambience"]);
    expect(bus.playEmitter("bird-1", { volume: 1, rate: 1, pan: 0, onEnd: () => {} })).toBeNull();
  });
});
