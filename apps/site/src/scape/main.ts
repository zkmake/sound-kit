import { type SoundscapeBus, type SoundscapeDef } from "@zkmake/sound-scape";
import { createHowlerBus, type SoundscapeAdapter } from "@zkmake/sound-scape/howler";
import { createWebAudioBus } from "@zkmake/sound-scape/web-audio";

import { type Integration, react, vanilla } from "./integrations.tsx";
import { SAMPLES, SCENES, type SceneId } from "./scenes.ts";
import { createTimeline } from "./timeline.ts";

import "./style.css";

type Backend = "web-audio" | "howler";
type IntegrationId = "vanilla" | "react";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

const ui = {
  scenes: $("#scenes"),
  backends: $("#backends"),
  integrations: $("#integrations"),
  start: $<HTMLButtonElement>("#start"),
  level: $<HTMLInputElement>("#level"),
  mute: $<HTMLButtonElement>("#mute"),
  duck: $<HTMLButtonElement>("#duck"),
  suppress: $<HTMLButtonElement>("#suppress"),
  pause: $<HTMLButtonElement>("#pause"),
  readout: $("#readout"),
  fires: $("#fires"),
  def: $<HTMLTextAreaElement>("#def"),
  defStatus: $("#def-status"),
  log: $("#log"),
  code: $("#code"),
  codeTitle: $("#code-title"),
};

const timeline = createTimeline($<HTMLCanvasElement>("#timeline"));

/** Edited defs, per scene, so switching away and back keeps your edits. */
const defs: Record<SceneId, SoundscapeDef> = { ...SCENES };

const state = {
  scene: "meadow" as SceneId,
  backend: "web-audio" as Backend,
  integration: "vanilla" as IntegrationId,
  started: false,
  paused: false,
  muted: false,
  suppressed: false,
  loaded: "",
};

let adapter: SoundscapeAdapter<number> | null = null;
let integration: Integration | null = null;
let releaseDuck: (() => void) | null = null;

/**
 * The engine's view of the adapter, tapped: the timeline sees each bed start and stop and each
 * fire's volume. The adapter's own controls (duck, level, mute) are used directly.
 */
const tap = (bus: SoundscapeAdapter<number>): SoundscapeBus<number> => {
  const beds = new Set<number>();

  return {
    playBed(sample, opts) {
      const id = bus.playBed(sample, opts);

      if (id !== null) {
        beds.add(id);
        timeline.bedOn();
      }

      return id;
    },
    playEmitter(sample, opts) {
      const id = bus.playEmitter(sample, opts);

      if (id !== null) {
        lastFire = { volume: opts.volume, rate: opts.rate, pan: opts.pan };
      }

      return id;
    },
    stop(id, fadeOutMs) {
      if (beds.delete(id) && beds.size === 0) {
        timeline.bedOff();
      }

      bus.stop(id, fadeOutMs);
    },
    setVolume: (id, volume, fadeMs) => bus.setVolume(id, volume, fadeMs),
  };
};

let lastFire = { volume: 0, rate: 1, pan: 0 };
let started = 0;

const log = (emitter: string, sample: string) => {
  const item = document.createElement("li");
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const pan = lastFire.pan.toFixed(2).replace("-", "−");
  const cell = (tag: string, text: string, className = "") => {
    const element = document.createElement(tag);

    element.textContent = text;
    element.className = className;

    return element;
  };

  item.append(
    cell("span", `${seconds}s`, "t"),
    cell("b", emitter),
    cell("span", sample),
    cell(
      "span",
      `vol ${lastFire.volume.toFixed(2)} · rate ${lastFire.rate.toFixed(3)} · pan ${pan}`,
      "n",
    ),
  );
  ui.log.prepend(item);

  while (ui.log.children.length > 40) {
    ui.log.lastElementChild?.remove();
  }
};

