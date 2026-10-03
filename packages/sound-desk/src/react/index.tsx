/**
 * @zkmake/sound-desk/react: the desk as a component that renders nothing and mounts the panel in an
 * effect (StrictMode-safe). Put it anywhere; with React Three Fiber, outside `<Canvas>` or inside.
 */
import { useEffect, useRef } from "react";

import { mountSoundDesk, type MountSoundDeskOptions } from "../ui/mount.ts";
import { type MixerLike } from "../ui/panel.ts";

type SoundDeskProps = MountSoundDeskOptions & {
  mixer: MixerLike;
};

/** Mounts on mount and when `mixer` changes; other props are read then. `theme` applies live. */
const SoundDesk = ({ mixer, theme, ...options }: SoundDeskProps) => {
  const handle = useRef<ReturnType<typeof mountSoundDesk> | null>(null);
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const mounted = mountSoundDesk(mixer, { ...latest.current, theme });

    handle.current = mounted;

    return () => {
      mounted.dispose();
      handle.current = null;
    };
    // theme applies live below; the desk isn't remounted for it.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [mixer]);

  useEffect(() => {
    if (theme) {
      handle.current?.setTheme(theme);
    }
  }, [theme]);

  return null;
};

export { SoundDesk };
export type { SoundDeskProps };
