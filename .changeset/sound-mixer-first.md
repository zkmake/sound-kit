---
"@zkmake/sound-mixer": minor
---

First release.

- `SoundMixer` has:
  - one lazily made context that unlocks on a press, resumes after interruptions and suspends in a
    hidden tab;
  - buses as gain nodes (levels above 1, ref-counted ducks, bus switches) and a limiter;
  - a typed registry with variants, ranges and voice caps (steal or drop);
  - fail-soft loading with fallbacks;
  - steerable voices, audio-time `after()`, `setPaused` and `setRate`;
  - persisted settings shaped for `useSyncExternalStore`, with a migration hook;
  - meters.
- `./music`: `Playlist`, which streams tracks through a bus, with shuffle, crossfades, resume in
  place and a retry on the next press.
- `./three`: `createSpace`, sounds placed on objects or points, with cheap falloff and pan or an
  HRTF panner.
- `./react`: settings hooks.
- `./scape`: run `@zkmake/sound-scape` on a mixer bus.
