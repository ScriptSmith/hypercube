/**
 * The fine snow a shake stirs up: soft specks that cloud the water while the globe is lively,
 * drifting with the same flow as the chips and thinning out as it calms. Only drawn while the
 * water is cloudy. Design metres, in the globe's frame.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
} from "three";
import type { Rng } from "../../core/types";
import { type Eddies, type FlowState, velocityAt } from "./flow";
import { R } from "./mound";

export const CLOUD = 2400;
const SINK = 0.025;
const INSIDE = R - 0.06;

// Points sized by the camera's own projection, since each viewer's field of view differs.
const VERTEX = /* glsl */ `
uniform float uSize;
uniform float uHalf;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min(256.0, uSize * projectionMatrix[1][1] * uHalf / max(0.1, -mvPosition.z));
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - smoothstep(0.0, 1.0, d));
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

export interface Cloud {
  readonly points: Points;
  /** Half the side of each viewer's picture, px, for sizing the specks. */
  setView(half: number): void;
  /** Fill the water with fine snow, for a shake. */
  stir(): void;
  step(dt: number, time: number, flow: FlowState): void;
  /** Show it as thick as `murk`, tinted towards `color`. */
  show(murk: number, color: Color): void;
  dispose(): void;
}

export const createCloud = (rng: Rng, eddies: Eddies): Cloud => {
  const geometry = new BufferGeometry();
  // The attribute keeps this very array, so writing to it moves the specks.
  const attr = new BufferAttribute(new Float32Array(CLOUD * 3), 3);
  const pos = attr.array as Float32Array;
  attr.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", attr);
  const uniforms = {
    uSize: { value: 0.16 },
    uHalf: { value: 512 },
    uColor: { value: new Color() },
  };
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  const u = new Float32Array(3);
  const white = new Color(1, 1, 1);
  let alive = false;
  let peaked = false;
  // The specks move on every other step: they are soft, and there are thousands.
  let skip = false;
  let owed = 0;

  return {
    points,
    stir() {
      for (let i = 0; i < CLOUD; i++) {
        let x = 0;
        let y = 0;
        let z = 0;
        do {
          x = rng.range(-INSIDE, INSIDE);
          y = rng.range(-INSIDE, INSIDE * 0.6);
          z = rng.range(-INSIDE, INSIDE);
        } while (x * x + y * y + z * z > INSIDE * INSIDE);
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;
      }
      alive = true;
      peaked = false;
      attr.needsUpdate = true;
    },
    step(step, time, flow) {
      if (!alive) return;
      owed += step;
      skip = !skip;
      if (skip) return;
      const dt = owed;
      owed = 0;
      for (let i = 0; i < CLOUD; i++) {
        const o = i * 3;
        velocityAt(flow, eddies, time, pos[o]!, pos[o + 1]!, pos[o + 2]!, u);
        let x = pos[o]! + u[0]! * dt;
        let y = pos[o + 1]! + (u[1]! - SINK) * dt;
        let z = pos[o + 2]! + u[2]! * dt;
        const d = Math.hypot(x, y, z);
        if (d > INSIDE) {
          const k = INSIDE / d;
          x *= k;
          y *= k;
          z *= k;
        }
        pos[o] = x;
        pos[o + 1] = y;
        pos[o + 2] = z;
      }
      attr.needsUpdate = true;
    },
    setView(half) {
      uniforms.uHalf.value = half;
    },
    show(murk, color) {
      if (murk > 0.1) peaked = true;
      // Once the water has cleared after its shake, the fine snow has settled.
      if (alive && peaked && murk < 0.01) alive = false;
      points.visible = alive && murk > 0.005;
      if (!points.visible) return;
      uniforms.uColor.value
        .copy(color)
        .lerp(white, 0.5)
        .multiplyScalar(0.3 * Math.min(1, murk));
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
};
