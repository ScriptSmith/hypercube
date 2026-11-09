/**
 * The wall's three.js scene: materials, meshes, and each frame's copy of the tank's state into
 * instance attributes. Venue metres throughout, so meshes need no model matrices.
 */
import {
  AdditiveBlending,
  type BufferGeometry,
  Data3DTexture,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  type IUniform,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  Vector4,
  BufferAttribute,
  BufferGeometry as Geometry,
  IcosahedronGeometry,
  InstancedBufferGeometry,
  Points,
} from "three";
import type { Rng } from "../../core/types";
import { activeVenue } from "../../core/venue";
import { buildCaustics, CAUSTIC_FRAMES, CAUSTIC_SIZE } from "./caustics";
import { buildFishGeometry, PUFF_BALL } from "./fishgeo";
import { FISH_VERT_BODY, fishFragment } from "./fishshader";
import { FISH_LOOKS } from "./looks";
import type { SpeciesId } from "./species";
import type { TankLayout } from "./tank";
import { TANK_FRAG, TANK_OUT, TANK_VERT } from "./tankenv";
import { buildCarpet, buildFlora, near } from "./flora";
import { bakeGroundMap, GROUND_MAP, mapFrame } from "./groundmaps";
import { createLampShadow, type LampShadow } from "./shadow";
import { buildGround, buildPanes, buildRocks, buildSkirt, buildWood, twice } from "./tankgeo";
import * as T from "./tankshaders";
import { MAX_FOOD, type TankShow } from "./tankshow";
import { buildNerite, buildShrimp } from "./critters";
import { LOOP_SECONDS } from "./shaders";
import { TAU } from "./vec";

const rgb = (r: number, g: number, b: number) => new Vector3(r, g, b);

/** A ring on the glass: where (metres), how old (seconds), and whether still held. */
export interface Ring {
  x: number;
  y: number;
  age: number;
  held: boolean;
}

const MAX_RINGS = 16;
const BUBBLES = 70;
const SPECKS = 700;

export interface TankSceneOptions {
  /** Mesh density: 1 on a software renderer, 2 on a GPU. */
  detail: number;
  /**
   * A software renderer (tests, shots, soaks): no lamp shadows, light shafts or reflections of
   * plants, and a thinner carpet, so a frame takes a fraction of a second rather than several.
   */
  light?: boolean;
}

export interface TankScene {
  readonly scene: Scene;
  /** The lamp's shadow map: draw it before the scene each frame. */
  readonly lamp: LampShadow;
  /** Follow the drawing buffer's height in pixels (specks are drawn a few pixels across). */
  resize(pixelHeight: number): void;
  /** Copy the tank's state in, with the rings to show on the glass. */
  sync(show: TankShow, t: number, rings: readonly Ring[]): void;
  readonly triangles: number;
  readonly drawCalls: number;
  dispose(): void;
}

