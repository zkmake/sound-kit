/**
 * What the desk shows, worked out from the mixer's reports with no DOM: tested on its own, drawn
 * by the panel.
 */
import { type MixerLogEvent, type SampleInfo, type VoiceInfo } from "@zkmake/sound-mixer";

/** A decoded sample over this many bytes should stream instead (a 2-minute stereo track is ~40 MB). */
const STREAM_HINT_BYTES = 8 * 1024 * 1024;

/** Linear peak to dBFS text, for a meter's readout. */
const formatDb = (peak: number) =>
  peak <= 0.000_01 ? "−∞" : `${(20 * Math.log10(peak)).toFixed(1).replace("-", "−")}`;

/** Meter width, 0..1, across −48 dB to 0 dB. */
const meterWidth = (peak: number) =>
  peak <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(peak) + 48) / 48));

const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : bytes >= 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${bytes} B`;

/** The file name of a URL, without its query. */
const basename = (url: string) => url.split(/[?#]/)[0]?.split("/").pop() || url;

type VoiceGroup = {
  sound: string;
  bus: string;
  count: number;
  loops: number;
  /** Seconds the oldest has played. */
  oldest: number;
};

/** Voices by sound, most first: a sound piling up stands out. */
const groupVoices = (voices: readonly VoiceInfo[], now: number): VoiceGroup[] => {
  const groups = new Map<string, VoiceGroup>();

  for (const voice of voices) {
    const key = `${voice.bus}\u0000${voice.sound}`;
    const group = groups.get(key) ?? {
      sound: voice.sound,
      bus: voice.bus,
      count: 0,
      loops: 0,
      oldest: 0,
    };

    group.count += 1;
    group.loops += voice.loop ? 1 : 0;
    group.oldest = Math.max(group.oldest, now - voice.started);
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || a.sound.localeCompare(b.sound));
};

type MemoryRow = SampleInfo & { name: string; hint: "stream" | "failed" | null };

/** Samples by decoded size, largest first, with a total and the ones worth a look. */
const summarizeMemory = (samples: readonly SampleInfo[]) => {
  const rows: MemoryRow[] = samples
    .map((sample) => ({
      ...sample,
      name: basename(sample.url),
      hint:
        sample.status === "failed"
          ? ("failed" as const)
          : sample.bytes > STREAM_HINT_BYTES
            ? ("stream" as const)
            : null,
    }))
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.bytes, 0),
    loading: rows.filter((row) => row.status === "loading").length,
    flagged: rows.filter((row) => row.hint !== null).length,
  };
};

type LogLine = {
  /** Seconds since the desk started listening. */
  at: number;
  kind: "play" | "end" | "warn" | "info";
  text: string;
};

const DROP_REASONS: Record<Extract<MixerLogEvent, { type: "drop" }>["reason"], string> = {
  cap: "at its voice cap",
  loading: "not loaded yet",
  failed: "failed to load",
  unknown: "not in the registry",
  "no-bus": "on a bus the mixer doesn't have",
};

/** One log line for one mixer event. */
const describe = (event: MixerLogEvent, at: number): LogLine => {
  switch (event.type) {
    case "play":
      return {
        at,
        kind: "play",
        text: `${event.sound} on ${event.bus} · vol ${event.volume.toFixed(2)} · rate ${event.rate.toFixed(2)}`,
      };
    case "end":
      return { at, kind: "end", text: `${event.sound} ended` };
    case "stop":
      return { at, kind: "end", text: `${event.sound} stopped` };
    case "steal":
      return { at, kind: "warn", text: `${event.sound} stolen: oldest voice cut for a new one` };
    case "drop":
      return { at, kind: "warn", text: `${event.sound} dropped: ${DROP_REASONS[event.reason]}` };
    case "load":
      return event.ok
        ? { at, kind: "info", text: `loaded ${basename(event.url)}` }
        : { at, kind: "warn", text: `failed ${basename(event.url)}` };
    case "duck":
      return {
        at,
        kind: "info",
        text:
          event.gain >= 1
            ? `${event.bus} back up`
            : `${event.bus} ducked to ${formatDb(event.gain)} dB`,
      };
  }
};

/** The newest lines first, at most `size`. Plays and ends can be hidden: they're most of the noise. */
const createLog = (size = 200) => {
  const lines: LogLine[] = [];

  return {
    push(line: LogLine) {
      lines.unshift(line);
      lines.length = Math.min(lines.length, size);
    },
    lines(opts: { plays: boolean }) {
      return opts.plays
        ? lines
        : lines.filter((line) => line.kind !== "play" && line.kind !== "end");
    },
    clear() {
      lines.length = 0;
    },
    get size() {
      return lines.length;
    },
  };
};

/**
 * Voice counts over the last `seconds`, sampled every `stepMs`: a line that climbs and never
 * comes back to its floor is a leak.
 */
const createHistory = (seconds = 30, stepMs = 250) => {
  const length = Math.round((seconds * 1000) / stepMs);
  const values: number[] = [];

  return {
    push(value: number) {
      values.push(value);

      if (values.length > length) {
        values.shift();
      }
    },
    get values(): readonly number[] {
      return values;
    },
    get max() {
      return values.reduce((max, value) => Math.max(max, value), 0);
    },
    /** True when the lowest count of the last third is well above the lowest of the first. */
    get climbing() {
      if (values.length < length) {
        return false;
      }

      const third = Math.floor(length / 3);
      const early = Math.min(...values.slice(0, third));
      const late = Math.min(...values.slice(-third));

      return late >= early + 4;
    },
    length,
    stepMs,
  };
};

export {
  basename,
  createHistory,
  createLog,
  describe,
  formatBytes,
  formatDb,
  groupVoices,
  meterWidth,
  STREAM_HINT_BYTES,
  summarizeMemory,
};
export type { LogLine, MemoryRow, VoiceGroup };
