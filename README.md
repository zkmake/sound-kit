# sound-kit

Audio tools for browser games, published separately under `@zkmake/*`. Each package has its own
version, changelog and README. The sibling of [three-kit](https://github.com/zkmake/three-kit).

Site, with live demos: [zkmake.github.io/sound-kit](https://zkmake.github.io/sound-kit/).

| Package                                       | What it is                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [**sound&#8209;scape**](packages/sound-scape) | Soundscapes: a looping bed under emitters on random timers, with no-repeat picks, a voice cap and ducking. Howler or Web Audio.                                          |
| [**sound&#8209;desk**](packages/sound-desk)   | Dev panel for the mixer: bus meters, levels, mute and solo; live voices with a leak trend; a log of drops and steals; decoded memory; soundscape and playlist controls.  |
| [**sound&#8209;mixer**](packages/sound-mixer) | One context with real buses, ducking and a limiter; a typed sound registry with variants and voice caps; streamed music; slow motion; sounds placed in a three.js scene. |

Planned, in order:

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
