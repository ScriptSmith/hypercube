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
 * A slime mould after Jones 2010: agents that sense the trail ahead of them at three points, turn
 * towards the strongest, step forward and deposit. Agent state (position in trail texels, heading,
 * strain) lives in an RGBA32F texture updated by a fragment pass; agents deposit into a trail map
 * as additive points; a diffuse-and-decay pass follows. Each strain has its own trail channel and
 * avoids the others'. A dormant agent (strain below zero) does nothing until a spore puff wakes it:
 * puffs take the next slice of the fixed buffer in turn, so the oldest colonies are recycled.
 */
export const MAX_PUFFS = 16;
export const MAX_PIECES = 6;
export const STRAINS = 4;
/** A spore puff wakes this share of the agent buffer. */
export const PUFF_SHARE = 1 / 24;
const AGENT_W = 1024;

const UPDATE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_agents;
uniform sampler2D u_trail;
uniform sampler2D u_cond;
uniform int u_agentN;
uniform uint u_frame;
uniform float u_repel;
uniform int u_pieceCount;
uniform vec4 u_pieces[${MAX_PIECES}];
uniform int u_puffCount;
uniform vec4 u_puffA[${MAX_PUFFS}];
uniform ivec4 u_puffB[${MAX_PUFFS}];
uniform int u_clear;
out vec4 o;
${GLSL_HASH}
${GLSL_WORLD}

vec4 condAt(float x) {
  int col = clamp(int(x / float(u_size.x) * ${CONDITION_COLUMNS}.0), 0, ${CONDITION_COLUMNS - 1});
  return texelFetch(u_cond, ivec2(col, 0), 0);
}

float sense(vec2 p, int strain) {
  vec4 t = texture(u_trail, p / vec2(u_size));
  float own = t[strain];
  float v = own - u_repel * (t.r + t.g + t.b + t.a - own);
  for (int i = 0; i < ${MAX_PIECES}; i++) {
    if (i >= u_pieceCount) break;
    vec4 pc = u_pieces[i];
    float d = length(p - pc.xy);
    if (pc.w > 0.0) v += pc.w * 6.0 * exp(-d * d / (2.0 * 9.0 * pc.z * pc.z));
    else v += pc.w * 40.0 * (1.0 - smoothstep(pc.z, pc.z * 2.2, d));
  }
  return v;
}

