/**
 * A light view for a touch frame under a working screen. All it shows is the low sky, the ground,
 * its own shells climbing away and the echo glow when they burst above, so a 2D canvas does,
 * and the frame needs no WebGL context of its own. (Browsers allow only so many: a simulator tab
 * with two banks would otherwise lose the screens' contexts.) Colours and hills follow the same
 * formulas as the WebGL sky, so the view joins the screen above and the frames beside it.
 */
import type { Engine } from "../engine";
import { COLORS, MIXED } from "../recipe";
import type { Glow, Renderer, RendererOptions, View } from "./renderer";

const SPARK_RATE = 70;
const SPARK_LIFE = 0.55;

const fract = (v: number) => v - Math.floor(v);
/** The shader's 2D hash and value noise, so the hills line up with the screen's sky. */
const h21 = (x: number, y: number) => {
  let px = fract(x * 123.34);
  let py = fract(y * 456.21);
  const d = px * (px + 45.32) + py * (py + 45.32);
  px += d;
  py += d;
  return fract(px * py);
};
const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const a = h21(i, 3.1);
  const b = h21(i + 1, 3.1);
  return a + (b - a) * f * f * (3 - 2 * f);
};
const hash = (i: number, salt: number, seed: number) => {
  let h = (Math.imul(i, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca77) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const mix = (a: readonly number[], b: readonly number[], t: number) =>
  a.map((v, i) => v + ((b[i] ?? 0) - v) * t);
const css = (c: readonly number[], k = 1) =>
  `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v * k)) * 255)).join(",")})`;

/** The shader's sky colour at height h (0 at the horizon, 1 at the top). */
const skyAt = (h: number) => {
  const zen = [0.004, 0.006, 0.018];
  const low = [0.028, 0.03, 0.075];
  const haze = [0.055, 0.045, 0.09];
  const c = mix(low, zen, Math.pow(Math.min(1, Math.max(0, h)), 0.55));
  return mix(c, haze, Math.exp(-Math.max(h, 0) * 9) * 0.6);
};

/** A soft round dot to stamp sparks with. */
const makeSprite = (): HTMLCanvasElement => {
  const s = document.createElement("canvas");
  s.width = s.height = 64;
  const g = s.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return s;
};

export const createClimbView = (opts: RendererOptions): Renderer => {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  opts.host.prepend(canvas);
  const g = canvas.getContext("2d", { alpha: false });
  const sprite = makeSprite();
  const tints = new Map<string, HTMLCanvasElement>();
  let backdrop: HTMLCanvasElement | null = null;
  let backdropKey = "";

  /** The sprite tinted to a colour, cached per colour. */
  const tinted = (rgb: readonly number[]) => {
    const key = rgb.map((v) => v.toFixed(2)).join(",");
    let t = tints.get(key);
    if (!t) {
      t = document.createElement("canvas");
      t.width = t.height = 64;
      const tg = t.getContext("2d");
      if (tg) {
        tg.drawImage(sprite, 0, 0);
        tg.globalCompositeOperation = "source-in";
        tg.fillStyle = css(rgb);
        tg.fillRect(0, 0, 64, 64);
      }
      tints.set(key, t);
      if (tints.size > 24) tints.delete(tints.keys().next().value ?? key);
    }
    return t;
  };

  /** Sky and ground, drawn once per view and blitted every frame. */
  const paintBackdrop = (view: View) => {
    const w = canvas.width;
    const h = canvas.height;
    const r = view.region;
    const key = `${w}x${h}:${r.x0},${r.y0},${r.x1},${r.y1}:${view.horizon},${view.zenith}`;
    if (backdrop && key === backdropKey) return backdrop;
    backdropKey = key;
    backdrop ??= document.createElement("canvas");
    backdrop.width = w;
    backdrop.height = h;
    const b = backdrop.getContext("2d");
    if (!b) return backdrop;
    const span = Math.max(1, view.zenith - view.horizon);
    const grad = b.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= 8; i++) {
      const y = r.y1 + ((r.y0 - r.y1) * i) / 8;
      grad.addColorStop(i / 8, css(skyAt((y - view.horizon) / span)));
    }
    b.fillStyle = grad;
    b.fillRect(0, 0, w, h);
    if (view.ground) {
      const toX = (x: number) => ((x - r.x0) / (r.x1 - r.x0)) * w;
      const toY = (y: number) => ((r.y1 - y) / (r.y1 - r.y0)) * h;
      b.beginPath();
      b.moveTo(0, h);
      for (let i = 0; i <= 64; i++) {
        const x = r.x0 + ((r.x1 - r.x0) * i) / 64;
        const hill =
          view.horizon +
          span * 0.012 * (noise1(x / (span * 0.05)) * 2 + noise1(x / (span * 0.013)) * 0.6);
        b.lineTo(toX(x), toY(hill));
      }
      b.lineTo(w, h);
      b.closePath();
      b.fillStyle = css([0.012, 0.014, 0.024]);
      b.fill();
    }
    return backdrop;
  };

  const drawShells = (now: number, engine: Engine, view: View) => {
    if (!g) return;
    const r = view.region;
    const w = canvas.width;
    const h = canvas.height;
    const sx = w / (r.x1 - r.x0);
    const sy = h / (r.y1 - r.y0);
    const spark = tinted([1, 0.78, 0.45]);
    for (const s of engine.shells.slots) {
      if (!s.live) continue;
      const age = (now - s.t0) / 1000;
      const end = (s.tb - s.t0) / 1000;
      if (age <= 0 || age - end > SPARK_LIFE) continue;
      const p = s.path;
      const at = (t: number) => ({
        x: (p.x + p.vx * t - r.x0) * sx,
        y: (r.y1 - (p.y + p.vy * t - 0.5 * p.g * t * t)) * sy,
      });
      const speed = Math.hypot(p.vx, p.vy);
      const first = Math.max(0, Math.floor((age - SPARK_LIFE) * SPARK_RATE));
      const last = Math.floor(Math.min(age, end) * SPARK_RATE);
      for (let i = first; i <= last; i++) {
        const te = i / SPARK_RATE;
        const a = age - te;
        if (a < 0 || a > SPARK_LIFE) continue;
        const x = a / SPARK_LIFE;
        const o = at(te);
        const kx = (hash(i, 1, s.seed) - 0.5) * speed * 0.09 * a;
        const ky = (hash(i, 2, s.seed) - 0.6) * speed * 0.09 * a - speed * 0.06 * a * a;
        const size = s.star * (1.1 - 0.7 * x) * sx * 3;
        g.globalAlpha = Math.pow(1 - x, 1.6) * 0.75;
        g.drawImage(spark, o.x + kx * sx - size / 2, o.y - ky * sy - size / 2, size, size);
      }
      if (age < end) {
        const head = at(age);
        // A short streak behind the head, so the sparks read as one trail.
        const tail = at(Math.max(0, age - 0.14));
        const streak = g.createLinearGradient(tail.x, tail.y, head.x, head.y);
        streak.addColorStop(0, "rgba(255,190,110,0)");
        streak.addColorStop(1, "rgba(255,225,170,0.7)");
        g.globalAlpha = 1;
        g.strokeStyle = streak;
        g.lineWidth = Math.max(1, s.star * sx * 0.7);
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(tail.x, tail.y);
        g.lineTo(head.x, head.y);
        g.stroke();
        const col = s.color >= MIXED ? [1, 0.92, 0.82] : (COLORS[s.color]?.rgb ?? [1, 1, 1]);
        const size = s.star * 7 * sx;
        g.globalAlpha = 1;
        g.drawImage(
          tinted(mix([1, 0.9, 0.75], col, 0.25)),
          head.x - size / 2,
          head.y - size / 2,
          size,
          size,
        );
      }
    }
    g.globalAlpha = 1;
  };

  const drawGlows = (view: View, glows: readonly Glow[]) => {
    if (!g) return;
    const r = view.region;
    const w = canvas.width;
    const h = canvas.height;
    const sx = w / (r.x1 - r.x0);
    const sy = h / (r.y1 - r.y0);
    for (const gw of glows) {
      const x = (gw.x - r.x0) * sx;
      const y = (r.y1 - gw.y) * sy;
      const rad = gw.width * sx * 2.2;
      const grad = g.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(
        0,
        `rgba(${gw.rgb.map((v) => Math.round(v * 255)).join(",")},${(0.4 * gw.strength).toFixed(3)})`,
      );
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  };

  return {
    get ready() {
      return g !== null;
    },
    lost: false,
    software: false,
    resize(w, h) {
      const cw = Math.max(1, Math.round(w));
      const ch = Math.max(1, Math.round(h));
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
    },
    draw(now, _dt, engine, view, glows) {
      if (!g) return;
      g.globalCompositeOperation = "source-over";
      g.drawImage(paintBackdrop(view), 0, 0);
      g.globalCompositeOperation = "lighter";
      drawShells(now, engine, view);
      drawGlows(view, glows);
      g.globalCompositeOperation = "source-over";
    },
    simulateLoss() {
      return false;
    },
    dispose() {
      canvas.remove();
      tints.clear();
      backdrop = null;
    },
  };
};
