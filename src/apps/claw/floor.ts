/**
 * The ball above and below the arcade strip, as a `SurfacePass`: the arcade's ceiling with a ring
 * of lamps above, and below, the carpet round the bottom pole with the heap of won prizes on it.
 * Everything comes from the shader, so nothing pinches at the pole or breaks at the seam.
 *
 * The prizes on the floor (the heap and those sliding to it) are drawn by the shader from a sprite
 * atlas made once in Canvas2D, each placed by a few uniforms in the floor plane (see heap.ts).
 * Moving a prize costs a uniform, not a texture upload, so the floor redraws every frame while
 * anything on it moves and only now and then otherwise.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace, Vector3, Vector4 } from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass, type SurfacePass } from "../../core/sphere3d";
import type { FrameInfo, SphereInfo } from "../../core/types";
import { DESIGN_IDS, DESIGNS, type DesignId } from "./designs";
import { floorTheta, type Heap, HEAP_MAX, itemLook } from "./heap";
import { drawPlush } from "./plush";

/** Prizes on the heap are a little bigger than in the machines: they are nearer the people under it. */
export const HEAP_SCALE = 1.15;
/** Most prizes the floor draws at once: a full heap, a few fading and every one on its way. */
export const FLOOR_SLOTS = HEAP_MAX + 14;
const ATLAS_MAX = 2048;
const LAMPS = 36;
/** How often the floor redraws when nothing on it moves, s. */
const STILL_REDRAW = 0.5;

