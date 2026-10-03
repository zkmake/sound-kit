/**
 * @zkmake/sound-mixer/three: sounds placed in a scene. Structural types only: anything with a
 * `matrixWorld` (a three.js `Object3D` or camera, WebGL or WebGPU, vanilla or R3F) works, and so
 * does a plain `[x, y, z]`. three is never imported.
 *
 * Two models. The default is cheap: gain falls off linearly between `near` and `far`, and pan
 * follows the angle to the listener, with no PannerNode, so it's light on phones. `panner: "HRTF"`
 * uses a real PannerNode for headphones-grade 3D.
 */
import { type SoundMixer } from "../core/mixer.ts";
import { type PlayOptions, type Range, type Voice } from "../core/types.ts";
import { rampTo } from "../core/util.ts";

type Matrix4Like = { readonly elements: ArrayLike<number> };
type Object3DLike = { readonly matrixWorld: Matrix4Like };
type Position = Object3DLike | readonly [number, number, number];

type PlaceOptions = Omit<PlayOptions, "output" | "pan"> & {
  /** Cheap model: full volume within `near`, silent past `far`. Default `[1, 20]`. */
  falloff?: Range;
  /** Cheap model: pan width, 0 (none) to 1 (hard left and right). Default 0.8. */
  panWidth?: number;
  /** A real PannerNode instead of the cheap model. */
  panner?: "HRTF" | "equalpower";
  /** PannerNode settings; defaults are the Web Audio ones but `refDistance` 1 and `maxDistance` 50. */
  distanceModel?: DistanceModelType;
  refDistance?: number;
  maxDistance?: number;
  rolloffFactor?: number;
};

type PlacedVoice = Voice & {
  /** Move it: a new object or point to follow. */
  moveTo(position: Position): void;
};

type Vector = [number, number, number];

const SMOOTH_MS = 40;

const positionOf = (target: Position): Vector => {
  if ("matrixWorld" in target) {
    const e = target.matrixWorld.elements;

    return [e[12] ?? 0, e[13] ?? 0, e[14] ?? 0];
  }

  return [target[0], target[1], target[2]];
};

const normalize = ([x, y, z]: Vector): Vector => {
  const length = Math.hypot(x, y, z) || 1;

  return [x / length, y / length, z / length];
};

/** Linear falloff between near and far. */
const falloffGain = (distance: number, [near, far]: Range) =>
  distance <= near ? 1 : distance >= far ? 0 : 1 - (distance - near) / (far - near);

type Placement = {
  voice: Voice | null;
  target: Position;
  opts: PlaceOptions;
  gain: GainNode | null;
  pan: StereoPannerNode | null;
  panner: PannerNode | null;
};

/**
 * Sounds in space around a listener (usually the camera). Call `update()` once a frame, after the
 * camera has moved: it moves the listener and every placed voice.
 */
