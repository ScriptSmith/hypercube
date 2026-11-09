import {
  CONDITION_COLUMNS,
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
  createDataTexture,
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
 * Gray-Scott reaction-diffusion (after Pearson 1993): two chemicals u and v per cell, v feeding on
 * u, with feed and kill rates from the per-column conditions. 32-bit float channels, because near
 * u = 1 the updates are smaller than half floats can hold. Drops enter on a frame's first
 * iteration; a wash drop resets a disc to clean agar.
 */
export const MAX_DROPS = 16;

const STEP_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_state;
uniform sampler2D u_cond;
uniform int u_dropCount;
uniform vec4 u_drops[${MAX_DROPS}];
uniform int u_clear;
uniform uint u_frame;
out vec4 o;
${GLSL_HASH}
${GLSL_WORLD}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = u_size - 1;
  vec2 s = texelFetch(u_state, p, 0).xy;
  if (u_clear == 1) s = vec2(1.0, 0.0);
  vec2 lap = -s;
  lap += 0.2 * texelFetch(u_state, clamp(p + ivec2(1, 0), ivec2(0), hi), 0).xy;
  lap += 0.2 * texelFetch(u_state, clamp(p + ivec2(-1, 0), ivec2(0), hi), 0).xy;
  lap += 0.2 * texelFetch(u_state, clamp(p + ivec2(0, 1), ivec2(0), hi), 0).xy;
  lap += 0.2 * texelFetch(u_state, clamp(p + ivec2(0, -1), ivec2(0), hi), 0).xy;
  lap += 0.05 * texelFetch(u_state, clamp(p + ivec2(1, 1), ivec2(0), hi), 0).xy;
  lap += 0.05 * texelFetch(u_state, clamp(p + ivec2(-1, 1), ivec2(0), hi), 0).xy;
  lap += 0.05 * texelFetch(u_state, clamp(p + ivec2(1, -1), ivec2(0), hi), 0).xy;
  lap += 0.05 * texelFetch(u_state, clamp(p + ivec2(-1, -1), ivec2(0), hi), 0).xy;
  int col = clamp(int(float(p.x) / float(u_size.x) * ${CONDITION_COLUMNS}.0), 0, ${CONDITION_COLUMNS - 1});
  vec4 c = texelFetch(u_cond, ivec2(col, 0), 0);
  float uvv = s.x * s.y * s.y;
  if (u_clear == 1) lap = vec2(0.0);
  s += vec2(lap.x - uvv + c.x * (1.0 - s.x), 0.5 * lap.y + uvv - (c.x + c.y) * s.y);
  s = clamp(s, 0.0, 1.0);
  vec2 q = vec2(p) + 0.5;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= u_dropCount) break;
    vec4 d = u_drops[i];
    float dist = length(q - d.xy);
    if (dist > d.z) continue;
    if (d.w > 0.5) {
      s = mix(s, vec2(1.0, 0.0), 1.0 - smoothstep(d.z * 0.7, d.z, dist));
    } else {
      float n = hashf(uint(p.x), uint(p.y), u_frame + uint(i));
      s = vec2(0.42 + 0.1 * n, 0.36 + 0.14 * n);
    }
  }
  if (washed(q)) s = mix(s, vec2(1.0, 0.0), 0.3);
  if (outside(q)) s = vec2(1.0, 0.0);
  o = vec4(s, 0.0, 1.0);
}`;

const STATS_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_state;
uniform ivec2 u_size;
out vec4 o;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  ivec2 lo = b * u_size / ${STATS_SIZE};
  ivec2 hi = max(lo + 1, (b + 1) * u_size / ${STATS_SIZE});
  float n = 0.0;
  float on = 0.0;
  for (int y = lo.y; y < hi.y; y += 2) {
    for (int x = lo.x; x < hi.x; x += 2) {
      on += step(0.12, texelFetch(u_state, ivec2(x, y), 0).y);
      n += 1.0;
    }
  }
  o = vec4(on / max(1.0, n), 0.0, 0.0, 1.0);
}`;