const FRAGMENT = /* glsl */ `
#define CLAW_SLOTS ${FLOOR_SLOTS}
uniform sampler2D uAtlas;
uniform vec4 uPose[CLAW_SLOTS];
uniform vec4 uRect[CLAW_SLOTS];
uniform vec4 uBox[CLAW_SLOTS];
uniform int uCount;
uniform float uReach;
uniform float uDiam;
uniform float uTop;
uniform float uBottom;
uniform float uViewTop;
uniform float uHeapR;
uniform float uLamps;
uniform vec3 uNeon;

const float CLAW_TAU = 6.283185307;

float clawHash(vec2 p) {
  p = fract(p * vec2(0.3183, 0.3679) + vec2(0.71, 0.113));
  p *= 17.0;
  return fract(p.x * p.y * (p.x + p.y));
}

// Width-aware edge: 1 inside a band of half width w round d = 0.
float clawLine(float d, float w) {
  float f = fwidth(d) + 1e-5;
  return 1.0 - smoothstep(w - f, w + f, abs(d));
}

vec3 clawPalette(float h) {
  if (h < 0.2) return vec3(1.0, 0.18, 0.62);
  if (h < 0.4) return vec3(0.1, 0.85, 1.0);
  if (h < 0.6) return vec3(0.6, 1.0, 0.15);
  if (h < 0.8) return vec3(0.65, 0.3, 1.0);
  return vec3(1.0, 0.55, 0.1);
}

// Arcade carpet: a dark ground scattered with little neon rings, dots, squiggles and triangles.
vec3 carpet(vec2 p) {
  vec3 c = vec3(0.004, 0.003, 0.014);
  float cell = 0.3;
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = clawHash(id);
  float h2 = clawHash(id + 17.3);
  vec2 q = f - (vec2(clawHash(id + 3.1), clawHash(id + 7.9)) - 0.5) * 0.4;
  float a = h2 * CLAW_TAU;
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
  float m = 0.0;
  float kind = floor(h * 4.0);
  if (kind < 1.0) m = clawLine(length(q) - 0.17, 0.035);
  else if (kind < 2.0) m = 1.0 - smoothstep(0.07, 0.07 + fwidth(length(q)) + 1e-5, length(q));
  else if (kind < 3.0) m = clawLine(q.y - 0.07 * sin(q.x * 18.0), 0.03) * step(abs(q.x), 0.26);
  else {
    vec2 r = abs(q);
    float tri = max(r.x * 0.866 + q.y * 0.5, -q.y) - 0.12;
    m = clawLine(tri, 0.03);
  }
  return c + clawPalette(h2) * 0.022 * m;
}

// The prizes on the floor, oldest first: a soft shadow, then the prize from the atlas.
vec3 prizes(vec3 c, vec2 p) {
  if (dot(p, p) > uReach * uReach) return c;
  for (int i = 0; i < CLAW_SLOTS; i++) {
    if (i >= uCount) break;
    vec4 pose = uPose[i];
    vec4 box = uBox[i];
    vec2 d = p - pose.xy;
    float r = 0.5 * max(box.z, box.w) * pose.w;
    if (dot(d, d) > 1.6 * r * r) continue;
    float alpha = fract(pose.z);
    float ang = floor(pose.z) / 1000.0;
    // Shadow, a little down and to the right.
    vec2 s = d - vec2(0.1, 0.1) * r;
    c *= 1.0 - 0.45 * alpha * exp(-dot(s, s) / (0.28 * r * r));
    // Into the sprite's own frame (canvas axes, u), then the atlas.
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 l = vec2(d.x * ca + d.y * sa, -d.x * sa + d.y * ca) / pose.w;
    vec2 uv = (l + box.xy) / box.zw;
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) continue;
    vec4 t = texture2D(uAtlas, uRect[i].xy + uv * uRect[i].zw);
    c = mix(c, t.rgb, t.a * alpha);
  }
  return c;
}

vec3 floorColour(vec3 dir, float lat) {
  // The floor plane round the bottom pole, metres, x right and y down seen from underneath.
  vec2 p = uDiam * vec2(dir.x, -dir.z) / max(1e-4, 1.0 - dir.y);
  vec3 c = carpet(p);
  float r = length(p);
  // A pool of light on the heap, and the cabinets' feet shading the edge of the floor.
  c *= 1.0 + 2.2 * exp(-r * r / (2.0 * uHeapR * uHeapR * 1.6));
  c += vec3(0.02, 0.012, 0.03) * exp(-r * r / (2.0 * uHeapR * uHeapR * 2.0));
  c *= mix(0.35, 1.0, smoothstep(uBottom, uBottom - 0.06, lat));
  return prizes(c, p);
}

vec3 ceilingColour(vec3 dir, float lat) {
  vec3 c = mix(vec3(0.012, 0.006, 0.022), vec3(0.004, 0.003, 0.01), smoothstep(uTop, uTop + 0.5, lat));
  // A neon tube along the top of the wall.
  float neon = lat - (uTop + 0.012);
  c += uNeon * (exp(-neon * neon / 0.00002) * 1.5 + exp(-neon * neon / 0.0006) * 0.12);
  // A ring of round lamps a little higher.
  float lon = atan(dir.x, dir.z);
  float lampLat = uTop + 0.075;
  float a = lon / CLAW_TAU * uLamps;
  float i = floor(a + 0.5);
  vec2 d = vec2((a - i) * CLAW_TAU / uLamps * cos(lampLat), lat - lampLat);
  float dl = length(d);
  float lamp = 1.0 - smoothstep(0.012, 0.012 + fwidth(dl) + 1e-5, dl);
  c += vec3(1.0, 0.72, 0.42) * (lamp * 0.9 + exp(-dl * dl / 0.0012) * 0.06);
  return c * mix(1.0, 0.35, smoothstep(uViewTop, uViewTop + 0.25, lat));
}

vec4 surface(vec3 dir) {
  float lat = asin(clamp(dir.y, -1.0, 1.0));
  if (lat < uBottom + 0.01) return vec4(floorColour(dir, lat), 1.0);
  if (lat > uTop - 0.01) return vec4(ceilingColour(dir, lat), 1.0);
  return vec4(0.0, 0.0, 0.0, 1.0);
}
`;

