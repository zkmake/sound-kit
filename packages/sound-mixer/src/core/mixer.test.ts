import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FakeAnalyser,
  FakeContext,
  fakeFetch,
  type FakeGain,
  type FakePanner,
  type FakeSource,
  settle,
} from "../../tests/fake-audio.ts";
import { defineSounds, SoundMixer } from "./mixer.ts";

const SOUNDS = defineSounds({
  click: { src: "click.ogg", bus: "ui", volume: 0.5 },
  step: { variants: ["step-1.ogg", "step-2.ogg", "step-3.ogg"], rate: [0.95, 1.05] },
  hum: { src: ["hum.ogg", "hum.m4a"], loop: true, bus: "ambience" },
  boom: { src: "boom.ogg", volume: 2, voices: 2 },
  thud: { src: "boom.ogg", voices: 1, onLimit: "drop" },
  lazy: { src: "lazy.ogg", preload: false },
  gone: { src: "gone.ogg" },
});

const FILES = {
  "click.ogg": "0.2",
  "step-1.ogg": "0.3",
  "step-2.ogg": "0.3",
  "step-3.ogg": "0.3",
  "hum.ogg": "bad",
  "hum.m4a": "4",
  "boom.ogg": "1",
  "lazy.ogg": "0.5",
};

/** localStorage in a Map. */
const memoryStorage = () => {
  const map = new Map<string, string>();

  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
};

/** The voice's gain and panner, found from its source. */
const chain = (source: FakeSource) => {
  const gain = source.outputs[0] as FakeGain;
  const panner = gain.outputs[0] as FakePanner;

  return { gain, panner, target: panner.outputs[0] };
};

