import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWebAudioBus } from "./index.ts";

/** Just enough of the Web Audio graph to see what the adapter schedules. */
class FakeParam {
  value: number;
  readonly events: string[] = [];

  constructor(value: number) {
    this.value = value;
  }

  cancelScheduledValues() {}

  setValueAtTime(value: number, at: number) {
    this.value = value;
    this.events.push(`set ${round(value)} @${at}`);
  }

  linearRampToValueAtTime(value: number, at: number) {
    this.value = value;
    this.events.push(`ramp ${round(value)} @${round(at)}`);
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];

  connect(node: FakeNode) {
    this.outputs.push(node);

    return node;
  }

  disconnect() {
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  start(at: number) {
    this.startedAt = at;
  }

  stop(at = 0) {
    this.stoppedAt = at;
  }
}

class FakeContext {
  currentTime = 10;
  state = "running";
  readonly destination = new FakeNode();
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  closed = false;

  createGain() {
    const gain = new FakeGain();

    this.gains.push(gain);

    return gain;
  }

  createStereoPanner() {
    return new FakePanner();
  }

  createBufferSource() {
    const source = new FakeSource();

    this.sources.push(source);

    return source;
  }

  decodeAudioData(data: ArrayBuffer) {
    const text = new TextDecoder().decode(data);

    return text === "bad" ? Promise.reject(new Error("decode")) : Promise.resolve({ text });
  }

  addEventListener() {}
  removeEventListener() {}
  resume() {
    return Promise.resolve();
  }

  close() {
    this.closed = true;

    return Promise.resolve();
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Files the fake fetch serves: content "bad" fails to decode; a missing name is a 404. */
const files: Record<string, string> = {
  "wind.ogg": "wind",
  "bird.ogg": "bad",
  "bird.m4a": "bird",
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createWebAudioBus", () => {
  let context: FakeContext;

  beforeEach(() => {
    context = new FakeContext();
    vi.stubGlobal("AudioContext", function AudioContext() {
      return context;
    });
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve(
        url in files
          ? {
              ok: true,
              arrayBuffer: () => Promise.resolve(new TextEncoder().encode(files[url]).buffer),
            }
          : { ok: false, status: 404 },
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const make = (opts = {}) =>
    createWebAudioBus(
      { wind: "wind.ogg", bird: ["bird.ogg", "bird.m4a"], gone: "gone.ogg" },
      { autoUnlock: false, ...opts },
    );

  it("loads every sample, falling back to the next source, and reports progress", async () => {
    const bus = make();
    const progress: string[] = [];

    await bus.load({ onProgress: (settled, total) => progress.push(`${settled}/${total}`) });

    expect(progress.at(-1)).toBe("3/3");
    expect(bus.playEmitter("bird", { volume: 1, rate: 1, pan: 0, onEnd: () => {} })).not.toBeNull();
    expect(bus.playEmitter("gone", { volume: 1, rate: 1, pan: 0, onEnd: () => {} })).toBeNull();
  });

  it("starts a bed when its sample arrives, fading in from silence", async () => {
    const bus = make();
    const id = bus.playBed("wind", { volume: 0.6, fadeInMs: 500 });

    expect(id).not.toBeNull();
    expect(context.sources.length).toBe(0);

    await settle();

    const [source] = context.sources;

    expect(source?.loop).toBe(true);
    expect(source?.startedAt).toBe(10);

    const voiceGain = source?.outputs[0] as FakeGain;

    expect(voiceGain.gain.events).toEqual(["set 0 @10", "ramp 0.6 @10.5"]);
  });

  it("skips an emitter that hasn't loaded rather than playing it late", () => {
    const bus = make();

    expect(bus.playEmitter("wind", { volume: 1, rate: 1, pan: 0, onEnd: () => {} })).toBeNull();
  });

  it("plays an emitter at its rate and pan, and calls onEnd when it ends by itself", async () => {
    const bus = make();
    const ends: string[] = [];

    await bus.load();
    bus.playEmitter("wind", { volume: 0.5, rate: 1.04, pan: -0.3, onEnd: () => ends.push("one") });

    const source = context.sources.at(-1)!;
    const gain = source.outputs[0] as FakeGain;
    const panner = gain.outputs[0] as FakePanner;

    expect(source.loop).toBe(false);
    expect(source.playbackRate.value).toBe(1.04);
    expect(panner.pan.value).toBe(-0.3);
    expect(gain.gain.value).toBe(0.5);
    expect(bus.voices).toBe(1);

    source.onended?.();
    expect(ends).toEqual(["one"]);
    expect(bus.voices).toBe(0);
  });

  it("fades a stopped voice out, stops its source after the fade, and doesn't call onEnd", async () => {
    const bus = make();
    const ends: string[] = [];

    await bus.load();

    const id = bus.playEmitter("wind", {
      volume: 1,
      rate: 1,
      pan: 0,
      onEnd: () => ends.push("x"),
    })!;
    const source = context.sources.at(-1)!;

    bus.stop(id, 300);
    expect(bus.voices).toBe(0);
    expect((source.outputs[0] as FakeGain).gain.events.at(-1)).toBe("ramp 0 @10.3");
    expect(source.stoppedAt).toBeCloseTo(10.32);

    source.onended?.();
    expect(ends).toEqual([]);
  });

  it("never starts a bed stopped before its sample arrived", async () => {
    const bus = make();
    const id = bus.playBed("wind", { volume: 1, fadeInMs: 0 })!;

    bus.stop(id, 500);
    await settle();
    expect(context.sources.length).toBe(0);
  });

  it("ducks the whole bus on one node, deepest duck first", async () => {
    const bus = make();

    await bus.load();
    bus.playEmitter("wind", { volume: 1, rate: 1, pan: 0, onEnd: () => {} });

    // Gains: bus, duck, then the voice's.
    const duck = context.gains[1]!;
    const release = bus.duck({ db: -12, attackMs: 120 });

    expect(duck.gain.events.at(-1)).toBe("ramp 0.251 @10.12");

    release();
    expect(duck.gain.events.at(-1)).toBe("ramp 1 @10.45");
    expect(bus.ducked).toBe(false);
  });

  it("allows a level above 1, and mutes on the bus without stopping beds", async () => {
    const bus = make();

    bus.playBed("wind", { volume: 1, fadeInMs: 0 });
    await settle();

    const level = context.gains[0]!;

    bus.setLevel(1.5, 200);
    expect(level.gain.events.at(-1)).toBe("ramp 1.5 @10.2");

    bus.setMuted(true);
    expect(level.gain.events.at(-1)).toBe("ramp 0 @10.03");
    expect(bus.playEmitter("wind", { volume: 1, rate: 1, pan: 0, onEnd: () => {} })).toBeNull();
    expect(context.sources[0]?.stoppedAt).toBeNull();
    expect(bus.voices).toBe(1);
  });

  it("closes the context it made, but not one it was given", async () => {
    const own = make();

    own.playBed("wind", { volume: 1, fadeInMs: 0 });
    own.dispose();
    expect(context.closed).toBe(true);

    const shared = new FakeContext();
    const guest = make({ context: shared as unknown as AudioContext });

    guest.playBed("wind", { volume: 1, fadeInMs: 0 });
    guest.dispose();
    expect(shared.closed).toBe(false);
  });
});
