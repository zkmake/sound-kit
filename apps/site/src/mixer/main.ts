import { defineSounds, SoundMixer, type Voice } from "@zkmake/sound-mixer";
import { Playlist } from "@zkmake/sound-mixer/music";
import { soundscapeBus } from "@zkmake/sound-mixer/scape";
import { createSpace, falloffGain, type PlacedVoice } from "@zkmake/sound-mixer/three";
import { SoundscapePlayer } from "@zkmake/sound-scape";

import { SCENES } from "../scape/scenes.ts";

import "../style.css";

const base = `${import.meta.env.BASE_URL}audio/`;
const audio = (name: string) => [`${base}${name}.ogg`, `${base}${name}.m4a`] as const;

const SOUNDS = defineSounds({
  step: {
    variants: [audio("step-1"), audio("step-2"), audio("step-3"), audio("step-4")],
    volume: 0.9,
    rate: [0.94, 1.06],
    voices: 4,
  },
  coin: { src: audio("coin"), volume: 0.45, rate: [0.97, 1.08], voices: 6 },
  boom: { src: audio("boom"), volume: 1.6, voices: 2 },
  click: { src: audio("click"), bus: "ui", volume: 0.6 },
  engine: { src: audio("engine"), loop: true, fadeInMs: 300 },
  // The soundscape's samples, on the ambience bus.
  wind: { src: audio("wind"), bus: "ambience" },
  "bird-1": { src: audio("bird-1"), bus: "ambience" },
  "bird-2": { src: audio("bird-2"), bus: "ambience" },
  "bird-3": { src: audio("bird-3"), bus: "ambience" },
  skylark: { src: audio("skylark"), bus: "ambience" },
});

const mixer = new SoundMixer({
  sounds: SOUNDS,
  buses: { music: 0.7, sfx: 1, ambience: 0.9, ui: 0.8, voice: 1 },
  storageKey: "sound-kit-demo:mixer",
});

const STRIPS = ["master", "music", "sfx", "ambience", "ui"] as const;

type Strip = (typeof STRIPS)[number];

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const ui = {
  strips: $("#strips"),
  start: $<HTMLButtonElement>("#start"),
  pad: $("#pad"),
  engine: $<HTMLButtonElement>("#engine"),
  speed: $<HTMLInputElement>("#speed"),
  music: $<HTMLButtonElement>("#music"),
  next: $<HTMLButtonElement>("#next"),
  track: $("#track"),
  scape: $<HTMLButtonElement>("#scape"),
  duck: $<HTMLButtonElement>("#duck"),
  rate: $<HTMLInputElement>("#rate"),
  pause: $<HTMLButtonElement>("#pause"),
  readout: $("#readout"),
  models: $("#models"),
  space: $<HTMLCanvasElement>("#space"),
  placed: $<HTMLButtonElement>("#placed"),
  placedReadout: $("#placed-readout"),
  code: $("#code"),
};

let started = false;

// Bus strips ------------------------------------------------------------------------------------

const strips = new Map<
  Strip,
  { level: HTMLInputElement; toggle: HTMLButtonElement; fill: HTMLElement; count: HTMLElement }
>();

for (const name of STRIPS) {
  const strip = document.createElement("div");
  const label = document.createElement("span");
  const meter = document.createElement("span");
  const fill = document.createElement("span");
  const level = document.createElement("input");
  const toggle = document.createElement("button");
  const count = document.createElement("span");

  strip.className = "strip";
  label.className = "strip-name";
  label.textContent = name;
  meter.className = "meter";
  fill.className = "meter-fill";
  meter.append(fill);
  level.type = "range";
  level.min = "0";
  level.max = "1.5";
  level.step = "0.01";
  level.id = `level-${name}`;
  level.setAttribute("aria-label", `${name} level`);
  level.addEventListener("input", () => mixer.setLevel(name, Number(level.value)));
  toggle.type = "button";
  toggle.addEventListener("click", () => {
    if (name === "master") {
      mixer.setMuted(!mixer.settings.muted);
    } else {
      mixer.setBusMuted(name, !mixer.settings.mutedBuses.includes(name));
    }
  });
  count.className = "strip-count";
  strip.append(label, meter, level, toggle, count);
  ui.strips.append(strip);
  strips.set(name, { level, toggle, fill, count });
}

/** Strips follow the settings, so a reload shows what was kept. */
const renderStrips = () => {
  const { levels, muted, mutedBuses } = mixer.settings;

  for (const [name, strip] of strips) {
    const off = name === "master" ? muted : mutedBuses.includes(name);

    strip.level.value = String(levels[name]);
    strip.toggle.textContent = name === "master" ? (muted ? "Unmute" : "Mute") : off ? "Off" : "On";
    strip.toggle.setAttribute("aria-pressed", String(off));
  }
};

mixer.subscribe(renderStrips);
renderStrips();

const meters = new Map<Strip, ReturnType<typeof mixer.meter>>();

