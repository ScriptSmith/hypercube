import {
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Matrix4,
  PCFShadowMap,
  PointLight,
  Scene,
  Vector3,
} from "three";
import { createRenderer3D } from "../../core/renderer3d";
import { multiply3, rotationAbout, WHOLE_SPHERE } from "../../core/sphere";
import { createSectorViews } from "../../core/sphere3d";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { createCloud } from "./cloud";
import { createFlakeMeshes } from "./flakes";
import { createEddies, emptyFlow, flowAt, STIR_LIMIT, type Stir } from "./flow";
import { makeDen } from "./den";
import { createGlass } from "./glass";
import { createMaterials, type Materials } from "./kit";
import { cloneLook, easeLook, MOOD_LOOKS } from "./moods";
import { R } from "./mound";
import type { BuiltScene } from "./scene";
import { SCENE_MAKERS } from "./scenes";
import { createSky } from "./sky";
import {
  createShow,
  type Look,
  SCENES,
  type SceneId,
  type Shake,
  type ShakeSetting,
  SWAP_AFTER,
} from "./show";
import { createSnow, type Pose } from "./snow";

const DEBUG_KEY = "__snowglobe";
/** One turn of the scene's turntable, seconds. */
const TURN_SECONDS = 420;
/** Most a debug skip runs the show forward, seconds. */
const MAX_SKIP = 600;
/** Clear water: how far you see before its tint is full, design metres. */
const CLEAR_SIGHT = 26;
/** Thickest snow: about the gap between the glass and the scene. */
const MURK_SIGHT = 1.1;
/** A change of scene: the old one crumbles into the snow from here to the swap moment... */
const DISSOLVE_FROM = 0.45;
/** ...and the new one gathers out of it over this long after. */
const GATHER = 1.4;
/** Seconds between clumps of snow sliding off a roof or a tree, while calm. */
const SHED_GAP: readonly [number, number] = [14, 40];
/**
 * Viewers round the ball. With three, the top of the band people see (about 25° to 45° up)
 * midway between two of them faces away from both, and someone standing there sees the scene
 * only at the edge of the ball. Five cover the whole band and put the next copies of the scene
 * near the ball's edge from beside; six crowd copies in at both edges. Each view needs fewer
 * pixels, so five cost about what three did.
 */
const AROUND = 5;
/** Most pixels on a side of each viewer's picture: enough for the feed's detail with six round. */
const VIEW_MAX = 1536;
/** Software renderers draw the feed at this fraction, with fewer samples. */
const SOFTWARE_SCALE = 0.5;
/**
 * And at most this often, ms: four views take a software renderer most of a second, and
 * drawing every frame would leave the page no time for anything else.
 */
const SOFTWARE_FRAME_MS = 1000;

const isSoftware = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

const sceneOption = (v: unknown): SceneId | "changes" =>
  typeof v === "string" && (SCENES as readonly string[]).includes(v) ? (v as SceneId) : "changes";

