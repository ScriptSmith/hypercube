/**
 * The lamp's shadows. Once a frame the tank's fish, plants, stones and wood are drawn from the
 * lamp's side into a depth map; every surface then looks itself up in it to see whether
 * something stands between it and the lamp. Each caster draws with a copy of its own vertex
 * shader (so swimming fish and swaying plants cast moving shadows) and an empty fragment shader.
 */
import {
  type Camera,
  DepthTexture,
  InstancedMesh,
  Matrix4,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import type { TankBox } from "./tank";

export interface LampShadow {
  /** Uniforms every receiving material shares. */
  readonly uniforms: {
    uShadowMap: { value: DepthTexture };
    uShadowMatrix: { value: Matrix4 };
    uShadowTexel: { value: Vector2 };
    uShadowOn: { value: number };
  };
  /** The casters' stand-ins, for compiling ahead (`Renderer3D.prepare`). */
  readonly scene: Scene;
  readonly camera: Camera;
  /** Cast a shadow with `mesh`: a stand-in sharing its geometry and instances. */
  caster(mesh: Mesh | InstancedMesh): void;
  /** Draw the casters into the map. */
  render(renderer: WebGLRenderer): void;
  dispose(): void;
}

const EMPTY_FRAG = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

export const createLampShadow = (
  box: TankBox,
  light: Vector3,
  size: { width: number; height: number },
): LampShadow => {
  const depth = new DepthTexture(size.width, size.height, UnsignedIntType);
  depth.minFilter = NearestFilter;
  depth.magFilter = NearestFilter;
  const target = new WebGLRenderTarget(size.width, size.height, {
    depthTexture: depth,
    depthBuffer: true,
  });

  // Look down along the light at the whole tank, the frustum fitted round its box.
  const camera = new OrthographicCamera();
  const centre = new Vector3((box.left + box.right) / 2, (box.floor + box.water) / 2, box.back / 2);
  const dir = light.clone().normalize();
  camera.position.copy(centre).addScaledVector(dir, 20);
  camera.up.set(0, 0, -1);
  camera.lookAt(centre);
  camera.updateMatrixWorld(true);
  const view = camera.matrixWorldInverse;
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [box.left, box.right]) {
    for (const y of [box.floor, box.water + 0.1]) {
      for (const z of [box.back, 0]) {
        const p = new Vector3(x, y, z).applyMatrix4(view);
        lo.min(p);
        hi.max(p);
      }
    }
  }
  camera.left = lo.x;
  camera.right = hi.x;
  camera.bottom = lo.y;
  camera.top = hi.y;
  camera.near = -hi.z - 0.5;
  camera.far = -lo.z + 0.5;
  camera.updateProjectionMatrix();

  const bias = new Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const matrix = new Matrix4().multiplyMatrices(bias, camera.projectionMatrix).multiply(view);

  const uniforms = {
    uShadowMap: { value: depth },
    uShadowMatrix: { value: matrix },
    uShadowTexel: { value: new Vector2(1 / size.width, 1 / size.height) },
    uShadowOn: { value: 1 },
  };
  const scene = new Scene();
  const materials: ShaderMaterial[] = [];
  const stands: { mesh: Mesh | InstancedMesh; stand: Mesh | InstancedMesh }[] = [];

  return {
    uniforms,
    scene,
    camera,
    caster(mesh) {
      const own = mesh.material as ShaderMaterial;
      const m = new ShaderMaterial({
        vertexShader: own.vertexShader,
        fragmentShader: EMPTY_FRAG,
        uniforms: own.uniforms,
        defines: { ...own.defines, DEPTH_PASS: 1 },
        side: own.side,
      });
      m.colorWrite = false;
      materials.push(m);
      let stand: Mesh | InstancedMesh;
      if ((mesh as InstancedMesh).isInstancedMesh) {
        const im = mesh as InstancedMesh;
        const s2 = new InstancedMesh(im.geometry, m, im.count);
        s2.instanceMatrix = im.instanceMatrix;
        stand = s2;
      } else {
        stand = new Mesh(mesh.geometry, m);
      }
      stand.frustumCulled = false;
      scene.add(stand);
      stands.push({ mesh, stand });
    },
    render(renderer) {
      if (uniforms.uShadowOn.value < 0.5) return;
      for (const { mesh, stand } of stands) {
        stand.visible = mesh.visible;
        if ((mesh as InstancedMesh).isInstancedMesh) {
          (stand as InstancedMesh).count = (mesh as InstancedMesh).count;
        }
      }
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
    },
    dispose() {
      target.dispose();
      depth.dispose();
      for (const m of materials) m.dispose();
    },
  };
};
