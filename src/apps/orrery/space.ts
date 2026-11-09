/**
 * The space view, in three.js through its public API. Not to scale: the Earth is drawn about a
 * fifth of its orbit's radius, the Sun smaller than the orbit, the Moon's orbit far closer.
 *
 * Scene axes: the plane of the Earth's orbit is x-z with ecliptic north up (+y), and ecliptic
 * longitude 0 along +x. The Earth's axis leans towards longitude 90° by the tilt; inside its
 * tilted group it turns about its own y axis with the clock, so Brisbane faces the Sun at noon.
 *
 * Seasons: the Sun at the centre, the Earth going round it on a faintly oval orbit.
 * Moon: the Earth at the centre with the Sun held to the left, so the Moon's phases and the line
 * of its tilted orbit's nodes turning towards and away from the Sun read at a glance. The Moon's
 * orbit tilt is drawn five times steeper than it is, and the shadows sized to match, so the Moon
 * misses the Earth's shadow in the drawing exactly when it does in the sky.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  CircleGeometry,
  Vector3,
} from "three";
import type { Rng } from "../../core/types";
import { CLOCK_LON, DEG, ECC, meanAnomaly, sunLongitude, timeOf, dateOf, MONTHS } from "./astro";
import type { Variant } from "./config";
import { decodeLand, LAND_H, LAND_W } from "./land";
import type { Global } from "./sky";

/** Model sizes, seasons: orbit radius, Earth and Sun. */
export const ORBIT_R = 10;
export const EARTH_R = 2.3;
const SUN_R = 2.1;
/** Model sizes, moon. */
export const MOON_ORBIT_R = 14;
const MOON_EARTH_R = 1.5;
export const MOON_R = 0.42;
/** The Moon's orbit tilt and the shadows are drawn this many times larger as angles. */
export const TILT_DRAWN = 5;
/** Angular radii as seen from the Earth's centre: the Earth's dark shadow at the Moon, the Moon. */
const UMBRA_DEG = 0.7;
const MOON_DEG = 0.26;
/** The Moon's shadow on the Earth for a partial eclipse anywhere. */
const PENUMBRA_AT_EARTH_DEG = 1.5;
const SUN_DIST_MOON = 26;

const toScene = (lambda: number, beta: number, r: number, out: Vector3): Vector3 => {
  const cb = Math.cos(beta * DEG);
  return out.set(
    r * cb * Math.cos(lambda * DEG),
    r * Math.sin(beta * DEG),
    -r * cb * Math.sin(lambda * DEG),
  );
};

export interface Marker {
  lat: number;
  lon: number;
  colour: string;
  /** Draw this place's circle of latitude, lit where it is day: its day length at a glance. */
  circle: boolean;
}

export interface SpaceLabels {
  months: { text: string; x: number; y: number }[];
  north: { x: number; y: number } | null;
  sun: { x: number; y: number } | null;
  shadow: { x: number; y: number } | null;
}

export interface SpaceView {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Viewport and focus, stage px, the focus within the frame. */
  frame(
    viewport: { width: number; height: number },
    focus: { x: number; y: number; width: number; height: number },
  ): void;
  /** Camera turn about the default, degrees. */
  orbit(az: number, el: number): void;
  update(g: Global, tilt: number, incl: number, markers: readonly Marker[]): void;
  /** Labels to draw, in viewport px. */
  labels(viewport: { width: number; height: number }): SpaceLabels;
  /** True when the drawn Moon overlaps the drawn shadow (or its shadow the Earth). */
  readonly eclipsed: "solar" | "lunar" | null;
  /** Where the Earth and the Moon are drawn, in scene units. */
  bodies(): { earth: [number, number, number]; moon: [number, number, number] };
  dispose(): void;
}

