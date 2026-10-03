import {
  type Soundscape,
  SoundscapePlayer,
  type SoundscapeBus,
  type SoundscapeDef,
  type SoundscapeOptions,
} from "@zkmake/sound-scape";
import { useSoundscape } from "@zkmake/sound-scape/react";
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";

/** The same demo through either integration: the controls never know which one runs. */
type Integration = {
  play(def: SoundscapeDef | null): void;
  current(): Soundscape | null;
  dispose(): void;
};

type IntegrationOptions = { crossfadeMs: number; onEmitter: SoundscapeOptions["onEmitter"] };

/** Vanilla: a `SoundscapePlayer`, which is what a scene manager would hold. */
const vanilla = (bus: SoundscapeBus, opts: IntegrationOptions): Integration => {
  const player = new SoundscapePlayer(bus, opts);

  return {
    play: (def) => player.play(def),
    current: () => player.current,
    dispose: () => player.dispose({ fadeOutMs: 300 }),
  };
};

type RunnerProps = IntegrationOptions & {
  bus: SoundscapeBus;
  def: SoundscapeDef | null;
  onPlayer: (player: SoundscapePlayer | null) => void;
};

/** React: `useSoundscape` in a root that renders nothing, under StrictMode. */
const Runner = ({ bus, def, onPlayer, ...opts }: RunnerProps) => {
  const player = useSoundscape(bus, def, opts);

  useEffect(() => {
    onPlayer(player);
  }, [player, onPlayer]);

  return null;
};

const react = (bus: SoundscapeBus, opts: IntegrationOptions): Integration => {
  const root = createRoot(document.createElement("div"));
  let player: SoundscapePlayer | null = null;
  const onPlayer = (next: SoundscapePlayer | null) => {
    player = next;
  };
  const render = (def: SoundscapeDef | null) => {
    root.render(
      <StrictMode>
        <Runner bus={bus} def={def} onPlayer={onPlayer} {...opts} />
      </StrictMode>,
    );
  };

  return {
    play: render,
    current: () => player?.current ?? null,
    dispose: () => root.unmount(),
  };
};

export { react, vanilla };
export type { Integration, IntegrationOptions };