const drawMeters = () => {
  for (const [name, strip] of strips) {
    let meter = meters.get(name);

    if (!meter && started) {
      meter = mixer.meter(name);
      meters.set(name, meter);
    }

    const peak = meter?.peak() ?? 0;
    // −48 dB to 0 dB across the bar.
    const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
    const width = Math.max(0, Math.min(1, (db + 48) / 48));

    strip.fill.style.width = `${(width * 100).toFixed(1)}%`;
    strip.fill.classList.toggle("hot", peak >= 0.89);
    strip.count.textContent =
      name === "master" ? `${mixer.voiceCount()} voices` : `${mixer.voiceCount(name)}`;
  }
};

// Sounds ----------------------------------------------------------------------------------------

ui.pad.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");

  if (!button || !started) {
    return;
  }

  if (button.dataset.play) {
    mixer.play(button.dataset.play as keyof typeof SOUNDS);
  } else if ("walk" in button.dataset) {
    // Eight steps on audio time: pause mid-walk and the rest wait.
    for (let step = 0; step < 8; step++) {
      mixer.after(step * 280, () => mixer.play("step"));
    }
  } else if ("burst" in button.dataset) {
    for (let index = 0; index < 16; index++) {
      mixer.play("coin", { delayMs: index * 25 });
    }
  } else if ("delayed" in button.dataset) {
    mixer.after(1000, () => mixer.play("boom"));
  }
});

let engine: Voice | null = null;

const engineLevel = () => {
  const speed = Number(ui.speed.value);

  engine?.setVolume(0.12 + 0.45 * speed, 80);
  engine?.setRate(0.7 + 0.6 * speed, 80);
};

ui.engine.addEventListener("click", () => {
  if (engine) {
    engine.stop(400);
    engine = null;
  } else {
    engine = mixer.play("engine", { volume: 0.12 });
    engineLevel();
  }

  ui.engine.setAttribute("aria-pressed", String(engine !== null));
  ui.engine.textContent = engine ? "Stop" : "Run";
});

ui.speed.addEventListener("input", engineLevel);

// Music -----------------------------------------------------------------------------------------

const playlist = new Playlist(mixer, {
  tracks: [
    { name: "Plucks in C", src: audio("track-a") },
    { name: "Minor thirds", src: audio("track-b") },
  ],
  crossfadeMs: 1500,
});

const renderMusic = () => {
  ui.music.textContent = playlist.playing ? "Pause" : "Play";
  ui.music.setAttribute("aria-pressed", String(playlist.playing));
  ui.track.textContent = playlist.current ?? "—";
};

ui.music.addEventListener("click", () => {
  if (playlist.playing) {
    playlist.pause();
  } else {
    playlist.play();
  }

  renderMusic();
});

ui.next.addEventListener("click", () => {
  playlist.next();
  renderMusic();
});

// Ambience: sound-scape on the mixer's ambience bus --------------------------------------------

const scape = new SoundscapePlayer(soundscapeBus(mixer, "ambience"), { crossfadeMs: 1500 });
let scapeOn = false;

ui.scape.addEventListener("click", () => {
  scapeOn = !scapeOn;
  scape.play(scapeOn ? SCENES.meadow : null);
  ui.scape.setAttribute("aria-pressed", String(scapeOn));
});

// Whole mix -------------------------------------------------------------------------------------

let releaseDuck: (() => void) | null = null;

const duckOn = () => {
  if (started && !releaseDuck) {
    releaseDuck = mixer.duck(["music", "ambience"]);
    ui.duck.classList.add("held");
  }
};

const duckOff = () => {
  releaseDuck?.();
  releaseDuck = null;
  ui.duck.classList.remove("held");
};

ui.duck.addEventListener("pointerdown", duckOn);

for (const event of ["pointerup", "pointerleave", "pointercancel", "blur"]) {
  ui.duck.addEventListener(event, duckOff);
}

ui.duck.addEventListener("keydown", (event) => {
  if ((event.key === " " || event.key === "Enter") && !event.repeat) {
    event.preventDefault();
    duckOn();
  }
});
ui.duck.addEventListener("keyup", duckOff);

ui.rate.addEventListener("input", () => mixer.setRate(Number(ui.rate.value), { fadeMs: 80 }));

ui.pause.addEventListener("click", () => {
  mixer.setPaused(!mixer.isPaused);
  ui.pause.setAttribute("aria-pressed", String(mixer.isPaused));
  ui.pause.textContent = mixer.isPaused ? "Resume" : "Pause";
});

// Placed sound ----------------------------------------------------------------------------------

const SCALE = 22;
const FALLOFF = [1, 8] as const;
// The listener: at the origin, facing −Z (up on the canvas).
const listener = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } };
const source = { matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, -3, 1] } };
const space = createSpace(mixer, { listener });
let model: "cheap" | "hrtf" = "cheap";
let placed: PlacedVoice | null = null;

const playPlaced = () =>
  space.play(
    "engine",
    source,
    model === "hrtf"
      ? { panner: "HRTF", refDistance: 1.5, rolloffFactor: 1.6, volume: 0.6 }
      : { falloff: FALLOFF, panWidth: 0.9, volume: 0.6 },
  );

