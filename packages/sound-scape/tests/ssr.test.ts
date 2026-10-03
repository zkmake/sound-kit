/**
 * Every entry must import under Node with no `window`, `document` or `AudioContext`: an SSR page
 * imports the package at module scope and starts audio in an effect.
 */
import { expect, test } from "vitest";

test("imports without a DOM or an AudioContext", async () => {
  expect(typeof window).toBe("undefined");
  expect(typeof AudioContext).toBe("undefined");

  const core = await import("../src/index.ts");
  const howler = await import("../src/howler/index.ts");
  const webAudio = await import("../src/web-audio/index.ts");
  const react = await import("../src/react/index.tsx");

  expect(typeof core.Soundscape).toBe("function");
  expect(typeof core.SoundscapePlayer).toBe("function");
  expect(typeof howler.createHowlerBus).toBe("function");
  expect(typeof webAudio.createWebAudioBus).toBe("function");
  expect(typeof react.useSoundscape).toBe("function");

  // Making an adapter touches nothing until it plays.
  webAudio.createWebAudioBus({ wind: "wind.ogg" }).dispose();
});