vec2 dir(float a) { return vec2(cos(a), sin(a)); }

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  int idx = ij.y * ${AGENT_W} + ij.x;
  vec4 a = texelFetch(u_agents, ij, 0);
  if (u_clear == 1) a = vec4(0.0, 0.0, 0.0, -1.0);
  uint ui = uint(idx);
  for (int i = 0; i < ${MAX_PUFFS}; i++) {
    if (i >= u_puffCount) break;
    ivec4 b = u_puffB[i];
    int rel = idx - b.x;
    if (rel < 0) rel += u_agentN;
    if (rel >= b.y) continue;
    vec4 pa = u_puffA[i];
    float ang = 6.2831853 * hashf(ui, uint(b.z), 1u);
    float rad = pa.z * (0.55 + 0.45 * sqrt(hashf(ui, uint(b.z), 2u)));
    vec2 p = pa.xy + rad * dir(ang);
    a = vec4(p, ang + (hashf(ui, uint(b.z), 3u) - 0.5) * 1.2, pa.w);
  }
  if (a.w < 0.0) {
    o = a;
    return;
  }
  vec2 pos = a.xy;
  float h = a.z;
  int strain = int(a.w + 0.5);
  vec4 c = condAt(pos.x);
  float sa = c.x;
  float ra = c.y;
  float so = c.z;
  float ss = c.w;
  float f = sense(pos + so * dir(h), strain);
  float l = sense(pos + so * dir(h + sa), strain);
  float r = sense(pos + so * dir(h - sa), strain);
  float rnd = hashf(ui, u_frame, 7u);
  if (f > l && f > r) {
    h += (rnd - 0.5) * 0.08;
  } else if (f < l && f < r) {
    h += rnd < 0.5 ? ra : -ra;
  } else if (l > r) {
    h += ra * (0.8 + 0.4 * rnd);
  } else if (r > l) {
    h -= ra * (0.8 + 0.4 * rnd);
  }
  vec2 np = pos + ss * dir(h);
  bool blocked = np.x < 1.0 || np.y < 1.0 || np.x > float(u_size.x) - 1.0 || np.y > float(u_size.y) - 1.0 || outside(np);
  for (int i = 0; i < ${MAX_PIECES}; i++) {
    if (i >= u_pieceCount) break;
    vec4 pc = u_pieces[i];
    if (pc.w < 0.0 && length(np - pc.xy) < pc.z * 0.9 * min(1.0, -pc.w * 3.0)) blocked = true;
  }
  if (blocked) {
    h = 6.2831853 * hashf(ui, u_frame, 9u);
    np = pos;
  }
  if (washed(np)) {
    o = vec4(np, h, -1.0);
    return;
  }
  o = vec4(np, mod(h, 6.2831853), a.w);
}`;

const DEPOSIT_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_agents;
uniform sampler2D u_cond;
uniform ivec2 u_size;
out vec4 v_amount;
void main() {
  ivec2 ij = ivec2(gl_VertexID % ${AGENT_W}, gl_VertexID / ${AGENT_W});
  vec4 a = texelFetch(u_agents, ij, 0);
  if (a.w < 0.0) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    v_amount = vec4(0.0);
    return;
  }
  int col = clamp(int(a.x / float(u_size.x) * ${CONDITION_COLUMNS}.0), 0, ${CONDITION_COLUMNS - 1});
  float deposit = texelFetch(u_cond, ivec2(col, 1), 0).x;
  vec4 m = vec4(0.0);
  m[clamp(int(a.w + 0.5), 0, 3)] = deposit;
  v_amount = m;
  gl_Position = vec4(a.xy / vec2(u_size) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const DEPOSIT_FS = `#version 300 es
precision highp float;
in vec4 v_amount;
out vec4 o;
void main() { o = v_amount; }`;

const DIFFUSE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_trail;
uniform sampler2D u_cond;
uniform int u_pieceCount;
uniform vec4 u_pieces[${MAX_PIECES}];
uniform int u_clear;
out vec4 o;
${GLSL_WORLD}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 hi = u_size - 1;
  vec4 sum = vec4(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      sum += texelFetch(u_trail, clamp(p + ivec2(x, y), ivec2(0), hi), 0);
    }
  }
  vec4 centre = texelFetch(u_trail, p, 0);
  int col = clamp(int(float(p.x) / float(u_size.x) * ${CONDITION_COLUMNS}.0), 0, ${CONDITION_COLUMNS - 1});
  float decay = texelFetch(u_cond, ivec2(col, 1), 0).y;
  vec4 v = mix(centre, sum / 9.0, 0.6) * decay;
  vec2 q = vec2(p) + 0.5;
  for (int i = 0; i < ${MAX_PIECES}; i++) {
    if (i >= u_pieceCount) break;
    vec4 pc = u_pieces[i];
    float d = length(q - pc.xy);
    if (pc.w > 0.0) v += vec4(pc.w * 1.5 * (1.0 - smoothstep(pc.z * 0.6, pc.z, d)));
    else v *= mix(1.0, 0.2, (1.0 - smoothstep(pc.z, pc.z * 1.4, d)) * min(1.0, -pc.w * 3.0));
  }
  if (washed(q)) v *= 0.8;
  if (outside(q) || u_clear == 1) v = vec4(0.0);
  o = min(v, vec4(200.0));
}`;

