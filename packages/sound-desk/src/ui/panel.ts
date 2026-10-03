/**
 * The desk itself, with no frame: tabs for the mix, the voices, the log, memory and (when given)
 * soundscapes and playlists. `mountSoundDesk` puts it in the zkmake dev-panel frame; a host with
 * its own tabs can mount `createSoundDesk(mixer).element` anywhere.
 */
import { type SoundMixer } from "@zkmake/sound-mixer";

import {
  createHistory,
  createLog,
  describe,
  formatBytes,
  formatDb,
  groupVoices,
  meterWidth,
  summarizeMemory,
} from "../core/model.ts";
import { injectStyles } from "./styles.ts";

/** What the desk reads and drives on a mixer. Any `SoundMixer`, whatever its sound and bus names. */
type MixerLike = Pick<
  SoundMixer<string, string>,
  | "busNames"
  | "settings"
  | "subscribe"
  | "meter"
  | "voiceCount"
  | "voices"
  | "samples"
  | "observe"
  | "on"
  | "isDucked"
  | "rate"
  | "state"
  | "isPaused"
  | "setPaused"
  | "setLevel"
  | "setMuted"
  | "setBusMuted"
  | "solo"
  | "soloed"
  | "context"
>;

/** A `Soundscape` from `@zkmake/sound-scape`, structurally. */
type SoundscapeLike = {
  readonly emitterNames: readonly string[];
  readonly liveEmitters: number;
  readonly isRunning: boolean;
  readonly emittersSuppressed: boolean;
  fire(emitter: string): boolean;
  suppressEmitters(suppressed: boolean): void;
  setBedGain(gain: number): void;
};

/** A `Playlist` from `@zkmake/sound-mixer/music`, structurally. */
type PlaylistLike = {
  readonly current: string | null;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  next(): void;
};

type SoundDeskOptions = {
  /** Soundscapes to drive, by label: a `Soundscape` or a `SoundscapePlayer` (its `current` is used). */
  scapes?: Record<string, SoundscapeLike | { readonly current: SoundscapeLike | null }>;
  /** Playlists to drive, by label. */
  playlists?: Record<string, PlaylistLike>;
};

type Tab = "mix" | "voices" | "log" | "memory" | "scapes";

type SoundDesk = {
  element: HTMLElement;
  /** Draw only while shown: meters run on animation frames. Sampling and the log carry on. */
  setActive(active: boolean): void;
  /** For a desk outside a dev-panel card: `dark` or `light`. */
  setTheme(theme: "dark" | "light"): void;
  setTab(tab: Tab): void;
  readonly tab: Tab;
  /** One line for a frame's brand row: voices, and the context when it isn't running. */
  readonly summary: string;
  dispose(): void;
};

const TICK_MS = 250;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (text) {
    element.textContent = text;
  }

  return element;
};

const button = (text: string, title: string, onClick: () => void) => {
  const element = el("button", "sdk-button", text);

  element.type = "button";
  element.title = title;
  element.addEventListener("click", onClick);

  return element;
};

const press = (element: HTMLButtonElement, on: boolean) =>
  element.setAttribute("aria-pressed", String(on));

const scapeOf = (source: SoundscapeLike | { readonly current: SoundscapeLike | null }) =>
  "emitterNames" in source ? source : source.current;

