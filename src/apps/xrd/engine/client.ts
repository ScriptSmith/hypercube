/**
 * The engine on the main thread: views that ask the frame's worker for pictures and hold the
 * latest one, coloured, in a small canvas ready to draw.
 *
 * A view sends at most one job at a time and keeps only the newest request waiting, so a fast
 * drag never queues up work; a request whose key matches the last one sends nothing. Jobs are
 * built only when they are about to be sent. The worker is started on the first job. If a worker
 * can't start at all, jobs run on the main thread after a timeout, so the page still works.
 */
import { COLOR } from "../config";
import type { EngineJob, Result } from "./pattern";
import type { WorkerRequest, WorkerResponse } from "./worker";

export type Tint = "recip" | "real" | "grey";

export interface PatternView {
  /** Ask for the picture `key` names; `build` runs only if it is sent. */
  want(key: string, build: () => EngineJob): void;
  /** The newest picture, n x n, or null before the first arrives. */
  readonly canvas: HTMLCanvasElement | null;
  /** Key of the picture in `canvas`. */
  readonly shown: string | null;
  /** Key last asked for. */
  readonly wanted: string | null;
  /** Counts pictures received, so a drawing can tell when to redraw. */
  readonly version: number;
  readonly peak: number;
  /**
   * Draw the picture into `rect` (in the context's current units), smoothed. A pattern view adds
   * the beam stop's arm, from the centre to the bottom edge.
   */
  draw(
    g: CanvasRenderingContext2D,
    rect: { x: number; y: number; width: number; height: number },
    opts?: { alpha?: number; stopArm?: boolean },
  ): void;
  release(): void;
}

export interface Engine {
  view(opts?: { tint?: Tint }): PatternView;
  /** Jobs run so far, and their mean time in ms. */
  stats(): { jobs: number; ms: number; views: number };
  dispose(): void;
}

/** Fewest ms between two jobs from one view (about 30 a second while dragging). */
export const MIN_GAP_MS = 33;
const MAX_VIEWS = 64;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const hex = (c: string): [number, number, number] => {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Dark to the tint's colour to near white, for 256 levels, as RGBA. */
export const lutFor = (tint: Tint): Uint8ClampedArray => {
  const base: [number, number, number] =
    tint === "recip" ? hex(COLOR.recip) : tint === "real" ? hex(COLOR.real) : [170, 178, 196];
  const dark: [number, number, number] = [6, 8, 14];
  const light: [number, number, number] = [255, 250, 238];
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const c =
      t < 0.6
        ? dark.map((d, k) => lerp(d, base[k]!, t / 0.6))
        : base.map((b, k) => lerp(b, light[k]!, (t - 0.6) / 0.4));
    lut[i * 4] = c[0]!;
    lut[i * 4 + 1] = c[1]!;
    lut[i * 4 + 2] = c[2]!;
    lut[i * 4 + 3] = 255;
  }
  return lut;
};

const LUTS = new Map<Tint, Uint8ClampedArray>();
const lut = (t: Tint) => {
  let l = LUTS.get(t);
  if (!l) {
    l = lutFor(t);
    LUTS.set(t, l);
  }
  return l;
};

const transfers = (job: EngineJob): Transferable[] => {
  const out: Transferable[] = [];
  const add = (s: EngineJob["source"] | undefined) => {
    if (!s) return;
    if ("density" in s) out.push(s.density.buffer);
    else {
      out.push(s.atoms.data.buffer);
      if ("angles" in s) out.push(s.angles.buffer);
    }
  };
  add(job.source);
  if (job.op === "synth") {
    add(job.phases);
    if (job.keep) out.push(job.keep.buffer);
  }
  return [...new Set(out)];
};

