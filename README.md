# sound-kit

Audio tools for browser games, published separately under `@zkmake/*`. Each package has its own
version, changelog and README. The sibling of [three-kit](https://github.com/zkmake/three-kit).

Site, with a live demo: [zkmake.github.io/sound-kit](https://zkmake.github.io/sound-kit/).

| Package                                       | What it is                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [**sound&#8209;scape**](packages/sound-scape) | Soundscapes: a looping bed under emitters on random timers, with no-repeat picks, a voice cap and ducking. Howler or Web Audio. |

Planned, in order:

- **sound-mixer:** one context, real buses, gain above 1, a limiter, voices, a typed sound registry, music.
- **sound-desk:** a dev panel in three-meter's frame.
- **sound-drive:** loops driven by speed, impact sounds, combo ladders.
- **sound-synth:** procedural sound effects and a typing kit.
- **sound-audit:** a CLI for loudness, loop seams and tails.

Everything works with vanilla JS and React, including React Three Fiber.

## Layout

```
packages/<name>/   one published package each
apps/site/         zkmake.github.io/sound-kit (Vite), built against the packages' source
configs/<name>/    shared config packages (TypeScript)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) to work on a package or add a new one.

## License

MIT
