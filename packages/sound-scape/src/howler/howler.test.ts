import { beforeEach, describe, expect, it, vi } from "vitest";

/** Just enough of Howl: per-voice volume, fades that land when told, and once/off events. */
const created: FakeHowl[] = [];

class FakeHowl {
  readonly src: string[];
  readonly log: string[] = [];
  readonly volumes = new Map<number, number>();
  readonly muted = new Map<number, boolean>();
  private readonly handlers: {
    event: string;
    id?: number;
    callback: (...args: unknown[]) => void;
  }[] = [];
  private loadState = "loading";
  // Howler's ids are large, so a volume argument is never mistaken for one.
  private next = 1000;

  constructor({ src }: { src: string[] }) {
    this.src = src;
    created.push(this);
  }

  readonly played: number[] = [];

  play() {
    const id = this.next++;

    this.played.push(id);
    this.volumes.set(id, 1);

    return id;
  }

  stop(id: number) {
    this.log.push(`stop ${id}`);
  }

  loop() {}

  rate(rate: number, id: number) {
    this.log.push(`rate ${id} ${rate}`);
  }

  stereo(pan: number, id: number) {
    this.log.push(`pan ${id} ${pan}`);
  }

  mute(muted: boolean, id: number) {
    this.muted.set(id, muted);
  }

  /** Like Howler: one argument that names a voice reads that voice's volume. */
  volume(volume?: number, id?: number) {
    if (id === undefined && volume !== undefined && this.volumes.has(volume)) {
      return this.volumes.get(volume) ?? 0;
    }

    if (volume === undefined) {
      return this.volumes.get(id ?? 0) ?? 0;
    }

    this.volumes.set(id ?? 0, volume);

    return this;
  }

  fade(from: number, to: number, ms: number, id: number) {
    this.log.push(`fade ${id} ${round(from)}→${round(to)} ${ms}`);
    this.volumes.set(id, to);
  }

  state() {
    return this.loadState;
  }

  once(event: string, callback: (...args: unknown[]) => void, id?: number) {
    this.handlers.push({ event, id, callback });
  }

  off(event: string, _callback: unknown, id?: number) {
    for (let index = this.handlers.length - 1; index >= 0; index--) {
      const handler = this.handlers[index];

      if (handler?.event === event && handler.id === id) {
        this.handlers.splice(index, 1);
      }
    }
  }

  unload() {
    this.log.push("unload");
  }

