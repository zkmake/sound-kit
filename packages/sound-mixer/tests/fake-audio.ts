/**
 * Just enough of the Web Audio API to see what the mixer schedules, with a clock the test moves:
 * `advance(seconds)` ends sources whose stop time (or buffer end) has passed.
 */

const round = (value: number) => Math.round(value * 1000) / 1000;

class FakeParam {
  value: number;
  readonly events: string[] = [];

  constructor(value: number) {
    this.value = value;
  }

  cancelScheduledValues() {}

  setValueAtTime(value: number, at: number) {
    this.value = value;
    this.events.push(`set ${round(value)} @${round(at)}`);
  }

  linearRampToValueAtTime(value: number, at: number) {
    this.value = value;
    this.events.push(`ramp ${round(value)} @${round(at)}`);
  }

  /** The last scheduled value, rounded. */
  get last() {
    return round(this.value);
  }
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  readonly context: FakeContext;

  constructor(context: FakeContext) {
    this.context = context;
  }

  connect(node: FakeNode) {
    this.outputs.push(node);

    return node;
  }

  disconnect() {
    this.outputs.length = 0;
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(0);
  readonly knee = new FakeParam(0);
  readonly ratio = new FakeParam(0);
  readonly attack = new FakeParam(0);
  readonly release = new FakeParam(0);
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  level = 0;

  getFloatTimeDomainData(array: Float32Array) {
    array.fill(this.level);
  }
}

class FakeScheduled extends FakeNode {
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  startOffset = 0;
  ended = false;

  start(at = 0, offset = 0) {
    this.startedAt = at;
    this.startOffset = offset;
  }

  stop(at = 0) {
    this.stoppedAt = at;
  }

  /** When this node will end by itself, if ever. */
  endsAt(): number | null {
    return this.stoppedAt;
  }
}

class FakeSource extends FakeScheduled {
  buffer: { duration: number } | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);

  override endsAt() {
    const natural =
      !this.loop && this.buffer && this.startedAt !== null
        ? this.startedAt + this.buffer.duration
        : null;

    return (
      [this.stoppedAt, natural].filter((value): value is number => value !== null).sort()[0] ?? null
    );
  }
}

class FakeConstant extends FakeScheduled {
  readonly offset = new FakeParam(1);
}

class Fake3D extends FakeNode {
  readonly positionX = new FakeParam(0);
  readonly positionY = new FakeParam(0);
  readonly positionZ = new FakeParam(0);
  panningModel = "equalpower";
  distanceModel = "inverse";
  refDistance = 1;
  maxDistance = 10000;
  rolloffFactor = 1;
}

class FakeListener {
  readonly positionX = new FakeParam(0);
  readonly positionY = new FakeParam(0);
  readonly positionZ = new FakeParam(0);
  readonly forwardX = new FakeParam(0);
  readonly forwardY = new FakeParam(0);
  readonly forwardZ = new FakeParam(-1);
  readonly upX = new FakeParam(0);
  readonly upY = new FakeParam(1);
  readonly upZ = new FakeParam(0);
}

/** An `<audio>` element: play() resolves unless `refuse` is set, as before a gesture. */
class FakeAudioElement {
  static refuse = false;
  static made: FakeAudioElement[] = [];
  src = "";
  preload = "";
  crossOrigin: string | null = null;
  loop = false;
  paused = true;
  currentTime = 0;
  duration = 10;
  playbackRate = 1;
  preservesPitch = true;
  private readonly listeners = new Map<string, (() => void)[]>();

  constructor() {
    FakeAudioElement.made.push(this);
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string) {
    this.listeners.get(type)?.forEach((listener) => listener());
  }

  play() {
    if (FakeAudioElement.refuse) {
      return Promise.reject(new Error("NotAllowedError"));
    }

    this.paused = false;

    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  removeAttribute() {
    this.src = "";
  }

  load() {}
}

class FakeContext {
  readonly listener = new FakeListener();
  readonly media: FakeNode[] = [];
  currentTime = 0;
  state: "suspended" | "running" | "closed" = "running";
  readonly destination = new FakeNode(this);
  readonly gains: FakeGain[] = [];
  readonly sources: FakeSource[] = [];
  readonly scheduled: FakeScheduled[] = [];
  private readonly listeners = new Set<() => void>();

  createGain() {
    const gain = new FakeGain(this);

    this.gains.push(gain);

    return gain;
  }

  createStereoPanner() {
    return new FakePanner(this);
  }

  createDynamicsCompressor() {
    return new FakeCompressor(this);
  }

  createPanner() {
    return new Fake3D(this);
  }

  createMediaElementSource(element: FakeAudioElement) {
    const node = new FakeNode(this);

    (node as FakeNode & { element: FakeAudioElement }).element = element;
    this.media.push(node);

    return node;
  }

  createAnalyser() {
    return new FakeAnalyser(this);
  }

  createBufferSource() {
    const source = new FakeSource(this);

    this.sources.push(source);
    this.scheduled.push(source);

    return source;
  }

  createConstantSource() {
    const node = new FakeConstant(this);

    this.scheduled.push(node);

    return node;
  }

  /** Buffers are `{ duration }`, read from the file's text: `"1.5"` lasts 1.5 s, `"bad"` fails. */
  decodeAudioData(data: ArrayBuffer) {
    const text = new TextDecoder().decode(data);
    const duration = Number(text);

    return Number.isFinite(duration)
      ? Promise.resolve({ duration })
      : Promise.reject(new Error("decode"));
  }

  addEventListener(_type: string, listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: () => void) {
    this.listeners.delete(listener);
  }

  private setState(state: FakeContext["state"]) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  resume() {
    this.setState("running");

    return Promise.resolve();
  }

  suspend() {
    this.setState("suspended");

    return Promise.resolve();
  }

  close() {
    this.setState("closed");

    return Promise.resolve();
  }

  /** Move audio time on (only while running) and end what should have ended. */
  advance(seconds: number) {
    if (this.state !== "running") {
      return;
    }

    this.currentTime += seconds;

    for (const node of this.scheduled) {
      const end = node.endsAt();

      if (
        !node.ended &&
        node.startedAt !== null &&
        end !== null &&
        end <= this.currentTime + 1e-9
      ) {
        node.ended = true;
        node.onended?.();
      }
    }
  }
}

/** Files a fake `fetch` serves, by URL: the text is the decoded duration, or `"bad"`. A missing URL is a 404. */
const fakeFetch = (files: Record<string, string>) => (url: string) =>
  Promise.resolve(
    url in files
      ? {
          ok: true,
          status: 200,
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode(files[url]).buffer),
        }
      : { ok: false, status: 404 },
  );

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export {
  Fake3D,
  FakeAnalyser,
  FakeAudioElement,
  FakeContext,
  fakeFetch,
  FakeGain,
  FakePanner,
  FakeSource,
  settle,
};
