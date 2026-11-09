/**
 * The glass itself, laid over the composed feed: a faint sheen of the room's lights that stays
 * put on the ball, three soft windows a third of a turn apart. Where no viewer sees the glass
 * at all (high up between two of them) the views have nothing true to show, so it fades into
 * the water's colour there.
 *
 * Above the waterline nobody sees the inside well (the views see it only edge on), so the
 * overlay paints that cap itself: the bright line of the meniscus, dim air, the bowl's rim.
 */
import { NormalBlending, Vector3 } from "three";
import type { Renderer3D } from "../../core/renderer3d";
import { WHOLE_SPHERE } from "../../core/sphere";
import { createSurfacePass, type SectorViews } from "../../core/sphere3d";
import type { FrameInfo } from "../../core/types";

/** Room for every viewer `SectorViews` uses, the one underneath included. */
const MAX_EYES = 8;

const GLASS = /* glsl */ `
uniform vec3 uEyes[${MAX_EYES}];
uniform int uEyeCount;
uniform vec3 uCentre;
uniform float uRadius;
uniform float uWaterLat;
uniform vec3 uHaze;
vec4 surface(vec3 dir) {
  vec3 p = uCentre + uRadius * dir;
  float best = -1.0;
  for (int i = 0; i < ${MAX_EYES}; i++) {
    if (i >= uEyeCount) break;
    best = max(best, dot(dir, normalize(uEyes[i] - p)));
  }
  float blind = smoothstep(0.28, 0.06, best);
  vec2 ll = sphereLatLon(dir);
  float lat = ll.x;
  float third = 2.0943951;
  float lon = mod(ll.y + 0.6, third) - third * 0.5;
  float window = smoothstep(0.16, 0.07, abs(lon)) * smoothstep(-0.1, 0.15, lat) * smoothstep(uWaterLat, uWaterLat - 0.3, lat);
  vec3 sheen = vec3(0.016, 0.019, 0.022) * window;

  // The cap above the waterline.
  float cap = smoothstep(uWaterLat - 0.003, uWaterLat + 0.003, lat);
  float meniscus = exp(-pow((lat - uWaterLat - 0.004) / 0.007, 2.0));
  vec3 air = mix(vec3(0.03, 0.045, 0.05), vec3(0.01, 0.014, 0.016), smoothstep(uWaterLat, 1.45, lat));
  float lip = exp(-pow((lat - 1.24) / 0.03, 2.0));
  air += vec3(0.03, 0.034, 0.036) * lip;
  float a = max(cap, blind);
  vec3 rgb = mix(mix(sheen, uHaze, blind), air, cap) + vec3(0.14, 0.17, 0.17) * meniscus;
  return vec4(rgb, a);
}
`;

export interface Glass {
  render(): void;
  resize(frame: FrameInfo, water: number): void;
}

export const createGlass = (
  r3d: Renderer3D,
  frame: FrameInfo,
  views: SectorViews,
  water: number,
): Glass => {
  const eyes = Array.from({ length: MAX_EYES }, () => new Vector3());
  const uniforms = {
    uEyes: { value: eyes },
    uEyeCount: { value: 0 },
    uCentre: { value: new Vector3() },
    uRadius: { value: 1 },
    uWaterLat: { value: 0.8 },
    uHaze: { value: new Vector3(0.028, 0.1, 0.11) },
  };
  const pass = createSurfacePass(r3d, frame, { fragment: GLASS, uniforms });
  pass.material.transparent = true;
  pass.material.premultipliedAlpha = true;
  pass.material.blending = NormalBlending;

  const place = (f: FrameInfo, w: number) => {
    const s = f.sphere ?? WHOLE_SPHERE;
    uniforms.uWaterLat.value = Math.asin(w);
    uniforms.uCentre.value.set(0, s.centreY, 0);
    uniforms.uRadius.value = s.radius;
    const list = views.viewers.slice(0, MAX_EYES);
    list.forEach((v, i) => eyes[i]!.copy(v.eye));
    uniforms.uEyeCount.value = list.length;
    pass.setSphere(s);
  };
  place(frame, water);

  return {
    render() {
      // Over the views' picture, not instead of it.
      const r = r3d.renderer;
      const clear = r.autoClear;
      r.autoClear = false;
      pass.render();
      r.autoClear = clear;
    },
    resize: place,
  };
};