const makeAdapter = (backend: Backend) => {
  const opts = { level: Number(ui.level.value), muted: state.muted };
  const next =
    backend === "howler" ? createHowlerBus(SAMPLES, opts) : createWebAudioBus(SAMPLES, opts);

  state.loaded = "loading";
  void next.load({
    onProgress: (settled, total) => {
      state.loaded = settled === total ? "" : `loading ${settled}/${total}`;
    },
  });

  return next;
};

const makeIntegration = (bus: SoundscapeAdapter<number>) => {
  const opts = {
    crossfadeMs: 1500,
    onEmitter: ({
      emitter,
      sample,
      phase,
    }: {
      emitter: string;
      sample: string;
      phase: "start" | "end";
    }) => {
      if (phase === "start") {
        timeline.fire(emitter, sample, lastFire.volume);
        log(emitter, sample);
      } else {
        timeline.end(emitter, sample);
      }
    },
  };

  return state.integration === "react" ? react(tap(bus), opts) : vanilla(tap(bus), opts);
};

const play = () => {
  integration?.play(state.paused ? null : defs[state.scene]);
};

const renderScene = () => {
  const def = defs[state.scene];

  timeline.setRows(
    (def.emitters ?? []).map((emitter, index) => emitter.name ?? String(index)),
    def.bed ? `bed: ${def.bed.sample}` : null,
  );
  ui.fires.replaceChildren(
    ...(def.emitters ?? []).map((emitter, index) => {
      const button = document.createElement("button");
      const name = emitter.name ?? String(index);

      button.type = "button";
      button.textContent = `Fire ${name}`;
      button.disabled = !state.started;
      button.addEventListener("click", () => integration?.current()?.fire(name));

      return button;
    }),
  );

  if (document.activeElement !== ui.def) {
    ui.def.value = JSON.stringify(def, null, 2);
  }
};

const renderCode = () => {
  const backend =
    state.backend === "howler"
      ? `import { createHowlerBus } from "@zkmake/sound-scape/howler";\n\nconst bus = createHowlerBus(SAMPLES);`
      : `import { createWebAudioBus } from "@zkmake/sound-scape/web-audio";\n\nconst bus = createWebAudioBus(SAMPLES);`;
  const samples = `// name → [opus, m4a]: the first one the browser plays wins\nconst SAMPLES = {\n  wind: ["audio/wind.ogg", "audio/wind.m4a"],\n  "bird-1": ["audio/bird-1.ogg", "audio/bird-1.m4a"],\n  // …\n};`;

  ui.codeTitle.textContent = state.integration === "react" ? "React" : "Vanilla";
  ui.code.textContent =
    state.integration === "react"
      ? `import { useSoundscape } from "@zkmake/sound-scape/react";\n${backend}\n\n${samples}\n\n// Outside <Canvas> with R3F. A new def crossfades; the same\n// content again does nothing, so inline objects are fine.\nfunction Ambience({ scene, paused }) {\n  useSoundscape(bus, SCENES[scene], { active: !paused, crossfadeMs: 1500 });\n  return null;\n}\n\nconst release = bus.duck(); // narration starts\nrelease();                  // …and ends`
      : `import { SoundscapePlayer } from "@zkmake/sound-scape";\n${backend}\n\n${samples}\n\nawait bus.load({ onProgress: (n, of) => bar(n / of) });\n\nconst player = new SoundscapePlayer(bus, { crossfadeMs: 1500 });\nplayer.play(MEADOW);   // after a click: browsers need a gesture\nplayer.play(CAFE);     // crossfades\nplayer.play(null);     // fades out\n\nconst release = bus.duck(); // −12 dB on the bed and every emitter\nrelease();`;
};

const press = (group: HTMLElement, attribute: string, value: string) => {
  for (const button of group.querySelectorAll<HTMLButtonElement>("button")) {
    button.setAttribute("aria-pressed", String(button.dataset[attribute] === value));
  }
};

const enableControls = () => {
  for (const control of [ui.mute, ui.duck, ui.suppress, ui.pause]) {
    control.disabled = !state.started;
  }
};

const resetSuppress = () => {
  state.suppressed = false;
  ui.suppress.setAttribute("aria-pressed", "false");
};

