import { PASS_OFFSETS } from "../blocks";
import { MAX_CLOUDS, MAX_EMITTERS, MAX_HEATS, MAX_STAMPS, MAX_ZONES } from "../shaders/common";
import { GENESIS_FS, MAX_ISLANDS } from "../shaders/genesis";
import { INPUT_FS } from "../shaders/input";
import { HEIGHT_FS, OUTLET_FS, STATS_FS } from "../shaders/probes";
import { STEP_FS } from "../shaders/step";
import {
  bindTexture,
  createColorTarget,
  createStateTarget,
  deleteTarget,
  drawFullscreen,
  type Program,
  type ProgramSet,
  type Target,
} from "./gl";

/** Programs every world uses, compiled as soon as a context exists. */
export const SIM_PROGRAMS = [GENESIS_FS, INPUT_FS, STEP_FS, STATS_FS];

/** How the starting world is built. Lengths are in cells. */
export interface WorldSpec {
  /** "sky" is islands only: the screen above a bank. */
  variant: "sandbox" | "delta" | "sky";
  seed: number;
  /** Islands as (cx, cy, half width, half height) and cones (offset, half width, height, crater). */
  islands: { at: [number, number, number, number]; cone: [number, number, number, number] }[];
  terrain: [number, number, number, number];
  plantScale: number;
}

export type GenesisMode = "build" | "regrow" | "clear";
const MODE_CODE: Record<GenesisMode, number> = { build: 0, regrow: 1, clear: 2 };
const VARIANT_CODE = { sandbox: 0, delta: 1, sky: 2 } as const;

/** Everything one tick needs, filled by the app and reused every tick (no allocation). */
export interface TickInputs {
  emitCount: number;
  /** MAX_EMITTERS vec4s each: segment, (radius, chance, element, lifeLo), (lifeHi, mode, -, -). */
  emitA: Float32Array;
  emitB: Float32Array;
  emitC: Float32Array;
  stampCount: number;
  /** MAX_STAMPS vec4s each: (cx, cy, hx, hy) and (shape, material, op, mirror). */
  stampA: Float32Array;
  stampB: Float32Array;
  sink: number;
  crumble: number;
  fade: number;
  sea: Float32Array;
  cloudCount: number;
  /** MAX_CLOUDS vec4s: (cx, cy, rx, ry) in cells. */
  clouds: Float32Array;
  /** Gadget zones: MAX_ZONES vec4s of (x0, y0, x1, y1) cells and (kind, strength, -, -). */
  zoneCount: number;
  zoneA: Float32Array;
  zoneB: Float32Array;
  /** Heaters and coolers: MAX_HEATS vec4s of (x, y, radius, sign) in cells. */
  heatCount: number;
  heats: Float32Array;
  /** Outlet (bank only): (rows, column count, -, -), and MAX_ZONES column ranges (x0, x1). */
  outlet: Float32Array;
  outletCols: Float32Array;
  wind: number;
  erosion: number;
  /** Chances per tick: open water turning to steam, snow in water melting. */
  evaporation: number;
  melt: number;
  condenseY: number;
  plantScale: number;
}

/** Write one vec4 into a packed uniform array without allocating. */
export const put4 = (arr: Float32Array, i: number, a: number, b: number, c: number, d: number) => {
  const o = i * 4;
  arr[o] = a;
  arr[o + 1] = b;
  arr[o + 2] = c;
  arr[o + 3] = d;
};

export const createTickInputs = (): TickInputs => ({
  emitCount: 0,
  emitA: new Float32Array(MAX_EMITTERS * 4),
  emitB: new Float32Array(MAX_EMITTERS * 4),
  emitC: new Float32Array(MAX_EMITTERS * 4),
  stampCount: 0,
  stampA: new Float32Array(MAX_STAMPS * 4),
  stampB: new Float32Array(MAX_STAMPS * 4),
  sink: 0,
  crumble: 0,
  fade: 0,
  sea: new Float32Array(4),
  cloudCount: 0,
  clouds: new Float32Array(MAX_CLOUDS * 4),
  zoneCount: 0,
  zoneA: new Float32Array(MAX_ZONES * 4),
  zoneB: new Float32Array(MAX_ZONES * 4),
  heatCount: 0,
  heats: new Float32Array(MAX_HEATS * 4),
  outlet: new Float32Array(4),
  outletCols: new Float32Array(MAX_ZONES * 4),
  wind: 0,
  erosion: 0,
  evaporation: 0,
  melt: 0.003,
  condenseY: 1e9,
  plantScale: 1,
});