describe("SoundMixer", () => {
  let context: FakeContext;
  let made: number;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    context = new FakeContext();
    made = 0;
    vi.stubGlobal("AudioContext", function AudioContext() {
      made += 1;

      return context;
    });
    vi.stubGlobal("fetch", fakeFetch(FILES));
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const make = (opts: Partial<ConstructorParameters<typeof SoundMixer>[0]> = {}) =>
    new SoundMixer({ sounds: SOUNDS, autoUnlock: false, ...opts });

  it("touches nothing until the first load or play", () => {
    const mixer = make();

    expect(made).toBe(0);
    expect(mixer.state).toBe("idle");
    expect(mixer.settings.levels).toEqual({
      master: 1,
      music: 1,
      sfx: 1,
      ambience: 1,
      ui: 1,
      voice: 1,
    });
  });

  it("loads each distinct file once, falls back to the next source, and counts failures", async () => {
    const mixer = make();
    const progress: string[] = [];

    await mixer.load({ onProgress: (settled, total) => progress.push(`${settled}/${total}`) });

    // click, 3 steps, hum, boom (shared by thud), gone; not lazy.
    expect(progress.at(-1)).toBe("7/7");
    expect(mixer.play("hum")).not.toBeNull();
    expect(mixer.play("gone")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("gone.ogg"));
  });

  it("routes a voice through gain and pan into its bus, with volume above 1", async () => {
    const mixer = make();

    await mixer.load();

    const voice = mixer.play("boom", { pan: -0.5 })!;
    const source = context.sources.at(-1)!;
    const { gain, panner, target } = chain(source);

    expect(voice.bus).toBe("sfx");
    expect(gain.gain.value).toBe(2);
    expect(panner.pan.value).toBe(-0.5);
    expect(target).toBe(mixer.input("sfx"));
    expect(source.startedAt).toBe(0);
  });

  it("never plays the same variant twice in a row, and draws rate from the range", async () => {
    const mixer = make();

    await mixer.load();

    let last: unknown = null;

    for (let index = 0; index < 30; index++) {
      mixer.play("step");

      const source = context.sources.at(-1)!;

      expect(source.buffer).not.toBe(last);
      expect(source.playbackRate.value).toBeGreaterThanOrEqual(0.95);
      expect(source.playbackRate.value).toBeLessThanOrEqual(1.05);
      last = source.buffer;
      context.advance(1);
    }
  });

  it("steals the oldest voice at the cap, or drops the new one", async () => {
    const mixer = make();

    await mixer.load();
    mixer.play("boom");
    mixer.play("boom");

    const [first] = context.sources;

    mixer.play("boom");
    expect(first?.stoppedAt).not.toBeNull();
    expect(mixer.voiceCount("sfx")).toBe(2);

    expect(mixer.play("thud")).not.toBeNull();
    expect(mixer.play("thud")).toBeNull();
  });

  it("skips a one-shot that isn't loaded, and loads it for next time", async () => {
    const mixer = make();

    expect(mixer.play("lazy")).toBeNull();
    await settle();
    expect(mixer.play("lazy")).not.toBeNull();
  });

  it("starts a loop that isn't loaded yet when it arrives, fading in", async () => {
    const mixer = make();
    const voice = mixer.play("hum", { fadeInMs: 500 })!;

    expect(voice.playing).toBe(true);
    expect(context.sources.length).toBe(0);

    await settle();
    await settle();

    const source = context.sources.at(-1)!;

    expect(source.loop).toBe(true);
    expect(chain(source).gain.gain.events).toEqual(["set 0 @0", "ramp 1 @0.5"]);
  });

  it("calls onEnd when a voice ends by itself, not when stopped", async () => {
    const mixer = make();
    const ends: string[] = [];

    await mixer.load();
    mixer.play("click", { onEnd: () => ends.push("natural") });

    const stopped = mixer.play("click", { onEnd: () => ends.push("stopped") })!;

    stopped.stop(100);
    expect(stopped.playing).toBe(false);
    expect(mixer.voiceCount()).toBe(1);

    context.advance(0.5);
    expect(ends).toEqual(["natural"]);
    expect(mixer.voiceCount()).toBe(0);
  });

  it("moves bus and master levels, mutes, and switches buses off", async () => {
    const mixer = make();

    await mixer.load();
    mixer.setLevel("music", 0.4, 200);
    expect((mixer.input("music") as unknown as FakeGain).gain.events.at(-1)).toBe("ramp 0.4 @0.2");

    mixer.setBusMuted("music", true);
    expect((mixer.input("music") as unknown as FakeGain).gain.last).toBe(0);
    expect(mixer.settings.levels.music).toBe(0.4);

    mixer.setBusMuted("music", false);
    expect((mixer.input("music") as unknown as FakeGain).gain.last).toBe(0.4);

    // The first gain made is the master.
    const master = context.gains[0]!;

    mixer.setMuted(true);
    expect(master.gain.last).toBe(0);
    mixer.setMuted(false);
    expect(master.gain.last).toBe(1);
  });

  it("persists settings under its key, restores them, and runs a migration", async () => {
    const storage = memoryStorage();

    vi.stubGlobal("localStorage", storage);

    const first = make({ storageKey: "game:sound" });
    const changes: number[] = [];

    first.subscribe(() => changes.push(1));
    first.setLevel("sfx", 0.3);
    first.setBusMuted("music", true);
    expect(changes.length).toBe(2);

    const second = make({ storageKey: "game:sound" });

    expect(second.settings.levels.sfx).toBe(0.3);
    expect(second.settings.mutedBuses).toEqual(["music"]);

    // The game's old keys, folded in once.
    storage.setItem("sfx:volume", "0.7");

    const migrated = make({
      storageKey: "fresh",
      migrate: (stored) =>
        stored
          ? null
          : { levels: { ...second.settings.levels, sfx: Number(storage.getItem("sfx:volume")) } },
    });

    expect(migrated.settings.levels.sfx).toBe(0.7);
    expect(JSON.parse(storage.getItem("fresh")!).levels.sfx).toBe(0.7);
  });

  it("ignores stored settings that don't fit", () => {
    const storage = memoryStorage();

    vi.stubGlobal("localStorage", storage);
    storage.setItem(
      "k",
      JSON.stringify({
        muted: "yes",
        levels: { sfx: -1, ui: 0.5, nope: 2 },
        mutedBuses: ["ui", "nope", 3],
      }),
    );

    const mixer = make({ storageKey: "k" });

    expect(mixer.settings.muted).toBe(false);
    expect(mixer.settings.levels.sfx).toBe(1);
    expect(mixer.settings.levels.ui).toBe(0.5);
    expect(mixer.settings.mutedBuses).toEqual(["ui"]);
  });

  it("ducks buses with the deepest duck winning, and releases", async () => {
    const mixer = make();

    await mixer.load();

    const duckOf = (bus: "ambience" | "music") =>
      (mixer.input(bus) as unknown as FakeGain).outputs[0] as FakeGain;
    const releaseA = mixer.duck(["ambience", "music"], { db: -6, attackMs: 100 });

    expect(duckOf("ambience").gain.events.at(-1)).toBe("ramp 0.501 @0.1");
    expect(duckOf("music").gain.last).toBe(0.501);

    const releaseB = mixer.duck("ambience", { db: -20 });

    expect(duckOf("ambience").gain.last).toBe(0.1);
    expect(mixer.isDucked("ambience")).toBe(true);

    releaseB();
    expect(duckOf("ambience").gain.events.at(-1)).toBe("ramp 0.501 @0.45");
    releaseA();
    releaseA();
    expect(duckOf("ambience").gain.last).toBe(1);
    expect(mixer.isDucked("ambience")).toBe(false);
    expect(mixer.isDucked("music")).toBe(false);
  });

  it("scales rate for live and new voices on the chosen buses", async () => {
    const mixer = make();
    const events: string[] = [];

    await mixer.load();
    mixer.on("rate", () => events.push("rate"));
    mixer.play("boom", { rate: 1 });
    mixer.play("click");
    mixer.setRate(0.5, { buses: ["sfx"] });

    const [boom, click] = context.sources;

    expect(boom?.playbackRate.last).toBe(0.5);
    expect(click?.playbackRate.last).toBe(1);
    expect(mixer.rate("sfx")).toBe(0.5);
    expect(events).toEqual(["rate"]);

    mixer.play("boom", { rate: 1.2 });
    expect(context.sources.at(-1)?.playbackRate.value).toBe(0.6);
  });

  it("runs `after` on audio time, which stops while paused", async () => {
    const mixer = make();
    const fired: string[] = [];

    await mixer.load();
    mixer.after(260, () => fired.push("wagon"));

    const cancel = mixer.after(100, () => fired.push("cancelled"));

    cancel();
    context.advance(0.1);
    mixer.setPaused(true);
    await settle();
    expect(context.state).toBe("suspended");
    context.advance(1);
    expect(fired).toEqual([]);

    mixer.setPaused(false);
    await settle();
    context.advance(0.2);
    expect(fired).toEqual(["wagon"]);
  });

  it("suspends while the tab is hidden and resumes when it shows, unless paused", async () => {
    const listeners = new Map<string, () => void>();
    const doc = {
      visibilityState: "visible",
      createElement: () => ({ canPlayType: () => "maybe" }),
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };

    vi.stubGlobal("document", doc);

    const mixer = make();

    await mixer.load();
    doc.visibilityState = "hidden";
    listeners.get("visibilitychange")?.();
    expect(context.state).toBe("suspended");

    mixer.setPaused(true);
    doc.visibilityState = "visible";
    listeners.get("visibilitychange")?.();
    expect(context.state).toBe("suspended");

    mixer.setPaused(false);
    expect(context.state).toBe("running");

    mixer.dispose();
    expect(listeners.size).toBe(0);
  });

  it("reads peak and RMS from a bus meter", async () => {
    const mixer = make();

    await mixer.load();

    const meter = mixer.meter("sfx");
    const analyser = Array.from(context.gains)
      .flatMap((gain) => gain.outputs)
      .find((node) => node instanceof FakeAnalyser) as FakeAnalyser;

    analyser.level = -0.5;
    expect(meter.peak()).toBe(0.5);
    expect(meter.rms()).toBe(0.5);
    expect(mixer.meter("master").peak()).toBe(0);
  });

  it("warns and returns null for an unknown sound or bus", async () => {
    const mixer = make();

    await mixer.load();
    expect(mixer.play("nope" as "click")).toBeNull();
    expect(mixer.play("click", { bus: "nope" })).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not in the sound registry"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('bus "nope"'));
  });

  it("stops everything and closes its own context on dispose, twice safely", async () => {
    const mixer = make();

    await mixer.load();
    mixer.play("hum");
    mixer.dispose();
    mixer.dispose();
    expect(context.state).toBe("closed");
    expect(mixer.voiceCount()).toBe(0);
    expect(mixer.play("click")).toBeNull();
  });

  it("reports plays, steals, drops, stops, ends, loads and ducks to observers", async () => {
    const mixer = make();
    const events: string[] = [];
    const off = mixer.observe((event) =>
      events.push("reason" in event ? `drop ${event.sound} ${event.reason}` : `${event.type}`),
    );

    mixer.play("lazy");
    await mixer.load();
    expect(events).toContain("drop lazy loading");
    expect(events.filter((event) => event === "load").length).toBeGreaterThan(5);

    events.length = 0;
    mixer.play("boom");
    mixer.play("boom");
    mixer.play("boom");
    mixer.play("thud");
    mixer.play("thud");
    mixer.play("gone");
    mixer.duck("music")();
    expect(events).toEqual([
      "play",
      "play",
      "steal",
      "stop",
      "play",
      "play",
      "drop thud cap",
      "drop gone failed",
      "duck",
      "duck",
    ]);

    events.length = 0;
    context.advance(2);
    expect(events).toEqual(["end", "end", "end"]);

    off();
    mixer.play("click");
    expect(events.length).toBe(3);
  });

  it("lists voices oldest first, and samples with their decoded size", async () => {
    const mixer = make();

    await mixer.load();
    mixer.play("hum");
    context.advance(0.5);
    mixer.play("click", { delayMs: 100 });

    const voices = mixer.voices();

    expect(voices.map(({ sound, bus, loop }) => [sound, bus, loop])).toEqual([
      ["hum", "ambience", true],
      ["click", "ui", false],
    ]);
    expect(mixer.voices("ui").length).toBe(1);

    const boom = mixer.samples().find((sample) => sample.url === "boom.ogg");

    expect(boom?.sounds).toEqual(["boom", "thud"]);
    expect(boom?.status).toBe("loaded");
    expect(mixer.samples().find((sample) => sample.url === "gone.ogg")?.status).toBe("failed");
  });

  it("solos one bus without touching the saved settings", async () => {
    const mixer = make();

    await mixer.load();
    mixer.solo("music");
    expect(mixer.soloed).toBe("music");
    expect((mixer.input("sfx") as unknown as FakeGain).gain.last).toBe(0);
    expect((mixer.input("music") as unknown as FakeGain).gain.last).toBe(1);
    expect(mixer.settings.mutedBuses).toEqual([]);

    mixer.solo(null);
    expect((mixer.input("sfx") as unknown as FakeGain).gain.last).toBe(1);
  });

  it("leaves a shared context open", async () => {
    const shared = new FakeContext();
    const mixer = make({ context: shared as unknown as AudioContext });

    mixer.play("hum");
    mixer.dispose();
    expect(shared.state).toBe("running");
    expect(made).toBe(0);
  });
});
