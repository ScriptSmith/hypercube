import { FADE_AT, persistEvery, QUIET_GAP } from "../life";
import { STAMPS } from "../stamps";
import {
  type Culture,
  type CultureInputs,
  GLSL_WORLD,
  type Stats,
  STATS_SIZE,
  setWorldUniforms,
  type StampOp,
  type WorldSpec,
} from "./culture";
import {
  bindTexture,
  createPair,
  createProgram,
  createReadback,
  createTarget,
  deleteTarget,
  drawFullscreen,
  FULLSCREEN_VS,
  GLSL_HASH,
} from "./gl";

/**
 * Conway's Life on the GPU: one RGBA8UI texel per cell (flags, colour, persist, since), one pass
 * per generation, exactly the rules of `life.ts`. Stamps ride along in the step: up to 16 per
 * pass, patterns read from a small atlas, soups made from the shared hash.
 */
export const MAX_STAMPS = 16;
const SLOT = 16;

const PATTERNS = STAMPS.life.filter((s) => s.pattern);
export const patternSlot = (id: string): number => PATTERNS.findIndex((s) => s.id === id);

const STEP_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_state;
uniform usampler2D u_atlas;
uniform uint u_gen;
uniform uint u_every;
uniform int u_advance;
uniform int u_fade;
uniform int u_clear;
uniform int u_stampCount;
uniform ivec4 u_stampA[${MAX_STAMPS}];
uniform ivec4 u_stampB[${MAX_STAMPS}];
out uvec4 o;
${GLSL_HASH}
${GLSL_WORLD}

const ivec2 N[8] = ivec2[8](ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1), ivec2(-1, 0),
  ivec2(1, 0), ivec2(-1, 1), ivec2(0, 1), ivec2(1, 1));

uint majority(uint a, uint b, uint c, ivec2 p) {
  if (a == b || a == c) return a;
  if (b == c) return b;
  uint k = hash3(uint(p.x), uint(p.y), u_gen) % 3u;
  return k == 0u ? a : (k == 1u ? b : c);
}