/**
 * Reads a small target back without stalling: readPixels into a pixel buffer, a fence, and the
 * bytes collected in a later frame once the fence has passed.
 */
interface Readback {
  readonly busy: boolean;
  /** Start reading `target` (already drawn) unless a read is in flight. */
  start(): boolean;
  poll(): Uint8Array | null;
  dispose(): void;
}

const createReadback = (gl: WebGL2RenderingContext, target: Target, integer: boolean): Readback => {
  const bytes = new Uint8Array(target.width * target.height * 4);
  const pbo = gl.createBuffer();
  if (!pbo) throw new Error("pixel buffer allocation failed");
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes.byteLength, gl.STREAM_READ);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  let fence: WebGLSync | null = null;
  return {
    get busy() {
      return fence !== null;
    },
    start() {
      if (fence) return false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readPixels(
        0,
        0,
        target.width,
        target.height,
        integer ? gl.RGBA_INTEGER : gl.RGBA,
        gl.UNSIGNED_BYTE,
        0,
      );
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      return fence !== null;
    },
    poll() {
      if (!fence || gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, bytes);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteSync(fence);
      fence = null;
      return bytes;
    },
    dispose() {
      if (fence) gl.deleteSync(fence);
      fence = null;
      gl.deleteBuffer(pbo);
    },
  };
};

export interface Sim {
  readonly width: number;
  readonly height: number;
  /** The current state texture, for rendering. */
  readonly state: WebGLTexture;
  /** Columns in the heightmap (one per two cells). */
  readonly heightColumns: number;
  /** Rows the outlet captures. */
  readonly outletRows: number;
  genesis(spec: WorldSpec, mode: GenesisMode): void;
  /** One tick: the outlet capture (if asked for and free), the input pass, then the block passes. */
  tick(inputs: TickInputs, passes: number): void;
  /** Start a stats readback if none is in flight. */
  requestStats(): void;
  /** Filled share of the world (0 to 1) from the latest finished readback, or null. */
  pollStats(): number | null;
  requestHeight(scanTop: number): void;
  /** RGBA per heightmap column (see HEIGHT_FS), or null. */
  pollHeight(): Uint8Array | null;
  /** Element ids per outlet cell (RGBA, top row first), or null. */
  pollOutlet(): Uint8Array | null;
  dispose(): void;
}

const STATS_CELLS = 24;
const OUTLET_ROWS = 6;

