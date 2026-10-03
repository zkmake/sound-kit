/**
 * Every entry must import under Node with no `window` or `document`: an SSR page imports the
 * package at module scope and mounts the desk in an effect.
 */
import { expect, test } from "vitest";

test("imports without a DOM", async () => {
  expect(typeof window).toBe("undefined");

  const desk = await import("../src/index.ts");
  const react = await import("../src/react/index.tsx");

  expect(typeof desk.mountSoundDesk).toBe("function");
  expect(typeof desk.createSoundDesk).toBe("function");
  expect(typeof react.SoundDesk).toBe("function");
});
