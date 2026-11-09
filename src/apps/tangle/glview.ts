/**
 * WebGL2 drawing of one arena.
 *
 * Trails live in a persistent texture. Each frame stamps only the segments laid since the last
 * one: a capsule with a white-hot centre, a coloured core and a soft glow, blended with MAX so
 * overlapping stamps of one line never build up. The alpha channel keeps the time each texel
 * was laid, so the display pass can fade old trail out and brighten fresh trail without
 * redrawing anything. Snake bodies move, so they are stamped straight onto the canvas each frame.
 * Heads, food and sparks are instanced sprites added on top.
 *
 * Solid edges are a bright rim. Wrapping edges are a soft glow with a broken line along them,
 * so they read as a way through; snake bodies are cut where they cross one, and bodies and
 * sprites are clipped to the arena so the copies the view adds past each edge show only inside.
 *
 * If the context is lost the picture comes back from the occupancy grid once it is restored.
 */
import type { Arena } from "./arena";
import { STAMP_FLOATS } from "./arena";
import { FADE_S, HZ } from "./config";
import { createHistory } from "./history";
import { MAX_PIECES, PIECE_FLOATS, splitSegment, wrapDelta } from "./wrap";

/** Seconds of laid time per unit of texture alpha. Rounds are at most 90 s plus results. */
const TIME_SCALE = 128;
/** Trail textures stay under this many texels; larger canvases sample them a little soft. */
const MAX_TRAIL_TEXELS = 9_000_000;
const SEG_BATCH = 8192;
const SPRITE_CAP = 2048;
/** Fading trails are redrawn from their history this often, so faded trail leaves no ghosts. */
const REDRAW_S = 0.5;
/** Enough merged segments for 24 lines at top speed over FADE_S. */
const HISTORY_CAP = 32_768;

export interface Geometry {
  /** Canvas size in device px. */
  width: number;
  height: number;
  /** The arena inside the canvas, in device px from the top left. */
  domain: { x: number; y: number; width: number; height: number };
  /** Arena size in arena units. */
  units: { width: number; height: number };
}

/** Sprite kinds, matching the fragment shader. */
export const SPRITE = { head: 0, hollow: 1, ringed: 2, spark: 3, food: 4, dead: 5 } as const;

export interface Sprites {
  readonly data: Float32Array;
  count: number;
  /** x, y, radius (units), kind, then r, g, b, a. */
  push(
    x: number,
    y: number,
    r: number,
    kind: number,
    cr: number,
    cg: number,
    cb: number,
    a: number,
  ): void;
}

export const createSprites = (cap = SPRITE_CAP): Sprites => {
  const data = new Float32Array(cap * 8);
  const s: Sprites = {
    data,
    count: 0,
    push(x, y, r, kind, cr, cg, cb, a) {
      if (s.count >= cap) return;
      const k = s.count * 8;
      data[k] = x;
      data[k + 1] = y;
      data[k + 2] = r;
      data[k + 3] = kind;
      data[k + 4] = cr;
      data[k + 5] = cg;
      data[k + 6] = cb;
      data[k + 7] = a;
      s.count++;
    },
  };
  return s;
};

export interface Look {
  /** Line colours, rgb 0 to 1 per line id. */
  colors: Float32Array;
  background: [number, number, number];
  edge: [number, number, number];
}

export interface Frame {
  arena: Arena;
  /** Draw snake bodies this frame (each body's brightness, by line id). */
  bodies: Float32Array | null;
  sprites: Sprites;
  /** -1, or how far down the arena the end-of-round wipe has got (0 to 1). */
  wipe: number;
  /** The winner's colour spreading from its head. */
  flood: {
    r: number;
    g: number;
    b: number;
    a: number;
    x: number;
    y: number;
    radius: number;
  } | null;
}

export interface GlView {
  readonly canvas: HTMLCanvasElement;
  /** False when WebGL2 is unavailable or the context is lost. */
  readonly ok: boolean;
  configure(geo: Geometry): void;
  draw(frame: Frame): void;
  dispose(): void;
}