const SNIPPET = `
uniform sampler2D u_rd;
uniform sampler2D u_rdCond;
uniform ivec2 u_rdSize;
float rdAt(ivec2 p) { return texelFetch(u_rd, clamp(p, ivec2(0), u_rdSize - 1), 0).y; }
float rdSmooth(vec2 c) {
  vec2 g = c - 0.5;
  ivec2 i = ivec2(floor(g));
  vec2 f = fract(g);
  float a = rdAt(i);
  float b = rdAt(i + ivec2(1, 0));
  float d = rdAt(i + ivec2(0, 1));
  float e = rdAt(i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
vec3 hue(float h) {
  vec3 k = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return k * k * (3.0 - 2.0 * k);
}
vec4 cultureColor(vec2 c, float cellPx) {
  if (c.x < 0.0 || c.y < 0.0 || c.x > float(u_rdSize.x) || c.y > float(u_rdSize.y)) return vec4(0.0);
  float v = rdSmooth(c);
  float dx = rdSmooth(c + vec2(0.75, 0.0)) - rdSmooth(c - vec2(0.75, 0.0));
  float dy = rdSmooth(c + vec2(0.0, 0.75)) - rdSmooth(c - vec2(0.0, 0.75));
  int col = clamp(int(c.x / float(u_rdSize.x) * ${CONDITION_COLUMNS}.0), 0, ${CONDITION_COLUMNS - 1});
  vec3 tint = mix(hue(texelFetch(u_rdCond, ivec2(col, 0), 0).z), vec3(0.62), 0.3);
  float body = smoothstep(0.08, 0.32, v);
  // Light from the top left on the v surface, so the pattern reads as raised and glossy.
  vec3 n = normalize(vec3(-dx * 7.0, -dy * 7.0, 1.0));
  float light = clamp(dot(n, normalize(vec3(-0.5, -0.6, 0.65))), 0.0, 1.0);
  vec3 base = mix(tint * 0.55, mix(tint, vec3(1.0), 0.35), light);
  float rim = smoothstep(0.06, 0.16, v) * (1.0 - smoothstep(0.16, 0.3, v));
  vec3 col3 = base * body + tint * rim * 0.9 + vec3(1.0) * pow(light, 12.0) * body * 0.5;
  return vec4(col3 * 0.9, body * 0.22 + rim * 0.45);
}`;

export interface TuringOptions {
  spec: WorldSpec;
  cell: number;
  iterations: number;
}

export const createTuringCulture = (gl: WebGL2RenderingContext, opts: TuringOptions): Culture => {
  const { spec, cell } = opts;
  const gridW = Math.max(8, Math.round(spec.width / cell));
  const gridH = Math.max(8, Math.round(spec.height / cell));
  const state = createPair(gl, gridW, gridH, { internal: gl.RG32F });
  const step = createProgram(gl, FULLSCREEN_VS, STEP_FS);
  const statsProg = createProgram(gl, FULLSCREEN_VS, STATS_FS);
  const statsTarget = createTarget(gl, STATS_SIZE, STATS_SIZE, { internal: gl.RGBA8 });
  const readback = createReadback(gl, STATS_SIZE, STATS_SIZE);
  const cond = createDataTexture(gl, CONDITION_COLUMNS, 2);
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("reaction allocation failed");
  const drops = new Float32Array(MAX_DROPS * 4);
  let frame = 0;
  let clearNext = true;
  let budget = 0;

  const fill = (stamps: StampOp[]): number => {
    let n = 0;
    while (stamps.length > 0 && n < MAX_DROPS) {
      const op = stamps.shift();
      if (!op || (op.stamp.kind !== "reagent" && op.stamp.kind !== "wash")) continue;
      drops.set(
        [op.x / cell, op.y / cell, op.stamp.radius / cell, op.stamp.kind === "wash" ? 1 : 0],
        n * 4,
      );
      n++;
    }
    return n;
  };

  const pass = (inputs: CultureInputs, dropCount: number) => {
    step.use();
    bindTexture(gl, 0, state.front.texture, step.u("u_state"));
    bindTexture(gl, 1, cond, step.u("u_cond"));
    setWorldUniforms(gl, step, spec, cell, gridW, gridH, inputs.wash);
    gl.uniform1i(step.u("u_dropCount"), dropCount);
    gl.uniform4fv(step.u("u_drops[0]"), drops);
    gl.uniform1i(step.u("u_clear"), clearNext ? 1 : 0);
    gl.uniform1ui(step.u("u_frame"), frame++);
    drawFullscreen(gl, state.back.fbo, gridW, gridH);
    state.swap();
    clearNext = false;
  };

  return {
    family: "turing",
    spec,
    gridW,
    gridH,
    cell,
    setConditions(columns) {
      gl.bindTexture(gl.TEXTURE_2D, cond);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, CONDITION_COLUMNS, 2, gl.RGBA, gl.FLOAT, columns);
    },
    update(inputs) {
      gl.bindVertexArray(vao);
      // Iterations are per 60 Hz frame; a slower display runs proportionally more, up to double.
      budget = Math.min(opts.iterations * 2, budget + inputs.dt * 60 * opts.iterations);
      let n = Math.floor(budget);
      budget -= n;
      n = Math.min(n, Math.max(1, Math.round(opts.iterations * 2 * inputs.load)));
      if (n === 0 && (inputs.stamps.length > 0 || clearNext)) n = 1;
      for (let i = 0; i < n; i++) pass(inputs, i === 0 ? fill(inputs.stamps) : 0);
    },
    snippet: SNIPPET,
    bind(p, unit) {
      bindTexture(gl, unit, state.front.texture, p.u("u_rd"));
      bindTexture(gl, unit + 1, cond, p.u("u_rdCond"));
      gl.uniform2i(p.u("u_rdSize"), gridW, gridH);
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
      gl.deleteTexture(cond);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(step.program);
      gl.deleteProgram(statsProg.program);
    },
  };
};
