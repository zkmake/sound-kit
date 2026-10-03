/**
 * Every entry must import under Node with no `window`, `document` or `AudioContext`: an SSR page
 * imports the package at module scope and starts audio after a gesture.
 */
import { expect, test } from "vitest";

test("imports without a DOM or an AudioContext", async () => {
  expect(typeof window).toBe("undefined");
  expect(typeof AudioContext).toBe("undefined");

  const core = await import("../src/index.ts");
  const music = await import("../src/music/index.ts");
  const three = await import("../src/three/index.ts");
  const react = await import("../src/react/index.ts");
  const scape = await import("../src/scape/index.ts");

  expect(typeof core.SoundMixer).toBe("function");
  expect(typeof music.Playlist).toBe("function");
  expect(typeof three.createSpace).toBe("function");
  expect(typeof react.useMixerSettings).toBe("function");
  expect(typeof scape.soundscapeBus).toBe("function");

  // Making a mixer touches nothing until it loads or plays.
  const mixer = new core.SoundMixer({ sounds: { click: { src: "click.ogg" } } });

  expect(mixer.state).toBe("idle");
  mixer.setLevel("sfx", 0.5);
  mixer.dispose();
});
