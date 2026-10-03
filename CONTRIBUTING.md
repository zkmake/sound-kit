# Contributing

A Bun workspace run by Turborepo, set up like three-kit:

- `packages/`: published packages
- `apps/site`: the site
- `configs/`: shared config

One `bun install` at the root sets them all up. Root scripts run each task in every workspace, in
dependency order, cached by turbo.

```sh
bun install
bun run ci-local       # everything CI runs: format, lint, typecheck, test, build, pack
bun run build          # packages (tsdown, then publint and arethetypeswrong) and the site (vite)
bun run ci:typecheck   # tsc in every workspace
bun run ci:test        # vitest in every workspace
bun run lint:fix       # oxlint
bun run format:fix     # oxfmt
bun run dev            # the site with hot reload, port 3030
```

## Versions: the catalog

Shared dependency versions are pinned once in the root `package.json`, under
`workspaces.catalog`. One rule applies to published packages: use `catalog:` and `workspace:*`
only in `devDependencies`. Changesets publishes with plain `npm publish`, which copies both
specifiers unresolved. Keep `dependencies` and `peerDependencies` as explicit, wide ranges.

## Shared config

- `configs/typescript` (`@config/typescript`) has `tsconfig-lib.json` for packages and
  `tsconfig-app.json` for apps.
  - Apps extend it by package name.
  - Published packages extend it by relative path, so their `package.json` stays free of private
    workspace dependencies.
- These live at the root:
  - `oxlint.config.ts`
  - `oxfmt.config.ts`
  - `bunfig.toml`
  - `turbo.json`
  - the changesets config
  - the workflows

## sound-scape

- **`src/core`:** the engine (`Soundscape`, `SoundscapePlayer`), the shared adapter helpers and
  the types. No DOM at import, no dependencies.
  - Time and randomness are injected, so the tests drive both. `tests/fakes.ts` has a fake clock
    and a bus that takes notes.
- **`src/howler`:** the Howler adapter. `howler` is an optional peer.
  - The adapter hands out its own voice ids, because Howler's are only unique per Howl.
  - The tests mock `howler`.
- **`src/web-audio`:** the dependency-free adapter. Its tests use a fake `AudioContext`.
- **`src/react`:** `useSoundscape` and `<SoundscapeRunner>`. `react` is an optional peer.
- **`tests/ssr.test.ts`:** checks that every entry imports with no `window` and no
  `AudioContext`.
- **Origin:** keyboard-express `audio/soundscape.ts`, its tests, and the copies in platform-typing,
  finlit-careers and virtual-room-three.

## sound-mixer

- **`src/core`:** `SoundMixer`, the settings store and helpers. No DOM and no context at import, no
  dependencies.
  - The graph is built on the first `load` or `play`: voice (gain → stereo pan) → bus input (level,
    mute) → bus duck → master → limiter → destination.
  - `after()` timers are `ConstantSourceNode`s, so they run on audio time.
- **`src/music`:** `Playlist`.
  - One `<audio>` element per track, made once, because an element can feed only one
    `MediaElementAudioSourceNode` ever.
  - It follows the mixer's `state` and `rate` events.
- **`src/three`:** `createSpace`, on structural types. `tests/three-types.ts` pins them against
  three's real classes (checked by `tsc`, not run).
- **`src/react`:** `useSyncExternalStore` hooks over the settings store.
- **`src/scape`:** a sound-scape adapter on a mixer bus.
  - `src/scape/scape.test.ts` types it against `SoundscapeAdapter` and runs a real `Soundscape`
    on it. `@zkmake/sound-scape` is a dev dependency for this.
- **Tests:** they run against `tests/fake-audio.ts`, a fake `AudioContext` whose `advance(seconds)`
  ends sources and timers on time.

## The site

`apps/site` is a Vite app under the base `/sound-kit/`. GitHub Pages deploys it from the `pages`
job in `ci.yml`.

- The packages resolve to their `src/` through the Vite alias and tsconfig `paths`, so editing a
  library hot-reloads.
- Pages: `index.html` (the landing page), `sound-scape/` and `sound-mixer/`, each with its script
  in `src/<short name>/`. Add a page to `build.rollupOptions.input` in `vite.config.ts`.
- The sound-scape demo runs the same scenes through either backend (Web Audio or Howler) and either
  integration (vanilla or React, under StrictMode).
- The sound-mixer demo has bus strips with meters, a sound pad, an engine driven by a slider,
  music, the soundscape on the ambience bus, and a top-down view for placed sounds.
- The samples in `public/audio` are synthesised by `bun run samples` (needs ffmpeg), so they
  carry no licence. Each sample comes as Opus/Ogg and AAC/M4A.

## Releasing

Every user-facing change gets a changeset (`bun run changeset`). Merging the "Version Packages" PR
that `release.yml` opens publishes to npm with provenance, through npm trusted publishing.

A new package's first version is published by hand:

1. `npm publish --access public` from the package folder.
2. On npmjs.com, add a trusted publisher: repository `zkmake/sound-kit`, workflow `release.yml`.

## Adding a package

1. Make `packages/<name>/`, copying sound-scape's `tsdown.config.ts`, `tsconfig.json` and
   `tests/ssr.test.ts`.
2. Add a changeset for its first version.
3. Publish it by hand, then add the trusted publisher.
4. Add it to the root README table and to the site.
