/**
 * The sky: day, dusk, night and dawn over DAY_MS on the shared clock, so every frame of a bank
 * agrees. The gradient, sun, moon and clouds are DOM layers behind the canvases (the compositor
 * moves them for free); stars and window lights follow `night`. Changes are slow: no flashing.
 */
import { DAY_MS } from "./config";
import { mix } from "./art";

interface Key {
  at: number;
  top: string;
  bottom: string;
  night: number;
}

/** Deep enough by day to hold its colour on a washed-out screen. */
const KEYS: Key[] = [
  { at: 0, top: "#1f4f8a", bottom: "#6d9fca", night: 0.05 },
  { at: 0.1, top: "#1d4f8c", bottom: "#5f97c6", night: 0 },
  { at: 0.42, top: "#1d4f8c", bottom: "#5f97c6", night: 0 },
  { at: 0.5, top: "#2a3270", bottom: "#d98a5f", night: 0.35 },
  { at: 0.57, top: "#171b48", bottom: "#7a4670", night: 0.75 },
  { at: 0.64, top: "#070b1e", bottom: "#18214a", night: 1 },
  { at: 0.88, top: "#070b1e", bottom: "#18214a", night: 1 },
  { at: 0.95, top: "#263572", bottom: "#d4907a", night: 0.45 },
  { at: 1, top: "#1f4f8a", bottom: "#6d9fca", night: 0.05 },
];

export interface SkyColours {
  top: string;
  bottom: string;
  /** 0 full day to 1 full night. */
  night: number;
  /** Sun and moon across the sky (0..1 left to right) and how high (0 horizon, 1 top). */
  sun: { x: number; y: number; a: number };
  moon: { x: number; y: number; a: number };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

export const skyAt = (phase: number): SkyColours => {
  const p = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]!.at <= p) i++;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const f = smooth((p - a.at) / Math.max(1e-6, b.at - a.at));
  // The sun crosses from just after dawn to dusk; the moon through the night.
  const sunT = (p + 0.04) / 0.6;
  const moonT = (p - 0.55) / 0.42;
  const arc = (t: number) => ({ x: 0.1 + 0.8 * t, y: Math.sin(Math.PI * t) });
  const sun =
    sunT > 0 && sunT < 1
      ? { ...arc(sunT), a: Math.min(1, Math.sin(Math.PI * sunT) * 3) }
      : { x: 0, y: 0, a: 0 };
  const moon =
    moonT > 0 && moonT < 1
      ? { ...arc(moonT), a: Math.min(1, Math.sin(Math.PI * moonT) * 3) }
      : { x: 0, y: 0, a: 0 };
  return {
    top: mix(a.top, b.top, f),
    bottom: mix(a.bottom, b.bottom, f),
    night: a.night + (b.night - a.night) * f,
    sun,
    moon,
  };
};

export const phaseAt = (clockMs: number): number => (clockMs % DAY_MS) / DAY_MS;

/** How bright finished buildings' windows are: a warm hint by day, fully lit at night. */
export const windowLight = (night: number): number => 0.3 + 0.7 * smooth(Math.min(1, night * 1.25));

const MAX_CLOUDS = 7;

export interface SkyLayer {
  /** Advance and restyle: `dt` in seconds, `phase` 0..1, `wind` -1.5..1.5. */
  update(dt: number, phase: number, wind: number): SkyColours;
  resize(width: number, height: number, skyBottom: number, unit: number): void;
  dispose(): void;
}

/** Gradient, sun, moon and clouds behind the canvases, in stage px. */
export const createSkyLayer = (root: HTMLElement, rand: () => number): SkyLayer => {
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0;";
  const sunEl = document.createElement("div");
  const moonEl = document.createElement("div");
  for (const el of [sunEl, moonEl]) {
    el.style.cssText = "position:absolute;left:0;top:0;border-radius:50%;will-change:transform;";
  }
  sunEl.style.background =
    "radial-gradient(circle, rgba(255,240,190,1) 0%, rgba(255,214,130,0.95) 38%, rgba(255,190,110,0) 70%)";
  moonEl.style.background =
    "radial-gradient(circle at 40% 40%, #f4f1e4 0%, #dcd8c6 45%, rgba(220,216,198,0) 68%)";
  layer.append(sunEl, moonEl);
  interface Cloud {
    el: HTMLElement;
    x: number;
    y: number;
    w: number;
    speed: number;
  }
  const clouds: Cloud[] = [];
  for (let i = 0; i < MAX_CLOUDS; i++) {
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:0;top:0;border-radius:50%;will-change:transform;filter:blur(0.5px);";
    layer.append(el);
    clouds.push({ el, x: rand(), y: rand(), w: 0.6 + rand() * 0.8, speed: 0.6 + rand() * 0.8 });
  }
  root.prepend(layer);
  let W = 1;
  let H = 1;
  let skyBottom = 1;
  let u = 1;
  let lastKey = "";

  const styleCloud = (c: Cloud, night: number) => {
    const w = c.w * 420 * u;
    const h = w * 0.36;
    c.el.style.width = `${w}px`;
    c.el.style.height = `${h}px`;
    const alpha = 0.16 + 0.1 * (1 - night);
    const tint = night > 0.5 ? "190,200,230" : "255,255,255";
    c.el.style.background = `radial-gradient(ellipse at 50% 60%, rgba(${tint},${alpha}) 0%, rgba(${tint},${alpha * 0.6}) 45%, rgba(${tint},0) 70%)`;
  };

  return {
    update(dt, phase, wind) {
      const sky = skyAt(phase);
      const key = `${sky.top}${sky.bottom}`;
      if (key !== lastKey) {
        lastKey = key;
        layer.style.background = `linear-gradient(to bottom, ${sky.top} 0%, ${sky.bottom} ${Math.round((skyBottom / H) * 100)}%, #0a0e18 100%)`;
        for (const c of clouds) styleCloud(c, sky.night);
      }
      const r = Math.min(W, skyBottom) * 0.07;
      const place = (el: HTMLElement, o: { x: number; y: number; a: number }, size: number) => {
        el.style.opacity = String(o.a);
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.transform = `translate(${o.x * W - size / 2}px, ${skyBottom * (0.92 - 0.75 * o.y) - size / 2}px)`;
      };
      place(sunEl, sky.sun, r * 2.6);
      place(moonEl, sky.moon, r * 1.7);
      const drift = 9 + 30 * Math.abs(wind);
      for (const c of clouds) {
        c.x += ((c.speed * drift * u * dt) / Math.max(1, W)) * (wind < 0 ? -1 : 1);
        if (c.x > 1.15) c.x = -0.15;
        if (c.x < -0.15) c.x = 1.15;
        c.el.style.transform = `translate(${c.x * W}px, ${c.y * skyBottom * 0.55}px)`;
      }
      return sky;
    },
    resize(width, height, bottom, unit) {
      W = width;
      H = height;
      skyBottom = bottom;
      u = unit;
      lastKey = "";
    },
    dispose() {
      layer.remove();
    },
  };
};