bool stampCell(ivec2 p, out uint color) {
  for (int i = 0; i < ${MAX_STAMPS}; i++) {
    if (i >= u_stampCount) break;
    ivec4 a = u_stampA[i];
    ivec4 b = u_stampB[i];
    ivec2 d = p - a.xy;
    if (a.z == 1) {
      // A pattern: undo the stamp's turn and reflection, then look the cell up in the atlas.
      if (abs(d.x) > 16 || abs(d.y) > 16) continue;
      int rot = b.z & 3;
      for (int k = 0; k < 4; k++) {
        if (k >= rot) break;
        d = ivec2(d.y, -d.x);
      }
      if ((b.z & 4) != 0) d.x = -d.x;
      ivec2 q = d + ivec2(b.x / 2, b.y / 2);
      if (q.x < 0 || q.y < 0 || q.x >= b.x || q.y >= b.y) continue;
      if (texelFetch(u_atlas, ivec2(a.w * ${SLOT} + q.x, q.y), 0).r == 0u) continue;
      color = uint(b.w);
      return true;
    } else if (a.z == 2) {
      // A soup: a disc of cells, each alive by the shared hash.
      float r = float(b.x) / 16.0;
      if (float(d.x * d.x + d.y * d.y) > r * r) continue;
      uint h = hash3(uint(d.x + 4096), uint(d.y + 4096), uint(b.w)) & 0xffffu;
      if (h >= uint(b.y)) continue;
      color = uint(b.z);
      return true;
    }
  }
  return false;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uvec4 s = texelFetch(u_state, p, 0);
  if (u_clear == 1) s = uvec4(0u, 0u, 0u, 255u);
  bool was = (s.r & 1u) == 1u;
  bool next = was;
  uint color = s.g;
  uint persist = s.b;
  uint since = s.a;
  uint flags = 0u;
  if (u_advance == 1) {
    uint n = 0u;
    uint c0 = 0u;
    uint c1 = 0u;
    uint c2 = 0u;
    bool nearFade = false;
    for (int k = 0; k < 8; k++) {
      ivec2 q = p + N[k];
      if (q.x < 0 || q.y < 0 || q.x >= u_size.x || q.y >= u_size.y) continue;
      uvec4 t = texelFetch(u_state, q, 0);
      if ((t.r & 1u) == 0u) continue;
      if (n == 0u) c0 = t.g; else if (n == 1u) c1 = t.g; else if (n == 2u) c2 = t.g;
      n++;
      if (t.b >= ${FADE_AT}u) nearFade = true;
    }
    next = was ? (n == 2u || n == 3u) : (n == 3u);
    if (outside(vec2(p) + 0.5)) next = false;
    if (u_fade == 1 && was && next && (s.b >= ${FADE_AT}u || (s.b >= ${FADE_AT / 2}u && nearFade))) next = false;
    if (!was && next) color = majority(c0, c1, c2, p);
    since = next ? 0u : min(255u, s.a + 1u);
    persist = since > ${QUIET_GAP}u ? 0u : ((u_gen % u_every) == 0u ? min(255u, s.b + 1u) : s.b);
    if (!was && next) flags |= 2u;
    if (was && !next) flags |= 4u;
  } else {
    flags = s.r & 6u;
  }
  if (next && washed(vec2(p) + 0.5)) {
    next = false;
    since = 1u;
    persist = 0u;
    flags = (flags & ~2u) | 4u;
  }
  uint sc;
  if (stampCell(p, sc) && !outside(vec2(p) + 0.5)) {
    if (!next) flags |= 2u;
    next = true;
    color = sc;
    persist = 0u;
    since = 0u;
    flags &= ~4u;
  }
  o = uvec4((next ? 1u : 0u) | flags, color, persist, since);
}`;

const STATS_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_state;
uniform ivec2 u_size;
out vec4 o;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  ivec2 lo = b * u_size / ${STATS_SIZE};
  ivec2 hi = max(lo + 1, (b + 1) * u_size / ${STATS_SIZE});
  float n = 0.0;
  float alive = 0.0;
  for (int y = lo.y; y < hi.y; y++) {
    for (int x = lo.x; x < hi.x; x++) {
      alive += float(texelFetch(u_state, ivec2(x, y), 0).r & 1u);
      n += 1.0;
    }
  }
  o = vec4(alive / max(1.0, n), 0.0, 0.0, 1.0);
}`;

/** Render side: dots with a soft afterglow, births fading in through the generation. */
const SNIPPET = `
uniform highp usampler2D u_life;
uniform ivec2 u_lifeSize;
uniform float u_genFrac;
uniform vec3 u_colors[10];
vec4 cultureColor(vec2 c, float cellPx) {
  ivec2 ci = ivec2(floor(c));
  if (ci.x < 0 || ci.y < 0 || ci.x >= u_lifeSize.x || ci.y >= u_lifeSize.y) return vec4(0.0);
  uvec4 s = texelFetch(u_life, ci, 0);
  bool alive = (s.r & 1u) == 1u;
  float t = u_genFrac;
  float a = 0.0;
  if (alive) {
    a = (s.r & 2u) != 0u ? mix(0.35, 1.0, t) : 1.0;
    // Debris on its way out dims over its last steps.
    a *= 1.0 - 0.75 * smoothstep(${FADE_AT - 14}.0, ${FADE_AT}.0, float(s.b));
  } else {
    float since = float(s.a) - 1.0 + t;
    a = (s.r & 4u) != 0u ? mix(0.75, 0.35, t) : 0.35 * (1.0 - smoothstep(0.0, 6.0, since));
  }
  if (a <= 0.001) return vec4(0.0);
  vec3 col = u_colors[min(s.g, 9u)];
  vec2 f = fract(c) - 0.5;
  float disc = 1.0 - smoothstep(0.30, 0.5, length(f));
  float shape = mix(1.0, disc, smoothstep(2.0, 5.0, cellPx));
  float fresh = alive && s.b == 0u ? 0.25 : 0.0;
  return vec4(mix(col, vec3(1.0), fresh) * a * shape, a * (alive ? 1.0 : 0.6));
}`;

