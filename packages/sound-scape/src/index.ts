/**
 * @zkmake/sound-scape: the engine. No DOM at import, no dependencies, no audio backend: pair it
 * with an adapter from `./howler` or `./web-audio`, or write your own `SoundscapeBus`.
 */
export { SoundscapePlayer, type SoundscapePlayerOptions } from "./core/player.ts";
export { pickNotLast, seededRandom } from "./core/random.ts";
export { Soundscape } from "./core/soundscape.ts";
export type {
  BedDef,
  EmitterDef,
  EmitterPhase,
  Range,
  SoundscapeBus,
  SoundscapeDef,
  SoundscapeOptions,
  Timers,
} from "./core/types.ts";