export const createSim = (
  gl: WebGL2RenderingContext,
  programs: ProgramSet,
  width: number,
  height: number,
): Sim => {
  const genesisProg = programs.get(GENESIS_FS);
  const inputProg = programs.get(INPUT_FS);
  const stepProg = programs.get(STEP_FS);
  const statsProg = programs.get(STATS_FS);
  // Only beetles need the heightmap and only a bank needs the outlet: built on first use, so a
  // plain world compiles two fewer programs. Both are small enough to compile in a frame.
  let heightProg: Program | null = null;
  let outletProg: Program | null = null;
  // Ping-pong: each pass reads `front` and writes `back`, then they swap.
  let front: Target = createStateTarget(gl, width, height);
  let back: Target = createStateTarget(gl, width, height);
  let tickCount = 0;
  let passCount = 0;

  const statsW = Math.max(4, Math.min(STATS_CELLS, Math.round((STATS_CELLS * width) / height)));
  const statsH = Math.max(4, Math.min(STATS_CELLS, Math.round((STATS_CELLS * height) / width)));
  const statsTarget = createColorTarget(gl, statsW, statsH);
  const stats = createReadback(gl, statsTarget, false);
  const heightColumns = Math.ceil(width / 2);
  const heightTarget = createColorTarget(gl, heightColumns, 1);
  const heights = createReadback(gl, heightTarget, false);
  const outletTarget = createStateTarget(gl, width, OUTLET_ROWS);
  const outlet = createReadback(gl, outletTarget, true);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const islandA = new Float32Array(MAX_ISLANDS * 4);
  const islandB = new Float32Array(MAX_ISLANDS * 4);

  const flip = () => {
    const t = front;
    front = back;
    back = t;
  };

  const seedFor = (n: number) => Math.imul(n + 1, 2654435761) >>> 0;

  const setOutlet = (
    p: { u(name: string): WebGLUniformLocation | null },
    inputs: TickInputs,
    rows: number,
  ) => {
    gl.uniform4f(p.u("u_outlet"), rows, inputs.outlet[1] ?? 0, 0, 0);
    gl.uniform4fv(p.u("u_outletCols"), inputs.outletCols);
  };

  return {
    width,
    height,
    heightColumns,
    outletRows: OUTLET_ROWS,
    get state() {
      return front.texture;
    },

    genesis(spec, mode) {
      gl.bindVertexArray(vao);
      const p = genesisProg;
      gl.useProgram(p.program);
      bindTexture(gl, 0, front.texture, p.u("u_state"));
      gl.uniform2i(p.u("u_size"), width, height);
      gl.uniform1f(p.u("u_seed"), spec.seed);
      gl.uniform1i(p.u("u_variant"), VARIANT_CODE[spec.variant]);
      gl.uniform1i(p.u("u_mode"), MODE_CODE[mode]);
      const n = Math.min(MAX_ISLANDS, spec.islands.length);
      islandA.fill(0);
      islandB.fill(0);
      for (let i = 0; i < n; i++) {
        const isl = spec.islands[i];
        if (!isl) continue;
        islandA.set(isl.at, i * 4);
        islandB.set(isl.cone, i * 4);
      }
      gl.uniform1i(p.u("u_islandCount"), n);
      gl.uniform4fv(p.u("u_islandA"), islandA);
      gl.uniform4fv(p.u("u_islandB"), islandB);
      gl.uniform4fv(p.u("u_terrain"), spec.terrain);
      gl.uniform1f(p.u("u_plantScale"), spec.plantScale);
      drawFullscreen(gl, back.fbo, width, height);
      flip();
    },

    tick(inputs, passes) {
      gl.bindVertexArray(vao);
      tickCount++;
      // The outlet only takes cells when a capture can start, so nothing leaves unrecorded.
      let rows = 0;
      if ((inputs.outlet[0] ?? 0) > 0 && !outlet.busy) {
        rows = Math.min(OUTLET_ROWS, inputs.outlet[0] ?? 0);
        outletProg ??= programs.get(OUTLET_FS);
        const op = outletProg;
        gl.useProgram(op.program);
        bindTexture(gl, 0, front.texture, op.u("u_state"));
        gl.uniform2i(op.u("u_size"), width, height);
        setOutlet(op, inputs, rows);
        drawFullscreen(gl, outletTarget.fbo, width, OUTLET_ROWS);
        outlet.start();
      }

      const ip = inputProg;
      gl.useProgram(ip.program);
      bindTexture(gl, 0, front.texture, ip.u("u_state"));
      gl.uniform2i(ip.u("u_size"), width, height);
      gl.uniform1ui(ip.u("u_seed"), seedFor(tickCount * 64));
      gl.uniform1i(ip.u("u_emitCount"), inputs.emitCount);
      gl.uniform4fv(ip.u("u_emitA"), inputs.emitA);
      gl.uniform4fv(ip.u("u_emitB"), inputs.emitB);
      gl.uniform4fv(ip.u("u_emitC"), inputs.emitC);
      gl.uniform1i(ip.u("u_stampCount"), inputs.stampCount);
      gl.uniform4fv(ip.u("u_stampA"), inputs.stampA);
      gl.uniform4fv(ip.u("u_stampB"), inputs.stampB);
      gl.uniform1f(ip.u("u_sink"), inputs.sink);
      gl.uniform1f(ip.u("u_crumble"), inputs.crumble);
      gl.uniform1f(ip.u("u_fade"), inputs.fade);
      gl.uniform4fv(ip.u("u_sea"), inputs.sea);
      gl.uniform1i(ip.u("u_cloudCount"), inputs.cloudCount);
      gl.uniform4fv(ip.u("u_cloud"), inputs.clouds);
      gl.uniform1f(ip.u("u_evaporation"), inputs.evaporation);
      gl.uniform1f(ip.u("u_melt"), inputs.melt);
      gl.uniform1i(ip.u("u_heatCount"), inputs.heatCount);
      gl.uniform4fv(ip.u("u_heat"), inputs.heats);
      setOutlet(ip, inputs, rows);
      drawFullscreen(gl, back.fbo, width, height);
      flip();

      const sp = stepProg;
      gl.useProgram(sp.program);
      gl.uniform2i(sp.u("u_size"), width, height);
      gl.uniform1f(sp.u("u_wind"), inputs.wind);
      gl.uniform1f(sp.u("u_erosion"), inputs.erosion);
      gl.uniform1f(sp.u("u_condenseY"), inputs.condenseY);
      gl.uniform1f(sp.u("u_plantScale"), inputs.plantScale);
      gl.uniform1i(sp.u("u_zoneCount"), inputs.zoneCount);
      gl.uniform4fv(sp.u("u_zoneA"), inputs.zoneA);
      gl.uniform4fv(sp.u("u_zoneB"), inputs.zoneB);
      for (let i = 0; i < passes; i++) {
        const [ox, oy] = PASS_OFFSETS[passCount % PASS_OFFSETS.length] ?? [0, 0];
        passCount = (passCount + 1) % 1_000_000;
        bindTexture(gl, 0, front.texture, sp.u("u_state"));
        gl.uniform2i(sp.u("u_offset"), ox, oy);
        gl.uniform1ui(sp.u("u_seed"), seedFor(tickCount * 64 + i + 1));
        drawFullscreen(gl, back.fbo, width, height);
        flip();
      }
      tickCount %= 1 << 24;
    },

    requestStats() {
      if (stats.busy) return;
      gl.bindVertexArray(vao);
      gl.useProgram(statsProg.program);
      bindTexture(gl, 0, front.texture, statsProg.u("u_state"));
      gl.uniform2i(statsProg.u("u_size"), width, height);
      gl.uniform2i(statsProg.u("u_out"), statsW, statsH);
      drawFullscreen(gl, statsTarget.fbo, statsW, statsH);
      stats.start();
    },

    pollStats() {
      const bytes = stats.poll();
      if (!bytes) return null;
      let filled = 0;
      let open = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        filled += (bytes[i] ?? 0) / 255;
        open += 1 - (bytes[i + 1] ?? 0) / 255;
      }
      return open > 0 ? Math.min(1, filled / open) : 0;
    },

    requestHeight(scanTop) {
      if (heights.busy) return;
      gl.bindVertexArray(vao);
      heightProg ??= programs.get(HEIGHT_FS);
      const hp = heightProg;
      gl.useProgram(hp.program);
      bindTexture(gl, 0, front.texture, hp.u("u_state"));
      gl.uniform2i(hp.u("u_size"), width, height);
      gl.uniform1i(hp.u("u_scanTop"), Math.max(0, Math.min(height - 1, Math.round(scanTop))));
      drawFullscreen(gl, heightTarget.fbo, heightColumns, 1);
      heights.start();
    },

    pollHeight: () => heights.poll(),
    pollOutlet: () => outlet.poll(),

    dispose() {
      for (const r of [stats, heights, outlet]) r.dispose();
      for (const t of [statsTarget, heightTarget, outletTarget, front, back]) deleteTarget(gl, t);
      gl.deleteVertexArray(vao);
    },
  };
};

export { MAX_CLOUDS, MAX_EMITTERS, MAX_HEATS, MAX_STAMPS, MAX_ZONES };