const createSpace = <Name extends string, Bus extends string>(
  mixer: SoundMixer<Name, Bus>,
  opts: { listener: Object3DLike },
) => {
  let listener = opts.listener;
  const placements = new Set<Placement>();

  const listenerFrame = () => {
    const e = listener.matrixWorld.elements;

    return {
      position: [e[12] ?? 0, e[13] ?? 0, e[14] ?? 0] as Vector,
      right: normalize([e[0] ?? 1, e[1] ?? 0, e[2] ?? 0]),
      up: normalize([e[4] ?? 0, e[5] ?? 1, e[6] ?? 0]),
      // A camera looks down its local −Z.
      forward: normalize([-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? -1)]),
    };
  };

  const moveListener = () => {
    const { context } = mixer;
    const audioListener = context.listener;
    const { position, forward, up } = listenerFrame();

    if ("positionX" in audioListener && audioListener.positionX) {
      audioListener.positionX.value = position[0];
      audioListener.positionY.value = position[1];
      audioListener.positionZ.value = position[2];
      audioListener.forwardX.value = forward[0];
      audioListener.forwardY.value = forward[1];
      audioListener.forwardZ.value = forward[2];
      audioListener.upX.value = up[0];
      audioListener.upY.value = up[1];
      audioListener.upZ.value = up[2];
    } else {
      // Older WebKit: the deprecated setters.
      const legacy = audioListener as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(...values: number[]): void;
      };

      legacy.setPosition(...position);
      legacy.setOrientation(...forward, ...up);
    }
  };

  const place = (placement: Placement, smoothMs: number) => {
    const { context } = mixer;
    const now = context.currentTime;
    const source = positionOf(placement.target);

    if (placement.panner) {
      const { panner } = placement;

      if (panner.positionX) {
        panner.positionX.value = source[0];
        panner.positionY.value = source[1];
        panner.positionZ.value = source[2];
      } else {
        (panner as unknown as { setPosition(...values: number[]): void }).setPosition(...source);
      }

      return;
    }

    const { position, right } = listenerFrame();
    const offset: Vector = [
      source[0] - position[0],
      source[1] - position[1],
      source[2] - position[2],
    ];
    const distance = Math.hypot(...offset);
    const direction = normalize(offset);
    const side =
      distance > 1e-6
        ? direction[0] * right[0] + direction[1] * right[1] + direction[2] * right[2]
        : 0;
    const width = placement.opts.panWidth ?? 0.8;

    rampTo(
      placement.gain!.gain,
      falloffGain(distance, placement.opts.falloff ?? [1, 20]),
      now,
      smoothMs,
    );
    rampTo(placement.pan!.pan, Math.max(-1, Math.min(1, side * width)), now, smoothMs);
  };

  const remove = (placement: Placement) => {
    placements.delete(placement);
    placement.gain?.disconnect();
    placement.pan?.disconnect();
    placement.panner?.disconnect();
  };

  return {
    /** Play a sound at `target`, following it on every `update()` while it plays. */
    play(name: Name, target: Position, placeOpts: PlaceOptions = {}): PlacedVoice | null {
      const { context } = mixer;
      const busInput = mixer.input((placeOpts.bus as Bus | undefined) ?? mixer.busOf(name));
      const placement: Placement = {
        voice: null,
        target,
        opts: placeOpts,
        gain: null,
        pan: null,
        panner: null,
      };
      let output: AudioNode;

      if (placeOpts.panner) {
        const panner = context.createPanner();

        panner.panningModel = placeOpts.panner;
        panner.distanceModel = placeOpts.distanceModel ?? "inverse";
        panner.refDistance = placeOpts.refDistance ?? 1;
        panner.maxDistance = placeOpts.maxDistance ?? 50;
        panner.rolloffFactor = placeOpts.rolloffFactor ?? 1;
        panner.connect(busInput);
        placement.panner = panner;
        output = panner;
        moveListener();
      } else {
        const gain = context.createGain();
        const pan = context.createStereoPanner();

        gain.connect(pan);
        pan.connect(busInput);
        placement.gain = gain;
        placement.pan = pan;
        output = gain;
      }

      // Position first, with no ramp, so it doesn't sweep in from the origin.
      place(placement, 0);

      const voice = mixer.play(name, {
        ...placeOpts,
        output,
        onEnd: () => {
          remove(placement);
          placeOpts.onEnd?.();
        },
      });

      if (!voice) {
        remove(placement);

        return null;
      }

      placement.voice = voice;
      placements.add(placement);

      return Object.assign(Object.create(voice) as Voice, {
        stop: (fadeOutMs?: number) => {
          voice.stop(fadeOutMs);
          mixer.after((fadeOutMs ?? 30) + 50, () => remove(placement));
        },
        moveTo: (position: Position) => {
          placement.target = position;
        },
      }) as PlacedVoice;
    },

    /** Move the listener and every placed voice. Once a frame, after the camera moves. */
    update() {
      if (placements.size === 0) {
        return;
      }

      let panners = false;

      for (const placement of placements) {
        if (!placement.voice?.playing) {
          remove(placement);
          continue;
        }

        panners ||= placement.panner !== null;
        place(placement, SMOOTH_MS);
      }

      if (panners) {
        moveListener();
      }
    },

    /** Listen from somewhere else: another camera, a character's head. */
    setListener(next: Object3DLike) {
      listener = next;
    },

    /** Placed voices playing now. */
    get size() {
      return placements.size;
    },

    dispose() {
      for (const placement of Array.from(placements)) {
        placement.voice?.stop(30);
        remove(placement);
      }
    },
  };
};

type Space = ReturnType<typeof createSpace>;

export { createSpace, falloffGain };
export type { Matrix4Like, Object3DLike, PlacedVoice, PlaceOptions, Position, Space };
