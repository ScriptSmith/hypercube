import type { Circle } from "../dish";
import type { Family, StampDef } from "../stamps";
import type { Program } from "./gl";

/**
 * What every rule family's GPU culture offers the app and the renderer. A culture is a fixed set
 * of textures sized once for its world; stamps, washes and conditions come in as small uniform
 * arrays each frame, and nothing grows.
 */
export interface WorldSpec {
  /** World size in venue px. */
  width: number;
  height: number;
  /** A disc (world venue px, origin at the world's top left) outside which nothing lives. */
  mask: Circle | null;
}

export interface StampOp {
  /** World venue px. */
  x: number;
  y: number;
  stamp: StampDef;
  /** Quarter turns in the low two bits, reflection in bit 2. */
  transform: number;
  /** Colour (Life) or strain (slime). */
  color: number;
  seed: number;
}

export interface Wash {
  /** 0 before it starts, rising past 1 as the front crosses the world; negative when idle. */
  front: number;
  /** From the centre outwards (a dish), or left to right. */
  radial: boolean;
}

export interface PieceInput {
  /** World venue px. */
  x: number;
  y: number;
  r: number;
  /** Positive for food, negative for salt, scaled by what is left. */
  strength: number;
}

export interface CultureInputs {
  /** Seconds since the last update. */
  dt: number;
  /** Stamps to place; the culture takes what it can and leaves the rest for the next frame. */
  stamps: StampOp[];
  wash: Wash;
  pieces: readonly PieceInput[];
  /** Seconds since the page started, for noise. */
  time: number;
  /**
   * Share of the full per-frame work to do, from 1 down to about 0.2 when frames run slow, so a
   * weak GPU runs the culture in slow motion rather than stalling the page.
   */
  load: number;
}

/** Blocks across and down in the coverage readback. */
export const STATS_SIZE = 64;

export interface Stats {
  /** Share of the world that is alive (Life), trailed (slime) or patterned (reaction). */
  coverage: number;
  /** Coverage per block, row 0 at the top, 0 to 255. */
  blocks: Uint8Array;
}

export interface Culture {
  readonly family: Family;
  readonly spec: WorldSpec;
  readonly gridW: number;
  readonly gridH: number;
  /** Venue px per texel. */
  readonly cell: number;
  /** Per-column condition parameters: CONDITION_COLUMNS x 2 texels of RGBA. */
  setConditions(columns: Float32Array): void;
  update(inputs: CultureInputs): void;
  /**
   * GLSL with the culture's uniforms and `vec4 cultureColor(vec2 cell, float cellPx)`: colour
   * (rgb) and glow (a) at a position in texels (row 0 at the top), given canvas px per texel.
   */
  readonly snippet: string;
  /** Bind what the snippet needs, starting at texture unit `unit`. */
  bind(p: Program, unit: number): void;
  requestStats(): void;
  pollStats(): Stats | null;
  /** Empty the world at once. */
  clear(): void;
  dispose(): void;
}

export const CONDITION_COLUMNS = 256;

/** Shared GLSL: the wash front and the dish mask in texel space. */
export const GLSL_WORLD = `
uniform vec2 u_washFront;   // x: front (negative when idle), y: 1 for radial
uniform vec3 u_mask;        // disc in texels; r <= 0 means the whole rectangle
uniform ivec2 u_size;

float washDist(vec2 p) {
  if (u_washFront.y > 0.5) {
    vec2 c = u_mask.z > 0.0 ? u_mask.xy : vec2(u_size) * 0.5;
    float r = u_mask.z > 0.0 ? u_mask.z : length(vec2(u_size)) * 0.5;
    return length(p - c) / r;
  }
  return p.x / float(u_size.x);
}
bool washed(vec2 p) { return u_washFront.x >= 0.0 && washDist(p) < u_washFront.x; }
bool outside(vec2 p) {
  if (u_mask.z <= 0.0) return false;
  vec2 d = p - u_mask.xy;
  return dot(d, d) > u_mask.z * u_mask.z;
}
`;

export const setWorldUniforms = (
  gl: WebGL2RenderingContext,
  p: Program,
  spec: WorldSpec,
  cell: number,
  gridW: number,
  gridH: number,
  wash: Wash,
): void => {
  gl.uniform2f(p.u("u_washFront"), wash.front, wash.radial ? 1 : 0);
  const m = spec.mask;
  if (m) gl.uniform3f(p.u("u_mask"), m.x / cell, m.y / cell, m.r / cell);
  else gl.uniform3f(p.u("u_mask"), 0, 0, 0);
  gl.uniform2i(p.u("u_size"), gridW, gridH);
};