const STAMP_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeg;
layout(location=2) in vec4 aInfo;
uniform vec4 uMap;
uniform float uGlow;
out vec2 vP;
flat out vec4 vSeg;
flat out vec4 vInfo;
void main() {
  vec2 a = aSeg.xy;
  vec2 b = aSeg.zw;
  vec2 d = b - a;
  float len = length(d);
  vec2 t = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  vec2 p = (a + b) * 0.5 + t * aCorner.x * (len * 0.5 + uGlow) + n * aCorner.y * uGlow;
  vP = p;
  vSeg = aSeg;
  vInfo = aInfo;
  gl_Position = vec4(p * uMap.xy + uMap.zw, 0.0, 1.0);
}`;

const STAMP_FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec4 vSeg;
flat in vec4 vInfo;
uniform float uCore;
uniform float uGlow;
uniform float uPx;
uniform float uGain;
// 1 when the alpha channel holds a width scale (snake bodies) rather than a time.
uniform float uScaled;
out vec4 o;
void main() {
  vec2 pa = vP - vSeg.xy;
  vec2 ba = vSeg.zw - vSeg.xy;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h);
  float aa = 0.8 / uPx;
  float rc = uScaled > 0.5 ? uCore * vInfo.a : uCore;
  float core = 1.0 - smoothstep(rc - aa, rc + aa, d);
  float hot = 1.0 - smoothstep(rc * 0.1, rc * 0.65, d);
  float g = clamp(1.0 - (d - rc) / (uGlow - rc), 0.0, 1.0);
  float glow = g * g * 0.5 + g * g * g * g * 0.25;
  float k = max(core, glow);
  if (k + hot < 0.004) discard;
  o = vec4((vInfo.rgb * k + vec3(hot * 0.55)) * uGain, vInfo.a);
}`;

const DISPLAY_VS = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID & 1) == 0 ? -1.0 : 3.0, (gl_VertexID & 2) == 0 ? -1.0 : 3.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTrails;
uniform vec2 uCanvas;
uniform vec4 uDomain;
uniform vec2 uUnits;
uniform float uPx;
uniform float uNow;
uniform float uFade;
uniform float uTimeScale;
uniform float uWipe;
uniform vec4 uFlood;
uniform vec3 uFloodAt;
uniform vec3 uBg;
uniform vec3 uEdge;
uniform vec2 uGrid;
uniform float uWrap;
out vec4 o;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y);
  vec2 q = (frag - uDomain.xy) / uPx;
  vec2 inner = min(q, uUnits - q);
  float edge = min(inner.x, inner.y);
  float inside = step(0.0, edge);
  vec3 col = uBg;
  // A faint dot grid and a soft lift towards the middle give the floor some depth.
  vec2 c = mod(q, uGrid) - uGrid * 0.5;
  float dotR = max(2.4, 1.2 / uPx);
  col += vec3(0.07, 0.1, 0.16) * (1.0 - smoothstep(dotR * 0.5, dotR, length(c))) * inside;
  vec2 m = q / uUnits - 0.5;
  col += vec3(0.012, 0.02, 0.04) * (1.0 - smoothstep(0.0, 0.7, length(m))) * inside;
  if (inside > 0.5) {
    vec4 t = texture(uTrails, vec2(q.x / uUnits.x, 1.0 - q.y / uUnits.y));
    float age = uNow - t.a * uTimeScale;
    float f = uFade > 0.0 ? 1.0 - smoothstep(uFade - 3.0, uFade, age) : 1.0;
    float fresh = 1.0 + 0.7 * exp(-max(age, 0.0) * 4.0);
    vec3 tc = t.rgb * f * fresh;
    if (uWipe >= 0.0) {
      float front = uWipe * uUnits.y;
      tc *= step(front, q.y);
      tc += uEdge * exp(-abs(q.y - front) / 10.0) * 1.2;
    }
    col += tc;
  }
  float ad = abs(edge);
  if (uWrap > 0.5) {
    // A way through: a soft glow either side of the edge and a broken line along it.
    float along = inner.x < inner.y ? q.y : q.x;
    float dash = smoothstep(0.32, 0.4, abs(fract(along / 56.0) - 0.5));
    col += uEdge * (exp(-ad / 3.0) * 0.7 * dash + exp(-ad / 70.0) * 0.14);
  } else {
    col += uEdge * (exp(-ad / 2.5) * 0.85 + exp(-ad / 30.0) * 0.16);
  }
  if (uFlood.a > 0.0) {
    // A bright ring of the winner's colour spreading out, washing the floor behind it.
    float r = length(q - uFloodAt.xy);
    float behind = 1.0 - smoothstep(uFloodAt.z * 0.85, uFloodAt.z, r);
    float ring = exp(-abs(r - uFloodAt.z) / 70.0);
    col += uFlood.rgb * (behind * 0.35 + ring * 1.2) * uFlood.a * inside;
  }
  o = vec4(min(col, vec3(1.0)), 1.0);
}`;

const SPRITE_VS = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSprite;
layout(location=2) in vec4 aColor;
uniform vec4 uMap;
out vec2 vUv;
flat out float vKind;
flat out vec4 vColor;
void main() {
  vec2 p = aSprite.xy + aCorner * aSprite.z;
  vUv = aCorner;
  vKind = aSprite.w;
  vColor = aColor;
  gl_Position = vec4(p * uMap.xy + uMap.zw, 0.0, 1.0);
}`;

const SPRITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
flat in float vKind;
flat in vec4 vColor;
out vec4 o;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float glow = pow(1.0 - r, 2.2);
  vec3 c;
  int k = int(vKind + 0.5);
  if (k == 3) {
    c = vColor.rgb * exp(-r * r * 7.0) * 1.4;
  } else if (k == 4) {
    float core = 1.0 - smoothstep(0.16, 0.24, r);
    float ring = 1.0 - smoothstep(0.02, 0.06, abs(r - 0.42));
    c = vColor.rgb * (glow * 0.9 + ring * 0.6) + vec3(core);
  } else if (k == 5) {
    float ring = 1.0 - smoothstep(0.03, 0.07, abs(r - 0.24));
    c = vColor.rgb * (ring * 0.7 + glow * 0.25);
  } else {
    // Solid heads are a white-hot disc; hollow ones a ring; ringed ones a ring round a dot.
    float hole = k == 0 ? 0.0 : 1.0 - smoothstep(0.13, 0.18, r);
    float core = (1.0 - smoothstep(0.26, 0.31, r)) * (1.0 - hole);
    float dot2 = k == 2 ? 1.0 - smoothstep(0.06, 0.1, r) : 0.0;
    c = vColor.rgb * glow * 1.3 + mix(vColor.rgb, vec3(1.0), 0.7) * core + vColor.rgb * dot2;
  }
  o = vec4(c * vColor.a, 1.0);
}`;

interface Prog {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

const compile = (gl: WebGL2RenderingContext, vs: string, fs: string, names: string[]): Prog => {
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("createShader failed");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(`tangle shader: ${gl.getShaderInfoLog(s) ?? ""}`);
    }
    return s;
  };
  const p = gl.createProgram();
  if (!p) throw new Error("createProgram failed");
  const v = shader(gl.VERTEX_SHADER, vs);
  const f = shader(gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`tangle program: ${gl.getProgramInfoLog(p) ?? ""}`);
  }
  const u: Prog["u"] = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
};

interface Resources {
  stamp: Prog;
  display: Prog;
  sprite: Prog;
  quad: WebGLBuffer;
  segBuf: WebGLBuffer;
  spriteBuf: WebGLBuffer;
  segVao: WebGLVertexArrayObject;
  spriteVao: WebGLVertexArrayObject;
  emptyVao: WebGLVertexArrayObject;
  float: boolean;
  tex: WebGLTexture | null;
  fbo: WebGLFramebuffer | null;
  texW: number;
  texH: number;
}

export const createGlView = (host: HTMLElement, look: Look): GlView => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;display:block;pointer-events:none;";
  host.append(canvas);
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: "high-performance",
  });
  const segData = new Float32Array(SEG_BATCH * 8);
  const pieces = new Float32Array(MAX_PIECES * PIECE_FLOATS);
  const history = createHistory(HISTORY_CAP);
  let redrawAt = 0;
  let res: Resources | null = null;
  let geo: Geometry | null = null;
  let generation = -1;
  /** The trail texture no longer matches the grid (new size, restored context, dropped stamps). */
  let stale = true;
  let disposed = false;

  const instanced = (buf: WebGLBuffer, quad: WebGLBuffer, stride: number) => {
    const g = gl!;
    const vao = g.createVertexArray();
    if (!vao) throw new Error("createVertexArray failed");
    g.bindVertexArray(vao);
    g.bindBuffer(g.ARRAY_BUFFER, quad);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    for (const [loc, off] of [
      [1, 0],
      [2, 16],
    ] as const) {
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 4, g.FLOAT, false, stride, off);
      g.vertexAttribDivisor(loc, 1);
    }
    g.bindVertexArray(null);
    return vao;
  };

  const build = () => {
    if (!gl || gl.isContextLost()) return;
    const float = gl.getExtension("EXT_color_buffer_float") !== null;
    const stamp = compile(gl, STAMP_VS, STAMP_FS, [
      "uMap",
      "uGlow",
      "uCore",
      "uPx",
      "uGain",
      "uScaled",
    ]);
    const display = compile(gl, DISPLAY_VS, DISPLAY_FS, [
      "uTrails",
      "uCanvas",
      "uDomain",
      "uUnits",
      "uPx",
      "uNow",
      "uFade",
      "uTimeScale",
      "uWipe",
      "uFlood",
      "uFloodAt",
      "uBg",
      "uEdge",
      "uGrid",
      "uWrap",
    ]);
    const sprite = compile(gl, SPRITE_VS, SPRITE_FS, ["uMap"]);
    const quad = gl.createBuffer();
    const segBuf = gl.createBuffer();
    const spriteBuf = gl.createBuffer();
    const emptyVao = gl.createVertexArray();
    if (!quad || !segBuf || !spriteBuf || !emptyVao) throw new Error("buffer allocation failed");
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, segData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, SPRITE_CAP * 32, gl.DYNAMIC_DRAW);
    res = {
      stamp,
      display,
      sprite,
      quad,
      segBuf,
      spriteBuf,
      segVao: instanced(segBuf, quad, 32),
      spriteVao: instanced(spriteBuf, quad, 32),
      emptyVao,
      float,
      tex: null,
      fbo: null,
      texW: 0,
      texH: 0,
    };
    stale = true;
    if (geo) allocate(geo);
  };

  const allocate = (g: Geometry) => {
    if (!gl || !res) return;
    const scale = Math.min(
      1,
      Math.sqrt(MAX_TRAIL_TEXELS / Math.max(1, g.domain.width * g.domain.height)),
    );
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const w = Math.max(1, Math.min(max, Math.round(g.domain.width * scale)));
    const h = Math.max(1, Math.min(max, Math.round(g.domain.height * scale)));
    if (res.tex && res.texW === w && res.texH === h) return;
    if (res.tex) gl.deleteTexture(res.tex);
    if (res.fbo) gl.deleteFramebuffer(res.fbo);
    const tex = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!tex || !fbo) throw new Error("trail texture allocation failed");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, res.float ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && res.float) {
      // Some drivers list the extension but can't render to half floats.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      res.float = false;
      res.tex = null;
      allocate(g);
      return;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    res.tex = tex;
    res.fbo = fbo;
    res.texW = w;
    res.texH = h;
    stale = true;
  };

  const onLost = (e: Event) => {
    e.preventDefault();
    res = null;
  };
  const onRestored = () => {
    try {
      build();
    } catch (err) {
      console.error("[tangle] GPU restore failed", err);
      res = null;
    }
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  try {
    build();
  } catch (err) {
    console.error("[tangle] GPU setup failed", err);
    res = null;
  }

  /** Units to clip space for a viewport covering the trail texture, or the canvas. */
  const texMap = (g: Geometry) => [2 / g.units.width, -2 / g.units.height, -1, 1] as const;
  const canvasMap = (g: Geometry) => {
    const px = g.domain.width / g.units.width;
    return [
      (2 * px) / g.width,
      (-2 * px) / g.height,
      (2 * g.domain.x) / g.width - 1,
      1 - (2 * g.domain.y) / g.height,
    ] as const;
  };

  const drawSegs = (count: number) => {
    if (!gl || !res || count === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.segBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, segData, 0, count * 8);
    gl.bindVertexArray(res.segVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  };

  const useStamp = (map: readonly number[], pxPerUnit: number, arena: Arena) => {
    if (!gl || !res) return;
    const half = arena.params.trail / 2;
    gl.useProgram(res.stamp.p);
    gl.uniform4f(res.stamp.u.uMap!, map[0]!, map[1]!, map[2]!, map[3]!);
    gl.uniform1f(res.stamp.u.uCore!, half);
    gl.uniform1f(res.stamp.u.uGlow!, half * 6);
    gl.uniform1f(res.stamp.u.uPx!, pxPerUnit);
    gl.uniform1f(res.stamp.u.uGain!, 1);
    gl.uniform1f(res.stamp.u.uScaled!, 0);
  };

  /** Lay the whole picture again from the grid, one dot per live cell. */
  const rebuild = (g: Geometry, arena: Arena) => {
    if (!gl || !res || !res.fbo) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
    gl.viewport(0, 0, res.texW, res.texH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (arena.variant === "trails") {
      useStamp(texMap(g), res.texW / g.units.width, arena);
      gl.enable(gl.BLEND);
      gl.blendEquation(gl.MAX);
      const { grid } = arena;
      let n = 0;
      for (let i = 0; i < grid.owner.length; i++) {
        if (!arena.blocks(i, -1)) continue;
        const id = grid.owner[i]! - 1;
        const x = ((i % grid.cols) + 0.5) * grid.cw;
        const y = (Math.floor(i / grid.cols) + 0.5) * grid.ch;
        const k = n * 8;
        segData[k] = x;
        segData[k + 1] = y;
        segData[k + 2] = x;
        segData[k + 3] = y;
        segData[k + 4] = look.colors[id * 3] ?? 1;
        segData[k + 5] = look.colors[id * 3 + 1] ?? 1;
        segData[k + 6] = look.colors[id * 3 + 2] ?? 1;
        segData[k + 7] = grid.stamp[i]! / HZ / TIME_SCALE;
        if (++n === SEG_BATCH) {
          drawSegs(n);
          n = 0;
        }
      }
      drawSegs(n);
      gl.disable(gl.BLEND);
    }
    arena.stamps.count = 0;
    arena.stamps.lost = false;
  };

  /** Clear the trail texture and lay the remembered segments again. */
  const redraw = (g: Geometry, arena: Arena) => {
    if (!gl || !res || !res.fbo) return;
    history.trim(arena.time - FADE_S);
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
    gl.viewport(0, 0, res.texW, res.texH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    useStamp(texMap(g), res.texW / g.units.width, arena);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    const d = history.data;
    let n = 0;
    for (let e = 0; e < history.count; e++) {
      const s = ((history.start + e) % history.cap) * 6;
      const id = d[s + 4]!;
      const k = n * 8;
      segData[k] = d[s]!;
      segData[k + 1] = d[s + 1]!;
      segData[k + 2] = d[s + 2]!;
      segData[k + 3] = d[s + 3]!;
      segData[k + 4] = look.colors[id * 3] ?? 1;
      segData[k + 5] = look.colors[id * 3 + 1] ?? 1;
      segData[k + 6] = look.colors[id * 3 + 2] ?? 1;
      segData[k + 7] = d[s + 5]! / TIME_SCALE;
      if (++n === SEG_BATCH) {
        drawSegs(n);
        n = 0;
      }
    }
    drawSegs(n);
    gl.disable(gl.BLEND);
  };

  const stampNew = (g: Geometry, arena: Arena) => {
    if (!gl || !res || !res.fbo) return;
    const st = arena.stamps;
    if (st.count === 0) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
    gl.viewport(0, 0, res.texW, res.texH);
    useStamp(texMap(g), res.texW / g.units.width, arena);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    let n = 0;
    for (let e = 0; e < st.count; e++) {
      const s = ((st.start + e) % st.cap) * STAMP_FLOATS;
      const id = st.data[s + 4]!;
      if (arena.fade) {
        const d = st.data;
        history.add(d[s]!, d[s + 1]!, d[s + 2]!, d[s + 3]!, id, d[s + 5]!);
      }
      const k = n * 8;
      segData[k] = st.data[s]!;
      segData[k + 1] = st.data[s + 1]!;
      segData[k + 2] = st.data[s + 2]!;
      segData[k + 3] = st.data[s + 3]!;
      segData[k + 4] = look.colors[id * 3] ?? 1;
      segData[k + 5] = look.colors[id * 3 + 1] ?? 1;
      segData[k + 6] = look.colors[id * 3 + 2] ?? 1;
      segData[k + 7] = st.data[s + 5]! / TIME_SCALE;
      if (++n === SEG_BATCH) {
        drawSegs(n);
        n = 0;
      }
    }
    drawSegs(n);
    gl.disable(gl.BLEND);
    st.start = 0;
    st.count = 0;
  };

  const drawBodies = (g: Geometry, arena: Arena, bodies: Float32Array) => {
    if (!gl || !res) return;
    const px = g.domain.width / g.units.width;
    useStamp(canvasMap(g), px, arena);
    // Bodies are a little thicker than trails, tapering to the tail.
    gl.uniform1f(res.stamp.u.uScaled!, 1);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    let n = 0;
    const one = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      id: number,
      gain: number,
      w: number,
    ) => {
      const k = n * 8;
      segData[k] = x0;
      segData[k + 1] = y0;
      segData[k + 2] = x1;
      segData[k + 3] = y1;
      segData[k + 4] = (look.colors[id * 3] ?? 1) * gain;
      segData[k + 5] = (look.colors[id * 3 + 1] ?? 1) * gain;
      segData[k + 6] = (look.colors[id * 3 + 2] ?? 1) * gain;
      segData[k + 7] = w;
      if (++n === SEG_BATCH) {
        drawSegs(n);
        n = 0;
      }
    };
    const W = arena.width;
    const H = arena.height;
    /** A body segment, cut in pieces where it crosses a wrapping edge. */
    const put = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      id: number,
      gain: number,
      w: number,
    ) => {
      if (!arena.wrap) {
        one(x0, y0, x1, y1, id, gain, w);
        return;
      }
      const count = splitSegment(
        x0,
        y0,
        x0 + wrapDelta(x1 - x0, W),
        y0 + wrapDelta(y1 - y0, H),
        W,
        H,
        pieces,
      );
      for (let k = 0; k < count; k++) {
        const o = k * PIECE_FLOATS;
        one(pieces[o]!, pieces[o + 1]!, pieces[o + 2]!, pieces[o + 3]!, id, gain, w);
      }
    };
    // About the same tapered length in both snake variants: grid body points are three times
    // as far apart.
    const taper = arena.variant === "grid" ? 4 : 12;
    for (const l of arena.lines) {
      const gain = bodies[l.id] ?? 0;
      const count = l.bodyCount;
      if (gain <= 0.01 || count === 0) continue;
      let p = arena.bodyPoint(l, 0);
      let px0 = p.x;
      let py0 = p.y;
      for (let k = 1; k < count; k++) {
        p = arena.bodyPoint(l, k);
        const w = 0.55 + 0.85 * Math.min(1, k / Math.min(count, taper));
        put(px0, py0, p.x, p.y, l.id, gain, w);
        px0 = p.x;
        py0 = p.y;
      }
      if (l.alive) put(px0, py0, l.x, l.y, l.id, gain, 1.4);
    }
    drawSegs(n);
    gl.disable(gl.BLEND);
  };

  const drawSprites = (g: Geometry, sprites: Sprites) => {
    if (!gl || !res || sprites.count === 0) return;
    const map = canvasMap(g);
    gl.useProgram(res.sprite.p);
    gl.uniform4f(res.sprite.u.uMap!, map[0], map[1], map[2], map[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, res.spriteBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sprites.data, 0, sprites.count * 8);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(res.spriteVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sprites.count);
    gl.disable(gl.BLEND);
  };

  return {
    canvas,
    get ok() {
      return !!gl && !!res && !gl.isContextLost();
    },

    configure(next) {
      geo = next;
      if (canvas.width !== next.width) canvas.width = next.width;
      if (canvas.height !== next.height) canvas.height = next.height;
      try {
        allocate(next);
      } catch (err) {
        console.error("[tangle] trail texture failed", err);
      }
    },

    draw(f) {
      if (disposed || !gl || !res || !geo || gl.isContextLost() || !res.fbo || !res.tex) return;
      const g = geo;
      const arena = f.arena;
      if (arena.generation !== generation) {
        generation = arena.generation;
        history.clear();
        redrawAt = 0;
        gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (arena.stamps.lost) {
        // Segments were dropped unseen: only the grid knows the whole picture now.
        stale = false;
        history.clear();
        rebuild(g, arena);
        // The history starts again empty; redrawing from it before then would lose trail.
        redrawAt = arena.time + FADE_S;
      } else {
        stampNew(g, arena);
        // A new size or a restored context lost the picture; fading trails redraw anyway.
        if (stale && !arena.fade) rebuild(g, arena);
        else if (arena.fade && (stale || arena.time >= redrawAt)) {
          redraw(g, arena);
          redrawAt = arena.time + REDRAW_S;
        }
        stale = false;
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, g.width, g.height);
      const d = res.display;
      gl.useProgram(d.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.tex);
      gl.uniform1i(d.u.uTrails!, 0);
      gl.uniform2f(d.u.uCanvas!, g.width, g.height);
      gl.uniform4f(d.u.uDomain!, g.domain.x, g.domain.y, g.domain.width, g.domain.height);
      gl.uniform2f(d.u.uUnits!, g.units.width, g.units.height);
      gl.uniform1f(d.u.uPx!, g.domain.width / g.units.width);
      gl.uniform1f(d.u.uNow!, arena.time);
      gl.uniform1f(d.u.uFade!, arena.fade ? FADE_S : 0);
      gl.uniform1f(d.u.uTimeScale!, TIME_SCALE);
      gl.uniform1f(d.u.uWipe!, f.wipe);
      const fl = f.flood;
      gl.uniform4f(d.u.uFlood!, fl?.r ?? 0, fl?.g ?? 0, fl?.b ?? 0, fl?.a ?? 0);
      gl.uniform3f(d.u.uFloodAt!, fl?.x ?? 0, fl?.y ?? 0, fl?.radius ?? 0);
      gl.uniform3f(d.u.uBg!, ...look.background);
      gl.uniform3f(d.u.uEdge!, ...look.edge);
      // On the grid the dots sit on the lane centres, so people can see the lanes snakes run in.
      const dots = Math.max(60, Math.round(arena.params.trail * 7.5));
      if (arena.variant === "grid") gl.uniform2f(d.u.uGrid!, arena.lane.w, arena.lane.h);
      else gl.uniform2f(d.u.uGrid!, dots, dots);
      gl.uniform1f(d.u.uWrap!, arena.wrap ? 1 : 0);
      gl.bindVertexArray(res.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (arena.wrap) {
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(
          Math.round(g.domain.x),
          Math.round(g.height - g.domain.y - g.domain.height),
          Math.round(g.domain.width),
          Math.round(g.domain.height),
        );
      }
      if (f.bodies) drawBodies(g, arena, f.bodies);
      drawSprites(g, f.sprites);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(null);
    },

    dispose() {
      disposed = true;
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      if (gl && res && !gl.isContextLost()) {
        for (const p of [res.stamp, res.display, res.sprite]) gl.deleteProgram(p.p);
        for (const b of [res.quad, res.segBuf, res.spriteBuf]) gl.deleteBuffer(b);
        for (const v of [res.segVao, res.spriteVao, res.emptyVao]) gl.deleteVertexArray(v);
        if (res.tex) gl.deleteTexture(res.tex);
        if (res.fbo) gl.deleteFramebuffer(res.fbo);
      }
      res = null;
      // Let the browser reclaim the context now rather than at garbage collection.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
};
