/**
 * Shared look: colours, canvas-drawn textures and the few materials every scene uses. Materials
 * are Phong or basic only, so shader programs are few and compile quickly, and every scene has
 * the same lights so they share those programs.
 */
import {
  CanvasTexture,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  MeshBasicMaterial,
  MeshPhongMaterial,
  type Object3D,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  AdditiveBlending,
} from "three";

/** Ball colours, cycled ball by ball: bright marbles that read on wood and on the dark run. */
export const BALL_COLORS = [
  "#4dabf7",
  "#ffcf3f",
  "#f06595",
  "#51cf66",
  "#9775fa",
  "#ff922b",
  "#3bc9db",
  "#e8e9ec",
] as const;

/** Each board's pad colour. */
export const ACCENTS = ["#6fd3ff", "#ffcf6a", "#ff8fc0", "#8be3a0"] as const;

export const WOOD = { floor: "#d8ac74", wall: "#a8713f", rim: "#7c4f2a", base: "#5a3820" };
export const GOAL_GLOW = "#6cf7c8";
export const BRASS = "#d4ad5f";

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

const texture = (c: HTMLCanvasElement): CanvasTexture => {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
};

/** Light wood with long grain, our own drawing. */
const woodTexture = () => {
  const c = canvas(512, 512);
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = WOOD.floor;
    g.fillRect(0, 0, 512, 512);
    // Grain: wavy darker lines along x, a few broad bands.
    for (let i = 0; i < 9; i++) {
      const y = (i / 9) * 512 + 20;
      const grad = g.createLinearGradient(0, y - 40, 0, y + 40);
      grad.addColorStop(0, "rgba(120,72,30,0)");
      grad.addColorStop(0.5, `rgba(120,72,30,${0.06 + (i % 3) * 0.03})`);
      grad.addColorStop(1, "rgba(120,72,30,0)");
      g.fillStyle = grad;
      g.fillRect(0, y - 40, 512, 80);
    }
    g.lineWidth = 1.5;
    for (let i = 0; i < 70; i++) {
      const y0 = (i * 512) / 70 + ((i * 37) % 11);
      const amp = 3 + ((i * 13) % 7);
      const ph = (i * 0.9) % (Math.PI * 2);
      g.strokeStyle = `rgba(110,64,26,${0.1 + ((i * 7) % 5) * 0.035})`;
      g.beginPath();
      for (let x = 0; x <= 512; x += 16) {
        const y = y0 + Math.sin(x / 70 + ph) * amp + Math.sin(x / 23 + i) * 1.2;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  const t = texture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.anisotropy = 4;
  return t;
};

/** A marble: its colour with a white band round it and a highlight, so rolling shows. */
const ballTexture = (color: string) => {
  const c = canvas(128, 64);
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.fillRect(0, 26, 128, 12);
    g.fillStyle = "rgba(255,255,255,0.85)";
    for (const x of [16, 80]) {
      g.beginPath();
      g.ellipse(x, 10, 7, 4, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(x + 32, 54, 7, 4, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  return texture(c);
};

const radial = (stops: [number, string][]) => {
  const c = canvas(128, 128);
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [at, col] of stops) grad.addColorStop(at, col);
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  return texture(c);
};

export interface Look {
  tex: { wood: Texture; blob: Texture; hole: Texture; glow: Texture };
  ballGeo: SphereGeometry;
  balls: MeshPhongMaterial[];
  mat: {
    floor: MeshPhongMaterial;
    wall: MeshPhongMaterial;
    rim: MeshPhongMaterial;
    base: MeshPhongMaterial;
    brass: MeshPhongMaterial;
    metal: MeshPhongMaterial;
    glass: MeshPhongMaterial;
    edge: MeshBasicMaterial;
    hole: MeshBasicMaterial;
    blob: MeshBasicMaterial;
    goal: MeshBasicMaterial;
    halo: MeshBasicMaterial;
    start: MeshBasicMaterial;
  };
  dispose(): void;
}

export const createLook = (): Look => {
  const own: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    own.push(x);
    return x;
  };
  const tex = {
    wood: keep(woodTexture()),
    blob: keep(
      radial([
        [0, "rgba(0,0,0,0.75)"],
        [0.5, "rgba(0,0,0,0.38)"],
        [1, "rgba(0,0,0,0)"],
      ]),
    ),
    hole: keep(
      radial([
        [0, "rgba(6,4,3,1)"],
        [0.7, "rgba(14,9,5,1)"],
        [0.92, "rgba(60,36,18,1)"],
        [1, "rgba(60,36,18,0)"],
      ]),
    ),
    glow: keep(
      radial([
        [0, "rgba(255,255,255,1)"],
        [0.35, "rgba(255,255,255,0.5)"],
        [1, "rgba(255,255,255,0)"],
      ]),
    ),
  };
  const balls = BALL_COLORS.map((c) =>
    keep(
      new MeshPhongMaterial({
        map: keep(ballTexture(c)),
        shininess: 110,
        specular: 0x9a9a9a,
      }),
    ),
  );
  const mat = {
    floor: keep(new MeshPhongMaterial({ map: tex.wood, shininess: 18, specular: 0x2a1d10 })),
    wall: keep(new MeshPhongMaterial({ color: WOOD.wall, shininess: 22, specular: 0x2a1d10 })),
    rim: keep(new MeshPhongMaterial({ color: WOOD.rim, shininess: 26, specular: 0x2a1d10 })),
    base: keep(new MeshPhongMaterial({ color: WOOD.base, shininess: 10, specular: 0x111111 })),
    brass: keep(new MeshPhongMaterial({ color: BRASS, shininess: 80, specular: 0x886633 })),
    metal: keep(new MeshPhongMaterial({ color: "#c9d2e0", shininess: 90, specular: 0x99aabb })),
    glass: keep(
      new MeshPhongMaterial({
        color: "#d6ecff",
        transparent: true,
        opacity: 0.07,
        shininess: 140,
        specular: 0xffffff,
        depthWrite: false,
        side: DoubleSide,
      }),
    ),
    edge: keep(
      new MeshBasicMaterial({
        color: "#cfe9ff",
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    ),
    hole: keep(new MeshBasicMaterial({ map: tex.hole, transparent: true, depthWrite: false })),
    blob: keep(
      new MeshBasicMaterial({
        map: tex.blob,
        transparent: true,
        depthWrite: false,
        color: 0x000000,
      }),
    ),
    goal: keep(new MeshBasicMaterial({ color: GOAL_GLOW, transparent: true, depthWrite: false })),
    halo: keep(
      new MeshBasicMaterial({
        map: tex.glow,
        color: GOAL_GLOW,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0.5,
      }),
    ),
    start: keep(
      new MeshBasicMaterial({
        color: "#6b4424",
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    ),
  };
  return {
    tex,
    ballGeo: keep(new SphereGeometry(1, 32, 20)),
    balls,
    mat,
    dispose() {
      for (const x of own) x.dispose();
      own.length = 0;
    },
  };
};

/** The same lights in every scene: a warm sky, a key from the front left, a cool fill behind. */
export const addLights = (scene: Object3D) => {
  scene.add(new HemisphereLight(0xfff4e6, 0x2a1e16, 1.25));
  const key = new DirectionalLight(0xffffff, 1.9);
  key.position.set(-2, 5, 4);
  scene.add(key);
  const fill = new DirectionalLight(0x9db8ff, 0.7);
  fill.position.set(3, 2, -4);
  scene.add(fill);
};
