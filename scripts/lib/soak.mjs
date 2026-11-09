// The soak test's verdict, kept apart from the browser so it can be unit tested.

const MB = 1024 * 1024;

/** Heap may grow by this fraction of its baseline or this many bytes, whichever is larger. */
export const HEAP_LIMIT = { fraction: 0.1, bytes: 2 * MB };
/** DOM nodes may grow by this fraction of the baseline or this many nodes, whichever is larger. */
export const DOM_LIMIT = { fraction: 0.1, nodes: 50 };
/** Growth before this is caches, pools and JIT filling up, not a leak. */
export const WARMUP_MS = 5 * 60_000;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Least-squares slope of y against t, per hour. */
const perHour = (points) => {
  const n = points.length;
  if (n < 2) return 0;
  const mt = points.reduce((a, p) => a + p.t, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - mt) * (p.y - my);
    den += (p.t - mt) ** 2;
  }
  return den ? (num / den) * 3_600_000 : 0;
};

const measure = (after, key, limit) => {
  const base = median(after.slice(0, 3).map((s) => s[key]));
  const end = median(after.slice(-3).map((s) => s[key]));
  return {
    base,
    end,
    growth: end - base,
    limit: Math.max(limit, base * (key === "heap" ? HEAP_LIMIT : DOM_LIMIT).fraction),
    perHour: perHour(after.map((s) => ({ t: s.t, y: s[key] }))),
  };
};

/**
 * Compare the median of the first three samples after warm-up (five minutes, or a quarter of
 * a shorter run) with the median of the last three. Samples are `{ t, heap, dom }` with `t` in
 * ms from the start and `heap` in bytes, taken after a forced garbage collection.
 */
export const assessSoak = (samples, durationMs) => {
  const warmup = Math.min(WARMUP_MS, durationMs / 4);
  const after = samples.filter((s) => s.t >= warmup);
  if (after.length < 2) {
    return { ok: false, warmup, heap: null, dom: null, reasons: ["too few samples after warm-up"] };
  }
  const heap = measure(after, "heap", HEAP_LIMIT.bytes);
  const dom = measure(after, "dom", DOM_LIMIT.nodes);
  const reasons = [];
  if (heap.growth > heap.limit) {
    reasons.push(
      `heap grew ${(heap.growth / MB).toFixed(2)} MB, over the ${(heap.limit / MB).toFixed(2)} MB limit`,
    );
  }
  if (dom.growth > dom.limit) {
    reasons.push(`DOM grew ${dom.growth} nodes, over the ${Math.round(dom.limit)} node limit`);
  }
  return { ok: reasons.length === 0, warmup, heap, dom, reasons };
};
