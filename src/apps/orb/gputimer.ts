/**
 * Debugging only: GPU time per named pass, from WebGL 2 timer queries where the browser offers
 * them. Results arrive a frame or two late, so they are averaged as they come in.
 */
interface Pending {
  name: string;
  query: WebGLQuery;
}

export interface GpuTimer {
  time(name: string, run: () => void): void;
  /** Average milliseconds per pass since the last reset, and how many were timed. */
  averages(): Record<string, { ms: number; count: number }>;
  reset(): void;
  dispose(): void;
}

/** At most this many queries wait for results; more are dropped untimed. */
const MAX_PENDING = 64;

export const createGpuTimer = (gl: WebGL2RenderingContext): GpuTimer | null => {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2") as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  if (!ext) return null;
  const pending: Pending[] = [];
  const sums = new Map<string, { ms: number; count: number }>();
  const collect = () => {
    while (pending.length > 0) {
      const p = pending[0]!;
      if (!gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE)) break;
      pending.shift();
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        const ns = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
        const s = sums.get(p.name) ?? { ms: 0, count: 0 };
        s.ms += ns / 1e6;
        s.count++;
        sums.set(p.name, s);
      }
      gl.deleteQuery(p.query);
    }
  };
  return {
    time(name, run) {
      collect();
      if (pending.length >= MAX_PENDING) {
        run();
        return;
      }
      const query = gl.createQuery();
      if (!query) {
        run();
        return;
      }
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      run();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push({ name, query });
    },
    averages() {
      collect();
      const out: Record<string, { ms: number; count: number }> = {};
      for (const [k, v] of sums) out[k] = { ms: v.count ? v.ms / v.count : 0, count: v.count };
      return out;
    },
    reset() {
      sums.clear();
    },
    dispose() {
      for (const p of pending) gl.deleteQuery(p.query);
      pending.length = 0;
    },
  };
};
