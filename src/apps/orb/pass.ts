import {
  type IUniform,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type WebGLRenderTarget,
} from "three";
import type { Renderer3D } from "../../core/renderer3d";

const FEED_VERTEX = /* glsl */ `
varying vec2 vFeed;
void main() {
  vFeed = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export interface Pass {
  readonly material: ShaderMaterial;
  render(target: WebGLRenderTarget | null): void;
}

/**
 * A shader over the whole of the canvas or a target, compiled in the background with the
 * renderer and disposed with it. The default vertex shader gives `vFeed`, 0 to 1 across and 0
 * to 1 down from the top row, as `SurfacePass` does.
 */
export const createPass = (
  r3d: Renderer3D,
  fragment: string,
  uniforms: Record<string, IUniform>,
  vertex = FEED_VERTEX,
): Pass => {
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  r3d.prepare(scene, camera);
  return {
    material,
    render(target) {
      const r = r3d.renderer;
      r.setRenderTarget(target);
      r.render(scene, camera);
      r.setRenderTarget(null);
    },
  };
};