  /** Fire a once-handler, as Howler would. */
  emit(event: string, id?: number, ...args: unknown[]) {
    if (event === "load") {
      this.loadState = "loaded";
    }

    for (let index = 0; index < this.handlers.length; index++) {
      const handler = this.handlers[index];

      if (handler && handler.event === event && (handler.id === undefined || handler.id === id)) {
        this.handlers.splice(index, 1);
        index -= 1;
        handler.callback(id, ...args);
      }
    }
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000;

vi.mock("howler", () => ({ Howl: FakeHowl }));

const { createHowlerBus } = await import("./index.ts");

const howlOf = (src: string) => created.find((howl) => howl.src[0] === src)!;

describe("createHowlerBus", () => {
  beforeEach(() => {
    created.length = 0;
    vi.restoreAllMocks();
  });

  it("fades a bed in from silence to its volume times the level", () => {
    const bus = createHowlerBus({ wind: "wind.ogg" }, { level: 0.5 });
    bus.playBed("wind", { volume: 0.8, fadeInMs: 500 });

    const wind = howlOf("wind.ogg");

    expect(wind.log).toEqual([`fade ${wind.played[0]} 0→0.4 500`]);
    expect(bus.voices).toBe(1);
  });

  it("ducks beds and emitters already playing, and releases after the last duck", () => {
    const bus = createHowlerBus({ wind: "wind.ogg", bird: ["bird.webm", "bird.m4a"] });
    bus.playBed("wind", { volume: 1, fadeInMs: 0 });
    bus.playEmitter("bird", { volume: 0.5, rate: 1, pan: 0, onEnd: () => {} });

    const wind = howlOf("wind.ogg");
    const birds = howlOf("bird.webm");
    const bed = wind.played[0];
    const bird = birds.played[0]!;

    expect(birds.src).toEqual(["bird.webm", "bird.m4a"]);

    const first = bus.duck();
    const second = bus.duck({ db: -6 });

    // The deeper duck holds; the shallower one changes nothing.
    expect(bus.ducked).toBe(true);
    expect(wind.log.at(-1)).toBe(`fade ${bed} 1→0.251 120`);
    expect(birds.log.at(-1)).toBe(`fade ${bird} 0.5→0.126 120`);

    // Releasing the deep one eases back to the shallow one; a second release is a no-op.
    first();
    first();
    expect(bus.ducked).toBe(true);
    expect(wind.log.at(-1)).toBe(`fade ${bed} 0.251→0.501 450`);

    second();
    expect(bus.ducked).toBe(false);
    expect(wind.log.at(-1)).toBe(`fade ${bed} 0.501→1 450`);
    expect(birds.volumes.get(bird)).toBe(0.5);
  });

  it("stops a voice when its fade lands, and forgets it at once", () => {
    const bus = createHowlerBus({ wind: "wind.ogg" });
    const id = bus.playBed("wind", { volume: 1, fadeInMs: 0 })!;
    const wind = howlOf("wind.ogg");
    const sound = wind.played[0];

    bus.stop(id, 700);
    expect(bus.voices).toBe(0);
    expect(wind.log.at(-1)).toBe(`fade ${sound} 1→0 700`);

    wind.emit("fade", sound);
    expect(wind.log.at(-1)).toBe(`stop ${sound}`);

    // A later duck leaves the stopped voice alone.
    bus.duck();
    expect(wind.log.at(-1)).toBe(`stop ${sound}`);
  });

  it("calls onEnd for a voice that ends by itself, not for one it stopped", () => {
    const bus = createHowlerBus({ bird: "bird.ogg" });
    const ends: number[] = [];
    bus.playEmitter("bird", { volume: 1, rate: 1.02, pan: -0.3, onEnd: () => ends.push(1) });

    const two = bus.playEmitter("bird", { volume: 1, rate: 1, pan: 0, onEnd: () => ends.push(2) })!;
    const bird = howlOf("bird.ogg");
    const [first, second] = bird.played;

    expect(bird.log).toContain(`rate ${first} 1.02`);
    expect(bird.log).toContain(`pan ${first} -0.3`);

    bird.emit("end", first);
    bus.stop(two, 0);
    bird.emit("end", second);
    expect(ends).toEqual([1]);
    expect(bus.voices).toBe(0);
  });

  it("returns null for a sample it doesn't know, warning once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = createHowlerBus({ wind: "wind.ogg" });

    expect(bus.playEmitter("nope", { volume: 1, rate: 1, pan: 0, onEnd: () => {} })).toBeNull();
    expect(bus.playBed("nope", { volume: 1, fadeInMs: 0 })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("mutes beds in place and skips emitters while muted", () => {
    const bus = createHowlerBus({ wind: "wind.ogg", bird: "bird.ogg" });
    bus.playBed("wind", { volume: 1, fadeInMs: 0 });
    bus.setMuted(true);

    const wind = howlOf("wind.ogg");

    expect(wind.muted.get(wind.played[0]!)).toBe(true);
    expect(bus.playEmitter("bird", { volume: 1, rate: 1, pan: 0, onEnd: () => {} })).toBeNull();

    bus.playBed("wind", { volume: 1, fadeInMs: 0 });
    expect(wind.muted.get(wind.played[1]!)).toBe(true);

    bus.setMuted(false);
    expect(wind.muted.get(wind.played[0]!)).toBe(false);
  });

  it("clamps to Howler's 0..1", () => {
    const bus = createHowlerBus({ wind: "wind.ogg" }, { level: 2 });
    bus.playBed("wind", { volume: 0.8, fadeInMs: 0 });

    const wind = howlOf("wind.ogg");

    expect(wind.volumes.get(wind.played[0]!)).toBe(1);
  });

  it("moves a voice's volume with setVolume and the level with setLevel", () => {
    const bus = createHowlerBus({ wind: "wind.ogg" });
    const id = bus.playBed("wind", { volume: 0.5, fadeInMs: 0 })!;
    const wind = howlOf("wind.ogg");
    const sound = wind.played[0]!;

    bus.setVolume(id, 0.8, 200);
    expect(wind.log.at(-1)).toBe(`fade ${sound} 0.5→0.8 200`);

    bus.setLevel(0.5);
    expect(wind.volumes.get(sound)).toBe(0.4);
  });

  it("loads every sample, counting failures as settled", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const bus = createHowlerBus({ wind: "wind.ogg", bird: "bird.ogg" });
    const progress: string[] = [];
    const loading = bus.load({
      onProgress: (settled, total) => progress.push(`${settled}/${total}`),
    });

    howlOf("wind.ogg").emit("load");
    howlOf("bird.ogg").emit("loaderror", undefined, "404");
    await loading;

    expect(progress).toEqual(["1/2", "2/2"]);
  });

  it("stops everything and unloads on dispose", () => {
    const bus = createHowlerBus({ wind: "wind.ogg" });
    bus.playBed("wind", { volume: 1, fadeInMs: 0 });

    const wind = howlOf("wind.ogg");

    bus.dispose();
    expect(wind.log.slice(-2)).toEqual([`stop ${wind.played[0]}`, "unload"]);
    expect(bus.voices).toBe(0);
  });
});