const instanced = (count: number, size: number): InstancedBufferAttribute => {
  const a = new InstancedBufferAttribute(new Float32Array(count * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
};

const ORDER: readonly SpeciesId[] = [
  "pleco",
  "cory",
  "goldfish",
  "fancy",
  "puffer",
  "angel",
  "gourami",
  "harlequin",
  "tetra",
];

export const createTankScene = (
  layout: TankLayout,
  show: TankShow,
  rng: Rng,
  opts: TankSceneOptions,
): TankScene => {
  const scene = new Scene();
  const { box } = layout;

  const caustic = new Data3DTexture(buildCaustics(), CAUSTIC_SIZE, CAUSTIC_SIZE, CAUSTIC_FRAMES);
  caustic.format = RedFormat;
  caustic.type = UnsignedByteType;
  caustic.minFilter = LinearFilter;
  caustic.magFilter = LinearFilter;
  caustic.wrapS = RepeatWrapping;
  caustic.wrapT = RepeatWrapping;
  caustic.wrapR = RepeatWrapping;
  caustic.unpackAlignment = 1;
  caustic.needsUpdate = true;

  const frameOfMaps = mapFrame(layout);
  const groundMap = new DataTexture(bakeGroundMap(layout), GROUND_MAP.width, GROUND_MAP.height);
  groundMap.minFilter = LinearFilter;
  groundMap.magFilter = LinearFilter;
  groundMap.needsUpdate = true;
  const light = new Vector3(0.18, 1, 0.22).normalize();
  const lamp = createLampShadow(
    box,
    light,
    opts.detail > 1 ? { width: 4096, height: 1024 } : { width: 1024, height: 256 },
  );
  if (opts.light) lamp.uniforms.uShadowOn.value = 0;

  const rafts = layout.rafts.slice(0, 2).map((r) => new Vector4(r.x, r.z, r.r, 1));
  while (rafts.length < 2) rafts.push(new Vector4(0, 0, 0, 0));
  const shared: Record<string, IUniform> = {
    uTime: { value: 0 },
    uWater: { value: box.water },
    uBox: { value: new Vector4(box.left, box.right, box.back, box.floor) },
    uCaustic: { value: caustic },
    uDeep: { value: rgb(0.008, 0.026, 0.026) },
    uShallow: { value: rgb(0.045, 0.11, 0.1) },
    uFogK: { value: 0.1 },
    uLight: { value: light },
    uGroundMap: { value: groundMap },
    ...lamp.uniforms,
    uMaps: {
      value: new Vector4(frameOfMaps.x0, frameOfMaps.z0, 1 / frameOfMaps.sx, 1 / frameOfMaps.sz),
    },
    uSun: { value: rgb(2.3, 2.2, 2.0) },
    uSky: { value: rgb(0.3, 0.4, 0.38) },
    uGround: { value: rgb(0.11, 0.1, 0.075) },
    uShafts: { value: opts.light ? 0 : 1 },
    uRafts: { value: rafts },
    uBubbler: { value: new Vector3(...layout.airstone) },
  };
  const material = (
    vertexShader: string,
    fragmentShader: string,
    own: Record<string, IUniform> = {},
    extra: Partial<ShaderMaterial> = {},
  ) => {
    const m = new ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...shared, ...own } });
    Object.assign(m, extra);
    return m;
  };

  let triangles = 0;
  let drawCalls = 0;
  const tris = (g: BufferGeometry, instances = 1) => {
    triangles += ((g.index ? g.index.count : g.getAttribute("position").count) / 3) * instances;
    drawCalls++;
  };
  const meshes: Mesh[] = [];
  const keep = <M extends Mesh>(m: M, order = 0): M => {
    m.frustumCulled = false;
    m.renderOrder = order;
    meshes.push(m);
    scene.add(m);
    return m;
  };

  const sand = {
    uSand: { value: rgb(0.3, 0.235, 0.155) },
    uGrit: { value: rgb(0.11, 0.095, 0.08) },
  };

  const panes = buildPanes(box);
  // Meshes with a mirrored copy draw both faces, since the reflection turns them inside out.
  keep(
    new Mesh(
      panes,
      material(
        T.PANE_VERT,
        T.PANE_FRAG,
        {
          uBackTop: { value: rgb(0.06, 0.13, 0.13) },
          uBackLow: { value: rgb(0.008, 0.02, 0.02) },
        },
        { side: DoubleSide },
      ),
    ),
    -2,
  );
  tris(panes, 2);

  const groundGeometry = buildGround(layout, opts.detail);
  keep(new Mesh(groundGeometry, material(T.PLAIN_VERT, T.GROUND_FRAG, sand)), -1);
  tris(groundGeometry);

  const skirt = buildSkirt(layout);
  keep(new Mesh(skirt, material(T.PLAIN_VERT, T.SKIRT_FRAG, sand)), -1);
  tris(skirt);

  const rocks = buildRocks(layout, opts.detail);
  lamp.caster(keep(new Mesh(rocks, material(T.HARD_VERT, T.HARD_FRAG, {}, { side: DoubleSide }))));
  tris(rocks, 2);
  const wood = buildWood(layout, rng.fork("wood"), opts.detail);
  lamp.caster(keep(new Mesh(wood, material(T.HARD_VERT, T.HARD_FRAG, {}, { side: DoubleSide }))));
  tris(wood, 2);

  const floraCtx = { water: box.water, ground: layout.ground, detail: opts.detail };
  const flora = buildFlora(
    layout.plants,
    opts.light ? { ...floraCtx, detail: 0.5 } : floraCtx,
    rng.fork("flora"),
  );
  const tallPlants = twice(flora.tall);
  if (opts.light) tallPlants.instanceCount = 1;
  lamp.caster(
    keep(
      new Mesh(tallPlants, material(T.plantVert(true), T.PLANT_FRAG, {}, { side: DoubleSide })),
      0,
    ),
  );
  tris(tallPlants, 2);
  lamp.caster(
    keep(
      new Mesh(flora.low, material(T.plantVert(false), T.PLANT_FRAG, {}, { side: DoubleSide })),
      0,
    ),
  );
  tris(flora.low);
  const roots = layout.plants.filter(
    (p) => p.kind !== "frogbit" && p.kind !== "moss" && p.kind !== "fern",
  );
  const avoid = near(
    [
      ...roots.map((p) => [p.x, p.y, p.z] as const),
      ...layout.rocks.map((r) => [r.x, 0, r.z] as const),
    ],
    0.45,
  );
  const carpet = buildCarpet(
    layout.carpet,
    opts.light ? { ...floraCtx, detail: 0.35 } : floraCtx,
    avoid,
    rng.fork("carpet"),
  );
  keep(new Mesh(carpet, material(T.plantVert(false), T.PLANT_FRAG, {}, { side: DoubleSide })), 0);
  tris(carpet);

  // Fish, one instanced mesh a kind: the real fish first, then their reflections.
  const fishVert = `${TANK_VERT}\n${FISH_VERT_BODY}`;
  const fishFrag = fishFragment(
    TANK_FRAG,
    "cameraPosition",
    "sunAt(vReal) * lampShadow(vReal + normalize(vNormal) * 0.03, 2.0)",
    TANK_OUT,
  );
  const fishMeshes: {
    mesh: InstancedMesh;
    list: TankShow["fish"][number][];
    a: InstancedBufferAttribute;
    b: InstancedBufferAttribute;
    look: InstancedBufferAttribute;
  }[] = [];
  for (const id of ORDER) {
    const list = show.fish.filter((f) => f.species === id);
    if (list.length === 0) continue;
    const geometry = buildFishGeometry(id, opts.detail);
    const n = list.length * 2;
    const a = instanced(n, 4);
    const b = instanced(n, 4);
    const look = instanced(n, 2);
    geometry.setAttribute("aAnimA", a);
    geometry.setAttribute("aAnimB", b);
    geometry.setAttribute("aLook", look);
    const l = FISH_LOOKS[id];
    const mat = material(
      fishVert,
      fishFrag,
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
        uPass: { value: 0 },
      },
      { side: DoubleSide },
    );
    if (opts.light) mat.defines = { FISH_CHEAP: 1 };
    const mesh = new InstancedMesh(geometry, mat, n);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    keep(mesh, 1);
    lamp.caster(mesh);
    // The fins again, blended over everything opaque, sharing the body's instances.
    const finMat = mat.clone();
    finMat.uniforms = { ...mat.uniforms, uPass: { value: 1 } };
    finMat.transparent = true;
    finMat.depthWrite = false;
    const fins = new InstancedMesh(geometry, finMat, n);
    fins.instanceMatrix = mesh.instanceMatrix;
    keep(fins, 6);
    fishMeshes.push({ mesh, list, a, b, look });
    tris(geometry, n * 2);
  }

  const surfaceGeometry = new PlaneGeometry(box.right - box.left, -box.back, 1, 1)
    .rotateX(-Math.PI / 2)
    .translate((box.left + box.right) / 2, 0, box.back / 2);
  keep(
    new Mesh(
      surfaceGeometry,
      material(
        T.SURFACE_VERT,
        T.SURFACE_FRAG,
        {},
        {
          transparent: true,
          depthWrite: false,
          premultipliedAlpha: true,
          blending: NormalBlending,
          side: DoubleSide,
        },
      ),
    ),
    10,
  );
  tris(surfaceGeometry);

  // The trim round the front glass and the meniscus along the waterline. Each quad's corners
  // carry (trim or not, how far in from the glass's edge, 0 to 1).
  const glassGeometry = (() => {
    const g = box.glass;
    const t = 0.07;
    const quads: {
      at: [number, number, number, number];
      trim: number;
      inner: [number, number, number, number];
    }[] = [
      { at: [g.left, g.bottom, g.right, g.bottom + t], trim: 1, inner: [0, 0, 1, 1] },
      { at: [g.left, g.top - t, g.right, g.top], trim: 1, inner: [1, 1, 0, 0] },
      { at: [g.left, g.bottom, g.left + t * 0.8, g.top], trim: 1, inner: [0, 1, 0, 1] },
      { at: [g.right - t * 0.8, g.bottom, g.right, g.top], trim: 1, inner: [1, 0, 1, 0] },
      { at: [g.left, box.water - 0.04, g.right, box.water + 0.06], trim: 0, inner: [0, 0, 0, 0] },
    ];
    const pos: number[] = [];
    const trim: number[] = [];
    const index: number[] = [];
    for (const q of quads) {
      const [x0, y0, x1, y1] = q.at;
      const base = pos.length / 3;
      const z = q.trim > 0.5 ? 0.002 : -0.001;
      // Corners: bottom left, bottom right, top left, top right.
      pos.push(x0, y0, z, x1, y0, z, x0, y1, z, x1, y1, z);
      for (const k of q.inner) trim.push(q.trim, k);
      index.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    const geom = new Geometry();
    geom.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geom.setAttribute("aTrim", new BufferAttribute(new Float32Array(trim), 2));
    geom.setIndex(index);
    return geom;
  })();
  keep(
    new Mesh(
      glassGeometry,
      material(
        T.GLASS_VERT,
        T.GLASS_FRAG,
        {},
        { transparent: true, depthWrite: false, depthTest: false },
      ),
    ),
    20,
  );
  tris(glassGeometry);

  // Food: a ragged flake, real and mirrored.
  const flakeGeometry = new PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2);
  const flakeData = instanced(MAX_FOOD * 2, 2);
  flakeGeometry.setAttribute("aFlake", flakeData);
  const flakes = new InstancedMesh(
    flakeGeometry,
    material(T.FLAKE_VERT, T.FLAKE_FRAG, {}, { side: DoubleSide }),
    MAX_FOOD * 2,
  );
  flakes.instanceMatrix.setUsage(DynamicDrawUsage);
  flakes.count = 0;
  keep(flakes, 2);
  tris(flakeGeometry, MAX_FOOD * 2);

  // Bubbles from the air stone.
  const column = new Vector3(layout.airstone[0], layout.airstone[1] + 0.06, layout.airstone[2]);
  const rise = 2.1;
  const bubbleGeometry = new InstancedBufferGeometry();
  bubbleGeometry.copy(new IcosahedronGeometry(1, 2) as unknown as InstancedBufferGeometry);
  const bubbleData = new Float32Array(BUBBLES * 2 * 4);
  const bubbleRng = rng.fork("bubbles");
  for (let i = 0; i < BUBBLES; i++) {
    const at = (i + bubbleRng.range(-0.4, 0.4)) / BUBBLES;
    const size =
      bubbleRng.next() < 0.15 ? bubbleRng.range(0.03, 0.045) : bubbleRng.range(0.01, 0.024);
    const seed = bubbleRng.next();
    bubbleData.set([at, size, seed, 0], i * 4);
    bubbleData.set([at, size, seed, 1], (BUBBLES + i) * 4);
  }
  bubbleGeometry.setAttribute("aBubble", new InstancedBufferAttribute(bubbleData, 4));
  bubbleGeometry.instanceCount = BUBBLES * 2;
  const period = (box.water - column.y) / rise;
  const bubbles = new Mesh(
    bubbleGeometry,
    material(
      T.BUBBLE_VERT,
      T.BUBBLE_FRAG,
      {
        uColumn: { value: column },
        uRise: { value: rise },
        // Whole loops of the shader's time, so the column never jumps.
        uPeriod: { value: LOOP_SECONDS / Math.max(1, Math.round(LOOP_SECONDS / period)) },
      },
      { transparent: true, depthWrite: false, blending: AdditiveBlending },
    ),
  );
  keep(bubbles, 7);
  tris(bubbleGeometry, BUBBLES * 2);

  // Specks drifting in the water where people see them.
  const speckRng = rng.fork("specks");
  const speckPos = new Float32Array(SPECKS * 3);
  const speckData = new Float32Array(SPECKS * 4);
  const halfGlass = (box.glass.right - box.glass.left) / 2;
  const midGlass = (box.glass.right + box.glass.left) / 2;
  for (let i = 0; i < SPECKS; i++) {
    const zz = -speckRng.range(0.15, -box.back - 0.3);
    const hw = halfGlass * (1 + -zz / 8);
    speckPos.set([midGlass + speckRng.range(-hw, hw), speckRng.next(), zz], i * 3);
    speckData.set(
      [
        speckRng.range(0, TAU),
        speckRng.range(0, TAU),
        20 + speckRng.int(30),
        60 + speckRng.int(90),
      ],
      i * 4,
    );
  }
  const speckGeometry = new Geometry();
  speckGeometry.setAttribute("position", new BufferAttribute(speckPos, 3));
  speckGeometry.setAttribute("aSpeck", new BufferAttribute(speckData, 4));
  const speckMaterial = material(
    T.SPECK_VERT,
    T.SPECK_FRAG,
    {
      uPointScale: { value: 30 },
      uSpan: { value: new Vector4(box.floor + 0.35, box.water - 0.08, 0, 0) },
    },
    { transparent: true, depthWrite: false, blending: AdditiveBlending },
  );
  const specks = new Points(speckGeometry, speckMaterial);
  specks.frustumCulled = false;
  specks.renderOrder = 8;
  scene.add(specks);
  drawCalls++;

  // Shrimp on the ground.
  const shrimpGeometry = buildShrimp(opts.detail);
  const shrimpData = instanced(Math.max(1, show.shrimp.length), 4);
  shrimpGeometry.setAttribute("aShrimp", shrimpData);
  const shrimp = new InstancedMesh(
    shrimpGeometry,
    material(T.SHRIMP_VERT, T.SHRIMP_FRAG, {}, { side: DoubleSide }),
    Math.max(1, show.shrimp.length),
  );
  shrimp.instanceMatrix.setUsage(DynamicDrawUsage);
  shrimp.count = show.shrimp.length;
  keep(shrimp, 1);
  lamp.caster(shrimp);
  tris(shrimpGeometry, show.shrimp.length);

  // Snails on the front glass.
  const neriteGeometry = buildNerite(opts.detail);
  const snailData = instanced(Math.max(1, show.snails.length), 4);
  neriteGeometry.setAttribute("aSnail", snailData);
  const snails = new InstancedMesh(
    neriteGeometry,
    material(T.NERITE_VERT, T.NERITE_FRAG, {}, { side: DoubleSide }),
    Math.max(1, show.snails.length),
  );
  snails.instanceMatrix.setUsage(DynamicDrawUsage);
  snails.count = show.snails.length;
  keep(snails, 3);
  tris(neriteGeometry, show.snails.length);

  // Rings where fingers touch the glass.
  const ringGeometry = new InstancedBufferGeometry();
  ringGeometry.copy(new PlaneGeometry(2, 2) as unknown as InstancedBufferGeometry);
  const ringData = instanced(MAX_RINGS, 4);
  ringGeometry.setAttribute("aRing", ringData);
  ringGeometry.instanceCount = 0;
  keep(
    new Mesh(
      ringGeometry,
      material(
        T.RING_VERT,
        T.RING_FRAG,
        {},
        {
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: AdditiveBlending,
        },
      ),
    ),
    25,
  );
  drawCalls++;

  // The lid over the tank, seen above the waterline.
  const lidGeometry = new PlaneGeometry(box.right - box.left, -box.back, 1, 1)
    .rotateX(Math.PI / 2)
    .translate((box.left + box.right) / 2, box.glass.top + 0.03, box.back / 2);
  keep(
    new Mesh(
      lidGeometry,
      material(T.PLAIN_VERT, T.LID_FRAG, {
        uLamps: { value: new Vector3(-0.4, box.back * 0.6, 0) },
      }),
    ),
    -2,
  );
  tris(lidGeometry);

  const m4 = new Matrix4();
  const x = new Vector3();
  const y = new Vector3();
  const z = new Vector3();
  const p = new Vector3();

  return {
    scene,
    lamp,
    resize(pixelHeight) {
      // Sized for a full-height picture of the venue's wall.
      speckMaterial.uniforms.uPointScale!.value = 30 * (pixelHeight / activeVenue().wall.height);
    },
    get triangles() {
      return triangles;
    },
    get drawCalls() {
      return drawCalls;
    },
    dispose() {
      caustic.dispose();
      groundMap.dispose();
      lamp.dispose();
      for (const m of [...fishMeshes.map((f) => f.mesh), flakes, shrimp, snails]) m.dispose();
      speckGeometry.dispose();
      speckMaterial.dispose();
    },
    sync(sh, t, rings) {
      shared.uTime!.value = t;
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

      const live = sh.food.filter((k) => !k.eaten);
      const nf = Math.min(MAX_FOOD, live.length);
      for (let i = 0; i < nf; i++) {
        const k = live[i]!;
        x.set(Math.cos(k.angle), 0.3 * Math.sin(k.age * 1.7), Math.sin(k.angle)).normalize();
        y.set(0, 1, 0).addScaledVector(x, -x.y).normalize();
        z.crossVectors(x, y);
        p.set(k.pos[0], k.pos[1], k.pos[2]);
        const size = 0.08 * Math.max(0.2, 1 - Math.max(0, k.landed - 20) / 10);
        m4.makeBasis(x.multiplyScalar(size), y.multiplyScalar(size), z.multiplyScalar(size));
        m4.setPosition(p);
        flakes.setMatrixAt(i, m4);
        flakes.setMatrixAt(nf + i, m4);
        flakeData.setXY(i, k.tone, 0);
        flakeData.setXY(nf + i, k.tone, 1);
      }
      flakes.count = nf * 2;
      flakes.instanceMatrix.needsUpdate = true;
      flakeData.needsUpdate = true;

      sh.shrimp.forEach((s2, i) => {
        x.set(s2.heading[0], 0, s2.heading[2]).normalize();
        y.set(0, 1, 0);
        z.crossVectors(x, y);
        p.set(s2.pos[0], s2.pos[1], s2.pos[2]);
        m4.makeBasis(
          x.multiplyScalar(s2.size),
          y.multiplyScalar(s2.size),
          z.multiplyScalar(s2.size),
        );
        m4.setPosition(p);
        shrimp.setMatrixAt(i, m4);
        const flick = s2.state === "flick" ? Math.sin(Math.PI * Math.min(1, s2.t / s2.until)) : 0;
        shrimpData.setXYZW(i, s2.legs, s2.claws, flick, 0);
      });
      shrimp.instanceMatrix.needsUpdate = true;
      shrimpData.needsUpdate = true;

      sh.snails.forEach((sn, i) => {
        // Sole on the glass: x along its way, y into the tank.
        x.set(Math.cos(sn.heading), Math.sin(sn.heading), 0);
        y.set(0, 0, -1);
        z.crossVectors(x, y);
        p.set(sn.x, sn.y, -0.006);
        m4.makeBasis(
          x.multiplyScalar(sn.size),
          y.multiplyScalar(sn.size),
          z.multiplyScalar(sn.size),
        );
        m4.setPosition(p);
        snails.setMatrixAt(i, m4);
        snailData.setXYZW(i, sn.wave, sn.mouth, sn.tuck, i);
      });
      snails.instanceMatrix.needsUpdate = true;
      snailData.needsUpdate = true;

      const nr = Math.min(MAX_RINGS, rings.length);
      for (let i = 0; i < nr; i++) {
        const r = rings[i]!;
        ringData.setXYZW(i, r.x, r.y, r.age, r.held ? 1 : 0);
      }
      ringGeometry.instanceCount = nr;
      ringData.needsUpdate = true;
    },
  };
};
