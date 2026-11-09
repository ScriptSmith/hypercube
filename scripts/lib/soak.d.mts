export interface SoakSample {
  /** ms since the first sample. */
  t: number;
  /** usedJSHeapSize in bytes, after a forced garbage collection. */
  heap: number;
  dom: number;
}

export interface Growth {
  base: number;
  end: number;
  growth: number;
  limit: number;
  perHour: number;
}

export interface SoakVerdict {
  ok: boolean;
  warmup: number;
  heap: Growth | null;
  dom: Growth | null;
  reasons: string[];
}

export const HEAP_LIMIT: { fraction: number; bytes: number };
export const DOM_LIMIT: { fraction: number; nodes: number };
export const WARMUP_MS: number;
export function assessSoak(samples: SoakSample[], durationMs: number): SoakVerdict;
