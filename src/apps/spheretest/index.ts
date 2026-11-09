import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix3,
  Mesh,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
} from "three";
import { createRenderer3D, disposeTree } from "../../core/renderer3d";
import {
  IDENTITY3,
  multiply3,
  orthonormalize3,
  rotationAbout,
  type Mat3,
  WHOLE_SPHERE,
} from "../../core/sphere";
import { createSectorViews, createSurfacePass, toMatrix3 } from "../../core/sphere3d";
import type { AppContext, AppInstance } from "../../core/types";

const CYCLE_S = 20;
const FLAKES = 600;

/** A ball of six coloured gores with white caps and a marked pole, so its turning shows. */
const BALL = /* glsl */ `
uniform mat3 uSpin;
uniform vec3 uGores[6];
vec4 surface(vec3 dir) {
  vec3 d = uSpin * dir;
  vec2 ll = sphereLatLon(d);
  float gore = (ll.y + SPHERE_PI) / (SPHERE_PI / 3.0);
  int i = int(floor(gore)) % 6;
  vec3 c = uGores[0];
  for (int k = 1; k < 6; k++) if (k == i) c = uGores[k];
  float seam = abs(fract(gore) - 0.5);
  c = mix(c, vec3(0.9), smoothstep(0.48, 0.485, seam));
  float cap = abs(ll.x);
  c = mix(c, vec3(0.95), smoothstep(1.2, 1.22, cap));
  c = mix(c, vec3(1.0, 0.8, 0.2), smoothstep(1.5, 1.52, ll.x));
  return vec4(c, 1.0);
}
`;

export const mount = (ctx: AppContext): AppInstance => {
  const r3d = createRenderer3D(ctx.root, ctx.frame, { antialias: false });
  const sphere = () => ctx.frame.sphere ?? WHOLE_SPHERE;
  const gores = ctx.ui.palette.players.slice(0, 6).map((c) => new Color(c));
  const spin = { value: new Matrix3() };
  const ball = createSurfacePass(r3d, ctx.frame, {
    fragment: BALL,
    uniforms: { uSpin: spin, uGores: { value: gores } },
  });

  const scene = new Scene();
  scene.background = new Color("#0b1a33");
  scene.add(new HemisphereLight("#cfe0ff", "#20304a", 1.6));
  const sun = new DirectionalLight("#ffffff", 1.4);
  sun.position.set(3, 10, 4);
  scene.add(sun);
  const world = new Group();
  scene.add(world);
  const flakes = new Float32Array(FLAKES * 3);
  const flakeGeo = new BufferGeometry();
  flakeGeo.setAttribute("position", new BufferAttribute(flakes, 3));
  const flakeMat = new PointsMaterial({ color: "#ffffff", size: 0.06, sizeAttenuation: true });
  const snow = new Points(flakeGeo, flakeMat);
  snow.frustumCulled = false;
  const orbiters: Mesh[] = [];
  const rng = ctx.rng("spheretest");

  const build = () => {
    for (const c of world.children) if (c !== snow) disposeTree(c);
    world.clear();
    const s = sphere();
    const cy = s.centreY;
    const r = s.radius;
    const ground = new Mesh(
      new CircleGeometry(r * 0.78, 48),
      new MeshLambertMaterial({ color: "#e8eef7" }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = cy - r * 0.62;
    const house = new Mesh(
      new BoxGeometry(r * 0.4, r * 0.32, r * 0.4),
      new MeshLambertMaterial({ color: "#b5643c" }),
    );
    house.position.set(0, ground.position.y + r * 0.16, 0);
    const roof = new Mesh(
      new ConeGeometry(r * 0.36, r * 0.24, 4),
      new MeshLambertMaterial({ color: "#3d5a80" }),
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, ground.position.y + r * 0.44, 0);
    world.add(ground, house, roof, snow);
    orbiters.length = 0;
    ctx.ui.palette.players.slice(0, 8).forEach((c, i) => {
      const m = new Mesh(
        new SphereGeometry(r * 0.07, 16, 12),
        new MeshLambertMaterial({ color: c }),
      );
      m.userData.phase = (i / 8) * Math.PI * 2;
      m.userData.height = (i % 2 ? 0.25 : -0.15) * r;
      orbiters.push(m);
      world.add(m);
    });
    for (let i = 0; i < FLAKES; i++) placeFlake(i, true);
    flakeGeo.attributes.position!.needsUpdate = true;
  };

  /** Somewhere inside the ball, above the ground; at the top when it melts away. */
  const placeFlake = (i: number, anywhere: boolean) => {
    const s = sphere();
    for (;;) {
      const x = rng.range(-1, 1);
      const y = anywhere ? rng.range(-0.6, 1) : rng.range(0.7, 0.95);
      const z = rng.range(-1, 1);
      if (x * x + y * y + z * z < 0.92) {
        flakes[i * 3] = x * s.radius;
        flakes[i * 3 + 1] = s.centreY + y * s.radius;
        flakes[i * 3 + 2] = z * s.radius;
        return;
      }
    }
  };

  const views = r3d.keep(createSectorViews(r3d, ctx.frame));
  build();
  r3d.prepare(scene, views.viewers[0]!.camera);

  let t = 0;
  let rotation: Mat3 = IDENTITY3;
  let steps = 0;
  const mode = () =>
    ctx.variant === "cycle" ? (Math.floor(t / CYCLE_S) % 2 ? "inside" : "ball") : ctx.variant;

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      t += dt;
      const axis = [Math.sin(t * 0.05), 1, Math.cos(t * 0.07) * 0.4] as const;
      rotation = multiply3(rotationAbout(axis, dt * 0.6), rotation);
      if (++steps % 600 === 0) rotation = orthonormalize3(rotation);
      const s = sphere();
      orbiters.forEach((m) => {
        const a = (m.userData.phase as number) + t * 0.25;
        m.position.set(
          Math.sin(a) * s.radius * 0.82,
          s.centreY + (m.userData.height as number),
          Math.cos(a) * s.radius * 0.82,
        );
      });
      const floor = s.centreY - s.radius * 0.6;
      for (let i = 0; i < FLAKES; i++) {
        const y = i * 3 + 1;
        flakes[y] = (flakes[y] ?? 0) - dt * (0.12 + (i % 7) * 0.02);
        flakes[i * 3] = (flakes[i * 3] ?? 0) + Math.sin(t + i) * dt * 0.05;
        if ((flakes[y] ?? 0) < floor) placeFlake(i, false);
      }
      flakeGeo.attributes.position!.needsUpdate = true;
    },
    render() {
      if (!r3d.ready) return;
      if (mode() === "inside") {
        views.render(scene);
      } else {
        toMatrix3(rotation, spin.value);
        ball.render();
      }
    },
  });
  loop.start();

  ctx.onResize((f) => {
    r3d.resize(f);
    ball.setSphere(f.sphere ?? WHOLE_SPHERE);
    views.resize(f);
    build();
  });

  return {
    reset() {
      t = 0;
      rotation = IDENTITY3;
    },
    status: () => ({ mode: mode() }),
    dispose() {
      loop.stop();
      flakeGeo.dispose();
      flakeMat.dispose();
      r3d.dispose();
    },
  };
};