ui.placed.addEventListener("click", () => {
  if (placed) {
    placed.stop(300);
    placed = null;
  } else {
    placed = playPlaced();
  }

  ui.placed.setAttribute("aria-pressed", String(placed !== null));
  ui.placed.textContent = placed ? "Stop placed engine" : "Play placed engine";
});

ui.models.addEventListener("click", (event) => {
  const next = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.model as
    | "cheap"
    | "hrtf"
    | undefined;

  if (!next || next === model) {
    return;
  }

  model = next;

  for (const button of ui.models.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.model === model));
  }

  if (placed) {
    placed.stop(150);
    placed = playPlaced();
  }
});

let dragging = false;

const moveSource = (event: PointerEvent) => {
  const rect = ui.space.getBoundingClientRect();

  source.matrixWorld.elements[12] = (event.clientX - rect.left - rect.width / 2) / SCALE;
  source.matrixWorld.elements[14] = (event.clientY - rect.top - rect.height / 2) / SCALE;
};

ui.space.addEventListener("pointerdown", (event) => {
  dragging = true;
  ui.space.setPointerCapture(event.pointerId);
  moveSource(event);
});
ui.space.addEventListener("pointermove", (event) => dragging && moveSource(event));
ui.space.addEventListener("pointerup", () => {
  dragging = false;
});

const drawSpace = () => {
  const canvas = ui.space;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (canvas.width !== Math.round(width * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }

  const context = canvas.getContext("2d")!;
  const style = getComputedStyle(canvas);
  const color = (name: string) => style.getPropertyValue(name).trim();
  const cx = width / 2;
  const cy = height / 2;
  const x = source.matrixWorld.elements[12]!;
  const z = source.matrixWorld.elements[14]!;

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (model === "cheap") {
    context.fillStyle = color("--band");

    for (const radius of FALLOFF) {
      context.beginPath();
      context.arc(cx, cy, radius * SCALE, 0, Math.PI * 2);
      context.globalAlpha = radius === FALLOFF[0] ? 0.9 : 0.35;
      context.fill();
    }

    context.globalAlpha = 1;
  }

  // The listener, pointing up.
  context.fillStyle = color("--fg");
  context.beginPath();
  context.moveTo(cx, cy - 10);
  context.lineTo(cx - 7, cy + 7);
  context.lineTo(cx + 7, cy + 7);
  context.closePath();
  context.fill();

  // The sound.
  context.fillStyle = color("--accent");
  context.beginPath();
  context.arc(cx + x * SCALE, cy + z * SCALE, placed ? 9 : 7, 0, Math.PI * 2);
  context.fill();

  const distance = Math.hypot(x, z);
  const side = distance > 0 ? x / distance : 0;

  ui.placedReadout.textContent =
    model === "cheap"
      ? `distance ${distance.toFixed(1)} · gain ${falloffGain(distance, FALLOFF).toFixed(2)} · pan ${(side * 0.9).toFixed(2)}`
      : `distance ${distance.toFixed(1)} · PannerNode, HRTF`;
};

// Start and the frame loop ------------------------------------------------------------------------

const enable = () => {
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    ".rows button, .rows input, #placed",
  )) {
    control.disabled = !started;
  }
};

ui.start.addEventListener("click", () => {
  started = true;
  ui.start.hidden = true;
  enable();
  void mixer.load();
});

const frame = () => {
  space.update();
  drawMeters();
  drawSpace();
  renderMusic();

  const parts = [
    mixer.state === "idle" ? "idle" : `context ${mixer.state}`,
    mixer.isPaused ? "paused" : "",
    mixer.isDucked("music") ? "ducked" : "",
    Number(ui.rate.value) !== 1 ? `rate ×${Number(ui.rate.value).toFixed(2)}` : "",
  ];

  ui.readout.textContent = parts.filter(Boolean).join(" · ");
  requestAnimationFrame(frame);
};

ui.code.textContent = `import { defineSounds, SoundMixer } from "@zkmake/sound-mixer";
import { Playlist } from "@zkmake/sound-mixer/music";
import { createSpace } from "@zkmake/sound-mixer/three";

const sounds = defineSounds({
  step: { variants: [step1, step2, step3, step4], rate: [0.94, 1.06] },
  coin: { src: ["coin.ogg", "coin.m4a"], voices: 6 },
  boom: { src: boom, volume: 1.6 },          // above 1: it's a gain node
  click: { src: click, bus: "ui" },
  engine: { src: engine, loop: true },
});

const mixer = new SoundMixer({ sounds, storageKey: "my-game:sound" });
await mixer.load({ onProgress: (n, of) => bar(n / of) });

mixer.play("step");                          // never the same variant twice
mixer.after(260, () => mixer.play("boom"));  // audio time: waits while paused
const release = mixer.duck(["music", "ambience"]);
mixer.setRate(0.5);                          // slow motion, music too
mixer.setPaused(true);

const music = new Playlist(mixer, { tracks, crossfadeMs: 1500 });
music.play();

const space = createSpace(mixer, { listener: camera });
space.play("engine", train, { falloff: [1, 8] });
renderer.setAnimationLoop(() => { space.update(); /* … */ });`;

enable();
requestAnimationFrame(frame);
