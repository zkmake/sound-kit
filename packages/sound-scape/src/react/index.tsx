/**
 * @zkmake/sound-scape/react: a hook and a component that render nothing. Audio is a side effect of
 * the scene, never part of the render tree; with React Three Fiber, put them outside `<Canvas>`.
 */
import { useEffect, useRef, useState } from "react";

import { SoundscapePlayer, type SoundscapePlayerOptions } from "../core/player.ts";
import { type SoundscapeBus, type SoundscapeDef } from "../core/types.ts";

type UseSoundscapeOptions = SoundscapePlayerOptions & {
  /** `false` fades the soundscape out, `true` brings it back. Default true. */
  active?: boolean;
};

/**
 * Play `def` on `bus` while mounted and `active`. A new def crossfades; a def with the same
 * content is the same soundscape, so an inline object literal doesn't restart the bed every
 * render. StrictMode-safe. Returns the player once mounted, for `current.fire()` and friends.
 * `random`, `timers` and `whenHidden` are read when the bus changes.
 */
const useSoundscape = <Id,>(
  bus: SoundscapeBus<Id>,
  def: SoundscapeDef | null,
  opts: UseSoundscapeOptions = {},
) => {
  const [player, setPlayer] = useState<SoundscapePlayer<Id> | null>(null);
  const live = useRef<SoundscapePlayer<Id> | null>(null);
  const latest = useRef(opts);

  // First, so the effects below see this render's options.
  useEffect(() => {
    latest.current = opts;
  });

  useEffect(() => {
    const { random, timers, whenHidden, crossfadeMs } = latest.current;
    const created = new SoundscapePlayer(bus, {
      random,
      timers,
      whenHidden,
      crossfadeMs,
      onEmitter: (event) => latest.current.onEmitter?.(event),
    });

    live.current = created;
    setPlayer(created);

    return () => {
      created.dispose();
      live.current = null;
    };
  }, [bus]);

  const active = opts.active ?? true;
  const crossfadeMs = opts.crossfadeMs;

  // Every render: `play` compares by content and does nothing when it hasn't changed.
  useEffect(() => {
    live.current?.play(active ? def : null, { crossfadeMs });
  });

  return player;
};

type SoundscapeRunnerProps<Id> = UseSoundscapeOptions & {
  bus: SoundscapeBus<Id>;
  def: SoundscapeDef | null;
};

/** `useSoundscape` as a component, for JSX that reads as the scene. Renders nothing. */
const SoundscapeRunner = <Id,>({ bus, def, ...opts }: SoundscapeRunnerProps<Id>) => {
  useSoundscape(bus, def, opts);

  return null;
};

export { SoundscapeRunner, useSoundscape };
export type { SoundscapeRunnerProps, UseSoundscapeOptions };