export interface LifeOptions {
  spec: WorldSpec;
  cell: number;
  gensPerSecond: number;
}

export const createLifeCulture = (gl: WebGL2RenderingContext, opts: LifeOptions): Culture => {
  const { spec, cell } = opts;
  const gridW = Math.max(8, Math.round(spec.width / cell));
  const gridH = Math.max(8, Math.round(spec.height / cell));
  const state = createPair(gl, gridW, gridH, { internal: gl.RGBA8UI });
  const step = createProgram(gl, FULLSCREEN_VS, STEP_FS);
  const statsProg = createProgram(gl, FULLSCREEN_VS, STATS_FS);
  const statsTarget = createTarget(gl, STATS_SIZE, STATS_SIZE, { internal: gl.RGBA8 });
  const readback = createReadback(gl, STATS_SIZE, STATS_SIZE);
  const vao = gl.createVertexArray();

  const atlas = gl.createTexture();
  if (!atlas || !vao) throw new Error("life allocation failed");
  const atlasW = SLOT * Math.max(1, PATTERNS.length);
  const bits = new Uint8Array(atlasW * SLOT);
  PATTERNS.forEach((s, i) => {
    for (const [x, y] of s.pattern?.cells ?? []) bits[y * atlasW + i * SLOT + x] = 1;
  });
  gl.bindTexture(gl.TEXTURE_2D, atlas);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, atlasW, SLOT);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, atlasW, SLOT, gl.RED_INTEGER, gl.UNSIGNED_BYTE, bits);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  const stampA = new Int32Array(MAX_STAMPS * 4);
  const stampB = new Int32Array(MAX_STAMPS * 4);
  let gen = 0;
  let acc = 0;
  let clearNext = true;
  const every = persistEvery(opts.gensPerSecond);

  const fill = (stamps: StampOp[]): number => {
    let n = 0;
    while (stamps.length > 0 && n < MAX_STAMPS) {
      const op = stamps.shift();
      if (!op || op.stamp.family !== "life") continue;
      const i = n * 4;
      const cx = Math.floor(op.x / cell);
      const cy = Math.floor(op.y / cell);
      if (op.stamp.kind === "soup" && op.stamp.soup) {
        stampA.set([cx, cy, 2, 0], i);
        stampB.set(
          [
            Math.round(op.stamp.soup.cells * 16),
            Math.floor(op.stamp.soup.density * 65536),
            op.color,
            op.seed & 0x7fffffff,
          ],
          i,
        );
      } else if (op.stamp.pattern) {
        const slot = patternSlot(op.stamp.id);
        if (slot < 0) continue;
        stampA.set([cx, cy, 1, slot], i);
        stampB.set(
          [op.stamp.pattern.width, op.stamp.pattern.height, op.transform & 7, op.color],
          i,
        );
      } else continue;
      n++;
    }
    return n;
  };

  const pass = (advance: boolean, stamps: number, inputs: CultureInputs) => {
    gl.bindVertexArray(vao);
    step.use();
    bindTexture(gl, 0, state.front.texture, step.u("u_state"));
    bindTexture(gl, 1, atlas, step.u("u_atlas"));
    setWorldUniforms(gl, step, spec, cell, gridW, gridH, inputs.wash);
    gl.uniform1ui(step.u("u_gen"), gen);
    gl.uniform1ui(step.u("u_every"), every);
    gl.uniform1i(step.u("u_advance"), advance ? 1 : 0);
    gl.uniform1i(step.u("u_fade"), 1);
    gl.uniform1i(step.u("u_clear"), clearNext ? 1 : 0);
    gl.uniform1i(step.u("u_stampCount"), stamps);
    gl.uniform4iv(step.u("u_stampA[0]"), stampA);
    gl.uniform4iv(step.u("u_stampB[0]"), stampB);
    drawFullscreen(gl, state.back.fbo, gridW, gridH);
    state.swap();
    clearNext = false;
  };

  return {
    family: "life",
    spec,
    gridW,
    gridH,
    cell,
    setConditions() {},
    update(inputs) {
      acc += inputs.dt * opts.gensPerSecond;
      // Never more than two generations a frame, so a stall doesn't fast-forward the world.
      let gens = Math.min(2, Math.floor(acc));
      acc = Math.min(acc - gens, 1);
      const washing = inputs.wash.front >= 0;
      if (gens === 0 && (inputs.stamps.length > 0 || washing || clearNext)) {
        pass(false, fill(inputs.stamps), inputs);
      }
      while (gens-- > 0) {
        gen++;
        pass(true, fill(inputs.stamps), inputs);
      }
    },
    snippet: SNIPPET,
    bind(p, unit) {
      bindTexture(gl, unit, state.front.texture, p.u("u_life"));
      gl.uniform2i(p.u("u_lifeSize"), gridW, gridH);
      gl.uniform1f(p.u("u_genFrac"), acc);
    },
    requestStats() {
      if (readback.busy) return;
      gl.bindVertexArray(vao);
      statsProg.use();
      bindTexture(gl, 0, state.front.texture, statsProg.u("u_state"));
      gl.uniform2i(statsProg.u("u_size"), gridW, gridH);
      drawFullscreen(gl, statsTarget.fbo, STATS_SIZE, STATS_SIZE);
      readback.start(statsTarget);
    },
    pollStats(): Stats | null {
      const bytes = readback.poll();
      if (!bytes) return null;
      const blocks = new Uint8Array(STATS_SIZE * STATS_SIZE);
      let sum = 0;
      for (let i = 0; i < blocks.length; i++) {
        const v = bytes[i * 4] ?? 0;
        blocks[i] = v;
        sum += v;
      }
      return { coverage: sum / 255 / blocks.length, blocks };
    },
    clear() {
      clearNext = true;
    },
    dispose() {
      state.dispose();
      deleteTarget(gl, statsTarget);
      readback.dispose();
      gl.deleteTexture(atlas);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(step.program);
      gl.deleteProgram(statsProg.program);
    },
  };
};

