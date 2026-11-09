/**
 * Drawing the snow: every flake is a small flat chip, tumbling while it floats and lying flat
 * where it rests. Floating flakes are drawn in the globe's frame and resting ones in the turning
 * scene's frame, as two instanced meshes sharing one shape and one shiny material, so a chip
 * catches the light as it turns.
 */
import {
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  MeshPhongMaterial,
} from "three";
import type { Rng } from "../../core/types";
import { FLOATING, RESTING, type Snow } from "./snow";

/**
 * A chip about one unit across: an uneven five-sided flake, flat, facing up. Five sides look
 * round at the size a chip is drawn, for few triangles: there are thousands, four views each.
 */
const chipGeometry = (rng: Rng): BufferGeometry => {
  const sides = 5;
  const pos: number[] = [];
  const nor: number[] = [];
  const rim: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const r = 0.5 * rng.range(0.78, 1.05);
    rim.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  // A fan from the first corner: three triangles.
  const [ox, oz] = rim[0]!;
  for (let i = 1; i < sides - 1; i++) {
    const [ax, az] = rim[i]!;
    const [bx, bz] = rim[i + 1]!;
    pos.push(ox, 0, oz, bx, 0, bz, ax, 0, az);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  return g;
};

export interface FlakeMeshes {
  readonly floating: InstancedMesh;
  readonly resting: InstancedMesh;
  readonly material: MeshPhongMaterial;
  /**
   * Copy the snow's flakes into the two meshes; without `resting`, only the floating ones (the
   * settled chips only add sparkle, which a software renderer can't afford).
   */
  update(snow: Snow, resting?: boolean): void;
  dispose(): void;
}

export const createFlakeMeshes = (rng: Rng, snow: Snow): FlakeMeshes => {
  const geometry = chipGeometry(rng);
  const material = new MeshPhongMaterial({
    color: "#f6f8fc",
    specular: new Color(0.9, 0.92, 1),
    shininess: 60,
    emissive: new Color(0.03, 0.035, 0.045),
    side: DoubleSide,
  });
  const make = () => {
    const m = new InstancedMesh(geometry, material, snow.count);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = false;
    // Each flake a touch whiter or bluer than the next.
    const c = new Color();
    for (let i = 0; i < snow.count; i++) {
      const k = rng.range(0.88, 1);
      m.setColorAt(i, c.setRGB(k, k, Math.min(1, k * rng.range(1, 1.06))));
    }
    m.count = 0;
    return m;
  };
  const floating = make();
  const resting = make();

  // Colours follow each flake into whichever mesh draws it.
  const tint = new Float32Array(snow.count * 3);
  tint.set((floating.instanceColor!.array as Float32Array).subarray(0, snow.count * 3));

  const write = (
    out: Float32Array,
    k: number,
    r00: number,
    r01: number,
    r02: number,
    r10: number,
    r11: number,
    r12: number,
    r20: number,
    r21: number,
    r22: number,
    s: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const o = k * 16;
    // Column by column, as three.js keeps matrices.
    out[o] = r00 * s;
    out[o + 1] = r10 * s;
    out[o + 2] = r20 * s;
    out[o + 3] = 0;
    out[o + 4] = r01 * s;
    out[o + 5] = r11 * s;
    out[o + 6] = r21 * s;
    out[o + 7] = 0;
    out[o + 8] = r02 * s;
    out[o + 9] = r12 * s;
    out[o + 10] = r22 * s;
    out[o + 11] = 0;
    out[o + 12] = x;
    out[o + 13] = y;
    out[o + 14] = z;
    out[o + 15] = 1;
  };

  return {
    floating,
    resting,
    material,
    update(sn, withResting = true) {
      const fm = floating.instanceMatrix.array as Float32Array;
      const rm = resting.instanceMatrix.array as Float32Array;
      const fc = floating.instanceColor!.array as Float32Array;
      const rc = resting.instanceColor!.array as Float32Array;
      let f = 0;
      let r = 0;
      const { state, pos, size, axis, angle, lie } = sn;
      for (let i = 0; i < sn.count; i++) {
        const st = state[i];
        const o = i * 3;
        const s = size[i]!;
        if (st === FLOATING) {
          const ax = axis[o]!;
          const ay = axis[o + 1]!;
          const az = axis[o + 2]!;
          const a = angle[i]!;
          const c = Math.cos(a);
          const sn2 = Math.sin(a);
          const t = 1 - c;
          write(
            fm,
            f,
            t * ax * ax + c,
            t * ax * ay - sn2 * az,
            t * ax * az + sn2 * ay,
            t * ax * ay + sn2 * az,
            t * ay * ay + c,
            t * ay * az - sn2 * ax,
            t * ax * az - sn2 * ay,
            t * ay * az + sn2 * ax,
            t * az * az + c,
            s,
            pos[o]!,
            pos[o + 1]!,
            pos[o + 2]!,
          );
          fc[f * 3] = tint[o]!;
          fc[f * 3 + 1] = tint[o + 1]!;
          fc[f * 3 + 2] = tint[o + 2]!;
          f++;
        } else if (st === RESTING && withResting) {
          // Turned round y by `yaw`, then tipped about its own x by `tilt`.
          const yaw = lie[i * 2]!;
          const tilt = lie[i * 2 + 1]!;
          const cy = Math.cos(yaw);
          const sy = Math.sin(yaw);
          const ct = Math.cos(tilt);
          const st2 = Math.sin(tilt);
          write(
            rm,
            r,
            cy,
            sy * st2,
            sy * ct,
            0,
            ct,
            -st2,
            -sy,
            cy * st2,
            cy * ct,
            s,
            pos[o]!,
            pos[o + 1]!,
            pos[o + 2]!,
          );
          rc[r * 3] = tint[o]!;
          rc[r * 3 + 1] = tint[o + 1]!;
          rc[r * 3 + 2] = tint[o + 2]!;
          r++;
        }
      }
      floating.count = f;
      resting.count = r;
      for (const [m, k] of [
        [floating, f],
        [resting, r],
      ] as const) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, Math.max(1, k) * 16);
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor!.clearUpdateRanges();
        m.instanceColor!.addUpdateRange(0, Math.max(1, k) * 3);
        m.instanceColor!.needsUpdate = true;
      }
    },
    dispose() {
      floating.dispose();
      resting.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
};