const glowTexture = (inner: string, outer: string): CanvasTexture => {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner.replace(/[\d.]+\)$/, "0.55)"));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/** The Earth's surface from the land grid: sea, land that pales towards the poles, and ice. */
export const earthCanvas = (): HTMLCanvasElement => {
  const grid = decodeLand();
  const small = document.createElement("canvas");
  small.width = LAND_W;
  small.height = LAND_H;
  const sg = small.getContext("2d")!;
  const img = sg.createImageData(LAND_W, LAND_H);
  for (let r = 0; r < LAND_H; r++) {
    const lat = Math.abs(89.5 - r);
    for (let c = 0; c < LAND_W; c++) {
      const i = (r * LAND_W + c) * 4;
      const land = grid[r * LAND_W + c] === 1;
      let rgb: [number, number, number];
      if (land) {
        if (lat > 62) rgb = [228, 236, 240];
        else if (lat < 12) rgb = [70, 150, 72];
        else if (lat < 35) rgb = [176, 160, 98];
        else rgb = [96, 146, 78];
      } else rgb = lat > 70 ? [190, 210, 226] : [28, 82, 150];
      img.data[i] = rgb[0];
      img.data[i + 1] = rgb[1];
      img.data[i + 2] = rgb[2];
      img.data[i + 3] = 255;
    }
  }
  sg.putImageData(img, 0, 0);
  const big = document.createElement("canvas");
  big.width = 1024;
  big.height = 512;
  const bg = big.getContext("2d")!;
  bg.imageSmoothingEnabled = true;
  bg.drawImage(small, 0, 0, 1024, 512);
  return big;
};

