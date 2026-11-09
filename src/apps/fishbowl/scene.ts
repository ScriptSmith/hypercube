/**
 * The three.js scene inside the ball: materials, meshes, and each frame's copy of the show's
 * state into instance attributes. Everything lives in a group scaled from bowl space (radius
 * 1) to venue metres, so the same scene fits any ball.
 */
import {
  AdditiveBlending,
  BackSide,
  type BufferGeometry,
  CircleGeometry,
  Data3DTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  type IUniform,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
} from "three";
import type { Rng, SphereInfo } from "../../core/types";
import { GRAVEL_TOP, surfaceRadius } from "./bowl";
import { buildCaustics, CAUSTIC_FRAMES, CAUSTIC_SIZE } from "./caustics";
import { buildFishGeometry, PUFF_BALL } from "./fishgeo";
import { FISH_VERT_BODY, fishFragment } from "./fishshader";
import { FISH_LOOKS } from "./looks";
import type { Scenery } from "./scenery";
import {
  BUBBLES,
  buildBed,
  buildBubbles,
  buildDecor,
  buildPebbles,
  buildPlants,
  buildSnail,
  buildSpecks,
} from "./scenegeo";
import * as S from "./shaders";
import type { Show } from "./show";
import { MAX_FLAKES } from "./show";
import type { SpeciesId } from "./species";

/** Linear colours. */
const rgb = (r: number, g: number, b: number) => new Vector3(r, g, b);

const ORDER: readonly SpeciesId[] = [
  "goldfish",
  "fancy",
  "angel",
  "gourami",
  "pleco",
  "tetra",
  "harlequin",
  "cory",
  "puffer",
];

const FISH_VERT = `${S.VERT_COMMON}\n${FISH_VERT_BODY}`;
const FISH_FRAG = fishFragment(S.FRAG_COMMON, "eyeInBowl()", "sunAt(vReal.y)", "");

export interface Shared {
  uniforms: Record<string, IUniform>;
}

export interface BowlScene {
  readonly scene: Scene;
  /** Copy the show into the meshes, for drawing at shader time `t` (seconds within the loop). */
  sync(show: Show, t: number): void;
  /** Follow a resized ball or a new waterline; `targetSide` is the views' render size. */
  resize(sphere: SphereInfo, water: number, targetSide: number): void;
  /** Triangles in one view, for measuring. */
  readonly triangles: number;
  readonly drawCalls: number;
  /** What the renderer's own clean-up doesn't reach (textures held only in uniforms). */
  dispose(): void;
}

