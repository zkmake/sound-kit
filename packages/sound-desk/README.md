# @zkmake/sound-desk

A dev panel for [`@zkmake/sound-mixer`](../sound-mixer): what's playing, how loud, on which bus,
and what was dropped. It docks, wakes and dims like three-meter's HUD and three-textures' panel,
because it uses the same frame.

```sh
bun add -d @zkmake/sound-desk   # or npm i -D / pnpm add -D
```

Live demo: the desk has no page of its own, because it needs a live mix to show. It's docked on
the right of the [sound-mixer demo](https://zkmake.github.io/sound-kit/sound-mixer/#desk).

- **Mix:** each bus and the master gets a peak and RMS meter with a dBFS readout, a level slider,
  mute (or switching the bus off) and solo. The voice count, duck state and rate show on each
  strip. Pause and resume the mixer, or **Lock** the context the way a browser does before a
  gesture, to test your unlock path.
- **Voices:** what's playing, grouped by sound, most first, with its bus, the oldest voice's age
  and the loops. A 30-second trend of the voice count flags a climb that never comes back down,
  which is a leak.
- **Log:** drops (at the cap, not loaded yet, failed, unknown), steals, loads and ducks, newest
  first. Plays and ends are hidden until you ask, because they're most of the noise. A badge
  counts warnings you haven't seen.
- **Memory:** every sample's decoded size, largest first. A sample over 8 MB is flagged "stream
  it" (a two-minute track decoded whole is about 40 MB), and failed files are flagged too.
- **Scenes:** given soundscapes, a fire button per emitter, the bed's gain, and holding emitters
  back. Given playlists, the current track, play/pause and next.

## Use

```ts
import { mountSoundDesk } from "@zkmake/sound-desk";

if (new URLSearchParams(location.search).has("debug")) {
  mountSoundDesk(mixer, {
    scapes: { ambience: soundscapePlayer }, // a Soundscape or a SoundscapePlayer
    playlists: { music: playlist },
  });
}
```

React (React Three Fiber too, inside `<Canvas>` or outside):

```tsx
import { SoundDesk } from "@zkmake/sound-desk/react";

const App = () => (
  <>
    <Game />
    {debug && <SoundDesk mixer={mixer} playlists={{ music }} />}
  </>
);
```

Gate the import yourself, with a `?debug` flag or a dev build. The package never reads
`NODE_ENV`.

| Option             | Default            | Meaning                                                           |
| ------------------ | ------------------ | ----------------------------------------------------------------- |
| `scapes`           |                    | `{ label: Soundscape \| SoundscapePlayer }`, read structurally.   |
| `playlists`        |                    | `{ label: Playlist }`.                                            |
| `theme`            | `"system"`         | `dark`, `light` or `system`. The pick inside the panel wins.      |
| `compact`          | false              | Start as the brand row and voice count. The choice is remembered. |
| `defaultPlacement` | right edge, bottom | Where it docks on a first visit.                                  |
| `storageKey`       | `"sound-desk"`     | Base key for placement, compact and tab; `null` keeps nothing.    |
| `container`        | `document.body`    |                                                                   |

`mountSoundDesk` returns `{ element, setCompact, setTab, setTheme, dispose }`.

`createSoundDesk(mixer, options)` is the bare panel, with no frame, for a host that has its own
tabs. Mount its `element` anywhere, and call `setActive` and `setTheme` on it.

The pure helpers behind the views are exported too, for your own tools:

- `groupVoices` and `summarizeMemory`
- `describe` (a mixer event as a log line)
- `createHistory`
- `formatDb` and `meterWidth`

## How it reads the mixer

It reads only the mixer's public surface:

- `meter(bus)` for the meters;
- `voices()` and `voiceCount()` for the voice list and trend;
- `samples()` for memory;
- `observe()` for the log;
- `subscribe()` and `on("state")` to keep the controls current.

Nothing is patched. Meters run on animation frames only while the desk is showing; the log and
the voice trend keep running when it's compact. Dispose removes everything.

## License

MIT