/** Test hook: run a Life world on the GPU from given cells and read the live cells back. */
export const lifeSelfTest = (
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  cells: readonly (readonly [number, number, number])[],
  generations: number,
): Uint32Array => {
  const pair = createPair(gl, width, height, { internal: gl.RGBA8UI });
  const step = createProgram(gl, FULLSCREEN_VS, STEP_FS);
  const vao = gl.createVertexArray();
  const atlas = gl.createTexture();
  try {
    const init = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) init[i * 4 + 3] = 255;
    for (const [x, y, c] of cells) init.set([1, c, 0, 0], (y * width + x) * 4);
    gl.bindTexture(gl.TEXTURE_2D, pair.front.texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      width,
      height,
      gl.RGBA_INTEGER,
      gl.UNSIGNED_BYTE,
      init,
    );
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, SLOT, SLOT);
    gl.bindVertexArray(vao);
    step.use();
    const none = new Int32Array(MAX_STAMPS * 4);
    for (let g = 1; g <= generations; g++) {
      bindTexture(gl, 0, pair.front.texture, step.u("u_state"));
      bindTexture(gl, 1, atlas!, step.u("u_atlas"));
      setWorldUniforms(gl, step, { width, height, mask: null }, 1, width, height, {
        front: -1,
        radial: false,
      });
      gl.uniform1ui(step.u("u_gen"), g);
      gl.uniform1ui(step.u("u_every"), persistEvery(12));
      gl.uniform1i(step.u("u_advance"), 1);
      gl.uniform1i(step.u("u_fade"), 1);
      gl.uniform1i(step.u("u_clear"), 0);
      gl.uniform1i(step.u("u_stampCount"), 0);
      gl.uniform4iv(step.u("u_stampA[0]"), none);
      gl.uniform4iv(step.u("u_stampB[0]"), none);
      drawFullscreen(gl, pair.back.fbo, width, height);
      pair.swap();
    }
    const out = new Uint32Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pair.front.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  } finally {
    pair.dispose();
    gl.deleteProgram(step.program);
    gl.deleteVertexArray(vao);
    gl.deleteTexture(atlas);
  }
};
