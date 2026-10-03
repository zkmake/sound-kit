import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeAudioElement, FakeContext, type FakeGain, settle } from "../../tests/fake-audio.ts";
import { seeded } from "../../tests/seeded.ts";
import { SoundMixer } from "../core/mixer.ts";
import { Playlist } from "./index.ts";

describe("Playlist", () => {
  let context: FakeContext;
  let gestures: Map<string, () => void>;

  beforeEach(() => {
    context = new FakeContext();
    gestures = new Map();
    FakeAudioElement.made = [];
    FakeAudioElement.refuse = false;
    vi.stubGlobal("AudioContext", function AudioContext() {
      return context;
    });
    vi.stubGlobal("Audio", FakeAudioElement);
    vi.stubGlobal("addEventListener", (type: string, listener: () => void) =>
      gestures.set(type, listener),
    );
    vi.stubGlobal("removeEventListener", (type: string) => gestures.delete(type));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const setup = (opts: Partial<ConstructorParameters<typeof Playlist>[1]> = {}) => {
    const mixer = new SoundMixer({ sounds: {}, autoUnlock: false });
    const playlist = new Playlist(mixer, {
      tracks: [{ name: "a", src: ["a.ogg", "a.m4a"] }, { name: "b", src: "b.ogg" }, "c.ogg"],
      order: "sequence",
      ...opts,
    });

    return { mixer, playlist };
  };

  /** The gain a track's element feeds. */
  const gainOf = (element: FakeAudioElement) =>
    context.media.find((node) => (node as unknown as { element: unknown }).element === element)!
      .outputs[0] as FakeGain;

  it("streams the first track through the music bus, fading in", () => {
    const { mixer, playlist } = setup();

    playlist.play();

    const [element] = FakeAudioElement.made;
    const gain = gainOf(element!);
    const output = gain.outputs[0] as FakeGain;

    expect(playlist.names).toEqual(["a", "b", "c.ogg"]);
    expect(playlist.current).toBe("a");
    expect(element?.src).toBe("a.ogg");
    expect(element?.crossOrigin).toBe("anonymous");
    expect(element?.paused).toBe(false);
    expect(gain.gain.events.at(-1)).toBe("ramp 1 @1");
    expect(output.outputs[0]).toBe(mixer.input("music"));
  });

  it("falls back to the next source when one fails", () => {
    const { playlist } = setup();

    playlist.play();

    const [element] = FakeAudioElement.made;

    element?.emit("error");
    expect(element?.src).toBe("a.m4a");
  });

  it("pauses mid-track and resumes in place", () => {
    const { playlist } = setup();

    playlist.play();

    const [element] = FakeAudioElement.made;

    element!.currentTime = 42;
    playlist.pause(300);
    context.advance(0.31);
    expect(element?.paused).toBe(true);
    expect(playlist.playing).toBe(false);

    playlist.play();
    expect(element?.paused).toBe(false);
    expect(element?.currentTime).toBe(42);
    expect(FakeAudioElement.made.length).toBe(1);
  });

  it("moves to the next track when one ends, and wraps", () => {
    const { playlist } = setup();

    playlist.play();
    FakeAudioElement.made[0]?.emit("ended");
    expect(playlist.current).toBe("b");
    FakeAudioElement.made[1]?.emit("ended");
    FakeAudioElement.made[2]?.emit("ended");
    expect(playlist.current).toBe("a");
  });

  it("fades the old track out on a switch, then stops it", () => {
    const { playlist } = setup();

    playlist.play();
    playlist.play("b");

    const [a, b] = FakeAudioElement.made;

    expect(gainOf(a!).gain.last).toBe(0);
    expect(gainOf(b!).gain.last).toBe(1);
    expect(a?.paused).toBe(false);

    context.advance(1.01);
    expect(a?.paused).toBe(true);
    expect(a?.currentTime).toBe(0);
  });

  it("crossfades into the next track near the end", () => {
    const { playlist } = setup({ crossfadeMs: 2000 });

    playlist.play();

    const [a] = FakeAudioElement.made;

    a!.currentTime = 7;
    a?.emit("timeupdate");
    expect(playlist.current).toBe("a");

    a!.currentTime = 8.5;
    a?.emit("timeupdate");
    expect(playlist.current).toBe("b");
    expect(gainOf(a!).gain.events.at(-1)).toBe("ramp 0 @1.5");

    // The old track's own end no longer moves the playlist.
    a?.emit("ended");
    expect(playlist.current).toBe("b");
  });

  it("never repeats a track back to back when shuffled", () => {
    const { playlist } = setup({ order: "shuffle", random: seeded(3) });
    let last: string | null = null;

    for (let index = 0; index < 20; index++) {
      playlist.next(0);
      expect(playlist.current).not.toBe(last);
      last = playlist.current;
    }
  });

  it("retries a refused play on the next press", async () => {
    FakeAudioElement.refuse = true;

    const { playlist } = setup();

    playlist.play();
    await settle();
    expect(gestures.has("pointerdown")).toBe(true);

    FakeAudioElement.refuse = false;
    gestures.get("pointerdown")?.();
    expect(FakeAudioElement.made[0]?.paused).toBe(false);
    expect(gestures.size).toBe(0);
  });

  it("holds the track while the mixer is paused, and follows its rate", async () => {
    const { mixer, playlist } = setup();

    playlist.play();

    const [element] = FakeAudioElement.made;

    mixer.setPaused(true);
    await settle();
    expect(element?.paused).toBe(true);

    mixer.setPaused(false);
    await settle();
    expect(element?.paused).toBe(false);

    mixer.setRate(0.25, { buses: ["music"] });
    expect(element?.playbackRate).toBe(0.5);
    expect(element?.preservesPitch).toBe(false);
  });

  it("lets go of its elements on dispose", () => {
    const { playlist } = setup();

    playlist.play();
    playlist.dispose();
    playlist.dispose();
    expect(FakeAudioElement.made[0]?.paused).toBe(true);
    expect(FakeAudioElement.made[0]?.src).toBe("");
    playlist.play();
    expect(FakeAudioElement.made.length).toBe(1);
  });
});
