---
"@zkmake/sound-desk": minor
---

First release: a dev panel for `@zkmake/sound-mixer` in the zkmake dev-panel frame. It has five tabs:

- **mix:** meters, levels, mute and solo per bus; pause, and lock to test the unlock path.
- **voices:** grouped by sound, with a 30 s trend that flags leaks.
- **log:** drops, steals, loads and ducks, with an unseen-warnings badge.
- **memory:** decoded size per sample, flagging what should stream and what failed.
- **scenes:** soundscape and playlist controls.

`mountSoundDesk`, a bare `createSoundDesk`, and `<SoundDesk>` for React.
