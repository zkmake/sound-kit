/**
 * @zkmake/sound-mixer: the mixer. No DOM and no `AudioContext` at import, no dependencies.
 */
export {
  defineSounds,
  SoundMixer,
  type Meter,
  type MixerLogEvent,
  type MixerOptions,
  type SampleInfo,
  type VoiceInfo,
} from "./core/mixer.ts";
export type {
  BusOptions,
  DefaultBus,
  DuckOptions,
  LoadOptions,
  MixerSettings,
  Param,
  PlayOptions,
  Range,
  SampleSource,
  SoundDef,
  Voice,
} from "./core/types.ts";