const instanced = (count: number, size: number): InstancedBufferAttribute => {
  const a = new InstancedBufferAttribute(new Float32Array(count * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
};

export const createBowlScene = (
  sphere: SphereInfo,
  scenery: Scenery,
  show: Show,
  rng: Rng,
  /** A software renderer: fish without their finest markings. */
  cheap = false,
): BowlScene => {
  const scene = new Scene();
  const bowl = new Group();
  scene.add(bowl);

  const data = buildCaustics();
  const caustic = new Data3DTexture(data, CAUSTIC_SIZE, CAUSTIC_SIZE, CAUSTIC_FRAMES);
  caustic.format = RedFormat;
  caustic.type = UnsignedByteType;
  caustic.minFilter = LinearFilter;
  caustic.magFilter = LinearFilter;
  caustic.wrapS = RepeatWrapping;
  caustic.wrapT = RepeatWrapping;
  caustic.wrapR = RepeatWrapping;
  caustic.unpackAlignment = 1;
  caustic.needsUpdate = true;

  const shared: Record<string, IUniform> = {
    uTime: { value: 0 },
    uWater: { value: show.water },
    uCentre: { value: new Vector3() },
    uRadius: { value: 1 },
    uCaustic: { value: caustic },
    uDeep: { value: rgb(0.006, 0.03, 0.04) },
    uShallow: { value: rgb(0.03, 0.12, 0.13) },
    uFogK: { value: 0.5 },
    uLight: { value: new Vector3(0.22, 1, 0.12).normalize() },
    uSun: { value: rgb(1.05, 1.0, 0.88) },
    uSky: { value: rgb(0.1, 0.17, 0.18) },
    uGround: { value: rgb(0.045, 0.06, 0.06) },
  };
  const material = (
    vertexShader: string,
    fragmentShader: string,
    own: Record<string, IUniform> = {},
    extra: Partial<ShaderMaterial> = {},
  ) => {
    const m = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...own },
    });
    Object.assign(m, extra);
    return m;
  };

  let triangles = 0;
  let drawCalls = 0;
  const count = (geometryTriangles: number, instances = 1) => {
    triangles += geometryTriangles * instances;
    drawCalls++;
  };
  const tris = (g: BufferGeometry) =>
    (g.index ? g.index.count : g.getAttribute("position").count) / 3;

  // The far glass, behind everything.
  const shellGeometry = new SphereGeometry(0.999, 96, 64);
  const shell = new Mesh(
    shellGeometry,
    material(S.SHELL_VERT, S.SHELL_FRAG, {}, { side: BackSide, depthWrite: false }),
  );
  shell.renderOrder = -1;
  count(tris(shellGeometry));

  const bedGeometry = buildBed();
  const bed = new Mesh(bedGeometry, material(S.PLAIN_VERT, S.BED_FRAG));
  count(tris(bedGeometry), 2);

  const pebbles = buildPebbles(rng.fork("pebbles"));
  const stones = new InstancedMesh(
    pebbles.geometry,
    material(S.PEBBLE_VERT, S.PEBBLE_FRAG),
    pebbles.count,
  );
  pebbles.matrices.forEach((m, i) => stones.setMatrixAt(i, m));
  count(tris(pebbles.geometry), pebbles.count);

  const plantGeometry = buildPlants(scenery, rng.fork("plants"));
  const plants = new Mesh(
    plantGeometry,
    material(S.PLANT_VERT, S.PLANT_FRAG, {}, { side: DoubleSide }),
  );
  count(tris(plantGeometry), 2);

  const decorGeometry = buildDecor(scenery);
  const decor = new Mesh(
    decorGeometry,
    material(S.DECOR_VERT, S.DECOR_FRAG, {}, { side: DoubleSide }),
  );
  count(tris(decorGeometry), 2);

  // Fish, one instanced mesh a kind: the real fish first, then their reflections.
  const fishMeshes: {
    id: SpeciesId;
    mesh: InstancedMesh;
    list: Show["fish"][number][];
    a: InstancedBufferAttribute;
    b: InstancedBufferAttribute;
    look: InstancedBufferAttribute;
  }[] = [];
  for (const id of ORDER) {
    const list = show.fish.filter((f) => f.species === id);
    if (list.length === 0) continue;
    const geometry = buildFishGeometry(id);
    const n = list.length * 2;
    const a = instanced(n, 4);
    const b = instanced(n, 4);
    const look = instanced(n, 2);
    geometry.setAttribute("aAnimA", a);
    geometry.setAttribute("aAnimB", b);
    geometry.setAttribute("aLook", look);
    const l = FISH_LOOKS[id];
    const mat = material(
      FISH_VERT,
      FISH_FRAG,
      {
        uKind: { value: l.kind },
        uBack: { value: rgb(...l.back) },
        uSide: { value: rgb(...l.side) },
        uBelly: { value: rgb(...l.belly) },
        uFin: { value: rgb(...l.fin) },
        uIris: { value: rgb(...l.iris) },
        uSeed: { value: list[0]!.tint },
        uBall: { value: PUFF_BALL },
        uFlow: { value: l.flow },
        uSheen: { value: l.sheen },
        // One pass for body and fins, the fins dithered by coverage, to keep the views cheap.
        uPass: { value: -1 },
      },
      { side: DoubleSide, alphaToCoverage: true },
    );
    if (cheap) mat.defines = { FISH_CHEAP: 1 };
    const mesh = new InstancedMesh(geometry, mat, n);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    fishMeshes.push({ id, mesh, list, a, b, look });
    count(tris(geometry), n);
  }

  const snailGeometry = buildSnail();
  const snailData = instanced(show.snails.length * 2, 4);
  snailGeometry.setAttribute("aSnail", snailData);
  const snails = new InstancedMesh(
    snailGeometry,
    material(S.SNAIL_VERT, S.SNAIL_FRAG),
    show.snails.length * 2,
  );
  snails.instanceMatrix.setUsage(DynamicDrawUsage);
  count(tris(snailGeometry), show.snails.length * 2);

  const flakeGeometry = new PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2);
  const flakeData = instanced(MAX_FLAKES * 2, 2);
  flakeGeometry.setAttribute("aFlake", flakeData);
  const flakes = new InstancedMesh(
    flakeGeometry,
    material(S.FLAKE_VERT, S.FLAKE_FRAG, {}, { side: DoubleSide }),
    MAX_FLAKES * 2,
  );
  flakes.instanceMatrix.setUsage(DynamicDrawUsage);
  flakes.count = 0;
  count(tris(flakeGeometry), MAX_FLAKES * 2);

  const column = new Vector3(scenery.air.x, scenery.air.y + 0.02, scenery.air.z);
  const bubbleUniforms = {
    uColumn: { value: column },
    uRise: { value: 0.16 },
    uPeriod: { value: 10 },
  };
  const bubbleGeometry = buildBubbles(rng.fork("bubbles"));
  const bubbles = new Mesh(
    bubbleGeometry,
    material(S.BUBBLE_VERT, S.BUBBLE_FRAG, bubbleUniforms, {
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  bubbles.renderOrder = 5;
  count(tris(bubbleGeometry), BUBBLES * 2);

  const specks = new Points(
    buildSpecks(rng.fork("specks")),
    material(
      S.SPECK_VERT,
      S.SPECK_FRAG,
      { uPointScale: { value: 1 }, uGravel: { value: GRAVEL_TOP + 0.03 } },
      { transparent: true, depthWrite: false, blending: AdditiveBlending },
    ),
  );
  specks.renderOrder = 6;
  drawCalls++;

  const surfaceUniforms = { uColumn: { value: column }, uDisc: { value: 1 } };
  const surfaceGeometry = new CircleGeometry(1, 128).rotateX(-Math.PI / 2);
  const surface = new Mesh(
    surfaceGeometry,
    material(S.SURFACE_VERT, S.SURFACE_FRAG, surfaceUniforms, {
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      side: DoubleSide,
    }),
  );
  surface.renderOrder = 10;
  count(tris(surfaceGeometry));

  const meshes = [
    shell,
    bed,
    stones,
    plants,
    decor,
    ...fishMeshes.map((f) => f.mesh),
    snails,
    flakes,
    bubbles,
    specks,
    surface,
  ];
  for (const m of meshes) {
    // Shaders move everything, so bounds are no use for culling.
    m.frustumCulled = false;
    bowl.add(m);
  }

  const m4 = new Matrix4();
  const x = new Vector3();
  const y = new Vector3();
  const z = new Vector3();
  const p = new Vector3();

  const resize = (s: SphereInfo, water: number, side: number) => {
    bowl.position.set(0, s.centreY, 0);
    bowl.scale.setScalar(s.radius);
    bowl.updateMatrixWorld(true);
    (shared.uCentre!.value as Vector3).set(0, s.centreY, 0);
    shared.uRadius!.value = s.radius;
    shared.uWater!.value = water;
    surfaceUniforms.uDisc.value = surfaceRadius(water) * 0.998;
    // Bubbles take about this long from the air stone to the surface; whole loops for the shader.
    const rise = (water - column.y) / bubbleUniforms.uRise.value;
    bubbleUniforms.uPeriod.value = S.LOOP_SECONDS / Math.max(1, Math.round(S.LOOP_SECONDS / rise));
    // Specks a few render pixels across, at the views' size.
    (specks.material as ShaderMaterial).uniforms.uPointScale!.value = side * 0.012 * s.radius;
  };
  resize(sphere, show.water, 1024);

  return {
    scene,
    get triangles() {
      return triangles;
    },
    get drawCalls() {
      return drawCalls;
    },
    resize,
    dispose() {
      caustic.dispose();
      for (const m of [stones, snails, flakes, ...fishMeshes.map((f) => f.mesh)]) m.dispose();
    },
    sync(sh, t) {
      shared.uTime!.value = t;
      shared.uWater!.value = sh.water;
      for (const fm of fishMeshes) {
        const n = fm.list.length;
        fm.list.forEach((f, i) => {
          x.set(f.fwd[0], f.fwd[1], f.fwd[2]);
          y.set(f.up[0], f.up[1], f.up[2]);
          z.crossVectors(x, y);
          p.set(f.pos[0], f.pos[1], f.pos[2]);
          m4.makeBasis(x.multiplyScalar(f.len), y.multiplyScalar(f.len), z.multiplyScalar(f.len));
          m4.setPosition(p);
          fm.mesh.setMatrixAt(i, m4);
          fm.mesh.setMatrixAt(n + i, m4);
          for (const k of [i, n + i]) {
            fm.a.setXYZW(k, f.phase, f.amp, f.bend, f.mouth);
            fm.b.setXYZW(k, f.puff, f.fin, f.wink, k >= n ? 1 : 0);
            fm.look.setXY(k, f.look, f.tint);
          }
        });
        fm.mesh.instanceMatrix.needsUpdate = true;
        fm.a.needsUpdate = true;
        fm.b.needsUpdate = true;
        fm.look.needsUpdate = true;
      }
      const ns = sh.snails.length;
      sh.snails.forEach((s, i) => {
        // Sole against the glass: x along its way, y into the bowl.
        x.set(s.heading[0], s.heading[1], s.heading[2]);
        y.set(-s.u[0], -s.u[1], -s.u[2]);
        z.crossVectors(x, y);
        p.set(s.u[0], s.u[1], s.u[2]).multiplyScalar(0.993);
        m4.makeBasis(x.multiplyScalar(s.size), y.multiplyScalar(s.size), z.multiplyScalar(s.size));
        m4.setPosition(p);
        snails.setMatrixAt(i, m4);
        snails.setMatrixAt(ns + i, m4);
        snailData.setXYZW(i, s.wave, s.mouth, 0, i);
        snailData.setXYZW(ns + i, s.wave, s.mouth, 1, i);
      });
      snails.instanceMatrix.needsUpdate = true;
      snailData.needsUpdate = true;
      const live = sh.flakes.filter((k) => !k.eaten);
      const nf = live.length;
      live.forEach((k, i) => {
        x.set(Math.cos(k.angle), 0.3 * Math.sin(k.age * 1.7), Math.sin(k.angle)).normalize();
        y.set(0, 1, 0).addScaledVector(x, -x.y).normalize();
        z.crossVectors(x, y);
        p.set(k.pos[0], k.pos[1], k.pos[2]);
        m4.makeBasis(x.multiplyScalar(0.03), y.multiplyScalar(0.03), z.multiplyScalar(0.03));
        m4.setPosition(p);
        flakes.setMatrixAt(i, m4);
        flakes.setMatrixAt(nf + i, m4);
        flakeData.setXY(i, k.tone, 0);
        flakeData.setXY(nf + i, k.tone, 1);
      });
      flakes.count = nf * 2;
      flakes.instanceMatrix.needsUpdate = true;
      flakeData.needsUpdate = true;
    },
  };
};