export const createSpaceView = (variant: Variant, rng: Rng): SpaceView => {
  const moonMode = variant === "moon";
  const scene = new Scene();
  scene.background = new Color("#05070f");
  const camera = new PerspectiveCamera(30, 1, 0.5, 2000);
  const tmp = new Vector3();
  const tmp2 = new Vector3();

  // Stars, far off in every direction.
  {
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rng.next() * 2 - 1;
      const a = rng.next() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pos.set([600 * s * Math.cos(a), 600 * u, 600 * s * Math.sin(a)], i * 3);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    scene.add(
      new Points(geo, new PointsMaterial({ color: "#9aa6c4", size: 1.6, sizeAttenuation: false })),
    );
  }

  const glowTex = glowTexture("rgba(255,214,120,1)", "rgba(255,170,60,0)");
  const sun = new Group();
  sun.add(
    new Mesh(
      new SphereGeometry(moonMode ? 2.6 : SUN_R, 32, 16),
      new MeshBasicMaterial({ color: "#ffe39a" }),
    ),
  );
  const glow = new Sprite(
    new SpriteMaterial({
      map: glowTex,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  glow.scale.setScalar((moonMode ? 2.6 : SUN_R) * 6);
  sun.add(glow);
  scene.add(sun);

  // Light: from the Sun's place for the year's view; parallel from the left for the Moon's.
  scene.add(new AmbientLight("#ffffff", 0.16));
  if (moonMode) {
    const dl = new DirectionalLight("#ffffff", 3.2);
    dl.position.set(-50, 0, 0);
    dl.target.position.set(0, 0, 0);
    scene.add(dl, dl.target);
    sun.position.set(-SUN_DIST_MOON, 0, 0);
  } else {
    scene.add(new PointLight("#ffffff", 3.4, 0, 0));
  }

  // The Earth: a group on its orbit, tilted, and the turning globe inside.
  const earthR = moonMode ? MOON_EARTH_R : EARTH_R;
  const earth = new Group();
  const tilted = new Group();
  const spin = new Group();
  earth.add(tilted);
  tilted.add(spin);
  const earthTex = new CanvasTexture(earthCanvas());
  earthTex.colorSpace = SRGBColorSpace;
  earthTex.anisotropy = 4;
  spin.add(
    new Mesh(new SphereGeometry(earthR, 64, 32), new MeshLambertMaterial({ map: earthTex })),
  );
  // Axis: a rod through the poles, brighter at the north end.
  const rodMat = new MeshBasicMaterial({ color: "#f2f5fa" });
  const rodS = new Mesh(
    new CylinderGeometry(earthR * 0.03, earthR * 0.03, earthR * 0.75, 8),
    new MeshBasicMaterial({ color: "#8a94a8" }),
  );
  rodS.position.y = -earthR * 1.3;
  const rodN = new Mesh(
    new CylinderGeometry(earthR * 0.03, earthR * 0.03, earthR * 0.75, 8),
    rodMat,
  );
  rodN.position.y = earthR * 1.3;
  tilted.add(rodN, rodS);
  const equator = new Mesh(
    new TorusGeometry(earthR * 1.004, earthR * 0.008, 6, 96),
    new MeshBasicMaterial({ color: "#cfe3ff", transparent: true, opacity: 0.45 }),
  );
  equator.rotation.x = Math.PI / 2;
  tilted.add(equator);
  scene.add(earth);

  // Places: a dot on the globe and, for some, their circle of latitude, lit where it is day.
  const MAX_MARKERS = 12;
  const markerGeo = new SphereGeometry(earthR * 0.075, 12, 8);
  const markers = Array.from({ length: MAX_MARKERS }, () => {
    const m = new Mesh(markerGeo, new MeshBasicMaterial({ color: "#ffffff" }));
    m.visible = false;
    spin.add(m);
    return m;
  });
  const CIRCLE_N = 96;
  const circles = Array.from({ length: 2 }, () => {
    const geo = new BufferGeometry();
    geo.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array((CIRCLE_N + 1) * 3), 3),
    );
    geo.setAttribute("color", new Float32BufferAttribute(new Float32Array((CIRCLE_N + 1) * 3), 3));
    const line = new Line(geo, new LineBasicMaterial({ vertexColors: true, transparent: true }));
    line.visible = false;
    tilted.add(line);
    return { line, lat: Number.NaN, colour: new Color("#ffffff") };
  });

  // Seasons: the orbit, its months, and ghost axes at the solstices and equinoxes.
  const orbit = new Group();
  const ghosts = new Group();
  const monthAt: Vector3[] = [];
  let orbitYear = Number.NaN;
  const orbitGeo = new BufferGeometry();
  orbitGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(361 * 3), 3));
  const ticksGeo = new BufferGeometry();
  ticksGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(12 * 2 * 3), 3));
  const ghostGeo = new BufferGeometry();
  ghostGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(4 * 2 * 3), 3));
  if (!moonMode) {
    orbit.add(
      new Line(
        orbitGeo,
        new LineBasicMaterial({ color: "#6f7fa6", transparent: true, opacity: 0.55 }),
      ),
    );
    orbit.add(
      new LineSegments(
        ticksGeo,
        new LineBasicMaterial({ color: "#aab6d4", transparent: true, opacity: 0.7 }),
      ),
    );
    ghosts.add(
      new LineSegments(
        ghostGeo,
        new LineBasicMaterial({ color: "#f2f5fa", transparent: true, opacity: 0.32 }),
      ),
    );
    scene.add(orbit, ghosts);
    for (let i = 0; i < 12; i++) monthAt.push(new Vector3());
  }

  const radiusAt = (t: number) => {
    const g = meanAnomaly(t);
    const nu = g + ((2 * ECC) / DEG) * Math.sin(g * DEG);
    return (ORBIT_R * (1 - ECC * ECC)) / (1 + ECC * Math.cos(nu * DEG));
  };
  const earthAt = (t: number, out: Vector3) => toScene(sunLongitude(t) + 180, 0, radiusAt(t), out);

  const buildOrbit = (year: number) => {
    orbitYear = year;
    const t0 = timeOf(year, 0, 1);
    const t1 = timeOf(year + 1, 0, 1);
    const pos = orbitGeo.getAttribute("position") as Float32BufferAttribute;
    for (let i = 0; i <= 360; i++) {
      earthAt(t0 + ((t1 - t0) * i) / 360, tmp);
      pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    pos.needsUpdate = true;
    const ticks = ticksGeo.getAttribute("position") as Float32BufferAttribute;
    for (let m = 0; m < 12; m++) {
      const t = timeOf(year, m, 1);
      earthAt(t, tmp);
      const out = tmp.clone().multiplyScalar(1.035);
      const inn = tmp.clone().multiplyScalar(0.965);
      ticks.setXYZ(m * 2, inn.x, inn.y, inn.z);
      ticks.setXYZ(m * 2 + 1, out.x, out.y, out.z);
      // Labels sit outside the orbit at the middle of each month.
      earthAt(timeOf(year, m, 15), monthAt[m]!).multiplyScalar(1.16);
    }
    ticks.needsUpdate = true;
  };

  // Moon: the Moon, its orbit, the plane of the Earth's orbit, the node line and the shadows.
  const moon = new Mesh(
    new SphereGeometry(MOON_R, 32, 16),
    new MeshLambertMaterial({ color: "#d9dbe2" }),
  );
  const moonColour = new Color("#d9dbe2");
  const eclipseColour = new Color("#8a3a22");
  const frameGroup = new Group();
  const moonOrbitGeo = new BufferGeometry();
  moonOrbitGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(129 * 3), 3));
  moonOrbitGeo.setAttribute("color", new Float32BufferAttribute(new Float32Array(129 * 3), 3));
  const nodeGeo = new BufferGeometry();
  nodeGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(2 * 3), 3));
  // Drawn so the Moon touches the shadow exactly when the angles, made TILT_DRAWN times larger,
  // say it does: the shadow's radius at the Moon plus the Moon's.
  const contact = MOON_ORBIT_R * Math.sin(TILT_DRAWN * (UMBRA_DEG + MOON_DEG) * DEG);
  const umbraR = contact - MOON_R;
  const moonShadowLen = MOON_ORBIT_R * 1.4;
  const moonShadowR = Math.max(
    MOON_R * 0.6,
    MOON_ORBIT_R * Math.sin(TILT_DRAWN * PENUMBRA_AT_EARTH_DEG * DEG) - MOON_EARTH_R,
  );
  // The Earth's dark shadow narrows from the Earth's width to `umbraR` at the Moon's distance.
  const shadowLen = MOON_ORBIT_R * 1.5;
  const shadow = new Mesh(
    new CylinderGeometry(
      MOON_EARTH_R,
      MOON_EARTH_R - (MOON_EARTH_R - umbraR) * 1.5,
      shadowLen,
      32,
      1,
      true,
    ),
    new MeshBasicMaterial({
      color: "#000008",
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const moonShadow = new Mesh(
    new CylinderGeometry(MOON_R, MOON_R + (moonShadowR - MOON_R) * 1.4, moonShadowLen, 24, 1, true),
    new MeshBasicMaterial({
      color: "#000008",
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const plane = new Mesh(
    new CircleGeometry(MOON_ORBIT_R * 1.22, 64),
    new MeshBasicMaterial({
      color: "#7f8fbf",
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  // A thread from the Moon down (or up) to the plane of the Earth's orbit: above or below it.
  const dropGeo = new BufferGeometry();
  dropGeo.setAttribute("position", new Float32BufferAttribute(new Float32Array(6), 3));
  const dropMat = new LineBasicMaterial({ color: "#cfe3ff", transparent: true, opacity: 0.8 });
  const drop = new LineSegments(dropGeo, dropMat);
  if (moonMode) {
    scene.add(drop);
    // Shadows run away from the Sun, along +x: a cylinder's top (+y) turned to -x is its near end.
    shadow.rotation.z = Math.PI / 2;
    shadow.position.x = shadowLen / 2;
    moonShadow.rotation.z = Math.PI / 2;
    plane.rotation.x = -Math.PI / 2;
    frameGroup.add(earth);
    frameGroup.add(
      new Line(
        moonOrbitGeo,
        new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
      ),
    );
    frameGroup.add(
      new LineSegments(
        nodeGeo,
        new LineBasicMaterial({ color: "#ffcc33", transparent: true, opacity: 0.6 }),
      ),
    );
    scene.add(frameGroup, moon, shadow, moonShadow, plane);
  }
  // A faint shell so the night side of the Earth reads against space.
  const halo = new Mesh(
    new SphereGeometry(earthR * 1.06, 32, 16),
    new MeshBasicMaterial({
      color: "#3a6ad0",
      transparent: true,
      opacity: 0.12,
      side: BackSide,
      depthWrite: false,
    }),
  );
  earth.add(halo);

  let eclipsed: "solar" | "lunar" | null = null;
  let lastNode = Number.NaN;
  let lastIncl = Number.NaN;
  let orbitAz = 0;
  let orbitEl = 0;
  let view = { width: 1, height: 1 };
  let focusBox = { x: 0, y: 0, width: 1, height: 1 };
  const target = new Vector3();

  const placeCamera = () => {
    const vw = Math.max(1, view.width);
    const vh = Math.max(1, view.height);
    const fx = focusBox.x + focusBox.width / 2;
    const fy = focusBox.y + focusBox.height / 2;
    // A virtual picture centred on the focus, of which the viewport is a part.
    const fullW = 2 * Math.max(fx, vw - fx);
    const fullH = 2 * Math.max(fy, vh - fy);
    camera.aspect = fullW / fullH;
    camera.fov = 30;
    camera.setViewOffset(fullW, fullH, fullW / 2 - fx, fullH / 2 - fy, vw, vh);
    const tanHalf = Math.tan((camera.fov / 2) * DEG);
    const el = ((moonMode ? 17 : 27) + orbitEl) * DEG;
    const az = ((moonMode ? -90 : 0) + orbitAz) * DEG;
    // Fit the scene's width across the focus and its height, seen at this angle, up it.
    const tanW = (tanHalf * focusBox.width) / fullH;
    const tanH = (tanHalf * focusBox.height) / fullH;
    const across = moonMode ? 21 : ORBIT_R * 1.2 + EARTH_R * 0.6;
    const up = moonMode
      ? MOON_ORBIT_R * Math.sin(el) + 3
      : ORBIT_R * 1.18 * Math.sin(el) + EARTH_R * 1.3 * Math.cos(el) + 1;
    const dist = Math.max(across / tanW, up / tanH) + across * Math.cos(el) * 0.15;
    target.set(moonMode ? -3 : 0, 0, 0);
    camera.position.set(
      target.x + dist * Math.cos(el) * Math.cos(az),
      target.y + dist * Math.sin(el),
      target.z - dist * Math.cos(el) * Math.sin(az),
    );
    camera.near = Math.max(0.5, dist - 60);
    camera.far = dist + 900;
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  };

  const setCircle = (i: number, m: Marker | null, sunDir: Vector3) => {
    const c = circles[i]!;
    if (!m) {
      c.line.visible = false;
      return;
    }
    c.line.visible = true;
    const pos = c.line.geometry.getAttribute("position") as Float32BufferAttribute;
    const col = c.line.geometry.getAttribute("color") as Float32BufferAttribute;
    if (m.lat !== c.lat) {
      c.lat = m.lat;
      const r = earthR * 1.012 * Math.cos(m.lat * DEG);
      const y = earthR * 1.012 * Math.sin(m.lat * DEG);
      for (let k = 0; k <= CIRCLE_N; k++) {
        const a = (k / CIRCLE_N) * Math.PI * 2;
        pos.setXYZ(k, r * Math.cos(a), y, r * Math.sin(a));
      }
      pos.needsUpdate = true;
    }
    c.colour.set(m.colour);
    tilted.updateMatrixWorld();
    for (let k = 0; k <= CIRCLE_N; k++) {
      tmp.fromBufferAttribute(pos, k).applyMatrix4(tilted.matrixWorld);
      tmp.sub(earth.getWorldPosition(tmp2)).normalize();
      const day = tmp.dot(sunDir) > 0;
      const b = day ? 1 : 0.22;
      col.setXYZ(k, c.colour.r * b, c.colour.g * b, c.colour.b * b);
    }
    col.needsUpdate = true;
  };

  const sunDirection = new Vector3();

  return {
    scene,
    camera,
    frame(viewport, focus) {
      view = viewport;
      focusBox = focus;
      placeCamera();
    },
    orbit(az, el) {
      if (az === orbitAz && el === orbitEl) return;
      orbitAz = az;
      orbitEl = el;
      placeCamera();
    },
    update(g, tilt, incl, list) {
      // The globe turns so the place on Brisbane's meridian under the Sun has noon.
      tilted.rotation.set(-tilt * DEG, 0, 0);
      spin.rotation.set(0, (g.meridian - CLOCK_LON) * DEG, 0);
      if (!moonMode) {
        const year = dateOf(g.t).year;
        if (year !== orbitYear) buildOrbit(year);
        earthAt(g.t, earth.position);
        sunDirection.copy(earth.position).negate().normalize();
        // Ghost axes at the solstices and equinoxes show the axis keeping its direction.
        const gp = ghostGeo.getAttribute("position") as Float32BufferAttribute;
        const ax = tmp2
          .set(0, Math.cos(tilt * DEG), -Math.sin(tilt * DEG))
          .multiplyScalar(earthR * 0.9);
        [0, 90, 180, 270].forEach((l, i) => {
          toScene(l + 180, 0, ORBIT_R, tmp);
          gp.setXYZ(i * 2, tmp.x - ax.x, tmp.y - ax.y, tmp.z - ax.z);
          gp.setXYZ(i * 2 + 1, tmp.x + ax.x, tmp.y + ax.y, tmp.z + ax.z);
        });
        gp.needsUpdate = true;
        eclipsed = null;
      } else {
        // Turn the ecliptic so the Sun sits to the left (-x).
        frameGroup.rotation.set(0, (180 - g.lambda) * DEG, 0);
        sunDirection.set(-1, 0, 0);
        const drawnIncl = incl * TILT_DRAWN;
        if (g.moon.node !== lastNode || incl !== lastIncl) {
          lastNode = g.moon.node;
          lastIncl = incl;
          const pos = moonOrbitGeo.getAttribute("position") as Float32BufferAttribute;
          const col = moonOrbitGeo.getAttribute("color") as Float32BufferAttribute;
          for (let k = 0; k <= 128; k++) {
            const u = (k / 128) * 360;
            const beta = Math.asin(Math.sin(drawnIncl * DEG) * Math.sin(u * DEG)) / DEG;
            const lam =
              g.moon.node +
              Math.atan2(Math.cos(drawnIncl * DEG) * Math.sin(u * DEG), Math.cos(u * DEG)) / DEG;
            toScene(lam, beta, MOON_ORBIT_R, tmp);
            pos.setXYZ(k, tmp.x, tmp.y, tmp.z);
            const up = beta >= 0;
            col.setXYZ(k, up ? 0.9 : 0.22, up ? 0.92 : 0.3, up ? 0.98 : 0.55);
          }
          pos.needsUpdate = true;
          col.needsUpdate = true;
          const np = nodeGeo.getAttribute("position") as Float32BufferAttribute;
          toScene(g.moon.node, 0, MOON_ORBIT_R * 1.12, tmp);
          np.setXYZ(0, tmp.x, 0, tmp.z);
          np.setXYZ(1, -tmp.x, 0, -tmp.z);
          np.needsUpdate = true;
        }
        // The Moon at its drawn place, in the turned frame.
        const u = g.moon.lambda - g.moon.node;
        const beta = Math.asin(Math.sin(drawnIncl * DEG) * Math.sin(u * DEG)) / DEG;
        const lam =
          g.moon.node +
          Math.atan2(Math.cos(drawnIncl * DEG) * Math.sin(u * DEG), Math.cos(u * DEG)) / DEG;
        toScene(lam, beta, MOON_ORBIT_R, tmp);
        moon.position.copy(tmp).applyAxisAngle(tmp2.set(0, 1, 0), (180 - g.lambda) * DEG);
        const dp = dropGeo.getAttribute("position") as Float32BufferAttribute;
        dp.setXYZ(0, moon.position.x, moon.position.y, moon.position.z);
        dp.setXYZ(1, moon.position.x, 0, moon.position.z);
        dp.needsUpdate = true;
        dropGeo.computeBoundingSphere();
        dropMat.color.set(moon.position.y >= 0 ? "#cfe3ff" : "#6676a6");
        // Eclipses as drawn: the Moon in the Earth's shadow, or its shadow on the Earth.
        const off = Math.hypot(moon.position.y, moon.position.z);
        const lunar = moon.position.x > 0 && off < contact;
        const solar =
          moon.position.x < 0 &&
          off < MOON_ORBIT_R * Math.sin(TILT_DRAWN * PENUMBRA_AT_EARTH_DEG * DEG);
        eclipsed = lunar ? "lunar" : solar ? "solar" : null;
        const mat = moon.material as MeshLambertMaterial;
        let dark = 0;
        if (moon.position.x > 0) {
          // Partly in at the edge, wholly in once the Moon's far side is inside.
          const inner = Math.max(0, umbraR - MOON_R);
          dark = Math.max(0, Math.min(1, (contact - off) / Math.max(0.01, contact - inner)));
        }
        mat.color.copy(moonColour).lerp(eclipseColour, dark);
        // The Moon's shadow, near new Moon, points away from the Sun.
        const e = Math.abs(((g.moon.elong + 180) % 360) - 180);
        moonShadow.visible = e < 30;
        (moonShadow.material as MeshBasicMaterial).opacity = 0.4 * Math.max(0, 1 - e / 30);
        moonShadow.position.copy(moon.position);
        moonShadow.position.x += moonShadowLen / 2;
      }
      // Markers and circles.
      for (let i = 0; i < MAX_MARKERS; i++) {
        const mk = markers[i]!;
        const m = list[i];
        if (!m) {
          mk.visible = false;
          continue;
        }
        mk.visible = true;
        (mk.material as MeshBasicMaterial).color.set(m.colour);
        // Longitude L sits at (cos L, 0, -sin L) on the unturned globe.
        const r = earthR * 1.01;
        mk.position.set(
          r * Math.cos(m.lat * DEG) * Math.cos(m.lon * DEG),
          r * Math.sin(m.lat * DEG),
          -r * Math.cos(m.lat * DEG) * Math.sin(m.lon * DEG),
        );
      }
      const withCircle = list.filter((m) => m.circle);
      earth.updateMatrixWorld();
      setCircle(0, withCircle[0] ?? null, sunDirection);
      setCircle(1, withCircle[1] ?? null, sunDirection);
    },
    labels(viewport) {
      const at = (v: Vector3) => {
        tmp.copy(v).project(camera);
        if (tmp.z > 1) return null;
        return {
          x: (tmp.x * 0.5 + 0.5) * viewport.width,
          y: (-tmp.y * 0.5 + 0.5) * viewport.height,
        };
      };
      const months: SpaceLabels["months"] = [];
      monthAt.forEach((v, m) => {
        const p = at(v);
        if (p) months.push({ text: MONTHS[m]!.slice(0, 3), x: p.x, y: p.y });
      });
      tilted.updateMatrixWorld();
      const north = at(tilted.localToWorld(tmp2.set(0, earthR * 1.85, 0)));
      const sunP = moonMode ? at(sun.position) : null;
      const shadowP = moonMode ? at(tmp2.set(MOON_ORBIT_R * 1.3, 0, 0)) : null;
      return { months, north, sun: sunP, shadow: shadowP };
    },
    get eclipsed() {
      return eclipsed;
    },
    bodies() {
      earth.getWorldPosition(tmp);
      const e: [number, number, number] = [tmp.x, tmp.y, tmp.z];
      return { earth: e, moon: [moon.position.x, moon.position.y, moon.position.z] };
    },
    dispose() {
      glowTex.dispose();
      earthTex.dispose();
    },
  };
};