export const mount = (ctx: AppContext): AppInstance => {
  let frame = ctx.frame;
  const sphere = () => frame.sphere ?? WHOLE_SPHERE;
  const r3d = createRenderer3D(ctx.root, frame, { antialias: false });
  const software = isSoftware(r3d.renderer.getContext());
  const fit = (f: FrameInfo) => {
    r3d.resize(f);
    if (!software) return;
    r3d.renderer.setPixelRatio(f.pixelRatio * SOFTWARE_SCALE);
    r3d.renderer.setSize(f.width, f.height, false);
  };
  fit(frame);
  r3d.renderer.shadowMap.enabled = !software;
  r3d.renderer.shadowMap.type = PCFShadowMap;
  r3d.renderer.shadowMap.autoUpdate = false;
  // Count draws over a whole frame (every view, the composite and the glass), not one call.
  r3d.renderer.info.autoReset = false;

  // Each view's side is set once, at mount: SectorViews keeps a size it is given.
  const viewSize = software
    ? 256
    : Math.max(256, Math.min(VIEW_MAX, Math.round(frame.height * frame.pixelRatio)));
  const views = r3d.keep(
    createSectorViews(r3d, frame, {
      // A software renderer (tests) can't afford seven views; three still show the scene.
      around: software ? 3 : AROUND,
      samples: software ? 0 : 4,
      size: viewSize,
    }),
  );
  const glass = createGlass(r3d, frame);

  const options = {
    scene: sceneOption(ctx.options.scene),
    shake: (ctx.options.shake === "rarely" ? "rarely" : "often") as ShakeSetting,
  };
  const root = ctx.rng();
  const show = createShow(root.fork("show"), options);
  const eddies = createEddies(root.fork("eddies"));
  const snow = createSnow(root.fork("snow"), eddies);
  const extra = root.fork("sheds");

  // The room: the globe's inside, scaled from design metres to the real ball.
  const scene = new Scene();
  const inside = new Group();
  scene.add(inside);
  const turning = new Group();
  turning.matrixAutoUpdate = false;
  inside.add(turning);

  const models = ctx.rng("snowglobe:models");
  const built = new Map<SceneId, BuiltScene>();
  const looks = new Map<SceneId, Materials>();
  for (const id of SCENES) {
    const materials = createMaterials();
    const b = SCENE_MAKERS[id](models.fork(id), materials);
    b.group.visible = false;
    turning.add(b.group);
    built.set(id, b);
    looks.set(id, materials);
  }

  // The tinted water behind the scene. It is a little larger than the glass, so that a view
  // grazing the ball's edge still finds it rather than the empty background.
  const sky = createSky(R + 0.12);
  inside.add(sky.mesh);

  const hemi = new HemisphereLight();
  const key = new DirectionalLight();
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  inside.add(hemi, key, key.target);
  const lamps = [0, 1, 2].map(() => {
    const l = new PointLight("#ffbf6e", 0, 1.4, 2);
    turning.add(l);
    return l;
  });
  // The den under the hill, the same under every scene, with its own soft light.
  const denLook = createMaterials();
  const den = makeDen(models.fork("den"), denLook);
  turning.add(den.group);
  const denLamp = new PointLight("#ffd9a8", 1.6, 2.2, 2);
  denLamp.position.copy(den.light);
  turning.add(denLamp);

  const flakes = createFlakeMeshes(models.fork("chips"), snow);
  inside.add(flakes.floating);
  turning.add(flakes.resting);
  const cloud = createCloud(root.fork("cloud"), eddies);
  cloud.setView(viewSize / 2);
  inside.add(cloud.points);

  const fog = new Fog(new Color(), 1, 100);
  scene.fog = fog;
  // Every scene, light and material is in place now, so one compile covers the whole show.
  r3d.prepare(scene, views.viewers[0]!.camera);
  const centre = new Vector3();
  const eye = new Vector3();

  let t = 0;
  let current: Look = show.lookAt(0);
  let active: BuiltScene = built.get(current.scene)!;
  active.group.visible = true;
  const look = cloneLook(MOOD_LOOKS[current.mood]);
  snow.setTerrain(active.terrain);

  const pose: Pose = new Float64Array(9);
  const poseMatrix = new Matrix4();
  const flow = emptyFlow();
  const stirs: Stir[] = [];
  let lastShake: Shake | null = null;
  let shakes = 0;
  let shed = t + extra.range(SHED_GAP[0], SHED_GAP[1]);
  let sheds = 0;
  let drawn = 0;
  let swaps = 0;
  /** Milliseconds the CPU spends on each step and each frame's drawing, smoothed. */
  let stepMs = 0;
  let drawMs = 0;
  let lastDraw = -Infinity;

  const turnAngle = (time: number) => -((time / TURN_SECONDS) % 1) * Math.PI * 2;
  const updatePose = () => {
    const yaw = rotationAbout([0, 1, 0], turnAngle(t));
    const tilt = rotationAbout([flow.tiltAxisX, 0, flow.tiltAxisZ], flow.tilt);
    const m = multiply3(tilt, yaw);
    for (let i = 0; i < 9; i++) pose[i] = m[i]!;
    poseMatrix.set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1);
    turning.matrix.copy(poseMatrix);
    turning.matrixWorldNeedsUpdate = true;
  };

  const placeInside = () => {
    const s = sphere();
    const k = s.radius / R;
    inside.position.set(0, s.centreY, 0);
    inside.scale.setScalar(k);
    centre.set(0, s.centreY, 0);
    sky.place(centre, s.radius);
    for (const l of lamps) l.distance = 1.4 * k;
    denLamp.distance = 2.2 * k;
    // The shadow camera works in venue metres, not the scaled inside's.
    const cam = key.shadow.camera;
    cam.left = cam.bottom = -1.75 * k;
    cam.right = cam.top = 1.75 * k;
    cam.near = 0.5 * k;
    cam.far = 9 * k;
    cam.updateProjectionMatrix();
  };
  placeInside();

  const applyLook = () => {
    sky.setColors(look.low, look.horizon, look.zenith, look.stars);
    hemi.color.copy(look.hemiSky);
    hemi.groundColor.copy(look.hemiGround);
    hemi.intensity = look.hemi;
    key.color.copy(look.key);
    key.intensity = look.keyPower;
    // The key light stands to one side of the room and doesn't turn with the scene.
    const up = look.keyUp;
    key.position.set(
      Math.cos(up) * 4 * Math.sin(0.7),
      Math.sin(up) * 4,
      Math.cos(up) * 4 * Math.cos(0.7),
    );
    key.target.position.set(0, -1.2, 0);
    for (const m of looks.values()) m.glow.color.setScalar(look.glow);
    flakes.material.emissive.setScalar(look.flakeGlow);
    active.lights.forEach((p, i) => lamps[i]?.position.copy(p));
    lamps.forEach((l, i) => {
      l.intensity = i < active.lights.length ? look.lamps * 0.55 : 0;
    });
    glass.setColors(look.pileLit, look.pileDeep, look.base, look.water);
  };
  applyLook();

  scene.onBeforeRender = (_r, _s, camera) => {
    // The water's tint and the blizzard start at the glass, wherever the viewer stands.
    camera.getWorldPosition(eye);
    const k = sphere().radius / R;
    const near = Math.max(0, eye.distanceTo(centre) - sphere().radius);
    const m = flow.murk;
    const sight = MURK_SIGHT + (CLEAR_SIGHT - MURK_SIGHT) * Math.pow(1 - m, 3);
    fog.near = near;
    fog.far = near + sight * k;
    fog.color.copy(look.water).lerp(look.murk, Math.min(1, m * 0.7));
  };

  updatePose();
  snow.scatter(pose);

  const smooth = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    return x * x * (3 - 2 * x);
  };
  /** How far the scene in the globe has crumbled into the snow, around a change of scene. */
  const dissolveAt = (time: number) => {
    const s = show.last(time);
    if (!s || s.from.scene === s.scene) return 0;
    const tau = time - s.at;
    if (tau < SWAP_AFTER) return smooth((tau - DISSOLVE_FROM) / (SWAP_AFTER - DISSOLVE_FROM));
    return 1 - smooth((tau - SWAP_AFTER) / GATHER);
  };

  const onShake = (s: Shake) => {
    lastShake = s;
    shakes++;
    stirs.push({ at: s.at, strength: s.strength, dir: s.dir, spin: s.spin });
    while (stirs.length > 3) stirs.shift();
    snow.lift(s.at, s.strength);
    cloud.stir();
  };

  const step = (dt: number) => {
    t += dt;
    const s = show.last(t);
    if (s && s !== lastShake) onShake(s);
    const want = show.lookAt(t);
    if (want.scene !== current.scene || want.mood !== current.mood) {
      if (want.scene !== current.scene) {
        active.group.visible = false;
        looks.get(active.id)!.dissolve.value = 0;
        active = built.get(want.scene)!;
        active.group.visible = true;
        snow.setTerrain(active.terrain);
      }
      current = want;
      swaps++;
    }
    looks.get(active.id)!.dissolve.value = dissolveAt(t);
    flowAt(stirs, t, flow);
    updatePose();
    snow.step(dt, t, flow, pose);
    cloud.step(dt, t, flow);
    if (t >= shed) {
      if (flow.stir < STIR_LIMIT) {
        if (snow.shed(t) > 0) sheds++;
      }
      shed = t + extra.range(SHED_GAP[0], SHED_GAP[1]);
    }
    easeLook(look, MOOD_LOOKS[current.mood], 1 - Math.exp(-dt / 0.6));
  };

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      const t0 = performance.now();
      step(dt);
      stepMs += (performance.now() - t0 - stepMs) * 0.05;
    },
    render() {
      if (!r3d.ready) return;
      const t0 = performance.now();
      if (software && t0 - lastDraw < SOFTWARE_FRAME_MS) return;
      lastDraw = t0;
      r3d.renderer.info.reset();
      active.update(t);
      den.update(t);
      applyLook();
      flakes.update(snow, !software);
      cloud.show(flow.murk, look.murk);
      glass.setPose(pose);
      glass.setPile(snow.level);
      r3d.renderer.shadowMap.needsUpdate = true;
      views.render(scene);
      glass.render();
      drawn++;
      drawMs += (performance.now() - t0 - drawMs) * 0.05;
    },
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    fit(f);
    views.resize(f);
    glass.resize(f);
    placeInside();
  });

  const state = () => {
    const last = show.last(t);
    return {
      t,
      ready: r3d.ready,
      software,
      drawn,
      scene: current.scene,
      mood: current.mood,
      shakes,
      swaps,
      sheds,
      next: show.next(t).at,
      last: last ? last.at : null,
      murk: flow.murk,
      stir: flow.stir,
      flakes: snow.count,
      floating: snow.counts.floating,
      resting: snow.counts.resting,
      piled: snow.counts.piled,
      pileTop: Math.max(...snow.level),
      held: show.held,
      viewers: views.viewers.length,
      viewSize,
      stepMs,
      drawMs,
      calls: r3d.renderer.info.render.calls,
      triangles: r3d.renderer.info.render.triangles,
    };
  };

  const shakeNow = (id?: string) => {
    const scene = id && (SCENES as readonly string[]).includes(id) ? (id as SceneId) : undefined;
    show.shakeNow(t, scene);
  };

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state,
        shake: shakeNow,
        /** Run the show forward by `seconds`, a little coarser than real time. */
        advance(seconds: number) {
          let left = Math.min(MAX_SKIP, Math.max(0, seconds));
          while (left > 0) {
            const dt = Math.min(1 / 30, left);
            step(dt);
            left -= dt;
          }
        },
        scenes: () => [...SCENES],
      },
    });
  }

  return {
    // A running show keeps running: nothing an idle moment or admin leaves behind needs undoing.
    reset() {},
    attract() {},
    status: () => ({
      scene: current.scene,
      mood: current.mood,
      shakes,
      settled: Math.round(((snow.count - snow.counts.floating) / snow.count) * 100),
    }),
    command(name, args) {
      if (name === "shake") shakeNow(typeof args === "string" ? args : undefined);
      else if ((SCENES as readonly string[]).includes(name)) shakeNow(name);
    },
    dispose() {
      loop.stop();
      offResize();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[DEBUG_KEY];
      flakes.dispose();
      cloud.dispose();
      r3d.dispose();
    },
  };
};
