/**
 * A ground view: a round patch of flat ground with the sky over it as a dome, seen from a little
 * behind and above someone standing in the middle, facing the equator (north from Brisbane,
 * south from London), so east is on their right in the south and on their left in the north.
 *
 * On the dome: today's path of the Sun as an arc, the Sun on it, and in the Moon variant the
 * Moon at its height, lit on the side the Sun is on as seen from the ground. An upright stick
 * casts its shadow on the ground. The sky brightens and darkens with the Sun's height. Scene
 * axes: x east, y up, z south. Basic materials only: nothing here needs lighting.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from "three";
import type { Rng } from "../../core/types";
import { DEG } from "./astro";
import { drawMoon } from "./art";
import type { Local } from "./sky";
import { sunPath } from "./sky";

const STICK = 0.3;
const PATH_N = 96;

/** A direction on the dome (altitude, azimuth from north through east) in scene axes. */
export const domePoint = (alt: number, az: number, r: number, out: Vector3): Vector3 => {
  const ca = Math.cos(alt * DEG);
  return out.set(
    r * ca * Math.sin(az * DEG),
    r * Math.sin(alt * DEG),
    -r * ca * Math.cos(az * DEG),
  );
};

const clamp01 = (u: number) => Math.max(0, Math.min(1, u));
const lerp = (a: number, b: number, u: number) => a + (b - a) * clamp01(u);

/** Sky colours, top and horizon, for the Sun's height. */
export const skyColours = (
  alt: number,
): { top: Color; horizon: Color; ground: Color; dark: number } => {
  const night = { top: new Color("#03060f"), horizon: new Color("#0a1430") };
  const dusk = { top: new Color("#18244f"), horizon: new Color("#d0713d") };
  const low = { top: new Color("#3a74cf"), horizon: new Color("#f2b97a") };
  const day = { top: new Color("#2a66cc"), horizon: new Color("#a9d2f2") };
  let top: Color;
  let horizon: Color;
  if (alt < -12) {
    top = night.top;
    horizon = night.horizon;
  } else if (alt < -2) {
    const u = clamp01((alt + 12) / 10);
    top = night.top.clone().lerp(dusk.top, u);
    horizon = night.horizon.clone().lerp(dusk.horizon, u);
  } else if (alt < 6) {
    const u = clamp01((alt + 2) / 8);
    top = dusk.top.clone().lerp(low.top, u);
    horizon = dusk.horizon.clone().lerp(low.horizon, u);
  } else {
    const u = clamp01((alt - 6) / 20);
    top = low.top.clone().lerp(day.top, u);
    horizon = low.horizon.clone().lerp(day.horizon, u);
  }
  const light = Math.max(0, Math.min(1, (alt + 8) / 22));
  const ground = new Color("#0b1610").lerp(new Color("#4b7a3c"), light);
  return { top, horizon, ground, dark: 1 - Math.max(0, Math.min(1, (alt + 10) / 10)) };
};

export interface GroundLabels {
  compass: { text: string; x: number; y: number }[];
}

export interface GroundView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  frame(viewport: { width: number; height: number }): void;
  update(local: Local, dec: number, moon: { lit: number; show: boolean; eclipse: boolean }): void;
  labels(viewport: { width: number; height: number }): GroundLabels;
  dispose(): void;
}