export interface FloorGeometry {
  frame: FrameInfo;
  /** The strip's latitudes, radians. */
  top: number;
  bottom: number;
  /** Metres per physics unit, so heap prizes match the machines'. */
  metresPerU: number;
  heapR: number;
}

export interface FloorOptions extends FloorGeometry {
  heap: Heap;
  /** The neon tube along the top of the wall, linear colour. */
  neon: readonly [number, number, number];
}

export interface Floor {
  readonly pass: SurfacePass;
  readonly atlas: HTMLCanvasElement;
  /** Prizes drawn on the floor at the last render. */
  readonly drawn: number;
  /** Draw the ball's caps if anything on the floor moved; returns whether it drew. */
  render(now: number, force?: boolean): boolean;
  setGeometry(o: FloorGeometry): void;
  dispose(): void;
}

interface Cell {
  /** Atlas uv rectangle: corner and size. */
  rect: [number, number, number, number];
  /** The sprite's origin and size in u: from its left and top edges. */
  box: [number, number, number, number];
}

const PAD = 3;

/** Every design and colour drawn once into one picture, at `scale` px per u. */
const buildAtlas = (scale: number) => {
  const items: { id: DesignId; colour: number; w: number; h: number }[] = [];
  for (const id of DESIGN_IDS) {
    const d = DESIGNS[id];
    for (let c = 0; c < d.colourways.length; c++) {
      items.push({
        id,
        colour: c,
        w: Math.ceil((d.box.x1 - d.box.x0) * scale) + 2 * PAD,
        h: Math.ceil((d.box.y1 - d.box.y0) * scale) + 2 * PAD,
      });
    }
  }
  const cellW = Math.max(...items.map((i) => i.w));
  const cellH = Math.max(...items.map((i) => i.h));
  const cols = Math.max(1, Math.min(items.length, Math.floor(ATLAS_MAX / cellW)));
  const rows = Math.ceil(items.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const g = canvas.getContext("2d");
  const cells = new Map<string, Cell>();
  items.forEach((it, n) => {
    const d = DESIGNS[it.id];
    const x = (n % cols) * cellW;
    const y = Math.floor(n / cols) * cellH;
    const ox = -d.box.x0 * scale + PAD;
    const oy = d.box.y1 * scale + PAD;
    if (g) {
      g.save();
      g.translate(x + ox, y + oy);
      g.scale(scale, -scale);
      drawPlush(g, d, it.colour);
      g.restore();
    }
    cells.set(`${it.id}:${it.colour}`, {
      rect: [x / canvas.width, y / canvas.height, it.w / canvas.width, it.h / canvas.height],
      box: [ox / scale, oy / scale, it.w / scale, it.h / scale],
    });
  });
  return { canvas, cells };
};

export const createFloor = (r3d: Renderer3D, o: FloorOptions): Floor => {
  const { heap } = o;
  let geo: FloorGeometry = o;

  const poses = Array.from({ length: FLOOR_SLOTS }, () => new Vector4());
  const rects = Array.from({ length: FLOOR_SLOTS }, () => new Vector4());
  const boxes = Array.from({ length: FLOOR_SLOTS }, () => new Vector4());
  const uniforms = {
    uAtlas: { value: null as CanvasTexture | null },
    uPose: { value: poses },
    uRect: { value: rects },
    uBox: { value: boxes },
    uCount: { value: 0 },
    uReach: { value: 1 },
    uDiam: { value: 5 },
    uTop: { value: 0 },
    uBottom: { value: 0 },
    uViewTop: { value: 0 },
    uHeapR: { value: 1 },
    uLamps: { value: LAMPS },
    uNeon: { value: new Vector3(...o.neon) },
  };
  const pass = createSurfacePass(r3d, o.frame, { fragment: FRAGMENT, uniforms });

  let atlas = buildAtlas(16);
  let texture: CanvasTexture | null = null;
  let atlasScale = 0;
  let drawn = 0;
  let lastDraw = Number.NEGATIVE_INFINITY;
  let dirty = true;

  const sphere = (): SphereInfo => geo.frame.sphere ?? WHOLE_SPHERE;

  const setGeometry = (g: FloorGeometry) => {
    geo = g;
    const s = sphere();
    // About one atlas pixel per feed pixel near the pole.
    const feedH = g.frame.height * g.frame.pixelRatio;
    const pxPerMetre = feedH / ((s.cover.top - s.cover.bottom) * s.radius);
    const scale = Math.max(8, Math.round(g.metresPerU * HEAP_SCALE * pxPerMetre));
    if (scale !== atlasScale) {
      atlas.canvas.width = atlas.canvas.height = 0;
      atlas = buildAtlas(scale);
      texture?.dispose();
      texture = new CanvasTexture(atlas.canvas);
      texture.flipY = false;
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      uniforms.uAtlas.value = texture;
      atlasScale = scale;
    }
    pass.setSphere(s);
    uniforms.uDiam.value = 2 * s.radius;
    uniforms.uTop.value = g.top;
    uniforms.uBottom.value = g.bottom;
    uniforms.uViewTop.value = s.view.top;
    uniforms.uHeapR.value = g.heapR;
    dirty = true;
  };
  setGeometry(o);

  let n = 0;
  let reach = 0;
  const place = (
    design: DesignId,
    colour: number,
    x: number,
    y: number,
    angle: number,
    size: number,
    alpha: number,
  ) => {
    if (n >= FLOOR_SLOTS || alpha <= 0.002) return;
    const cell = atlas.cells.get(`${design}:${colour % DESIGNS[design].colourways.length}`);
    if (!cell) return;
    const s = sphere();
    // The flat floor plane spreads out away from the pole; draw a little bigger to match.
    const spread = 1 / Math.cos(floorTheta(s.radius, x, y) / 2) ** 2;
    const metresPerU = geo.metresPerU * HEAP_SCALE * size * spread;
    // Angle and opacity share one float, to keep to three uniforms a prize: whole thousandths of
    // a radian, opacity in the fraction.
    const turn = angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
    const a = Math.round(turn * 1000);
    poses[n]!.set(x, y, a + Math.min(0.999, Math.max(0, alpha)), metresPerU);
    rects[n]!.set(...cell.rect);
    boxes[n]!.set(...cell.box);
    reach = Math.max(reach, Math.hypot(x, y) + Math.max(cell.box[2], cell.box[3]) * metresPerU);
    n++;
  };

  return {
    pass,
    get atlas() {
      return atlas.canvas;
    },
    get drawn() {
      return drawn;
    },
    render(now, force = false) {
      const moving = heap.moving(now);
      if (!force && !dirty && !moving && now - lastDraw < STILL_REDRAW) return false;
      n = 0;
      reach = 0;
      for (const it of heap.items) {
        const look = itemLook(it, now);
        place(it.design, it.colour, it.x, it.y, it.angle, look.scale, look.alpha);
      }
      for (const f of heap.flights) {
        const p = heap.pose(f, now);
        if (p.stage !== "fall" && p.stage !== "slide") continue;
        // Machine size while it falls, growing to heap size as it slides in.
        const grow = p.stage === "slide" ? p.k : 0;
        const size = (1 + (HEAP_SCALE - 1) * grow) / HEAP_SCALE;
        place(f.design, f.colour, p.x, p.y, p.turn + f.door.lon, size, 1);
      }
      uniforms.uCount.value = n;
      uniforms.uReach.value = reach;
      drawn = n;
      pass.render();
      lastDraw = now;
      dirty = false;
      return true;
    },
    setGeometry,
    dispose() {
      texture?.dispose();
      atlas.canvas.width = atlas.canvas.height = 0;
    },
  };
};
