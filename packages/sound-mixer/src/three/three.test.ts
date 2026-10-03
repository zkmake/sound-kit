import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Fake3D,
  FakeContext,
  fakeFetch,
  type FakeGain,
  type FakePanner,
} from "../../tests/fake-audio.ts";
import { defineSounds, SoundMixer } from "../core/mixer.ts";
import { createSpace, falloffGain } from "./index.ts";

/** A column-major 4×4 at `[x, y, z]`, unrotated: what `matrixWorld` holds for a moved object. */
const at = (x: number, y: number, z: number) => ({
  matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] },
});

/** A camera turned 180° about Y: its right is world −X. */
const turned = { matrixWorld: { elements: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1] } };

const SOUNDS = defineSounds({
  fire: { src: "fire.ogg", loop: true, bus: "ambience" },
  chirp: { src: "chirp.ogg" },
});

describe("createSpace", () => {
  let context: FakeContext;

  beforeEach(() => {
    context = new FakeContext();
    vi.stubGlobal("AudioContext", function AudioContext() {
      return context;
    });
    vi.stubGlobal("fetch", fakeFetch({ "fire.ogg": "4", "chirp.ogg": "0.5" }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setup = async (listener = at(0, 0, 0)) => {
    const mixer = new SoundMixer({ sounds: SOUNDS, autoUnlock: false });

    await mixer.load();

    return { mixer, space: createSpace(mixer, { listener }) };
  };

  it("falls off linearly between near and far", () => {
    expect(falloffGain(0.5, [1, 20])).toBe(1);
    expect(falloffGain(10.5, [1, 20])).toBe(0.5);
    expect(falloffGain(25, [1, 20])).toBe(0);
  });

  it("places a sound by distance and side, into its own bus", async () => {
    const { mixer, space } = await setup();
    const voice = space.play("fire", at(10.5, 0, 0), { falloff: [1, 20] })!;
    // Made in order: the placement's gain, then the voice's.
    const placement = context.gains.at(-2) as FakeGain;
    const pan = placement.outputs[0] as FakePanner;

    expect(pan.outputs[0]).toBe(mixer.input("ambience") as unknown);
    expect(voice.playing).toBe(true);
    expect(placement.gain.last).toBe(0.5);
    expect(pan.pan.last).toBe(0.8);
    expect(space.size).toBe(1);
  });

  it("follows the object and the listener on update", async () => {
    const listener = at(0, 0, 0);
    const { space } = await setup(listener);
    const target = at(-3, 0, 0);

    space.play("fire", target, { falloff: [1, 5], panWidth: 1 });

    const placement = context.gains.at(-2) as FakeGain;
    const pan = placement.outputs[0] as FakePanner;

    expect(pan.pan.last).toBe(-1);

    // The listener turns round: the same source is now on its right.
    space.setListener(turned);
    space.update();
    expect(pan.pan.last).toBe(1);

    target.matrixWorld.elements[12] = -10;
    space.update();
    expect(placement.gain.last).toBe(0);
  });

  it("takes a plain point and moves to another", async () => {
    const { space } = await setup();
    const voice = space.play("fire", [2, 0, 0], { falloff: [1, 3] })!;
    const placement = context.gains.at(-2) as FakeGain;

    expect(placement.gain.last).toBe(0.5);
    voice.moveTo([0, 0, 0]);
    space.update();
    expect(placement.gain.last).toBe(1);
  });

  it("uses a PannerNode for HRTF, and moves the listener", async () => {
    const { mixer, space } = await setup(at(1, 2, 3));

    space.play("chirp", at(4, 5, 6), { panner: "HRTF", refDistance: 2 });

    const panner = mixer.input("sfx") as unknown as FakeGain;
    const node = context.sources.at(-1)!.outputs[0]!.outputs[0]!.outputs[0] as unknown as Fake3D;

    expect(panner).toBeDefined();
    expect(node.panningModel).toBe("HRTF");
    expect(node.refDistance).toBe(2);
    expect([node.positionX.value, node.positionY.value, node.positionZ.value]).toEqual([4, 5, 6]);
    expect([context.listener.positionX.value, context.listener.positionZ.value]).toEqual([1, 3]);
    expect(context.listener.forwardZ.value).toBe(-1);
  });

  it("forgets a placement when its voice ends, and stops all on dispose", async () => {
    const { space } = await setup();

    space.play("chirp", at(1, 0, 0));
    space.play("fire", at(1, 0, 0));
    expect(space.size).toBe(2);

    context.advance(1);
    space.update();
    expect(space.size).toBe(1);

    space.dispose();
    expect(space.size).toBe(0);
  });

  it("returns null and cleans up when the sound can't play", async () => {
    const { space } = await setup();

    expect(space.play("nope" as "chirp", at(0, 0, 0))).toBeNull();
    expect(space.size).toBe(0);
  });
});
