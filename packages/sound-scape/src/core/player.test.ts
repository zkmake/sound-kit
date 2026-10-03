import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeBus, fakeTimers } from "../../tests/fakes.ts";
import { SoundscapePlayer } from "./player.ts";
import { seededRandom } from "./random.ts";
import { type SoundscapeDef } from "./types.ts";

const CAFE: SoundscapeDef = {
  bed: { sample: "room", volume: 0.5, fadeInMs: 500, fadeOutMs: 700 },
  emitters: [{ samples: ["cup-1", "cup-2"], intervalMs: [2000, 4000] }],
};
const STREET: SoundscapeDef = { bed: { sample: "traffic", volume: 0.6 } };

const setup = () => {
  const time = fakeTimers();
  const fake = fakeBus(time);
  const player = new SoundscapePlayer(fake.bus, {
    timers: time.timers,
    random: seededRandom(1),
    crossfadeMs: 1200,
  });

  return { ...time, ...fake, player };
};

describe("SoundscapePlayer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a def with its own fade, and ignores the same content again", () => {
    const { player, calls } = setup();

    player.play(CAFE);
    player.play({ ...CAFE, bed: { ...CAFE.bed!, sample: "room" } });
    expect(calls).toEqual(["bed room 0.5 in 500"]);
    expect(player.current?.isRunning).toBe(true);
  });

  it("crossfades to a different def", () => {
    const { player, calls } = setup();

    player.play(CAFE);

    const cafe = player.current;

    player.play(STREET);
    expect(cafe?.isDisposed).toBe(true);
    expect(calls).toEqual(["bed room 0.5 in 500", "stop 100 out 1200", "bed traffic 0.6 in 1200"]);
  });

  it("fades out on null and on stop, and can play again", () => {
    const { player, calls } = setup();

    player.play(CAFE);
    player.play(null);
    expect(player.current).toBeNull();
    expect(calls.at(-1)).toBe("stop 100 out 1200");

    player.play(CAFE);
    player.stop({ fadeOutMs: 300 });
    expect(calls.at(-1)).toBe("stop 101 out 300");

    player.play(CAFE);
    expect(calls.at(-1)).toBe("bed room 0.5 in 500");
  });

  it("does nothing once disposed", () => {
    const { player, calls } = setup();

    player.play(CAFE);
    player.dispose();
    player.dispose();
    player.play(STREET);
    expect(calls).toEqual(["bed room 0.5 in 500", "stop 100 out 700"]);
  });

  it("fades out while the tab is hidden and back in when it returns", () => {
    const listeners = new Map<string, () => void>();
    const doc = {
      visibilityState: "visible",
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    };

    vi.stubGlobal("document", doc);

    const { player, calls } = setup();

    player.play(CAFE);
    doc.visibilityState = "hidden";
    listeners.get("visibilitychange")?.();
    expect(calls.at(-1)).toBe("stop 100 out 700");

    // A swap while hidden waits for the tab to come back.
    player.play(STREET);
    expect(calls.at(-1)).toBe("stop 100 out 700");

    doc.visibilityState = "visible";
    listeners.get("visibilitychange")?.();
    expect(calls.at(-1)).toBe("bed traffic 0.6 in 500");

    player.dispose();
    expect(listeners.size).toBe(0);
  });
});