const switchAdapter = (backend: Backend) => {
  const old = adapter;
  const oldIntegration = integration;

  oldIntegration?.dispose();
  releaseDuck?.();
  releaseDuck = null;

  if (old) {
    old.stopAll(300);
    setTimeout(() => old.dispose(), 400);
  }

  adapter = makeAdapter(backend);
  integration = makeIntegration(adapter);
  resetSuppress();
  play();
};

ui.start.addEventListener("click", () => {
  state.started = true;
  started = performance.now();
  ui.start.hidden = true;
  switchAdapter(state.backend);
  enableControls();
  renderScene();
});

ui.scenes.addEventListener("click", (event) => {
  const scene = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset
    .scene as SceneId | undefined;

  if (scene && scene !== state.scene) {
    state.scene = scene;
    press(ui.scenes, "scene", scene);
    resetSuppress();
    renderScene();
    play();
  }
});

ui.backends.addEventListener("click", (event) => {
  const backend = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset
    .backend as Backend | undefined;

  if (backend && backend !== state.backend) {
    state.backend = backend;
    press(ui.backends, "backend", backend);
    renderCode();

    if (state.started) {
      switchAdapter(backend);
    }
  }
});

ui.integrations.addEventListener("click", (event) => {
  const id = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset
    .integration as IntegrationId | undefined;

  if (id && id !== state.integration) {
    state.integration = id;
    press(ui.integrations, "integration", id);
    renderCode();

    if (adapter) {
      integration?.dispose();
      integration = makeIntegration(adapter);
      resetSuppress();
      play();
    }
  }
});

ui.level.addEventListener("input", () => adapter?.setLevel(Number(ui.level.value), 60));

ui.mute.addEventListener("click", () => {
  state.muted = !state.muted;
  ui.mute.setAttribute("aria-pressed", String(state.muted));
  adapter?.setMuted(state.muted);
});

const duckOn = () => {
  if (adapter && !releaseDuck) {
    releaseDuck = adapter.duck();
    ui.duck.classList.add("held");
    timeline.duckOn();
  }
};

const duckOff = () => {
  if (releaseDuck) {
    releaseDuck();
    releaseDuck = null;
    ui.duck.classList.remove("held");
    timeline.duckOff();
  }
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

ui.suppress.addEventListener("click", () => {
  state.suppressed = !state.suppressed;
  ui.suppress.setAttribute("aria-pressed", String(state.suppressed));
  integration?.current()?.suppressEmitters(state.suppressed);
});

ui.pause.addEventListener("click", () => {
  state.paused = !state.paused;
  ui.pause.setAttribute("aria-pressed", String(state.paused));
  ui.pause.textContent = state.paused ? "Resume" : "Pause";
  resetSuppress();
  play();
});

let editTimer = 0;

ui.def.addEventListener("input", () => {
  clearTimeout(editTimer);
  editTimer = window.setTimeout(() => {
    try {
      const def = JSON.parse(ui.def.value) as SoundscapeDef;

      if (typeof def !== "object" || def === null || Array.isArray(def)) {
        throw new Error("expected an object");
      }

      defs[state.scene] = def;
      ui.defStatus.textContent = "Swapped.";
      ui.defStatus.classList.remove("bad");
      renderScene();
      play();
    } catch (error) {
      ui.defStatus.textContent = `Not swapped: ${(error as Error).message}`;
      ui.defStatus.classList.add("bad");
    }
  }, 500);
});

setInterval(() => {
  if (!adapter) {
    return;
  }

  const scape = integration?.current();
  const cap = defs[state.scene].maxConcurrent ?? 4;
  const parts = [
    `${scape?.liveEmitters ?? 0}/${cap} emitters`,
    `${adapter.voices} voices`,
    adapter.ducked ? "ducked" : "",
    state.loaded,
    "context" in adapter ? `context ${(adapter as { context: AudioContext }).context.state}` : "",
  ];

  ui.readout.textContent = parts.filter(Boolean).join(" · ");
}, 200);

enableControls();
renderScene();
renderCode();