const STATS_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_trail;
uniform ivec2 u_size;
out vec4 o;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  ivec2 lo = b * u_size / ${STATS_SIZE};
  ivec2 hi = max(lo + 1, (b + 1) * u_size / ${STATS_SIZE});
  float n = 0.0;
  float on = 0.0;
  for (int y = lo.y; y < hi.y; y++) {
    for (int x = lo.x; x < hi.x; x++) {
      vec4 t = texelFetch(u_trail, ivec2(x, y), 0);
      on += step(1.5, t.r + t.g + t.b + t.a);
      n += 1.0;
    }
  }
  o = vec4(on / max(1.0, n), 0.0, 0.0, 1.0);
}`;

const SNIPPET = `
uniform sampler2D u_slimeTrail;
uniform vec2 u_slimeSize;
uniform vec3 u_strainColors[4];
uniform float u_slimeGain;
vec4 cultureColor(vec2 c, float cellPx) {
  vec4 t = texture(u_slimeTrail, c / u_slimeSize);
  vec4 k = vec4(1.0) - exp(-t * u_slimeGain);
  vec3 col = u_strainColors[0] * k.r + u_strainColors[1] * k.g + u_strainColors[2] * k.b + u_strainColors[3] * k.a;
  float glow = max(max(k.r, k.g), max(k.b, k.a));
  // The densest veins run white-hot.
  col = min(col, vec3(1.0)) + vec3(0.9, 0.95, 1.0) * smoothstep(0.9, 1.0, glow) * 0.22;
  return vec4(col, glow);
}`;

export interface SlimeOptions {
  spec: WorldSpec;
  /** Venue px per trail texel. */
  cell: number;
  agents: number;
  stepsPerSecond: number;
}

export interface SlimeCulture extends Culture {
  readonly agents: number;
}

export const createSlimeCulture = (
  gl: WebGL2RenderingContext,
  opts: SlimeOptions,
): SlimeCulture => {
  const { spec, cell } = opts;
  const gridW = Math.max(8, Math.round(spec.width / cell));
  const gridH = Math.max(8, Math.round(spec.height / cell));
  const agentH = Math.max(1, Math.ceil(opts.agents / AGENT_W));
  const agentN = AGENT_W * agentH;
  const agents = createPair(gl, AGENT_W, agentH, { internal: gl.RGBA32F });
  const trail = createPair(gl, gridW, gridH, { internal: gl.RGBA16F, linear: true });
  const update = createProgram(gl, FULLSCREEN_VS, UPDATE_FS);
  const deposit = createProgram(gl, DEPOSIT_VS, DEPOSIT_FS);
  const diffuse = createProgram(gl, FULLSCREEN_VS, DIFFUSE_FS);
  const statsProg = createProgram(gl, FULLSCREEN_VS, STATS_FS);
  const statsTarget = createTarget(gl, STATS_SIZE, STATS_SIZE, { internal: gl.RGBA8 });
  const readback = createReadback(gl, STATS_SIZE, STATS_SIZE);
  const cond = createDataTexture(gl, CONDITION_COLUMNS, 2);
  const vao = gl.createVertexArray();
  if (!vao) throw new Error("slime allocation failed");

  const puffA = new Float32Array(MAX_PUFFS * 4);
  const puffB = new Int32Array(MAX_PUFFS * 4);
  const pieces = new Float32Array(MAX_PIECES * 4);
  let pieceCount = 0;
  let cursor = 0;
  let frame = 0;
  let acc = 0;
  let clearNext = true;
  const perPuff = Math.max(64, Math.round(agentN * PUFF_SHARE));

  const fillPuffs = (stamps: StampOp[]): number => {
    let n = 0;
    while (stamps.length > 0 && n < MAX_PUFFS) {
      const op = stamps.shift();
      if (!op || op.stamp.kind !== "spore") continue;
      const i = n * 4;
      puffA.set([op.x / cell, op.y / cell, op.stamp.radius / cell, op.color % STRAINS], i);
      puffB.set([cursor, perPuff, op.seed & 0x7fffffff, 0], i);
      cursor = (cursor + perPuff) % agentN;
      n++;
    }
    return n;
  };

  const fillPieces = (inputs: CultureInputs) => {
    pieceCount = 0;
    for (const p of inputs.pieces) {
      if (pieceCount >= MAX_PIECES) break;
      pieces.set([p.x / cell, p.y / cell, p.r / cell, p.strength], pieceCount * 4);
      pieceCount++;
    }
  };

  const stepOnce = (inputs: CultureInputs, puffs: number) => {
    gl.bindVertexArray(vao);
    update.use();
    bindTexture(gl, 0, agents.front.texture, update.u("u_agents"));
    bindTexture(gl, 1, trail.front.texture, update.u("u_trail"));
    bindTexture(gl, 2, cond, update.u("u_cond"));
    setWorldUniforms(gl, update, spec, cell, gridW, gridH, inputs.wash);
    gl.uniform1i(update.u("u_agentN"), agentN);
    gl.uniform1ui(update.u("u_frame"), frame++);
    gl.uniform1f(update.u("u_repel"), 0.7);
    gl.uniform1i(update.u("u_pieceCount"), pieceCount);
    gl.uniform4fv(update.u("u_pieces[0]"), pieces);
    gl.uniform1i(update.u("u_puffCount"), puffs);
    gl.uniform4fv(update.u("u_puffA[0]"), puffA);
    gl.uniform4iv(update.u("u_puffB[0]"), puffB);
    gl.uniform1i(update.u("u_clear"), clearNext ? 1 : 0);
    drawFullscreen(gl, agents.back.fbo, AGENT_W, agentH);
    agents.swap();

    deposit.use();
    bindTexture(gl, 0, agents.front.texture, deposit.u("u_agents"));
    bindTexture(gl, 2, cond, deposit.u("u_cond"));
    gl.uniform2i(deposit.u("u_size"), gridW, gridH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trail.front.fbo);
    gl.viewport(0, 0, gridW, gridH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, agentN);
    gl.disable(gl.BLEND);

    diffuse.use();
    bindTexture(gl, 0, trail.front.texture, diffuse.u("u_trail"));
    bindTexture(gl, 2, cond, diffuse.u("u_cond"));
    setWorldUniforms(gl, diffuse, spec, cell, gridW, gridH, inputs.wash);
    gl.uniform1i(diffuse.u("u_pieceCount"), pieceCount);
    gl.uniform4fv(diffuse.u("u_pieces[0]"), pieces);
    gl.uniform1i(diffuse.u("u_clear"), clearNext ? 1 : 0);
    drawFullscreen(gl, trail.back.fbo, gridW, gridH);
    trail.swap();
    clearNext = false;
  };

  return {
    family: "slime",
    spec,
    gridW,
    gridH,
    cell,
    agents: agentN,
    setConditions(columns) {
      gl.bindTexture(gl.TEXTURE_2D, cond);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, CONDITION_COLUMNS, 2, gl.RGBA, gl.FLOAT, columns);
    },
    update(inputs) {
      fillPieces(inputs);
      acc += inputs.dt * opts.stepsPerSecond;
      let steps = Math.min(Math.max(1, Math.round(3 * inputs.load)), Math.floor(acc));
      acc = Math.min(acc - steps, 1);
      if (steps === 0 && (inputs.stamps.length > 0 || clearNext)) steps = 1;
      while (steps-- > 0) stepOnce(inputs, fillPuffs(inputs.stamps));
    },
    snippet: SNIPPET,
    bind(p, unit) {
      bindTexture(gl, unit, trail.front.texture, p.u("u_slimeTrail"));
      gl.uniform2f(p.u("u_slimeSize"), gridW, gridH);
      gl.uniform1f(p.u("u_slimeGain"), 0.06);
    },
    requestStats() {
      if (readback.busy) return;
      gl.bindVertexArray(vao);
      statsProg.use();
      bindTexture(gl, 0, trail.front.texture, statsProg.u("u_trail"));
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
      cursor = 0;
    },
    dispose() {
      agents.dispose();
      trail.dispose();
      deleteTarget(gl, statsTarget);
      readback.dispose();
      gl.deleteTexture(cond);
      gl.deleteVertexArray(vao);
      for (const p of [update, deposit, diffuse, statsProg]) gl.deleteProgram(p.program);
    },
  };
};
