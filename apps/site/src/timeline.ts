/**
 * The last 30 seconds, drawn: the bed as a band (dimmed while ducked), and one row per emitter with
 * a dot per fire, sized by its volume, filled while it plays.
 */

type Fire = {
  emitter: string;
  sample: string;
  volume: number;
  start: number;
  end: number | null;
};

type Span = { start: number; end: number | null };

const WINDOW_MS = 30_000;
const GUTTER = 92;
const BED_ROW = 30;
const ROW = 34;

const createTimeline = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d")!;
  const fires: Fire[] = [];
  const beds: Span[] = [];
  const ducks: Span[] = [];
  let rows: readonly string[] = [];
  let bedLabel = "bed";

  const prune = (now: number) => {
    const cutoff = now - WINDOW_MS;

    for (const list of [fires, beds, ducks] as Span[][]) {
      while (list.length > 0 && list[0]!.end !== null && list[0]!.end < cutoff) {
        list.shift();
      }
    }
  };

  const draw = () => {
    const now = performance.now();
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = BED_ROW + rows.length * ROW + 24;

    canvas.style.height = `${height}px`;

    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }

    const style = getComputedStyle(canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const fg = color("--fg");
    const muted = color("--muted");
    const line = color("--line");
    const accent = color("--accent");
    const band = color("--band");
    const plot = width - GUTTER - 8;
    const x = (time: number) => GUTTER + plot - ((now - time) / WINDOW_MS) * plot;

    prune(now);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = "12px Geist, system-ui, sans-serif";
    context.textBaseline = "middle";

    // Rows and their labels.
    context.fillStyle = muted;
    context.fillText(bedLabel, 0, BED_ROW / 2);
    rows.forEach((name, index) => {
      const y = BED_ROW + index * ROW;

      context.fillStyle = line;
      context.fillRect(GUTTER, y, plot, 1);
      context.fillStyle = fg;
      context.fillText(name, 0, y + ROW / 2);
    });

    // The bed: a band while it plays, cut down while ducked.
    for (const span of beds) {
      const from = Math.max(GUTTER, x(span.start));
      const to = x(span.end ?? now);

      if (to > from) {
        context.fillStyle = band;
        context.fillRect(from, 6, to - from, BED_ROW - 12);
      }
    }

    for (const span of ducks) {
      const from = Math.max(GUTTER, x(span.start));
      const to = x(span.end ?? now);

      if (to > from) {
        context.clearRect(from, 6, to - from, BED_ROW - 12);
        context.fillStyle = band;
        context.fillRect(from, 12, to - from, BED_ROW - 24);
      }
    }

    // Fires.
    for (const fire of fires) {
      const row = rows.indexOf(fire.emitter);
      const start = x(fire.start);

      if (row < 0 || start < GUTTER) {
        continue;
      }

      const y = BED_ROW + row * ROW + ROW / 2;
      const radius = 3 + fire.volume * 9;
      const end = fire.end === null ? x(now) : x(fire.end);

      context.strokeStyle = accent;
      context.globalAlpha = 0.5;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(start, y);
      context.lineTo(Math.max(start, end), y);
      context.stroke();
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(start, y, radius, 0, Math.PI * 2);

      if (fire.end === null) {
        context.fillStyle = accent;
        context.fill();
      } else {
        context.lineWidth = 1.5;
        context.stroke();
      }
    }

    // Time ticks every 5 s, counting back from now.
    context.fillStyle = muted;
    context.textAlign = "center";

    for (let seconds = 0; seconds <= 30; seconds += 5) {
      const tick = GUTTER + plot - (seconds / 30) * plot;

      context.fillText(seconds === 0 ? "now" : `−${seconds}s`, tick, height - 8);
    }

    context.textAlign = "left";
  };

  let frame = 0;
  const loop = () => {
    draw();
    frame = requestAnimationFrame(loop);
  };

  frame = requestAnimationFrame(loop);

  return {
    setRows(next: readonly string[], bed: string | null) {
      rows = next;
      bedLabel = bed ?? "no bed";
    },
    fire(emitter: string, sample: string, volume: number) {
      fires.push({ emitter, sample, volume, start: performance.now(), end: null });
    },
    end(emitter: string, sample: string) {
      const fire = fires.find(
        (item) => item.end === null && item.emitter === emitter && item.sample === sample,
      );

      if (fire) {
        fire.end = performance.now();
      }
    },
    bedOn() {
      if (beds.at(-1)?.end !== null) {
        beds.push({ start: performance.now(), end: null });
      }
    },
    bedOff() {
      const last = beds.at(-1);

      if (last && last.end === null) {
        last.end = performance.now();
      }
    },
    duckOn() {
      ducks.push({ start: performance.now(), end: null });
    },
    duckOff() {
      const last = ducks.at(-1);

      if (last && last.end === null) {
        last.end = performance.now();
      }
    },
    dispose() {
      cancelAnimationFrame(frame);
    },
  };
};

export { createTimeline };
