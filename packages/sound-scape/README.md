# @zkmake/sound-scape

Soundscapes for web games: a looping **bed** (wind, room tone, traffic) with **emitters** above
it, short samples that fire on random timers (birds, cups, a distant siren). A game without one
goes silent between sound effects. This is the layer that fills that silence, and it stays out of
the way of your music and effects.

```sh
bun add @zkmake/sound-scape   # or npm i / pnpm add
```

Live demo: [zkmake.github.io/sound-kit](https://zkmake.github.io/sound-kit/). Background:
[Soundscapes for Web Games, part 1](https://zubin.dev/blog/web-game-soundscapes-1-concepts/) and
[part 2](https://zubin.dev/blog/web-game-soundscapes-2-howler/).

- **Never the same sample twice in a row.** Each emitter draws from a pool of 3–6 samples. Of
  everything here, this does the most to stop a soundscape sounding like a tape loop.
- **Tight random ranges.** Every fire gets its own volume, rate and pan. The defaults are
  `[0.7, 1]`, `[0.95, 1.05]` and `[-0.4, 0.4]`; past about ±5% rate, a sample turns chipmunk.
- **A voice cap.** A fire past `maxConcurrent` is dropped, not queued, so a cluster of fires never
  muddies the mix or clips the master.
- **Ducking that reaches every voice.** `bus.duck()` dips the bed and every emitter, including
  ones already playing, by −12 dB over 120 ms, and brings them back over 450 ms. It lowers gain
  instead of pausing, so loops keep their place.
- **Fades everywhere.** Beds fade in and out. A voice is stopped when its fade lands, so no silent
  voices are left alive.
- **Swaps and tab changes.** `SoundscapePlayer` crossfades between scenes. It ignores a def with the
  same content, and fades out while the tab is hidden.
- **Safe teardown.** `dispose()` is safe to call twice and under React StrictMode. A timer queued
  before a teardown does nothing, so no ghost bird sings in the next level.
- **Two backends, one engine.** `./howler` sits on Howler; `./web-audio` has no dependencies. The
  engine talks to either through four functions, so you can write your own.

## Entry points

| Import                          | What                                                     | Needs        |
| ------------------------------- | -------------------------------------------------------- | ------------ |
| `@zkmake/sound-scape`           | `Soundscape`, `SoundscapePlayer`, types. No DOM, no deps | nothing      |
| `@zkmake/sound-scape/web-audio` | `createWebAudioBus`: the adapter on the Web Audio API    | nothing      |
| `@zkmake/sound-scape/howler`    | `createHowlerBus`: the adapter on Howler                 | `howler` 2.2 |
| `@zkmake/sound-scape/react`     | `useSoundscape`, `<SoundscapeRunner>`                    | `react` 18+  |

Every entry imports under SSR. Nothing touches `window` or creates an `AudioContext` until it
plays.

## Vanilla

```ts
import { SoundscapePlayer, type SoundscapeDef } from "@zkmake/sound-scape";
import { createWebAudioBus } from "@zkmake/sound-scape/web-audio";

// name → sources, in order of preference: the first one the browser plays wins.
const bus = createWebAudioBus({
  room: ["audio/room.ogg", "audio/room.m4a"],
  "cup-1": ["audio/cup-1.ogg", "audio/cup-1.m4a"],
  "cup-2": ["audio/cup-2.ogg", "audio/cup-2.m4a"],
  "cup-3": ["audio/cup-3.ogg", "audio/cup-3.m4a"],
});

const CAFE: SoundscapeDef = {
  bed: { sample: "room", volume: 0.5 },
  emitters: [{ name: "cups", samples: ["cup-1", "cup-2", "cup-3"], intervalMs: [1500, 5000] }],
  maxConcurrent: 4,
};

await bus.load({ onProgress: (settled, total) => bar(settled / total) });

const player = new SoundscapePlayer(bus, { crossfadeMs: 1500 });

player.play(CAFE); // from a click or key press: browsers start audio suspended
player.play(STREET); // crossfades
player.play(null); // fades out

const release = bus.duck(); // a voice line starts
release(); // …and ends
```

For full control, use `Soundscape` directly: `new Soundscape(def, bus)`, then `start()`,
`stop()` and `dispose()`. Both expose `fire(name)`, `suppressEmitters(on)` and `setBedGain(gain)`
(the player through `player.current`).

## React and React Three Fiber

```tsx
import { useSoundscape } from "@zkmake/sound-scape/react";

function Ambience({ scene, paused }: { scene: SceneId; paused: boolean }) {
  useSoundscape(bus, SCENES[scene], { active: !paused, crossfadeMs: 1500 });

  return null;
}
```

- **Placement:** keep the hook outside `<Canvas>`. Audio is a side effect of the scene, not part
  of the render loop.
- **Inline defs:** a def is compared by content, so an inline object literal doesn't restart the
  bed on every render.
- **Unmounting** fades the soundscape out.
- **The bus:** make it once, at module scope or in a ref. A new bus starts a new player.
- **The return value** is the player, for `player.current?.fire("cups")`.
- **JSX alternative:** `<SoundscapeRunner bus={bus} def={def} active={!paused} />` does the same.

## Definitions

`SoundscapeDef` is plain data, and it is all you tune: you can adjust a scene's feel without
touching engine code.

| Field                   | Default        | Meaning                                                          |
| ----------------------- | -------------- | ---------------------------------------------------------------- |
| `bed.sample`            |                | The looping layer. Non-positional; set `bed` to `null` for none. |
| `bed.volume`            |                | Before the bus level and duck.                                   |
| `bed.fadeInMs`          | 500            | A bed that starts at full volume is heard as a seam.             |
| `bed.fadeOutMs`         | 700            |                                                                  |
| `emitters[].samples`    |                | The pool. 3–6 is plenty.                                         |
| `emitters[].intervalMs` |                | `[min, max]` wait between fires. The first fire comes sooner.    |
| `emitters[].volume`     | `[0.7, 1]`     |                                                                  |
| `emitters[].rate`       | `[0.95, 1.05]` | Playback rate, which also shifts pitch.                          |
| `emitters[].pan`        | `[-0.4, 0.4]`  | Stereo, −1..1.                                                   |
| `emitters[].name`       | its index      | For `fire(name)` and `onEmitter`.                                |
| `maxConcurrent`         | 4              | Emitter voices at once, across the soundscape.                   |

Options for `Soundscape` and `SoundscapePlayer`:

- `random`: pass `seededRandom(n)` to make a soundscape play the same way each time.
- `timers`: inject these to drive time in tests.
- `onEmitter({ emitter, sample, phase })`: for captions, debug panels or tests.
- Player only:
  - `crossfadeMs`: default 1000.
  - `whenHidden`: `"stop"` (the default) or `"play"`.

Calls:

- `suppressEmitters(true)` fades out the emitters that are playing and holds back new fires while
  dialog is on screen, because one-shots compete with screen readers even when ducked. The timers
  keep running, and `suppressEmitters(false)` lets fires through again.
- `fire(name)` fires one emitter now, still within the cap, for debug buttons.

## The adapters

Both return a `SoundscapeAdapter`. It has the engine's four functions plus `load`, `duck`,
`ducked`, `setLevel`, `setMuted`, `stopAll`, `voices` and `dispose`. Use one bus as your ambience
bus, shared by every soundscape, so its duck and level carry across a scene swap.

| Option          | Web Audio             | Howler    | Meaning                                                                                     |
| --------------- | --------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `level`         | 1 (above 1 allowed)   | 1 (max 1) | Bus level, for a settings slider. `setLevel(v, fadeMs)` moves it live.                      |
| `muted`         | false                 | false     | Mutes in place: beds keep their phase, and emitters don't fire.                             |
| `duck`          | −12 dB, 120 / 450 ms  | same      | Defaults for `duck()`. Ducks count, and the deepest held one wins.                          |
| `context`       | made on first use     |           | Share your game's `AudioContext`. One the adapter made is closed on `dispose`.              |
| `destination`   | `context.destination` |           | Route the bus into your own mixer node.                                                     |
| `autoUnlock`    | true                  |           | Resumes the context on the first pointer or key press, and again after an iOS interruption. |
| `html5`         |                       | false     | Streams through `<audio>`, with no per-voice pan or rate.                                   |
| `loadTimeoutMs` |                       | 10000     | A sample still loading after this long counts as settled.                                   |

Behaviour when a sample is missing or still loading:

- `load()` never rejects. A sample that fails logs one warning and stays silent; its fires are
  skipped.
- A bed may start before its sample loads, and fades in when it arrives.
- An emitter whose sample isn't loaded yet is skipped, because a late bird is worse than none.

### Writing your own

The engine only ever calls these four functions:

```ts
type SoundscapeBus<Id> = {
  playBed(sample, { volume, fadeInMs }): Id | null;
  playEmitter(sample, { volume, rate, pan, onEnd }): Id | null;
  stop(id, fadeOutMs): void; // forget the id synchronously, then fade and stop
  setVolume(id, volume, fadeMs): void;
};
```

The contract:

- `stop` must forget the id at once, so a fade in flight survives a dispose that follows.
- `onEnd` is called once, when a voice ends by itself. It needn't be called for a voice the engine
  stopped.
- Return `null` when a voice can't play. The engine skips that fire and counts nothing.

## Formats and iOS

Give each sample two sources: `[ogg, m4a]`. Opus in Ogg is small and decodes in Chrome, Firefox
and recent Safari. AAC in M4A is the fallback that every Safari version decodes. The Web Audio
adapter skips any source that `canPlayType` rejects, and tries the next source if decoding fails.
Howler does the same with its `src` list.

For beds, prefer Ogg. AAC encoders add a few milliseconds of padding at the start, which can
leave a gap at a loop seam. If a bed has to be AAC, listen to it on an iPhone.

On iOS, audio starts on a gesture: call `play` from a tap, or rely on `autoUnlock`. After a phone
call or Siri, Safari reports the context as `"interrupted"`, and the next tap resumes it. Targets:
iOS 17 and later, and current desktop browsers.

## Shipping it

- **Settings:** connect your sliders to `setLevel` and your mute switch to `setMuted`. Both apply
  live to voices already playing.
- **Narration:** duck while a voice line plays, and call `suppressEmitters(true)` while dialog is
  on screen.
- **Size:** the core is about 3.5 kB gzipped. The Web Audio adapter adds 2.7 kB and the Howler
  adapter 1.7 kB (Howler itself is about 7 kB more).

## Origin

The engine is extracted from four copies of the same idea:

- keyboard-express
- platform-typing
- finlit-careers
- virtual-room-three

Their tests came with it.

## License

MIT
