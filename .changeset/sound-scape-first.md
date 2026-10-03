---
"@zkmake/sound-scape": minor
---

First release.

- `Soundscape`: a bed under emitters on random timers, with no-repeat picks, tight random ranges,
  a voice cap, emitter suppression, `fire` and `setBedGain`. `dispose` is safe to call twice.
- `SoundscapePlayer`: crossfades between defs, ignores a def with the same content, and fades out
  while the tab is hidden.
- Adapters for Howler (`./howler`) and for Web Audio with no dependencies (`./web-audio`). Both
  have ducking that reaches every voice, and a level, mute and fail-soft loading.
- `./react`: `useSoundscape` and `<SoundscapeRunner>`.