export const createEngine = (
  makeWorker: () => Worker = () =>
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
): Engine => {
  let worker: Worker | null = null;
  let failed = false;
  let nextId = 1;
  let jobs = 0;
  let totalMs = 0;
  let disposed = false;
  const waiting = new Map<number, (r: Result | null) => void>();
  const views = new Set<ViewImpl>();
  const timers = new Set<number>();

  const ensure = (): Worker | null => {
    if (worker || failed) return worker;
    try {
      worker = makeWorker();
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        const done = waiting.get(m.id);
        if (!done) return;
        waiting.delete(m.id);
        if (m.ok) {
          jobs++;
          totalMs += m.ms;
          done({ bytes: m.bytes, peak: m.peak });
        } else done(null);
      };
      worker.onerror = () => {
        for (const done of waiting.values()) done(null);
        waiting.clear();
      };
    } catch {
      failed = true;
      worker = null;
    }
    return worker;
  };

  const submit = (job: EngineJob, done: (r: Result | null) => void) => {
    if (disposed) return;
    const w = ensure();
    if (w) {
      const id = nextId++;
      waiting.set(id, done);
      w.postMessage({ id, job } satisfies WorkerRequest, transfers(job));
      return;
    }
    // No worker: run here, later, so the caller's frame isn't held up.
    const t = window.setTimeout(() => {
      timers.delete(t);
      if (disposed) return;
      void import("./pattern").then((m) => {
        if (disposed) return;
        const t0 = performance.now();
        try {
          const r = m.run(job);
          jobs++;
          totalMs += performance.now() - t0;
          done(r);
        } catch {
          done(null);
        }
      });
    }, 0);
    timers.add(t);
  };

  class ViewImpl implements PatternView {
    canvas: HTMLCanvasElement | null = null;
    shown: string | null = null;
    wanted: string | null = null;
    version = 0;
    peak = 0;
    private pending: { key: string; build: () => EngineJob } | null = null;
    private busy = false;
    private lastSent = Number.NEGATIVE_INFINITY;
    private timer = 0;
    private gone = false;
    private n = 0;
    private image: ImageData | null = null;
    constructor(private readonly tint: Tint) {}

    want(key: string, build: () => EngineJob) {
      if (this.gone || key === this.wanted) return;
      this.wanted = key;
      this.pending = { key, build };
      this.pump();
    }

    private pump() {
      if (this.gone || this.busy || !this.pending) return;
      const wait = this.lastSent + MIN_GAP_MS - performance.now();
      if (wait > 0) {
        if (!this.timer) {
          this.timer = window.setTimeout(() => {
            timers.delete(this.timer);
            this.timer = 0;
            this.pump();
          }, wait);
          timers.add(this.timer);
        }
        return;
      }
      const { key, build } = this.pending;
      this.pending = null;
      let job: EngineJob;
      try {
        job = build();
      } catch (err) {
        console.warn("[xrd] engine job failed to build", err);
        return;
      }
      this.busy = true;
      this.lastSent = performance.now();
      const n = job.n;
      submit(job, (r) => {
        this.busy = false;
        if (this.gone) return;
        if (r) this.accept(key, n, r);
        this.pump();
      });
    }

    private accept(key: string, n: number, r: Result) {
      if (!this.canvas || this.n !== n) {
        this.canvas = document.createElement("canvas");
        this.canvas.width = n;
        this.canvas.height = n;
        this.n = n;
        this.image = new ImageData(n, n);
      }
      const px = this.image!.data;
      const table = lut(this.tint);
      const b = r.bytes;
      for (let i = 0; i < n * n; i++) {
        const k = b[i]! * 4;
        const j = i * 4;
        px[j] = table[k]!;
        px[j + 1] = table[k + 1]!;
        px[j + 2] = table[k + 2]!;
        px[j + 3] = 255;
      }
      this.canvas.getContext("2d")?.putImageData(this.image!, 0, 0);
      this.shown = key;
      this.peak = r.peak;
      this.version++;
    }

    draw(
      g: CanvasRenderingContext2D,
      rect: { x: number; y: number; width: number; height: number },
      opts: { alpha?: number; stopArm?: boolean } = {},
    ) {
      if (!this.canvas) return;
      g.save();
      g.globalAlpha = opts.alpha ?? 1;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(this.canvas, rect.x, rect.y, rect.width, rect.height);
      if (opts.stopArm ?? this.tint === "recip") {
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const w = Math.max(2, rect.width * 0.018);
        g.fillStyle = "rgba(20,26,40,0.95)";
        g.fillRect(cx - w / 2, cy, w, rect.y + rect.height - cy);
        g.beginPath();
        g.arc(cx, cy, w * 1.6, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }

    release() {
      this.gone = true;
      this.pending = null;
      clearTimeout(this.timer);
      timers.delete(this.timer);
      this.canvas = null;
      this.image = null;
      views.delete(this);
    }
  }

  return {
    view(opts = {}) {
      if (views.size >= MAX_VIEWS) {
        // Views belong to chapters, which release them; this guards against a leak.
        const first = views.values().next().value;
        first?.release();
      }
      const v = new ViewImpl(opts.tint ?? "recip");
      views.add(v);
      return v;
    },
    stats() {
      return { jobs, ms: jobs > 0 ? totalMs / jobs : 0, views: views.size };
    },
    dispose() {
      disposed = true;
      for (const v of views) v.release();
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const done of waiting.values()) done(null);
      waiting.clear();
      worker?.terminate();
      worker = null;
    },
  };
};
