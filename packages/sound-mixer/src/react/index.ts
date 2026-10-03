/**
 * @zkmake/sound-mixer/react: settings hooks over the mixer's store, for a settings screen.
 * Each re-renders only when settings change. Make the mixer once, outside React.
 */
import { useSyncExternalStore } from "react";

import { type SoundMixer } from "../core/mixer.ts";
import { type MixerSettings } from "../core/types.ts";

/** Mute, levels and bus switches, kept current. */
const useMixerSettings = <Bus extends string>(mixer: SoundMixer<string, Bus>): MixerSettings<Bus> =>
  useSyncExternalStore(mixer.subscribe, mixer.getSnapshot, mixer.getSnapshot);

/** A bus's (or the master's) level and its setter, for a slider. */
const useBusLevel = <Bus extends string>(mixer: SoundMixer<string, Bus>, bus: Bus | "master") => {
  const level = useMixerSettings(mixer).levels[bus];

  return [level, (next: number) => mixer.setLevel(bus, next)] as const;
};

/** The master mute and its setter. */
const useMuted = <Bus extends string>(mixer: SoundMixer<string, Bus>) => {
  const { muted } = useMixerSettings(mixer);

  return [muted, (next: boolean) => mixer.setMuted(next)] as const;
};

/** Whether a bus is switched on, and its setter, for a toggle. */
const useBusOn = <Bus extends string>(mixer: SoundMixer<string, Bus>, bus: Bus) => {
  const on = !useMixerSettings(mixer).mutedBuses.includes(bus);

  return [on, (next: boolean) => mixer.setBusMuted(bus, !next)] as const;
};

export { useBusLevel, useBusOn, useMixerSettings, useMuted };
