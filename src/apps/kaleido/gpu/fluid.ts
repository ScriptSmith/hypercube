/**
 * A stable-fluids solver on the GPU, written from Stam (1999, "Stable Fluids"), Fedkiw, Stam and
 * Jensen (2001, buoyancy and vorticity confinement) and Bridson's "Fluid Simulation for Computer
 * Graphics". Velocity and pressure live on a coarse grid of square cells; ink (RGB) and
 * temperature (alpha) share a finer texture so the ink keeps its wisps.
 *
 * One step: pours (mix velocity, ink and heat into capsules along each finger's path), forces
 * (vorticity confinement from the curl, buoyancy from temperature, a gentle travelling swirl, drag),
 * semi-Lagrangian advection of velocity, divergence, Jacobi pressure iterations (warm started from
 * the last step), subtraction of the pressure gradient, then MacCormack advection of ink and heat
 * (Selle et al. 2008, limited to the neighbourhood the forward step sampled so it can't make new
 * extremes) with fading, cooling, a sink under the day's layers and a soft cap on how dense ink
 * can get, so a busy wall can't saturate.
 *
 * Velocities are stored in cells a second. Positions and physics come in venue px and seconds
 * (y down, as everywhere else in the app) and are converted here, so the same numbers behave the
 * same at any grid size. The sides and floor are walls. The top is a wall (a lid) or open
 * (pressure 0, ink flows out and clean water in), for a touch frame under a screen.
 */
import {
  bindTexture,
  clearTarget,
  createPair,
  createProgram,
  createReadback,
  createTarget,
  deleteTarget,
  drawFullscreen,
  FULLSCREEN_VS,
  type Pair,
  type Program,
  type Readback,
  readFloats,
  type Target,
} from "./gl";

export const MAX_SPLATS = 32;
export const SETTLE_COLUMNS = 32;
/** Ink in the settle readback is encoded as sqrt(avg / SETTLE_SCALE). */
export const SETTLE_SCALE = 2;

export interface FluidSpec {
  /** Venue px. */
  width: number;
  height: number;
  /** Venue px per velocity cell. */
  cell: number;
  /** Ink texels per velocity cell along each axis. */
  dyeScale: number;
  iterations: number;
  /** Weight of the MacCormack correction for ink, 0 (plain semi-Lagrangian) to 1; default 0.5. */
  correction?: number;
}

export interface Physics {
  /** Venue px/s^2 of lift per unit of temperature. */
  buoyancy: number;
  /** Vorticity confinement strength, 1/s. */
  vorticity: number;
  /** Travelling swirl force, venue px/s^2, and its wavelength in venue px. */
  swirl: number;
  swirlScale: number;
  /** Seconds for velocity, ink and heat to fall to 1/e. */
  drag: number;
  inkLife: number;
  cool: number;
  /** Total ink (r + g + b) above which a texel is pulled back down, and how fast (per second). */
  cap: number;
  capRate: number;
  /**
   * Ink (r + g + b) taken from every texel each second, so faint wisps clear away and the water
   * between plumes stays clean instead of filling with a dim haze of mixed colours.
   */
  clear: number;
  /** Venue px/s; speeds are clipped here. */
  maxSpeed: number;
}

/** One pour this step, in venue px with y down. Strengths are blend weights for this step. */
export interface Splat {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
  vx: number;
  vy: number;
  push: number;
  rgb: readonly [number, number, number];
  ink: number;
  temp: number;
  heat: number;
}

export interface StepOptions {
  dt: number;
  time: number;
  open: boolean;
  /** Ink is drawn out above `lo` (venue px from the top), fully above `hi`, at `rate` per second. */
  sink: { lo: number; hi: number; rate: number };
  physics: Physics;
}

