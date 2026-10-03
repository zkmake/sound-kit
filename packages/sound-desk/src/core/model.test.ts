import { describe as group, expect, it } from "vitest";

import {
  basename,
  createHistory,
  createLog,
  describe,
  formatBytes,
  formatDb,
  groupVoices,
  meterWidth,
  summarizeMemory,
} from "./model.ts";

group("formatting", () => {
  it("writes dBFS, sizes and file names", () => {
    expect(formatDb(1)).toBe("0.0");
    expect(formatDb(0.5)).toBe("−6.0");
    expect(formatDb(0)).toBe("−∞");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4 KB");
    expect(formatBytes(38.2 * 1024 * 1024)).toBe("38.2 MB");
    expect(basename("/sound-kit/audio/wind.ogg?v=2")).toBe("wind.ogg");
  });

  it("maps −48..0 dB across a meter", () => {
    expect(meterWidth(0)).toBe(0);
    expect(meterWidth(1)).toBe(1);
    expect(meterWidth(2)).toBe(1);
    expect(meterWidth(10 ** (-24 / 20))).toBeCloseTo(0.5);
  });
});

group("groupVoices", () => {
  it("counts voices per sound, most first, with loops and the oldest age", () => {
    const groups = groupVoices(
      [
        { id: 1, sound: "hum", bus: "ambience", started: 1, loop: true },
        { id: 2, sound: "coin", bus: "sfx", started: 8, loop: false },
        { id: 3, sound: "coin", bus: "sfx", started: 9, loop: false },
      ],
      10,
    );

    expect(groups).toEqual([
      { sound: "coin", bus: "sfx", count: 2, loops: 0, oldest: 2 },
      { sound: "hum", bus: "ambience", count: 1, loops: 1, oldest: 9 },
    ]);
  });
});

group("summarizeMemory", () => {
  it("sorts by decoded size and flags what should stream or failed", () => {
    const summary = summarizeMemory([
      {
        url: "a/click.ogg",
        sounds: ["click"],
        status: "loaded",
        bytes: 20_000,
        duration: 0.1,
        channels: 1,
      },
      {
        url: "a/theme.ogg",
        sounds: ["theme"],
        status: "loaded",
        bytes: 40_000_000,
        duration: 120,
        channels: 2,
      },
      { url: "a/gone.ogg", sounds: ["gone"], status: "failed", bytes: 0, duration: 0, channels: 0 },
      {
        url: "a/late.ogg",
        sounds: ["late"],
        status: "loading",
        bytes: 0,
        duration: 0,
        channels: 0,
      },
    ]);

    expect(summary.rows.map((row) => [row.name, row.hint])).toEqual([
      ["theme.ogg", "stream"],
      ["click.ogg", null],
      ["gone.ogg", "failed"],
      ["late.ogg", null],
    ]);
    expect(summary.total).toBe(40_020_000);
    expect(summary.flagged).toBe(2);
    expect(summary.loading).toBe(1);
  });
});

group("the log", () => {
  it("describes each event in a line", () => {
    expect(
      describe({ type: "play", id: 1, sound: "coin", bus: "sfx", volume: 0.5, rate: 1.04 }, 1),
    ).toEqual({
      at: 1,
      kind: "play",
      text: "coin on sfx · vol 0.50 · rate 1.04",
    });
    expect(describe({ type: "drop", sound: "thud", reason: "cap" }, 2).text).toBe(
      "thud dropped: at its voice cap",
    );
    expect(describe({ type: "steal", id: 1, sound: "coin", bus: "sfx" }, 2).kind).toBe("warn");
    expect(describe({ type: "load", url: "x/gone.ogg", ok: false }, 2).text).toBe(
      "failed gone.ogg",
    );
    expect(describe({ type: "duck", bus: "music", gain: 0.251 }, 2).text).toBe(
      "music ducked to −12.0 dB",
    );
    expect(describe({ type: "duck", bus: "music", gain: 1 }, 2).text).toBe("music back up");
  });

  it("keeps the newest first, caps its size, and hides plays on request", () => {
    const log = createLog(3);

    log.push({ at: 1, kind: "play", text: "a" });
    log.push({ at: 2, kind: "warn", text: "b" });
    log.push({ at: 3, kind: "end", text: "c" });
    log.push({ at: 4, kind: "info", text: "d" });

    expect(log.lines({ plays: true }).map((line) => line.text)).toEqual(["d", "c", "b"]);
    expect(log.lines({ plays: false }).map((line) => line.text)).toEqual(["d", "b"]);
    log.clear();
    expect(log.size).toBe(0);
  });
});

group("createHistory", () => {
  it("keeps a window of counts and spots a climb that never comes back down", () => {
    const steady = createHistory(3, 250);
    const leaking = createHistory(3, 250);

    for (let step = 0; step < 12; step++) {
      steady.push(step % 2 === 0 ? 2 : 6);
      leaking.push(step);
    }

    expect(steady.values.length).toBe(12);
    expect(steady.max).toBe(6);
    expect(steady.climbing).toBe(false);
    expect(leaking.climbing).toBe(true);

    steady.push(1);
    expect(steady.values.length).toBe(12);
  });
});
