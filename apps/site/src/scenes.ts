import { type SoundscapeDef } from "@zkmake/sound-scape";

/** Every sample the demo plays, as `[opus, m4a]`: the first one the browser decodes wins. */
const NAMES = [
  "wind",
  "bird-1",
  "bird-2",
  "bird-3",
  "skylark",
  "room",
  "cup-1",
  "cup-2",
  "cup-3",
  "bell",
  "chair",
  "night",
  "cricket-1",
  "cricket-2",
  "owl",
] as const;

type SampleName = (typeof NAMES)[number];

const base = `${import.meta.env.BASE_URL}audio/`;

const SAMPLES = {} as Record<SampleName, readonly string[]>;

for (const name of NAMES) {
  SAMPLES[name] = [`${base}${name}.ogg`, `${base}${name}.m4a`];
}

const MEADOW: SoundscapeDef<SampleName> = {
  bed: { sample: "wind", volume: 0.45, fadeInMs: 1500, fadeOutMs: 900 },
  emitters: [
    {
      name: "songbirds",
      samples: ["bird-1", "bird-2", "bird-3"],
      intervalMs: [2500, 7000],
      volume: [0.22, 0.4],
      rate: [0.95, 1.05],
      pan: [-0.6, 0.6],
    },
    {
      name: "skylark",
      samples: ["skylark"],
      intervalMs: [9000, 20000],
      volume: [0.16, 0.26],
      rate: [0.97, 1.03],
      pan: [-0.2, 0.2],
    },
  ],
  maxConcurrent: 3,
};

const CAFE: SoundscapeDef<SampleName> = {
  bed: { sample: "room", volume: 0.55, fadeInMs: 1500, fadeOutMs: 900 },
  emitters: [
    {
      name: "cups",
      samples: ["cup-1", "cup-2", "cup-3"],
      intervalMs: [1500, 5000],
      volume: [0.18, 0.34],
      rate: [0.95, 1.05],
      pan: [-0.5, 0.5],
    },
    {
      name: "register",
      samples: ["bell"],
      intervalMs: [12000, 25000],
      volume: [0.2, 0.3],
      rate: [0.98, 1.02],
      pan: [0.3, 0.6],
    },
    {
      name: "chairs",
      samples: ["chair"],
      intervalMs: [8000, 18000],
      volume: [0.14, 0.26],
      rate: [0.9, 1.1],
      pan: [-0.6, 0.6],
    },
  ],
  maxConcurrent: 4,
};

const NIGHT: SoundscapeDef<SampleName> = {
  bed: { sample: "night", volume: 0.6, fadeInMs: 2000, fadeOutMs: 1200 },
  emitters: [
    {
      name: "crickets",
      samples: ["cricket-1", "cricket-2"],
      intervalMs: [1200, 4000],
      volume: [0.08, 0.18],
      rate: [0.97, 1.03],
      pan: [-0.8, 0.8],
    },
    {
      name: "owl",
      samples: ["owl"],
      intervalMs: [10000, 22000],
      volume: [0.25, 0.38],
      rate: [0.97, 1.02],
      pan: [-0.5, 0.5],
    },
  ],
  maxConcurrent: 3,
};

const SCENES = { meadow: MEADOW, cafe: CAFE, night: NIGHT } as const;

type SceneId = keyof typeof SCENES;

export { SAMPLES, SCENES };
export type { SampleName, SceneId };