export interface Fluid {
  readonly nx: number;
  readonly ny: number;
  readonly mx: number;
  readonly my: number;
  readonly dye: Target;
  readonly velocity: Target;
  step(splats: readonly Splat[], opts: StepOptions): void;
  /** Measure ink in the sink zone per column and start reading it back. */
  measure(sink: StepOptions["sink"]): boolean;
  /**
   * Once a measurement arrives: the sink zone's mean ink per column (RGB per column, decoded)
   * and the whole frame's mean ink (r + g + b).
   */
  pollMeasure(): { columns: Float32Array; mean: number } | null;
  clear(): void;
  /** Debugging and tests: stall and read the ink and velocity textures. */
  readDye(): Float32Array;
  readVelocity(): Float32Array;
  readField(name: "pressure" | "divergence"): Float32Array;
  dispose(): void;
}

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 o;
`;

const CAPSULE = `
float capsule(vec2 p, vec4 s, float r) {
  vec2 ab = s.zw - s.xy;
  float t = clamp(dot(p - s.xy, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
  vec2 d = p - (s.xy + ab * t);
  return exp(-dot(d, d) / (r * r));
}
`;

const SPLAT_VEL = `${HEAD}
uniform sampler2D u_vel;
uniform vec2 u_size;
uniform vec2 u_cellsPerPx;
uniform int u_n;
uniform vec4 u_seg[${MAX_SPLATS}];
uniform vec4 u_jet[${MAX_SPLATS}];
${CAPSULE}
void main() {
  vec2 p = v_uv * u_size;
  vec2 v = texture(u_vel, v_uv).xy;
  for (int i = 0; i < ${MAX_SPLATS}; i++) {
    if (i >= u_n) break;
    vec4 j = u_jet[i];
    float g = capsule(p, u_seg[i], j.x);
    if (g < 0.002) continue;
    v = mix(v, j.yz * u_cellsPerPx, clamp(g * j.w, 0.0, 1.0));
  }
  o = vec4(v, 0.0, 1.0);
}`;

const SPLAT_DYE = `${HEAD}
uniform sampler2D u_dye;
uniform vec2 u_size;
uniform int u_n;
uniform vec4 u_seg[${MAX_SPLATS}];
uniform vec4 u_ink[${MAX_SPLATS}];
uniform vec4 u_heat[${MAX_SPLATS}];
${CAPSULE}
void main() {
  vec2 p = v_uv * u_size;
  vec4 d = texture(u_dye, v_uv);
  for (int i = 0; i < ${MAX_SPLATS}; i++) {
    if (i >= u_n) break;
    vec4 k = u_ink[i];
    vec4 h = u_heat[i];
    float g = capsule(p, u_seg[i], k.w);
    if (g < 0.002) continue;
    d.rgb = mix(d.rgb, k.rgb, clamp(g * h.y, 0.0, 1.0));
    d.a = max(d.a, mix(d.a, h.x, clamp(g * h.z, 0.0, 1.0)));
  }
  o = d;
}`;

const FORCE = `${HEAD}
uniform sampler2D u_vel;
uniform sampler2D u_dye;
uniform vec2 u_texel;
uniform vec2 u_cells;
uniform float u_dt;
uniform float u_eps;
uniform float u_beta;
uniform float u_keep;
uniform float u_swirl;
uniform float u_swirlK;
uniform float u_time;
uniform float u_vmax;

// A slowly travelling swirl: the curl of a sum of three plane waves, so it adds no divergence.
vec2 swirl(vec2 p, float t) {
  const vec2 a1 = vec2(0.80, 0.60);
  const vec2 a2 = vec2(-0.55, 0.83) * 1.37;
  const vec2 a3 = vec2(0.28, -0.96) * 0.71;
  vec2 g = a1 * cos(dot(a1, p) + 0.31 * t)
    + 0.7 * a2 * cos(dot(a2, p) - 0.23 * t + 1.7)
    + 0.5 * a3 * cos(dot(a3, p) + 0.17 * t + 4.1);
  return vec2(g.y, -g.x);
}

float curlAt(vec2 uv) {
  float L = texture(u_vel, uv - vec2(u_texel.x, 0.0)).y;
  float R = texture(u_vel, uv + vec2(u_texel.x, 0.0)).y;
  float B = texture(u_vel, uv - vec2(0.0, u_texel.y)).x;
  float T = texture(u_vel, uv + vec2(0.0, u_texel.y)).x;
  return 0.5 * ((R - L) - (T - B));
}

void main() {
  vec2 v = texture(u_vel, v_uv).xy;
  float c = curlAt(v_uv);
  // Beyond a wall there is no flow to swirl: use this cell's own curl there.
  float cL = v_uv.x < u_texel.x ? abs(c) : abs(curlAt(v_uv - vec2(u_texel.x, 0.0)));
  float cR = v_uv.x > 1.0 - u_texel.x ? abs(c) : abs(curlAt(v_uv + vec2(u_texel.x, 0.0)));
  float cB = v_uv.y < u_texel.y ? abs(c) : abs(curlAt(v_uv - vec2(0.0, u_texel.y)));
  float cT = v_uv.y > 1.0 - u_texel.y ? abs(c) : abs(curlAt(v_uv + vec2(0.0, u_texel.y)));
  vec2 grad = 0.5 * vec2(cR - cL, cT - cB);
  vec2 N = grad / (length(grad) + 1e-4);
  vec2 f = u_eps * c * vec2(N.y, -N.x);
  f.y += u_beta * texture(u_dye, v_uv).a;
  f += u_swirl * swirl(v_uv * u_cells * u_swirlK, u_time);
  v = (v + u_dt * f) * u_keep;
  float s = length(v);
  if (s > u_vmax) v *= u_vmax / s;
  o = vec4(v, 0.0, 1.0);
}`;

const ADVECT_VEL = `${HEAD}
uniform sampler2D u_vel;
uniform vec2 u_texel;
uniform float u_dt;
void main() {
  vec2 v = texture(u_vel, v_uv).xy;
  o = vec4(texture(u_vel, v_uv - u_dt * v * u_texel).xy, 0.0, 1.0);
}`;

const EDGES = `
bool atLeft() { return v_uv.x < u_texel.x; }
bool atRight() { return v_uv.x > 1.0 - u_texel.x; }
bool atBottom() { return v_uv.y < u_texel.y; }
bool atTop() { return v_uv.y > 1.0 - u_texel.y; }
`;

const DIVERGENCE = `${HEAD}
uniform sampler2D u_vel;
uniform vec2 u_texel;
uniform float u_open;
${EDGES}
void main() {
  vec2 C = texture(u_vel, v_uv).xy;
  float L = texture(u_vel, v_uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_vel, v_uv + vec2(u_texel.x, 0.0)).x;
  float B = texture(u_vel, v_uv - vec2(0.0, u_texel.y)).y;
  float T = texture(u_vel, v_uv + vec2(0.0, u_texel.y)).y;
  if (atLeft()) L = -C.x;
  if (atRight()) R = -C.x;
  if (atBottom()) B = -C.y;
  if (atTop() && u_open < 0.5) T = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`;

const JACOBI = `${HEAD}
uniform sampler2D u_p;
uniform sampler2D u_div;
uniform vec2 u_texel;
uniform float u_open;
${EDGES}
void main() {
  float C = texture(u_p, v_uv).x;
  float L = atLeft() ? C : texture(u_p, v_uv - vec2(u_texel.x, 0.0)).x;
  float R = atRight() ? C : texture(u_p, v_uv + vec2(u_texel.x, 0.0)).x;
  float B = atBottom() ? C : texture(u_p, v_uv - vec2(0.0, u_texel.y)).x;
  float T = atTop() ? (u_open > 0.5 ? 0.0 : C) : texture(u_p, v_uv + vec2(0.0, u_texel.y)).x;
  float d = texture(u_div, v_uv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT = `${HEAD}
uniform sampler2D u_p;
uniform sampler2D u_vel;
uniform vec2 u_texel;
uniform float u_open;
${EDGES}
void main() {
  float C = texture(u_p, v_uv).x;
  float L = atLeft() ? C : texture(u_p, v_uv - vec2(u_texel.x, 0.0)).x;
  float R = atRight() ? C : texture(u_p, v_uv + vec2(u_texel.x, 0.0)).x;
  float B = atBottom() ? C : texture(u_p, v_uv - vec2(0.0, u_texel.y)).x;
  float T = atTop() ? (u_open > 0.5 ? 0.0 : C) : texture(u_p, v_uv + vec2(0.0, u_texel.y)).x;
  vec2 v = texture(u_vel, v_uv).xy - 0.5 * vec2(R - L, T - B);
  if (atLeft() || atRight()) v.x = 0.0;
  if (atBottom()) v.y = 0.0;
  if (atTop() && u_open < 0.5) v.y = 0.0;
  o = vec4(v, 0.0, 1.0);
}`;

const ADVECT_DYE = `${HEAD}
uniform sampler2D u_dye;
uniform sampler2D u_vel;
uniform vec2 u_velTexel;
uniform float u_dt;
uniform float u_open;
void main() {
  vec2 v = texture(u_vel, v_uv).xy;
  vec2 back = v_uv - u_dt * v * u_velTexel;
  o = (back.y > 1.0 && u_open > 0.5) ? vec4(0.0) : texture(u_dye, back);
}`;

const CORRECT_DYE = `${HEAD}
uniform sampler2D u_dye;
uniform sampler2D u_tmp;
uniform sampler2D u_vel;
uniform vec2 u_velTexel;
uniform vec2 u_dyeSize;
uniform float u_dt;
uniform float u_open;
uniform float u_keepInk;
uniform float u_keepHeat;
uniform float u_cap;
uniform float u_capPull;
uniform vec3 u_sink;
uniform float u_mc;
uniform float u_clear;
void main() {
  vec2 disp = u_dt * texture(u_vel, v_uv).xy * u_velTexel;
  vec2 back = v_uv - disp;
  vec4 fwd = texture(u_tmp, v_uv);
  vec4 r;
  if ((back.y > 1.0 && u_open > 0.5) || u_mc <= 0.0) {
    r = fwd;
  } else {
    vec4 bwd = texture(u_tmp, v_uv + disp);
    vec4 orig = texture(u_dye, v_uv);
    r = fwd + 0.5 * u_mc * (orig - bwd);
    vec2 st = back * u_dyeSize - 0.5;
    ivec2 i0 = ivec2(floor(st));
    ivec2 hi = ivec2(u_dyeSize) - 1;
    vec4 a = texelFetch(u_dye, clamp(i0, ivec2(0), hi), 0);
    vec4 b = texelFetch(u_dye, clamp(i0 + ivec2(1, 0), ivec2(0), hi), 0);
    vec4 c = texelFetch(u_dye, clamp(i0 + ivec2(0, 1), ivec2(0), hi), 0);
    vec4 e = texelFetch(u_dye, clamp(i0 + ivec2(1, 1), ivec2(0), hi), 0);
    r = clamp(r, min(min(a, b), min(c, e)), max(max(a, b), max(c, e)));
  }
  r = max(r, vec4(0.0));
  float w = clamp((v_uv.y - u_sink.x) / max(u_sink.y - u_sink.x, 1e-4), 0.0, 1.0);
  float k = exp(-u_dt * u_sink.z * w);
  r.rgb *= u_keepInk * k;
  r.a *= u_keepHeat * k * k;
  float s = r.r + r.g + r.b;
  if (s > u_cap) r.rgb *= mix(1.0, u_cap / s, u_capPull);
  r.rgb *= max(0.0, 1.0 - u_dt * u_clear / max(s, 1e-4));
  o = r;
}`;

const MEASURE = `${HEAD}
uniform sampler2D u_dye;
uniform vec2 u_sink;
void main() {
  float col = floor(gl_FragCoord.x);
  vec3 sum = vec3(0.0);
  if (col >= ${SETTLE_COLUMNS}.0) {
    // The last texel: the whole frame's mean ink.
    for (int i = 0; i < 12; i++) {
      for (int j = 0; j < 12; j++) {
        vec2 uv = (vec2(float(i), float(j)) + 0.5) / 12.0;
        vec3 d = max(texture(u_dye, uv).rgb, vec3(0.0));
        sum += vec3(d.r + d.g + d.b);
      }
    }
    o = vec4(sqrt(clamp(sum / 144.0 / ${SETTLE_SCALE}.0, 0.0, 1.0)), 1.0);
    return;
  }
  for (int i = 0; i < 6; i++) {
    for (int j = 0; j < 8; j++) {
      float x = (col + (float(i) + 0.5) / 6.0) / ${SETTLE_COLUMNS}.0;
      float y = mix(u_sink.x, 1.0, (float(j) + 0.5) / 8.0);
      float w = clamp((y - u_sink.x) / max(u_sink.y - u_sink.x, 1e-4), 0.0, 1.0);
      sum += max(texture(u_dye, vec2(x, y)).rgb, vec3(0.0)) * w;
    }
  }
  o = vec4(sqrt(clamp(sum / 48.0 / ${SETTLE_SCALE}.0, 0.0, 1.0)), 1.0);
}`;

const sizeOf = (venue: number, cell: number) => Math.max(8, Math.round(venue / cell));

export const createFluid = (gl: WebGL2RenderingContext, spec: FluidSpec): Fluid => {
  const nx = sizeOf(spec.width, spec.cell);
  const ny = sizeOf(spec.height, spec.cell);
  const mx = Math.max(8, Math.round(nx * spec.dyeScale));
  const my = Math.max(8, Math.round(ny * spec.dyeScale));
  const W = spec.width;
  const H = spec.height;
  const cellsPerPx = [nx / W, ny / H] as const;
  const texel = [1 / nx, 1 / ny] as const;

  const programs: Program[] = [];
  const make = (fs: string) => {
    const p = createProgram(gl, FULLSCREEN_VS, fs);
    programs.push(p);
    return p;
  };
  const splatVel = make(SPLAT_VEL);
  const splatDye = make(SPLAT_DYE);
  const forceP = make(FORCE);
  const advectVel = make(ADVECT_VEL);
  const divP = make(DIVERGENCE);
  const jacobi = make(JACOBI);
  const gradP = make(GRADIENT);
  const advectDye = make(ADVECT_DYE);
  const correctDye = make(CORRECT_DYE);
  const measureP = make(MEASURE);

  const vel: Pair = createPair(gl, nx, ny, { internal: gl.RG16F, linear: true });
  const pressure: Pair = createPair(gl, nx, ny, { internal: gl.R16F });
  const div: Target = createTarget(gl, nx, ny, { internal: gl.R16F });
  const dye: Pair = createPair(gl, mx, my, { internal: gl.RGBA16F, linear: true });
  const tmp: Target = createTarget(gl, mx, my, { internal: gl.RGBA16F, linear: true });
  const settle: Target = createTarget(gl, SETTLE_COLUMNS + 1, 1, { internal: gl.RGBA8 });
  const readback: Readback = createReadback(gl, SETTLE_COLUMNS + 1, 1);
  const vao = gl.createVertexArray();

  const seg = new Float32Array(MAX_SPLATS * 4);
  const jet = new Float32Array(MAX_SPLATS * 4);
  const ink = new Float32Array(MAX_SPLATS * 4);
  const heat = new Float32Array(MAX_SPLATS * 4);
  const decoded = new Float32Array(SETTLE_COLUMNS * 3);

  const clearAll = () => {
    for (const t of [vel.front, vel.back, pressure.front, pressure.back, dye.front, dye.back]) {
      clearTarget(gl, t);
    }
    clearTarget(gl, div);
    clearTarget(gl, tmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  clearAll();

  const fillSplats = (splats: readonly Splat[]) => {
    const n = Math.min(MAX_SPLATS, splats.length);
    for (let i = 0; i < n; i++) {
      const s = splats[i]!;
      // Venue px with y down to venue px with y up.
      seg.set([s.x0, H - s.y0, s.x1, H - s.y1], i * 4);
      jet.set([Math.max(1, s.r), s.vx, -s.vy, s.push], i * 4);
      ink.set([s.rgb[0], s.rgb[1], s.rgb[2], Math.max(1, s.r)], i * 4);
      heat.set([s.temp, s.ink, s.heat, 0], i * 4);
    }
    return n;
  };

  const sinkUv = (sink: StepOptions["sink"]) =>
    [1 - Math.max(0, sink.lo) / H, 1 - Math.max(0, sink.hi) / H] as const;

  return {
    nx,
    ny,
    mx,
    my,
    get dye() {
      return dye.front;
    },
    get velocity() {
      return vel.front;
    },
    step(splats, o) {
      const { dt, physics: ph } = o;
      const open = o.open ? 1 : 0;
      gl.bindVertexArray(vao);
      gl.disable(gl.BLEND);

      const n = fillSplats(splats);
      if (n > 0) {
        splatVel.use();
        bindTexture(gl, 0, vel.front.texture, splatVel.u("u_vel"));
        gl.uniform2f(splatVel.u("u_size"), W, H);
        gl.uniform2f(splatVel.u("u_cellsPerPx"), cellsPerPx[0], cellsPerPx[1]);
        gl.uniform1i(splatVel.u("u_n"), n);
        gl.uniform4fv(splatVel.u("u_seg"), seg);
        gl.uniform4fv(splatVel.u("u_jet"), jet);
        drawFullscreen(gl, vel.back.fbo, nx, ny);
        vel.swap();

        splatDye.use();
        bindTexture(gl, 0, dye.front.texture, splatDye.u("u_dye"));
        gl.uniform2f(splatDye.u("u_size"), W, H);
        gl.uniform1i(splatDye.u("u_n"), n);
        gl.uniform4fv(splatDye.u("u_seg"), seg);
        gl.uniform4fv(splatDye.u("u_ink"), ink);
        gl.uniform4fv(splatDye.u("u_heat"), heat);
        drawFullscreen(gl, dye.back.fbo, mx, my);
        dye.swap();
      }

      forceP.use();
      bindTexture(gl, 0, vel.front.texture, forceP.u("u_vel"));
      bindTexture(gl, 1, dye.front.texture, forceP.u("u_dye"));
      gl.uniform2f(forceP.u("u_texel"), texel[0], texel[1]);
      gl.uniform2f(forceP.u("u_cells"), nx, ny);
      gl.uniform1f(forceP.u("u_dt"), dt);
      gl.uniform1f(forceP.u("u_eps"), ph.vorticity);
      gl.uniform1f(forceP.u("u_beta"), ph.buoyancy * cellsPerPx[1]);
      gl.uniform1f(forceP.u("u_keep"), Math.exp(-dt / Math.max(0.05, ph.drag)));
      gl.uniform1f(forceP.u("u_swirl"), ph.swirl * cellsPerPx[0]);
      gl.uniform1f(
        forceP.u("u_swirlK"),
        (2 * Math.PI) / Math.max(1, ph.swirlScale * cellsPerPx[0]),
      );
      gl.uniform1f(forceP.u("u_time"), o.time);
      gl.uniform1f(forceP.u("u_vmax"), ph.maxSpeed * cellsPerPx[0]);
      drawFullscreen(gl, vel.back.fbo, nx, ny);
      vel.swap();

      advectVel.use();
      bindTexture(gl, 0, vel.front.texture, advectVel.u("u_vel"));
      gl.uniform2f(advectVel.u("u_texel"), texel[0], texel[1]);
      gl.uniform1f(advectVel.u("u_dt"), dt);
      drawFullscreen(gl, vel.back.fbo, nx, ny);
      vel.swap();

      divP.use();
      bindTexture(gl, 0, vel.front.texture, divP.u("u_vel"));
      gl.uniform2f(divP.u("u_texel"), texel[0], texel[1]);
      gl.uniform1f(divP.u("u_open"), open);
      drawFullscreen(gl, div.fbo, nx, ny);

      jacobi.use();
      gl.uniform2f(jacobi.u("u_texel"), texel[0], texel[1]);
      gl.uniform1f(jacobi.u("u_open"), open);
      bindTexture(gl, 1, div.texture, jacobi.u("u_div"));
      for (let i = 0; i < spec.iterations; i++) {
        bindTexture(gl, 0, pressure.front.texture, jacobi.u("u_p"));
        drawFullscreen(gl, pressure.back.fbo, nx, ny);
        pressure.swap();
      }

      gradP.use();
      bindTexture(gl, 0, pressure.front.texture, gradP.u("u_p"));
      bindTexture(gl, 1, vel.front.texture, gradP.u("u_vel"));
      gl.uniform2f(gradP.u("u_texel"), texel[0], texel[1]);
      gl.uniform1f(gradP.u("u_open"), open);
      drawFullscreen(gl, vel.back.fbo, nx, ny);
      vel.swap();

      advectDye.use();
      bindTexture(gl, 0, dye.front.texture, advectDye.u("u_dye"));
      bindTexture(gl, 1, vel.front.texture, advectDye.u("u_vel"));
      gl.uniform2f(advectDye.u("u_velTexel"), texel[0], texel[1]);
      gl.uniform1f(advectDye.u("u_dt"), dt);
      gl.uniform1f(advectDye.u("u_open"), open);
      drawFullscreen(gl, tmp.fbo, mx, my);

      const [lo, hi] = sinkUv(o.sink);
      correctDye.use();
      bindTexture(gl, 0, dye.front.texture, correctDye.u("u_dye"));
      bindTexture(gl, 1, tmp.texture, correctDye.u("u_tmp"));
      bindTexture(gl, 2, vel.front.texture, correctDye.u("u_vel"));
      gl.uniform2f(correctDye.u("u_velTexel"), texel[0], texel[1]);
      gl.uniform2f(correctDye.u("u_dyeSize"), mx, my);
      gl.uniform1f(correctDye.u("u_dt"), dt);
      gl.uniform1f(correctDye.u("u_open"), open);
      gl.uniform1f(correctDye.u("u_keepInk"), Math.exp(-dt / Math.max(0.1, ph.inkLife)));
      gl.uniform1f(correctDye.u("u_keepHeat"), Math.exp(-dt / Math.max(0.1, ph.cool)));
      gl.uniform1f(correctDye.u("u_cap"), ph.cap);
      gl.uniform1f(correctDye.u("u_capPull"), 1 - Math.exp(-dt * ph.capRate));
      gl.uniform1f(correctDye.u("u_clear"), ph.clear);
      gl.uniform3f(correctDye.u("u_sink"), lo, hi, o.sink.rate);
      gl.uniform1f(correctDye.u("u_mc"), spec.correction ?? 0.5);
      drawFullscreen(gl, dye.back.fbo, mx, my);
      dye.swap();

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(null);
    },
    measure(sink) {
      if (readback.busy) return false;
      const [lo, hi] = sinkUv(sink);
      gl.bindVertexArray(vao);
      measureP.use();
      bindTexture(gl, 0, dye.front.texture, measureP.u("u_dye"));
      gl.uniform2f(measureP.u("u_sink"), lo, hi);
      drawFullscreen(gl, settle.fbo, SETTLE_COLUMNS + 1, 1);
      gl.bindVertexArray(null);
      readback.start(settle);
      return true;
    },
    pollMeasure() {
      const bytes = readback.poll();
      if (!bytes) return null;
      for (let i = 0; i < SETTLE_COLUMNS; i++) {
        for (let c = 0; c < 3; c++) {
          const v = bytes[i * 4 + c]! / 255;
          decoded[i * 3 + c] = v * v * SETTLE_SCALE;
        }
      }
      const m = bytes[SETTLE_COLUMNS * 4]! / 255;
      return { columns: decoded, mean: m * m * SETTLE_SCALE };
    },
    clear() {
      clearAll();
    },
    readDye() {
      return readFloats(gl, dye.front);
    },
    readVelocity() {
      return readFloats(gl, vel.front);
    },
    readField(name) {
      return readFloats(gl, name === "pressure" ? pressure.front : div);
    },
    dispose() {
      for (const p of programs) p.dispose();
      vel.dispose();
      pressure.dispose();
      dye.dispose();
      deleteTarget(gl, div);
      deleteTarget(gl, tmp);
      deleteTarget(gl, settle);
      readback.dispose();
      gl.deleteVertexArray(vao);
    },
  };
};
