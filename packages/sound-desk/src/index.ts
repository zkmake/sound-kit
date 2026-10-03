/**
 * @zkmake/sound-desk: a dev panel for `@zkmake/sound-mixer`. Nothing touches the DOM until you
 * mount it; gate the import yourself (a `?debug` flag, a dev build) to keep it out of production.
 */
export {
  basename,
  createHistory,
  createLog,
  describe,
  formatBytes,
  formatDb,
  groupVoices,
  meterWidth,
  STREAM_HINT_BYTES,
  summarizeMemory,
  type LogLine,
  type MemoryRow,
  type VoiceGroup,
} from "./core/model.ts";
export { mountSoundDesk, type MountSoundDeskOptions, type SoundDeskHandle } from "./ui/mount.ts";
export {
  createSoundDesk,
  type MixerLike,
  type PlaylistLike,
  type SoundDesk,
  type SoundDeskOptions,
  type SoundscapeLike,
  type Tab,
} from "./ui/panel.ts";
export { injectStyles, SOUND_DESK_STYLES } from "./ui/styles.ts";
