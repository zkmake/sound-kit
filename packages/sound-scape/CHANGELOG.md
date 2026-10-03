# @zkmake/sound-scape

## 0.1.0

### Minor Changes

- [`c266212`](https://github.com/zkmake/sound-kit/commit/c2662126eb3b9aa4ddee1e5ece8b531ad3108cbd) Thanks [@zkmake](https://github.com/zkmake)! - First release.
  
  - `Soundscape`: a bed under emitters on random timers, with no-repeat picks, tight random ranges,
    a voice cap, emitter suppression, `fire` and `setBedGain`. `dispose` is safe to call twice.
  - `SoundscapePlayer`: crossfades between defs, ignores a def with the same content, and fades out
    while the tab is hidden.
  - Adapters for Howler (`./howler`) and for Web Audio with no dependencies (`./web-audio`). Both
    have ducking that reaches every voice, and a level, mute and fail-soft loading.
  - `./react`: `useSoundscape` and `<SoundscapeRunner>`.
