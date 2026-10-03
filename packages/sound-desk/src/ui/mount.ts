/**
 * The desk in the zkmake dev-panel frame (three-meter's `mountDevPanel`), so it docks, wakes, dims
 * and toggles exactly like the three-meter HUD and three-textures' panel. One call.
 */
import {
  type DefaultPlacement,
  HudTheme,
  mountDevPanel,
  type ThemeMode,
} from "@zkmake/three-meter/ui";

import { createSoundDesk, type MixerLike, type SoundDeskOptions, type Tab } from "./panel.ts";

type MountSoundDeskOptions = SoundDeskOptions & {
  /** Where it docks on a first visit. Default the right edge, bottom. */
  defaultPlacement?: DefaultPlacement;
  /** `dark`, `light` or `system` (default). */
  theme?: ThemeMode;
  /** Start compact: the brand row and the voice count. The choice is remembered. */
  compact?: boolean;
  /** Base key for remembered choices (placement, compact, tab). Default `"sound-desk"`; `null` keeps nothing. */
  storageKey?: string | null;
  /** Where to mount. Default `document.body`. */
  container?: HTMLElement;
};

type SoundDeskHandle = {
  element: HTMLElement;
  setCompact(compact: boolean): void;
  setTab(tab: Tab): void;
  /** `dark`, `light` or `system`: the desk follows it. */
  setTheme(mode: ThemeMode): void;
  dispose(): void;
};

const read = (key: string | null) => {
  try {
    return key === null ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string | null, value: string) => {
  try {
    if (key !== null) {
      localStorage.setItem(key, value);
    }
  } catch {
    // Private mode: the choice lasts this page.
  }
};

const mountSoundDesk = (mixer: MixerLike, options: MountSoundDeskOptions = {}): SoundDeskHandle => {
  const key = options.storageKey === null ? null : (options.storageKey ?? "sound-desk");
  const compactKey = key === null ? null : `${key}:compact`;
  const tabKey = key === null ? null : `${key}:tab`;
  const desk = createSoundDesk(mixer, options);
  const theme = new HudTheme(options.theme ?? "system");

  const setCompact = (compact: boolean) => {
    frame.element.classList.toggle("sdk-compact", compact);
    desk.setActive(!compact);
    write(compactKey, compact ? "1" : "0");
    frame.refresh();
  };

  const frame = mountDevPanel({
    brand: "sound-desk",
    content: desk.element,
    defaultPlacement: options.defaultPlacement ?? { edge: "right", align: "end" },
    label: "Sound",
    onToggle: () => setCompact(!frame.element.classList.contains("sdk-compact")),
    storageKey: key === null ? null : `${key}:panel`,
    theme,
    toggleLabel: "Show or hide the mixer desk",
    ...(options.container ? { parent: options.container } : {}),
  });

  frame.element.classList.add("sdk-frame");

  const paintTheme = () => desk.setTheme(theme.resolved);
  const unsubscribeTheme = theme.subscribe(paintTheme);
  const summary = setInterval(() => {
    frame.detail.textContent = desk.summary;
  }, 250);
  const onTab = () => write(tabKey, desk.tab);

  desk.element.addEventListener("click", onTab);
  paintTheme();
  frame.detail.textContent = desk.summary;

  const storedTab = read(tabKey);

  if (storedTab) {
    desk.setTab(storedTab as Tab);
  }

  const storedCompact = read(compactKey);

  setCompact(storedCompact === null ? options.compact === true : storedCompact === "1");

  return {
    element: frame.element,
    setCompact,
    setTab: (tab) => {
      desk.setTab(tab);
      onTab();
    },
    setTheme: (mode) => theme.setMode(mode),
    dispose: () => {
      clearInterval(summary);
      unsubscribeTheme();
      theme.dispose();
      desk.element.removeEventListener("click", onTab);
      desk.dispose();
      frame.dispose();
    },
  };
};

export { mountSoundDesk };
export type { MountSoundDeskOptions, SoundDeskHandle };