const createSoundDesk = (mixer: MixerLike, options: SoundDeskOptions = {}): SoundDesk => {
  injectStyles(document);

  const scapes = Object.entries(options.scapes ?? {});
  const playlists = Object.entries(options.playlists ?? {});
  const root = el("div", "sdk sdk-panel");
  const tabs = el("div", "sdk-tabs");
  const body = el("div", "sdk-body");
  const tabNames: Tab[] = [
    "mix",
    "voices",
    "log",
    "memory",
    ...(scapes.length + playlists.length > 0 ? (["scapes"] as const) : []),
  ];
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const views = new Map<Tab, HTMLElement>();
  const started = performance.now();
  const log = createLog();
  const history = createHistory();
  let tab: Tab = "mix";
  let active = true;
  let showPlays = false;
  let logDirty = true;
  let frame = 0;

  tabs.setAttribute("role", "tablist");
  root.append(tabs, body);

  for (const name of tabNames) {
    const tabButton = el("button", "sdk-tab", name === "scapes" ? "scenes" : name);
    const view = el("div", "sdk-view");

    tabButton.type = "button";
    tabButton.setAttribute("role", "tab");
    tabButton.addEventListener("click", () => setTab(name));
    view.setAttribute("role", "tabpanel");
    tabs.append(tabButton);
    body.append(view);
    tabButtons.set(name, tabButton);
    views.set(name, view);
  }

  const warnBadge = el("span", "sdk-badge sdk-warn");

  warnBadge.hidden = true;
  tabButtons.get("log")?.append(warnBadge);

  let unseenWarnings = 0;

  // Mix ----------------------------------------------------------------------------------------

  const mixView = views.get("mix")!;
  const strips = ["master", ...mixer.busNames].map((name) => {
    const row = el("div", "sdk-strip");
    const meter = el("div", "sdk-meter");
    const peak = el("span", "sdk-meter-peak");
    const rms = el("span", "sdk-meter-rms");
    const db = el("span", "sdk-db");
    const info = el("span", "sdk-strip-info");
    const level = el("input");
    const buttons = el("span", "sdk-strip-buttons");
    const mute = button("M", name === "master" ? "Mute everything" : `Switch ${name} off`, () => {
      if (name === "master") {
        mixer.setMuted(!mixer.settings.muted);
      } else {
        mixer.setBusMuted(name, !mixer.settings.mutedBuses.includes(name));
      }
    });
    const solo =
      name === "master"
        ? null
        : button("S", `Hear ${name} alone`, () => mixer.solo(mixer.soloed === name ? null : name));

    meter.append(peak, rms);
    level.type = "range";
    level.min = "0";
    level.max = "1.5";
    level.step = "0.01";
    level.setAttribute("aria-label", `${name} level`);
    level.addEventListener("input", () => mixer.setLevel(name, Number(level.value)));
    buttons.append(mute, ...(solo ? [solo] : []));
    row.append(el("span", "sdk-strip-name", name), meter, db, info, level, buttons);
    mixView.append(row);

    return {
      name,
      meter,
      peak,
      rms,
      db,
      info,
      level,
      mute,
      solo,
      read: null as ReturnType<MixerLike["meter"]> | null,
    };
  });

  const mixFooter = el("div", "sdk-row");
  const stateText = el("span", "sdk-dim");
  const pause = button("Pause", "Suspend the mixer: voices hold, after() timers wait", () =>
    mixer.setPaused(!mixer.isPaused),
  );
  const lock = button(
    "Lock",
    "Suspend the context as a browser does before a gesture, to test the unlock",
    () => {
      void mixer.context.suspend();
    },
  );

  mixFooter.append(stateText, pause, lock);
  mixView.append(mixFooter);

  const renderSettings = () => {
    const { levels, muted, mutedBuses } = mixer.settings;

    for (const strip of strips) {
      const off = strip.name === "master" ? muted : mutedBuses.includes(strip.name);

      strip.level.value = String(levels[strip.name] ?? 1);
      press(strip.mute, off);

      if (strip.solo) {
        press(strip.solo, mixer.soloed === strip.name);
      }
    }
  };

  const renderState = () => {
    const state = mixer.state;
    const parts = [state === "idle" ? "not started" : state];

    if (mixer.isPaused) {
      parts.push("paused");
    }

    stateText.textContent = parts.join(" · ");
    press(pause, mixer.isPaused);
    pause.textContent = mixer.isPaused ? "Resume" : "Pause";
    lock.disabled = state !== "running";
    renderSettings();
  };

  const drawMeters = () => {
    if (mixer.state === "idle") {
      return;
    }

    for (const strip of strips) {
      strip.read ??= mixer.meter(strip.name);

      const peak = strip.read.peak();
      const rms = strip.read.rms();

      strip.peak.style.width = `${(meterWidth(peak) * 100).toFixed(1)}%`;
      strip.rms.style.width = `${(meterWidth(rms) * 100).toFixed(1)}%`;
      strip.meter.classList.toggle("sdk-hot", peak >= 0.98);
      strip.db.textContent = formatDb(peak);
    }
  };

  const tickMix = () => {
    for (const strip of strips) {
      const parts: string[] = [];

      if (strip.name === "master") {
        parts.push(`${mixer.voiceCount()} voices`);
      } else {
        parts.push(`${mixer.voiceCount(strip.name)} v`);

        if (mixer.isDucked(strip.name)) {
          parts.push("ducked");
        }

        if (mixer.rate(strip.name) !== 1) {
          parts.push(`×${mixer.rate(strip.name).toFixed(2)}`);
        }
      }

      strip.info.textContent = parts.join(" · ");
    }
  };

  // Voices -------------------------------------------------------------------------------------

  const voicesView = views.get("voices")!;
  const sparkHead = el("div", "sdk-row");
  const sparkLabel = el("span", "sdk-dim", "voices, last 30 s");
  const sparkNote = el("span", "sdk-warn");
  const spark = el("canvas", "sdk-spark");
  const voiceList = el("ul", "sdk-list");

  sparkHead.append(sparkLabel, sparkNote);
  voicesView.append(sparkHead, spark, voiceList);

  const drawSpark = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = spark.clientWidth || 300;
    const height = spark.clientHeight || 44;

    if (spark.width !== Math.round(width * ratio)) {
      spark.width = Math.round(width * ratio);
      spark.height = Math.round(height * ratio);
    }

    const context = spark.getContext("2d");

    if (!context) {
      return;
    }

    const color = getComputedStyle(root).getPropertyValue("--sdk-accent").trim() || "#60a5fa";
    const values = history.values;
    const max = Math.max(4, history.max);
    const step = width / Math.max(1, history.length - 1);
    const offset = history.length - values.length;

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 1.5;
    context.beginPath();
    values.forEach((value, index) => {
      const x = (offset + index) * step;
      const y = height - 2 - (value / max) * (height - 6);

      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
    context.globalAlpha = 0.15;
    context.lineTo((offset + values.length - 1) * step, height);
    context.lineTo(offset * step, height);
    context.fill();
    context.globalAlpha = 1;
  };

  const tickVoices = () => {
    const now = mixer.state === "idle" ? 0 : mixer.context.currentTime;
    const groups = groupVoices(mixer.voices(), now);

    sparkNote.textContent = history.climbing ? "climbing: a leak?" : "";
    voiceList.replaceChildren(
      ...(groups.length === 0
        ? [el("li", "sdk-empty", "Nothing playing.")]
        : groups.map((group) => {
            const item = el("li");
            const loops =
              group.loops > 0 ? ` · ${group.loops} loop${group.loops === 1 ? "" : "s"}` : "";

            item.append(
              el("span", "", `${group.sound} ×${group.count}`),
              el("span", "sdk-dim", `${group.bus} · ${group.oldest.toFixed(1)} s${loops}`),
            );

            return item;
          })),
    );
    drawSpark();
  };

  // Log ----------------------------------------------------------------------------------------

  const logView = views.get("log")!;
  const logBar = el("div", "sdk-row");
  const playsToggle = button("plays", "Show plays and ends too", () => {
    showPlays = !showPlays;
    press(playsToggle, showPlays);
    logDirty = true;
    tickLog();
  });
  const logList = el("ul", "sdk-list sdk-log");

  press(playsToggle, showPlays);
  logBar.append(
    playsToggle,
    button("clear", "Clear the log", () => {
      log.clear();
      logDirty = true;
      tickLog();
    }),
  );
  logView.append(logBar, logList);

  const tickLog = () => {
    if (!logDirty) {
      return;
    }

    logDirty = false;

    const lines = log.lines({ plays: showPlays }).slice(0, 120);

    logList.replaceChildren(
      ...(lines.length === 0
        ? [
            el(
              "li",
              "sdk-empty",
              showPlays ? "Nothing yet." : "No drops, steals, loads or ducks yet.",
            ),
          ]
        : lines.map((line) => {
            const item = el("li");

            item.dataset.kind = line.kind;
            item.append(
              el("span", "sdk-time", `${line.at.toFixed(1)}s`),
              el("span", "", line.text),
            );

            return item;
          })),
    );
  };

  const unobserve = mixer.observe((event) => {
    const line = describe(event, (performance.now() - started) / 1000);

    log.push(line);
    logDirty = true;

    if (line.kind === "warn" && tab !== "log") {
      unseenWarnings += 1;
      warnBadge.hidden = false;
      warnBadge.textContent = String(unseenWarnings);
    }
  });

  // Memory -------------------------------------------------------------------------------------

  const memoryView = views.get("memory")!;
  const memoryHead = el("div", "sdk-row");
  const memoryList = el("ul", "sdk-list");

  memoryView.append(memoryHead, memoryList);

  const tickMemory = () => {
    const summary = summarizeMemory(mixer.samples());
    const parts = [`${formatBytes(summary.total)} decoded`, `${summary.rows.length} files`];

    if (summary.loading > 0) {
      parts.push(`${summary.loading} loading`);
    }

    memoryHead.replaceChildren(el("span", "", parts.join(" · ")));

    if (summary.flagged > 0) {
      memoryHead.append(el("span", "sdk-warn", `${summary.flagged} to look at`));
    }

    memoryList.replaceChildren(
      ...(summary.rows.length === 0
        ? [el("li", "sdk-empty", "Nothing loaded yet.")]
        : summary.rows.map((row) => {
            const item = el("li");
            const detail =
              row.hint === "failed"
                ? "failed"
                : row.status === "loading"
                  ? "loading"
                  : `${formatBytes(row.bytes)} · ${row.duration.toFixed(1)} s · ${row.channels === 1 ? "mono" : `${row.channels} ch`}${row.hint === "stream" ? " · stream it" : ""}`;

            item.title = `${row.url}\nplayed by ${row.sounds.join(", ")}`;
            item.append(
              el("span", "", row.name),
              el("span", row.hint ? "sdk-warn" : "sdk-dim", detail),
            );

            return item;
          })),
    );
  };

  // Scenes: soundscapes and playlists ------------------------------------------------------------

  const scapeView = views.get("scapes");
  const scapeRows: (() => void)[] = [];

  for (const [label, source] of scapes) {
    const box = el("div", "sdk-scape");
    const head = el("div", "sdk-scape-head");
    const status = el("span", "sdk-dim");
    const suppress = button("hold", "Hold the emitters back, as during dialog", () => {
      const scape = scapeOf(source);

      scape?.suppressEmitters(!scape.emittersSuppressed);
    });
    const bed = el("input");
    const fires = el("div", "sdk-row");
    let names = "";

    bed.type = "range";
    bed.min = "0";
    bed.max = "2";
    bed.step = "0.01";
    bed.value = "1";
    bed.setAttribute("aria-label", `${label} bed gain`);
    bed.addEventListener("input", () => scapeOf(source)?.setBedGain(Number(bed.value)));
    head.append(el("b", "", label), status);
    box.append(head, el("div", "sdk-row"), fires);
    box.children[1]?.append(el("span", "sdk-dim", "bed"), bed, suppress);
    scapeView?.append(box);

    scapeRows.push(() => {
      const scape = scapeOf(source);

      status.textContent = scape
        ? `${scape.isRunning ? "running" : "stopped"} · ${scape.liveEmitters} live`
        : "none playing";
      press(suppress, scape?.emittersSuppressed ?? false);

      const next = scape?.emitterNames.join("\u0000") ?? "";

      if (next !== names) {
        names = next;
        fires.replaceChildren(
          ...(scape?.emitterNames ?? []).map((emitter) =>
            button(`fire ${emitter}`, `Fire ${emitter} now`, () => scapeOf(source)?.fire(emitter)),
          ),
        );
      }
    });
  }

  for (const [label, playlist] of playlists) {
    const box = el("div", "sdk-scape");
    const head = el("div", "sdk-scape-head");
    const status = el("span", "sdk-dim");
    const toggle = button("play", "Play or pause", () =>
      playlist.playing ? playlist.pause() : playlist.play(),
    );
    const row = el("div", "sdk-row");

    head.append(el("b", "", label), status);
    row.append(
      toggle,
      button("next", "Next track", () => playlist.next()),
    );
    box.append(head, row);
    scapeView?.append(box);
    scapeRows.push(() => {
      status.textContent = playlist.current ?? "—";
      toggle.textContent = playlist.playing ? "pause" : "play";
    });
  }

  // Loop and lifecycle ---------------------------------------------------------------------------

  const setTab = (next: Tab) => {
    tab = tabNames.includes(next) ? next : "mix";

    for (const [name, tabButton] of tabButtons) {
      tabButton.setAttribute("aria-selected", String(name === tab));
      views.get(name)!.hidden = name !== tab;
    }

    if (tab === "log") {
      unseenWarnings = 0;
      warnBadge.hidden = true;
    }

    tick();
  };

  const tick = () => {
    history.push(mixer.voiceCount());

    if (!active) {
      return;
    }

    if (tab === "mix") {
      tickMix();
    } else if (tab === "voices") {
      tickVoices();
    } else if (tab === "log") {
      tickLog();
    } else if (tab === "memory") {
      tickMemory();
    } else {
      scapeRows.forEach((row) => row());
    }
  };

  const loop = () => {
    if (active && tab === "mix") {
      drawMeters();
    }

    frame = requestAnimationFrame(loop);
  };

  const interval = setInterval(tick, TICK_MS);
  const unsubscribe = mixer.subscribe(renderSettings);
  const offState = mixer.on("state", renderState);

  frame = requestAnimationFrame(loop);
  renderState();
  setTab("mix");

  return {
    element: root,
    setActive(next) {
      active = next;
      tick();
    },
    setTheme(theme) {
      root.dataset.theme = theme;
    },
    setTab,
    get tab() {
      return tab;
    },
    get summary() {
      const voices = mixer.voiceCount();
      const state = mixer.isPaused ? "paused" : mixer.state === "running" ? "" : mixer.state;

      return [`${voices} voice${voices === 1 ? "" : "s"}`, state].filter(Boolean).join(" · ");
    },
    dispose() {
      clearInterval(interval);
      cancelAnimationFrame(frame);
      unobserve();
      unsubscribe();
      offState();
      root.remove();
    },
  };
};

export { createSoundDesk };
export type { MixerLike, PlaylistLike, SoundDesk, SoundDeskOptions, SoundscapeLike, Tab };
