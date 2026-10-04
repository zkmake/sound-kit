# @zkmake/sound-mixer

## 0.1.0

### Minor Changes

- [`70f5446`](https://github.com/zkmake/sound-kit/commit/70f54460ef42982e8a6de740489542e6b36c78bd) Thanks [@zkmake](https://github.com/zkmake)! - First release.
  
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
  - Introspection for tools: `observe()` streams plays, ends, stops, steals, drops (with the reason),
    loads and ducks. `voices()` lists what's playing, `samples()` reports each file's decoded size,
    and `solo(bus)` hears one bus alone.
  - `./react`: settings hooks.
  - `./scape`: run `@zkmake/sound-scape` on a mixer bus.
