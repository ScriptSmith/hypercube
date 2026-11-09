/** Measurement helpers for the diagnostics app. Everything here has a fixed size. */

export interface Ring {
  push(value: number): void;
  readonly length: number;
  readonly capacity: number;
  /** Oldest first. */
  values(): number[];
  mean(): number;
  max(): number;
  median(): number;
  clear(): void;
}

/** A fixed-capacity ring of numbers that overwrites its oldest entry, so it never grows. */
export const createRing = (capacity: number): Ring => {
  const data = new Float64Array(capacity);
  let start = 0;
  let length = 0;
  const values = () => Array.from({ length }, (_, i) => data[(start + i) % capacity] ?? 0);
  return {
    push(value) {
      if (length < capacity) {
        data[(start + length) % capacity] = value;
        length++;
      } else {
        data[start] = value;
        start = (start + 1) % capacity;
      }
    },
    get length() {
      return length;
    },
    capacity,
    values,
    mean() {
      if (length === 0) return 0;
      let sum = 0;
      for (let i = 0; i < length; i++) sum += data[(start + i) % capacity] ?? 0;
      return sum / length;
    },
    max() {
      let m = 0;
      for (let i = 0; i < length; i++) m = Math.max(m, data[(start + i) % capacity] ?? 0);
      return m;
    },
    median() {
      if (length === 0) return 0;
      const sorted = values().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    },
    clear() {
      start = 0;
      length = 0;
    },
  };
};

export type Tone = "good" | "warn" | "bad" | "plain";

export interface ThrottleInput {
  /** Time since the last animation frame, ms. */
  sinceFrame: number;
  /** Median lateness of recent timers, ms. */
  timerLate: number;
  hidden: boolean;
}

/**
 * Thresholds well above normal jitter, so only real throttling is flagged. Throttled timers
 * run on one-second boundaries, so their median lateness is hundreds of ms; a merely busy
 * page (such as the simulator running many frames) stays well under this.
 */
export const STALL_MS = 500;
export const LATE_TIMER_MS = 200;
/** Lateness worth a warning, though not throttling. */
export const SLOW_TIMER_MS = 50;

export const assessThrottle = (t: ThrottleInput): { throttled: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  if (t.hidden) reasons.push("page hidden");
  if (t.sinceFrame > STALL_MS) {
    reasons.push(`no animation frame for ${(t.sinceFrame / 1000).toFixed(1)} s`);
  }
  if (t.timerLate > LATE_TIMER_MS) reasons.push(`timers ${Math.round(t.timerLate)} ms late`);
  return { throttled: reasons.length > 0, reasons };
};

export const fpsTone = (fps: number): Tone => (fps >= 55 ? "good" : fps >= 30 ? "warn" : "bad");

/** "host/host" pairs mean a direct LAN path; anything through a relay is slow and costly. */
export const candidateTone = (pair: string): Tone => {
  const p = pair.toLowerCase();
  if (p.includes("relay")) return "bad";
  if (p === "host/host") return "good";
  return "warn";
};

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export const formatDuration = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
};

/** Browser engine versions worth knowing at the venue, e.g. "Chrome 140 · Electron 38.1". */
export const browserVersion = (ua: string): string => {
  const parts: string[] = [];
  const chrome = /Chrom(?:e|ium)\/(\d+)/.exec(ua);
  if (chrome) parts.push(`Chrome ${chrome[1]}`);
  const electron = /Electron\/([\d.]+)/.exec(ua);
  if (electron) parts.push(`Electron ${electron[1]}`);
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) parts.push(`Firefox ${firefox[1]}`);
  const safari = !chrome && /Version\/([\d.]+).*Safari/.exec(ua);
  if (safari) parts.push(`Safari ${safari[1]}`);
  const os = /Windows NT [\d.]+|Mac OS X [\d_]+|Android [\d.]+|iPhone OS [\d_]+|Linux/.exec(ua);
  if (os) parts.push(os[0].replace(/_/g, "."));
  return parts.join(" · ") || "unknown";
};

export interface GpuInfo {
  webgl2: boolean;
  renderer: string | null;
  vendor: string | null;
  maxTexture: number | null;
}

/** Probe WebGL once, then release the context so it doesn't count against the page's limit. */
export const probeGpu = (): GpuInfo => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const gl2 = canvas.getContext("webgl2");
  const gl = gl2 ?? canvas.getContext("webgl");
  if (!gl) return { webgl2: false, renderer: null, vendor: null, maxTexture: null };
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const info: GpuInfo = {
    webgl2: gl2 !== null,
    renderer: String(
      debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    ),
    vendor: String(
      debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    ),
    maxTexture: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
  };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return info;
};

/** Whether a WebGPU adapter is available. WebGPU is an optional upgrade at the venue. */
export const probeWebGpu = async (): Promise<string> => {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return "not in this browser";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "adapter available" : "no adapter";
  } catch {
    return "request failed";
  }
};
