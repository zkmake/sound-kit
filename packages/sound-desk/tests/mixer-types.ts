/**
 * Type pin, checked by `tsc` only: a mixer with its own sound and bus names is a `MixerLike`, and
 * sound-scape's `Soundscape` and `SoundscapePlayer` and sound-mixer's `Playlist` fit the desk's
 * structural types.
 */
import { defineSounds, SoundMixer } from "@zkmake/sound-mixer";
import { Playlist } from "@zkmake/sound-mixer/music";
import { Soundscape, SoundscapePlayer, type SoundscapeBus } from "@zkmake/sound-scape";

import { type MixerLike, type PlaylistLike, type SoundDeskOptions } from "../src/ui/panel.ts";

const mixer = new SoundMixer({
  sounds: defineSounds({ coin: { src: "coin.ogg" } }),
  buses: { music: 1, sfx: 1 },
});

export const asMixer: MixerLike = mixer;
export const asPlaylist: PlaylistLike = new Playlist(mixer, { tracks: ["a.ogg"] });

declare const bus: SoundscapeBus;

export const scapes: SoundDeskOptions["scapes"] = {
  meadow: new Soundscape({ bed: null }, bus),
  town: new SoundscapePlayer(bus),
};