export const createGroundView = (rng: Rng, moonMode: boolean): GroundView => {
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 2, 0.05, 100);
  const tmp = new Vector3();

  // The sky: an inside-out sphere coloured by height.
  const skyGeo = new SphereGeometry(30, 24, 12);
  const skyCol = new Float32Array(skyGeo.getAttribute("position").count * 3);
  skyGeo.setAttribute("color", new Float32BufferAttribute(skyCol, 3));
  const sky = new Mesh(
    skyGeo,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false }),
  );
  sky.renderOrder = -10;
  scene.add(sky);

  // Stars on the dome, showing at night.
  const starGeo = new BufferGeometry();
  {
    const n = 160;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      domePoint(Math.asin(rng.next()) / DEG, rng.next() * 360, 25, tmp);
      pos.set([tmp.x, tmp.y, tmp.z], i * 3);
    }
    starGeo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  }
  const starMat = new PointsMaterial({
    color: "#dfe6ff",
    size: 2,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  scene.add(new Points(starGeo, starMat));

  // The ground: a wide plain, and the round patch the dome stands on.
  const plainMat = new MeshBasicMaterial({ color: "#0b1610" });
  const plain = new Mesh(new CircleGeometry(28, 48), plainMat);
  plain.rotation.x = -Math.PI / 2;
  plain.position.y = -0.002;
  const patchMat = new MeshBasicMaterial({ color: "#3d6a33" });
  const patch = new Mesh(new CircleGeometry(1.12, 64), patchMat);
  patch.rotation.x = -Math.PI / 2;
  scene.add(plain, patch);

  // The horizon ring, compass ticks and the dome's guide lines.
  const lines = new Group();
  const ring = (alt: number, n = 96) => {
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      domePoint(alt, (i / n) * 360, 1, tmp);
      pts.push(tmp.x, tmp.y + 0.003, tmp.z);
    }
    return pts;
  };
  const arc = (az: number, n = 48) => {
    const pts: number[] = [];
    for (let i = 0; i <= n; i++) {
      domePoint((i / n) * 180, az, 1, tmp);
      pts.push(tmp.x, tmp.y, tmp.z);
    }
    return pts;
  };
  const lineOf = (pts: number[], colour: string, opacity: number) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return new Line(geo, new LineBasicMaterial({ color: colour, transparent: true, opacity }));
  };
  const guideMat = new LineBasicMaterial({ color: "#c8d4f0", transparent: true, opacity: 0.18 });
  for (const pts of [ring(30), ring(60), arc(0), arc(90)]) {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    lines.add(new Line(geo, guideMat));
  }
  lines.add(lineOf(ring(0), "#e8eef8", 0.7));
  {
    const pts: number[] = [];
    for (const az of [0, 90, 180, 270]) {
      domePoint(0, az, 1.0, tmp);
      pts.push(tmp.x, 0.004, tmp.z);
      domePoint(0, az, 1.1, tmp);
      pts.push(tmp.x, 0.004, tmp.z);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
    lines.add(new LineSegments(geo, new LineBasicMaterial({ color: "#f2f5fa" })));
  }
  scene.add(lines);

  // Today's path of the Sun.
  const pathGeo = new BufferGeometry();
  pathGeo.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array((PATH_N + 1) * 3), 3),
  );
  const path = new Line(
    pathGeo,
    new LineBasicMaterial({ color: "#ffd36b", transparent: true, opacity: 0.95 }),
  );
  scene.add(path);

  // The Sun.
  const sun = new Group();
  sun.add(new Mesh(new SphereGeometry(0.055, 20, 10), new MeshBasicMaterial({ color: "#fff1b8" })));
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 64;
  glowCanvas.height = 64;
  {
    const g = glowCanvas.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,230,150,1)");
    grad.addColorStop(0.3, "rgba(255,200,90,0.5)");
    grad.addColorStop(1, "rgba(255,170,60,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  const glowTex = new CanvasTexture(glowCanvas);
  glowTex.colorSpace = SRGBColorSpace;
  const glow = new Sprite(
    new SpriteMaterial({
      map: glowTex,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  glow.scale.setScalar(0.42);
  sun.add(glow);
  scene.add(sun);

  // The stick and its shadow.
  const stick = new Mesh(
    new CylinderGeometry(0.014, 0.014, STICK, 10),
    new MeshBasicMaterial({ color: "#f4e7c9" }),
  );
  stick.position.y = STICK / 2;
  const shadowMat = new MeshBasicMaterial({
    color: "#000000",
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  const shadowPivot = new Group();
  shadowPivot.position.y = 0.003;
  shadowPivot.add(shadow);
  scene.add(stick, shadowPivot);

  // The Moon, a disc that faces the camera, drawn at its phase and turned to its lit side.
  const moonCanvas = document.createElement("canvas");
  moonCanvas.width = 128;
  moonCanvas.height = 128;
  const moonTex = new CanvasTexture(moonCanvas);
  moonTex.colorSpace = SRGBColorSpace;
  const moonMat = new SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false });
  const moonSprite = new Sprite(moonMat);
  moonSprite.scale.setScalar(0.2);
  moonSprite.visible = moonMode;
  scene.add(moonSprite);
  let drawnLit = Number.NaN;
  let drawnEclipse = false;

  let lastAlt = Number.NaN;
  let lastPath = { lat: Number.NaN, dec: Number.NaN };
  let facing = -1;
  let aspect = 2;

  const paintSky = (alt: number) => {
    const c = skyColours(alt);
    const pos = skyGeo.getAttribute("position");
    const col = skyGeo.getAttribute("color") as Float32BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 30;
      const u = Math.max(0, Math.min(1, y * 2.2));
      col.setXYZ(
        i,
        lerp(c.horizon.r, c.top.r, u),
        lerp(c.horizon.g, c.top.g, u),
        lerp(c.horizon.b, c.top.b, u),
      );
    }
    col.needsUpdate = true;
    plainMat.color.copy(c.ground).multiplyScalar(0.7);
    patchMat.color.copy(c.ground);
    starMat.opacity = 0.9 * c.dark;
  };

  const placeCamera = () => {
    // Behind someone facing the equator, a little above the dome's middle: far enough back that
    // the whole patch of ground shows below and a band of sky above the dome's top.
    const fov = aspect >= 2 ? 34 : aspect >= 1.2 ? 38 : 44;
    const half = (fov / 2) * DEG;
    const hHalf = Math.atan(Math.tan(half) * aspect);
    const h = 0.95;
    let d = Math.max(2.4, 1.15 / Math.tan(hHalf * 0.78));
    let pitch = 0;
    for (let i = 0; i < 40; i++) {
      const front = Math.atan(h / (d - 1.12));
      const top = Math.atan((1.08 - h) / d);
      const lo = front + 2 * DEG - half;
      const hi = half - top - 5 * DEG;
      pitch = Math.max(3 * DEG, Math.min(lo, hi));
      if (lo <= hi) break;
      d += 0.1;
    }
    camera.aspect = aspect;
    camera.fov = fov;
    camera.position.set(0, h, facing * d);
    camera.lookAt(0, h - d * Math.tan(pitch), 0);
    camera.updateProjectionMatrix();
  };

  return {
    scene,
    camera,
    frame(viewport) {
      aspect = Math.max(0.3, viewport.width / Math.max(1, viewport.height));
      placeCamera();
    },
    update(local, dec, moon) {
      const f = local.lat >= 0 ? -1 : 1;
      if (f !== facing) {
        facing = f;
        placeCamera();
      }
      if (!(Math.abs(local.sun.alt - lastAlt) <= 0.15)) {
        lastAlt = local.sun.alt;
        paintSky(local.sun.alt);
      }
      if (local.lat !== lastPath.lat || Math.abs(dec - lastPath.dec) > 0.01) {
        lastPath = { lat: local.lat, dec };
        const pts = sunPath(local.lat, dec, PATH_N);
        const pos = pathGeo.getAttribute("position") as Float32BufferAttribute;
        pts.forEach((p, i) => {
          domePoint(p.alt, p.az, 1, tmp);
          pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
        });
        pos.needsUpdate = true;
        pathGeo.computeBoundingSphere();
      }
      domePoint(local.sun.alt, local.sun.az, 1, sun.position);
      const up = local.sun.alt > 0.3;
      shadowPivot.visible = up;
      if (up) {
        // The quad's length runs north from the stick's foot; the pivot turns it to point away
        // from the Sun (a direction at azimuth A is (sin A, 0, -cos A), north turned by -A).
        const len = Math.min(1.1, STICK / Math.tan(local.sun.alt * DEG));
        shadow.scale.set(0.03, len, 1);
        shadow.position.set(0, 0, -len / 2);
        shadowPivot.rotation.set(0, -(local.sun.az + 180) * DEG, 0);
        shadowMat.opacity = 0.55 * Math.min(1, local.sun.alt / 4);
      }
      if (moonMode) {
        moonSprite.visible = moon.show;
        domePoint(local.moon.alt, local.moon.az, 0.94, moonSprite.position);
        if (!(Math.abs(moon.lit - drawnLit) <= 0.004) || moon.eclipse !== drawnEclipse) {
          drawnLit = moon.lit;
          drawnEclipse = moon.eclipse;
          const g = moonCanvas.getContext("2d")!;
          g.clearRect(0, 0, 128, 128);
          drawMoon(g, 64, 64, 56, moon.lit, 0, moon.eclipse);
          moonTex.needsUpdate = true;
        }
        // The lit side faces the Sun as seen from the ground; seen from behind the person it
        // is the same way round.
        moonMat.rotation = local.moon.limb * DEG;
      }
    },
    labels(viewport) {
      const at = (alt: number, az: number, r: number) => {
        domePoint(alt, az, r, tmp).project(camera);
        if (tmp.z > 1) return null;
        return {
          x: (tmp.x * 0.5 + 0.5) * viewport.width,
          y: (-tmp.y * 0.5 + 0.5) * viewport.height,
        };
      };
      const compass: GroundLabels["compass"] = [];
      for (const [text, az] of [
        ["N", 0],
        ["E", 90],
        ["S", 180],
        ["W", 270],
      ] as const) {
        const p = at(0, az, 1.26);
        if (p) compass.push({ text, x: p.x, y: p.y });
      }
      return { compass };
    },
    dispose() {
      glowTex.dispose();
      moonTex.dispose();
    },
  };
};
