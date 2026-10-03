# @zkmake/sound-mixer

A mixer for web games, on the Web Audio API and nothing else. It gives you:

- **One context** that unlocks on the first press, resumes after iOS interruptions, and suspends in
  a background tab.
- **Real buses:** levels above 1, ducks that reach voices already playing, and a limiter at the
  end.
- **A typed registry of sounds,** with variants, random ranges and voice caps.
- **Music** that streams instead of decoding.
- **Slow motion.**
- **Audio-time timers** that pause with the game.
- **Sounds placed in a three.js scene.**

```sh
bun add @zkmake/sound-mixer   # or npm i / pnpm add
```

Live demo: [zkmake.github.io/sound-kit/sound-mixer](https://zkmake.github.io/sound-kit/sound-mixer/).

It replaces the layer every game ends up writing on top of Howler. That layer usually has the same
bugs:

- Volumes above 1 are silently ignored.
- `howl.volume()` re-levels every voice of a sound at once.
- Loops keep playing in hidden tabs.
- A second context for synth bypasses the master.
- Music is decoded to 40 MB of PCM.
- Patches reach into Howler's private fields.

- **Buses are gain nodes:** master, then music, sfx, ambience, ui and voice by default, or your own
  set. A level, a mute and a duck move every voice on the bus, including ones already ringing.
  Gain above 1 works.
- **A limiter after master** (−1 dB, fast), so twenty coins at once don't clip.
- **The registry is data:** `defineSounds({...})` gives typed names.
  - Each sound has a bus, a volume and a rate or pan range, drawn per play.
  - `variants` play a pool, never the same file twice in a row.
  - A voice cap either steals the oldest voice or drops the new one.
- **Fail-soft loading.** Progress counts every file, a broken file warns once and stays silent,
  and sources list fallbacks (`[opus, m4a]`).
- **Voices you can steer:** `setVolume`, `setRate` and `setPan`, ramped and click-free, on what
  `play` returns.
- **Audio time.** `after(ms, fn)` runs on the audio clock, so a crash's follow-up sound waits while
  the game is paused. `setPaused` suspends everything at once.
- **Slow motion.** `setRate(0.5)` scales every voice, playlists included.
- **Settings that persist.** Mute, levels and bus switches go to localStorage, with a migration
  hook for a game's old keys. They form a `useSyncExternalStore` store for settings screens.
- **Meters.** `meter(bus).peak()` and `.rms()`, for a HUD or a debug panel.

## Entry points

| Import                      | What                                                                                    | Needs                      |
| --------------------------- | --------------------------------------------------------------------------------------- | -------------------------- |
| `@zkmake/sound-mixer`       | `SoundMixer`, `defineSounds`, types. No DOM or context at import, no deps               | nothing                    |
| `@zkmake/sound-mixer/music` | `Playlist`: tracks streamed through a bus, with shuffle, crossfades and resume in place | nothing                    |
| `@zkmake/sound-mixer/three` | `createSpace`: sounds placed in a scene, with cheap falloff or HRTF                     | nothing (structural types) |
| `@zkmake/sound-mixer/react` | `useMixerSettings`, `useBusLevel`, `useBusOn`, `useMuted`                               | `react` 18+                |
| `@zkmake/sound-mixer/scape` | `soundscapeBus`: run `@zkmake/sound-scape` on a mixer bus                               | nothing                    |

## Use

```ts
import { defineSounds, SoundMixer } from "@zkmake/sound-mixer";

const sounds = defineSounds({
  step: { variants: ["step-1.ogg", "step-2.ogg", "step-3.ogg"], rate: [0.94, 1.06], voices: 4 },
  coin: { src: ["coin.ogg", "coin.m4a"], volume: 0.5, rate: [0.97, 1.08], voices: 6 },
  boom: { src: "boom.ogg", volume: 1.6 }, // above 1 is fine
  click: { src: "click.ogg", bus: "ui" },
  engine: { src: "engine.ogg", loop: true, fadeInMs: 300 },
});

const mixer = new SoundMixer({ sounds, storageKey: "my-game:sound" });

await mixer.load({ onProgress: (settled, total) => bar(settled / total) });

mixer.play("step");
const engine = mixer.play("engine")!;

engine.setRate(0.7 + 0.6 * speed, 80); // every frame, ramped

const release = mixer.duck(["music", "ambience"]); // −12 dB over 120 ms
release(); // back over 450 ms

mixer.after(260, () => mixer.play("boom")); // audio time
mixer.setPaused(true); // everything holds its place
mixer.setRate(0.5); // slow motion
```

`play` returns a `Voice`, or `null` when the sound can't play. That happens when:

- the sound is unknown or failed to load;
- it's at its cap with `onLimit: "drop"`;
- it's a one-shot not loaded yet. It loads then, for next time, because a late one-shot is worse
  than none.

A loop that isn't loaded yet starts when it arrives.

### Sound definitions

| Field      | Default   | Meaning                                                             |
| ---------- | --------- | ------------------------------------------------------------------- |
| `src`      |           | One sample: a URL or `[preferred, fallback]`.                       |
| `variants` |           | A pool of samples; each play picks one, never the last.             |
| `bus`      | `"sfx"`   |                                                                     |
| `volume`   | 1         | A number or a `[low, high]` range. Above 1 is allowed.              |
| `rate`     | 1         | A number or a range. Rate shifts pitch too; keep ranges within ±5%. |
| `pan`      | 0         | A number or a range, −1..1.                                         |
| `loop`     | false     |                                                                     |
| `fadeInMs` | 0         | Loops always get 8 ms, so they never click in.                      |
| `voices`   | 8         | Voices of this sound at once.                                       |
| `onLimit`  | `"steal"` | At the cap, stop the oldest voice, or `"drop"` the new one.         |
| `preload`  | true      | `false` loads the sound on its first play.                          |

`play(name, opts)` overrides any of these for one play. It also takes `delayMs` (audio clock),
`offset`, `bus`, `output` (a node to play into, such as a panner) and `onEnd`.

### Mixer options

| Option         | Default                         | Meaning                                                                     |
| -------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `buses`        | music, sfx, ambience, ui, voice | `{ name: level }` or `{ name: { level, voices } }`. Typed names follow.     |
| `storageKey`   | `null`                          | Persist settings to localStorage under this key.                            |
| `migrate`      |                                 | `(stored) => settings`: fold a game's old keys in once.                     |
| `whenHidden`   | `"suspend"`                     | Suspend the context in a background tab, or `"play"` on.                    |
| `autoUnlock`   | true                            | Resume on pointer and key presses, including after an iOS interruption.     |
| `audioSession` |                                 | iOS: `"playback"` plays through the silent switch; `"ambient"` respects it. |
| `limiter`      | true                            | The brick-wall limiter after master.                                        |
| `context`      | made on first use               | Share a context. A context the mixer made is closed on `dispose`.           |
| `destination`  | `context.destination`           |                                                                             |

Settings calls: `setLevel(bus | "master", level)`, `setMuted(muted)` and
`setBusMuted(bus, muted)`. Read them back from `settings`, or subscribe through
`subscribe` / `getSnapshot`.

## Music

```ts
import { Playlist } from "@zkmake/sound-mixer/music";

const music = new Playlist(mixer, {
  tracks: [
    { name: "Rails and keys", src: ["rails.ogg", "rails.m4a"] },
    { name: "Dusty trail", src: ["dusty.ogg", "dusty.m4a"] },
  ],
  order: "shuffle", // never the same track twice; or "sequence", "repeat"
  crossfadeMs: 1500, // 0: the next starts when the last ends
});

music.play(); // a refused play (no gesture yet) retries on the next press
music.pause(); // fades and holds the place: resume() picks up mid-bar
music.next();
music.play("Dusty trail"); // switch, fading
```

- **Streaming:** tracks stream from `<audio>` elements routed into the bus. The bus's level, duck,
  mute and the limiter all apply.
- **Following the mixer:** the playlist pauses with `setPaused` and in a hidden tab, and follows
  `setRate`. Pitch moves with rate, held between 0.5× and 4×.
- **Cross-origin tracks:** these need CORS headers. Without them, Web Audio plays the element
  silent.

## Placed sounds (three.js)

```ts
import { createSpace } from "@zkmake/sound-mixer/three";

const space = createSpace(mixer, { listener: camera });

space.play("engine", locomotive, { falloff: [1, 30] }); // cheap: gain and pan, no PannerNode
space.play("bell", crossing, { panner: "HRTF", refDistance: 2 }); // real 3D

renderer.setAnimationLoop(() => {
  space.update(); // after the camera moves
  renderer.render(scene, camera);
});
```

- **Targets:** anything with a `matrixWorld` works: a three.js object or camera (WebGL or WebGPU),
  or a plain `[x, y, z]`. three is never imported.
- **The default model** is the one games already write by hand. Gain falls off linearly between
  `near` and `far`, and pan follows the angle to the listener. It's cheap on phones and stays on
  the sound's bus.
- **Following:** a placed voice follows its target until it ends. `moveTo` gives it a new one.
- **React Three Fiber:** call `space.update()` in a `useFrame`.

## React

```tsx
import { useBusLevel, useBusOn, useMuted } from "@zkmake/sound-mixer/react";

function SoundSettings() {
  const [music, setMusic] = useBusLevel(mixer, "music");
  const [sfxOn, setSfxOn] = useBusOn(mixer, "sfx");
  const [muted, setMuted] = useMuted(mixer);
  // …sliders and switches; changes persist under the mixer's storageKey
}
```

Make the mixer once, outside React. Audio is a side effect of the scene, not part of the render
tree.

## With sound-scape

```ts
import { soundscapeBus } from "@zkmake/sound-mixer/scape";
import { SoundscapePlayer } from "@zkmake/sound-scape";

const ambience = new SoundscapePlayer(soundscapeBus(mixer, "ambience"));

ambience.play(MEADOW); // its samples are names in the mixer's registry
```

A soundscape on the mixer shares its context, levels, ducks and settings. The bus has
sound-scape's `SoundscapeAdapter` shape, so neither package imports the other.

## Formats and iOS

- **Sources:** give each sample `[ogg, m4a]`. The mixer skips sources `canPlayType` rejects, and
  tries the next if decoding fails.
- **Gestures:** audio starts on a gesture. `autoUnlock` resumes on the first press, and again after
  a call or Siri interrupts it.
- **Targets:** iOS 17 and later, and current desktop browsers.

## Size

| Entry | Gzipped |
| ----- | ------- |
| Core  | 6.3 kB  |
| music | 2.7 kB  |
| three | 1.9 kB  |
| scape | 0.7 kB  |
| react | 0.5 kB  |

Shared helpers add 1.5 kB.

## License

MIT
