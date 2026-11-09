/**
 * A preview of a `sphere` frame as the ball itself, hanging in a room at its true size and
 * height, for the simulator, the landing page and anyone checking a sphere app on a laptop
 * (`look=globe`). The app runs as usual on the stage underneath; every frame its canvases are
 * copied into one picture that wraps the model. DOM content, such as notices, isn't copied.
 *
 * Drag to walk round, scroll to step in or out. The buttons jump to standing beside it, under
 * it or far across the room, or flip back to the flat feed.
 */
import {
  CanvasTexture,
  CylinderGeometry,
  GridHelper,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { disposeTree } from "./renderer3d";
import { DEG, sphereMap, WHOLE_SPHERE } from "./sphere";
import type { FrameInfo, SphereInfo } from "./types";
import { PALETTE } from "./ui/palette";

export interface Globe {
  dispose(): void;
}

export interface GlobeOptions {
  /** Element the preview covers, normally the page body. */
  host: HTMLElement;
  /** The stage, whose canvases make the picture. */
  source: HTMLElement;
  frame: () => FrameInfo;
}

/** Widest copy of the feed the preview keeps, px. */
const MAX_PICTURE = 4096;
const EYE = 1.6;
const CHILD = 1.1;

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Samples the feed by direction, so the picture lands exactly where the runtime's maths says.
const FRAGMENT = /* glsl */ `
uniform sampler2D uFeed;
uniform vec2 uCover;
varying vec3 vDir;
const float PI = 3.141592653589793;
void main() {
  vec3 d = normalize(vDir);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float lon = atan(d.x, d.z);
  float v = (uCover.x - lat) / (uCover.x - uCover.y);
  if (v < 0.0 || v > 1.0) {
    gl_FragColor = vec4(0.06, 0.07, 0.09, 1.0);
    return;
  }
  vec2 uv = vec2((lon + PI) / (2.0 * PI), 1.0 - v);
  gl_FragColor = vec4(texture2D(uFeed, uv).rgb, 1.0);
}
`;

interface View {
  az: number;
  el: number;
  dist: number;
  target: Vector3;
}

/** A camera at `eye` looking at `target`, as orbit angles round the target. */
const viewFrom = (eye: Vector3, target: Vector3): View => {
  const d = eye.clone().sub(target);
  const dist = d.length();
  return { az: Math.atan2(d.x, d.z), el: Math.asin(d.y / dist), dist, target };
};

const PRESETS: Record<"side" | "under" | "far", (s: SphereInfo) => View> = {
  side: (s) =>
    viewFrom(new Vector3(0, EYE, s.radius * 3.6), new Vector3(0, s.centreY - s.radius * 0.35, 0)),
  under: (s) =>
    viewFrom(new Vector3(0.15, EYE, s.radius * 0.45), new Vector3(0, s.centreY, -s.radius * 0.1)),
  far: (s) => viewFrom(new Vector3(0, EYE, s.radius * 10), new Vector3(0, s.centreY, 0)),
};

const css = `
.hc-globe,.hc-globe-back{font:600 max(12px,1.6vmin) system-ui,sans-serif;}
.hc-globe{position:absolute;inset:0;z-index:40;background:#020306;overflow:hidden;
color:${PALETTE.foreground};touch-action:none;}
.hc-globe-view{position:absolute;inset:0;width:100%;height:100%;display:block;}
.hc-globe-flat{position:absolute;left:1em;bottom:1em;width:min(34%,60vmin);height:auto;
display:block;border:1px solid rgba(255,255,255,0.25);border-radius:0.3em;}
.hc-globe-bar{position:absolute;left:1em;top:1em;right:1em;display:flex;flex-wrap:wrap;
gap:0.4em;z-index:2;}
.hc-globe-bar button,.hc-globe-back{font:inherit;color:${PALETTE.foreground};
background:rgba(20,26,40,0.85);border:1px solid rgba(255,255,255,0.25);border-radius:0.3em;
padding:0.4em 0.7em;cursor:pointer;}
.hc-globe-bar button[aria-pressed=true]{border-color:${PALETTE.accent};color:${PALETTE.accent};}
.hc-globe-back{position:absolute;left:1em;top:1em;z-index:41;}
`;

const person = (height: number, color: string): Group => {
  const g = new Group();
  const mat = new MeshBasicMaterial({ color });
  const body = new Mesh(new CylinderGeometry(height * 0.12, height * 0.1, height * 0.8, 12), mat);
  body.position.y = height * 0.4;
  const head = new Mesh(new SphereGeometry(height * 0.08, 12, 8), mat);
  head.position.y = height * 0.9;
  g.add(body, head);
  return g;
};

export const startGlobe = ({ host, source, frame }: GlobeOptions): Globe => {
  const root = document.createElement("div");
  root.className = "hc-globe";
  root.dataset.look = "globe";
  const style = document.createElement("style");
  style.textContent = css;
  const canvas = document.createElement("canvas");
  canvas.className = "hc-globe-view";
  const flat = document.createElement("canvas");
  flat.className = "hc-globe-flat";
  const bar = document.createElement("div");
  bar.className = "hc-globe-bar";
  root.append(style, canvas, flat, bar);
  const back = document.createElement("button");
  back.className = "hc-globe-back";
  back.textContent = "Globe";
  back.hidden = true;
  host.append(root, back);

  const sphere = (): SphereInfo => frame().sphere ?? WHOLE_SPHERE;
  let s = sphere();

  const picture = document.createElement("canvas");
  const pg = picture.getContext("2d");
  const texture = new CanvasTexture(picture);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;

  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.05, 400);
  const ballMat = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: { uFeed: { value: texture }, uCover: { value: [0, 0] } },
  });
  const ball = new Mesh(new SphereGeometry(1, 192, 96), ballMat);
  const cable = new Mesh(
    new CylinderGeometry(0.03, 0.03, 1, 8),
    new MeshBasicMaterial({ color: "#3a4256" }),
  );
  const grid = new GridHelper(80, 80, "#2a3246", "#141a26");
  const people = new Group();
  scene.add(ball, cable, grid, people);

  const place = () => {
    s = sphere();
    ball.scale.setScalar(s.radius);
    ball.position.set(0, s.centreY, 0);
    ballMat.uniforms.uCover!.value = [s.cover.top, s.cover.bottom];
    const top = s.centreY + s.radius;
    const ceiling = top + Math.max(1, s.radius * 0.4);
    cable.scale.y = ceiling - top;
    cable.position.set(0, (ceiling + top) / 2, 0);
    disposeTree(people);
    people.clear();
    const r = s.radius;
    // Two underneath, the rest round about and clear of the cameras' usual spots.
    const spots: [number, number, number][] = [
      [0.3 * r, 0.2 * r, 1.75],
      [-0.25 * r, -0.3 * r, CHILD + 0.15],
      [-3 * r, -r, 1.75],
      [2.6 * r, -1.8 * r, 1.75],
      [-1.2 * r, -3.4 * r, CHILD + 0.15],
      [3.4 * r, 1.4 * r, 1.75],
    ];
    for (const [x, z, h] of spots) {
      const p = person(h, "#566078");
      p.position.set(x, 0, z);
      people.add(p);
    }
  };
  place();

  let view = PRESETS.side(s);
  let preset: keyof typeof PRESETS | null = "side";
  const buttons = new Map<string, HTMLButtonElement>();
  const button = (id: string, label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.dataset.globe = id;
    b.addEventListener("click", onClick);
    bar.append(b);
    buttons.set(id, b);
  };
  const mark = () => {
    for (const [id, b] of buttons) b.setAttribute("aria-pressed", String(id === preset));
  };
  for (const [id, label] of [
    ["side", "Beside"],
    ["under", "Below"],
    ["far", "Far"],
  ] as const) {
    button(id, label, () => {
      preset = id;
      view = PRESETS[id](s);
      mark();
    });
  }
  let showing = true;
  const show = (on: boolean) => {
    showing = on;
    root.hidden = !on;
    back.hidden = on;
  };
  button("flat", "Flat", () => show(false));
  back.addEventListener("click", () => show(true));
  mark();

  let drag: { id: number; x: number; y: number } | null = null;
  // Only real pointers: an app's bots inject synthetic ones that land here too.
  const onDown = (e: PointerEvent) => {
    if (!e.isTrusted || e.target !== canvas) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone; the drag ends on the next move.
    }
  };
  const onMove = (e: PointerEvent) => {
    if (!e.isTrusted || !drag || e.pointerId !== drag.id) return;
    view.az -= (e.clientX - drag.x) * 0.006;
    view.el = Math.max(-1.45, Math.min(1.45, view.el + (e.clientY - drag.y) * 0.006));
    drag.x = e.clientX;
    drag.y = e.clientY;
    preset = null;
    mark();
  };
  const onUp = (e: PointerEvent) => {
    if (drag?.id === e.pointerId) drag = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    view.dist = Math.max(s.radius * 0.3, Math.min(120, view.dist * Math.exp(e.deltaY * 0.001)));
    preset = null;
    mark();
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  /** Copy every canvas of the stage into the picture, in paint order. */
  const capture = () => {
    if (!pg) return;
    const f = frame();
    const w = Math.max(2, Math.min(MAX_PICTURE, Math.round(f.width * f.pixelRatio)));
    const h = Math.max(1, Math.round((w * f.height) / Math.max(1, f.width)));
    if (picture.width !== w || picture.height !== h) {
      picture.width = w;
      picture.height = h;
      texture.dispose();
    }
    const box = source.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    const k = w / box.width;
    pg.globalCompositeOperation = "source-over";
    pg.globalAlpha = 1;
    pg.fillStyle = PALETTE.background;
    pg.fillRect(0, 0, w, h);
    const canvases = [...source.querySelectorAll("canvas")]
      .map((c, i) => ({ c, i, z: Number(getComputedStyle(c).zIndex) || 0 }))
      .sort((a, b) => a.z - b.z || a.i - b.i);
    for (const { c } of canvases) {
      if (c.width === 0 || c.height === 0) continue;
      const r = c.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      try {
        pg.drawImage(c, (r.left - box.left) * k, (r.top - box.top) * k, r.width * k, r.height * k);
      } catch {
        // A canvas mid-resize or with a lost context; the next frame catches up.
      }
    }
    texture.needsUpdate = true;
  };

  const fg = flat.getContext("2d");
  /** The flat feed with latitude lines and the band people see. */
  const drawFlat = () => {
    if (!fg || picture.width === 0) return;
    const w = 640;
    const h = Math.round((w * picture.height) / picture.width);
    if (flat.width !== w || flat.height !== h) {
      flat.width = w;
      flat.height = h;
    }
    fg.drawImage(picture, 0, 0, w, h);
    const m = sphereMap(s, w, h);
    fg.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      fg.strokeStyle = lat === 0 ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.22)";
      const y = Math.round(m.y(lat * DEG)) + 0.5;
      fg.beginPath();
      fg.moveTo(0, y);
      fg.lineTo(w, y);
      fg.stroke();
    }
    const top = m.y(s.view.top);
    fg.fillStyle = "rgba(0,0,0,0.45)";
    fg.fillRect(0, 0, w, Math.max(0, top));
    fg.strokeStyle = PALETTE.accent;
    fg.setLineDash([6, 4]);
    fg.beginPath();
    fg.moveTo(0, top);
    fg.lineTo(w, top);
    fg.stroke();
    fg.setLineDash([]);
    fg.fillStyle = PALETTE.accent;
    fg.font = "600 12px system-ui, sans-serif";
    fg.fillText("seen well below this line", 6, Math.min(h - 6, top + 14));
  };

  const size = new Vector2();
  let handle = 0;
  let disposed = false;
  const tick = () => {
    if (disposed) return;
    handle = requestAnimationFrame(tick);
    if (!showing) return;
    capture();
    drawFlat();
    const w = root.clientWidth;
    const h = root.clientHeight;
    if (w === 0 || h === 0) return;
    const ratio = Math.min(2, frame().pixelRatio);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.getSize(size);
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const ce = Math.cos(view.el);
    camera.position.set(
      view.target.x + view.dist * ce * Math.sin(view.az),
      Math.max(0.2, view.target.y + view.dist * Math.sin(view.el)),
      view.target.z + view.dist * ce * Math.cos(view.az),
    );
    camera.lookAt(view.target);
    renderer.render(scene, camera);
  };
  handle = requestAnimationFrame(tick);

  const resized = () => {
    const before = s;
    place();
    if (before.radius !== s.radius || before.centreY !== s.centreY) {
      view = PRESETS[preset ?? "side"](s);
    }
  };
  const observer = new ResizeObserver(resized);
  observer.observe(source);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(handle);
      observer.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      disposeTree(scene);
      texture.dispose();
      renderer.dispose();
      root.remove();
      back.remove();
    },
  };
};
