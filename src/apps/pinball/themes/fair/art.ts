/**
 * Fun fair's painted art: the playfield (dark boards under a big top's stripes, with the marks
 * under the toys), the deck's night sky, and the textures its models wear. Drawn from seeded
 * noise, so every table and deck looks the same each time. Stripes are red and cream or blue and
 * cream, never red beside yellow.
 */
import { withAlpha } from "../../../../core/ui/palette";
import type { Lamp } from "../../layout";
import type { FairMiddle } from ".";

/** A small seeded stream, so the boards and stars are the same on every run. */
export const stream = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

export const FAIR = {
  red: "#c8283c",
  cream: "#f4e6c8",
  blue: "#2f6fd0",
  gold: "#f2c45a",
  wood: "#3a2418",
  night: "#120a20",
  bulb: "#ffe9b0",
} as const;

/** Dark boards running across, with seams and a little grain. */
const boards = (g: CanvasRenderingContext2D, w: number, h: number, seed: number) => {
  const rnd = stream(seed);
  const plank = 64;
  for (let y = 0; y < h; y += plank) {
    const shade = 0.82 + rnd() * 0.3;
    g.fillStyle = `rgb(${Math.round(52 * shade)},${Math.round(31 * shade)},${Math.round(24 * shade)})`;
    g.fillRect(0, y, w, plank);
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = withAlpha(rnd() > 0.5 ? "#000000" : "#8a5a3a", 0.12 + rnd() * 0.1);
      g.lineWidth = 1 + rnd() * 2;
      const yy = y + 6 + rnd() * (plank - 12);
      g.beginPath();
      g.moveTo(0, yy);
      for (let x = 0; x <= w; x += 120) g.lineTo(x, yy + (rnd() - 0.5) * 5);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, y, w, 3);
    // Board ends, staggered.
    const off = rnd() * 400;
    for (let x = off; x < w; x += 420) g.fillRect(x, y, 3, plank);
  }
};

/** The big top's stripes fanning down from above the arch, fading out lower down. */
const tent = (g: CanvasRenderingContext2D, w: number, h: number, cx: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const t = c.getContext("2d");
  if (!t) return;
  const top = 40;
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a0 = (Math.PI * (i - 0.5)) / (n - 1);
    const a1 = (Math.PI * (i + 0.5)) / (n - 1);
    t.fillStyle = i % 2 === 0 ? "#7a1a2e" : "#d9c6a4";
    t.beginPath();
    t.moveTo(cx, top);
    t.arc(cx, top, 2000, a0, a1);
    t.closePath();
    t.fill();
  }
  // Fade the stripes out down the table, and darken them overall.
  t.globalCompositeOperation = "destination-in";
  const fade = t.createLinearGradient(0, top, 0, 1180);
  fade.addColorStop(0, "rgba(0,0,0,0.62)");
  fade.addColorStop(0.45, "rgba(0,0,0,0.42)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  t.fillStyle = fade;
  t.fillRect(0, 0, w, h);
  g.drawImage(c, 0, 0);
  c.width = 0;
  // The tent's scalloped hem where the stripes end, in cream and gold.
  g.save();
  g.globalAlpha = 0.3;
  g.strokeStyle = FAIR.gold;
  g.lineWidth = 4;
  g.beginPath();
  for (let x = 20; x < w; x += 60) {
    g.moveTo(x, 1120);
    g.arc(x + 30, 1120, 30, Math.PI, 0, true);
  }
  g.stroke();
  g.restore();
};

/** A five-pointed star outline. */
const star = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const k = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) g.moveTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
    else g.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k);
  }
  g.closePath();
};

/** A gold chevron at (x, y) pointing along angle `a` (radians, y down). */
const chevron = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  a: number,
  s: number,
  c: string,
) => {
  g.save();
  g.translate(x, y);
  g.rotate(a + Math.PI / 2);
  g.beginPath();
  g.moveTo(0, -s);
  g.lineTo(s * 0.8, s * 0.45);
  g.lineTo(0, 0);
  g.lineTo(-s * 0.8, s * 0.45);
  g.closePath();
  g.fillStyle = withAlpha(c, 0.3);
  g.fill();
  g.strokeStyle = withAlpha(c, 0.85);
  g.lineWidth = s * 0.1;
  g.stroke();
  g.restore();
};

/** Chevrons from (x, y) towards (tx, ty). */
const lead = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  tx: number,
  ty: number,
  c: string,
  n = 3,
) => {
  const a = Math.atan2(ty - y, tx - x);
  for (let i = 0; i < n; i++)
    chevron(g, x + Math.cos(a) * i * 42, y + Math.sin(a) * i * 42, a, 20, c);
};

/** The playfield: boards, the big top's stripes, and the marks under the toys. */
export const paintFairField = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: FairMiddle,
  lamps: readonly Lamp[],
  color: string,
) => {
  boards(g, w, h, m.mirror ? 23 : 21);
  tent(g, w, h, 540);
  // Warm light pooled under the wheel and the carousel.
  for (const [x, y, r, a] of [
    [m.wheel.hub.x, m.wheel.hub.y + 40, 260, 0.2],
    [m.carousel.x, m.carousel.y, 240, 0.22],
  ] as const) {
    const pool = g.createRadialGradient(x, y, 0, x, y, r);
    pool.addColorStop(0, withAlpha("#ffcf8a", a));
    pool.addColorStop(1, withAlpha("#ffcf8a", 0));
    g.fillStyle = pool;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // The carousel's platform: a gold ring with a row of painted lights.
  const c = m.carousel;
  g.strokeStyle = withAlpha(FAIR.gold, 0.75);
  g.lineWidth = 6;
  g.beginPath();
  g.arc(c.x, c.y, c.r + 10, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 28; i++) {
    const a = (i * Math.PI * 2) / 28;
    g.fillStyle = withAlpha(i % 2 ? FAIR.cream : FAIR.gold, 0.55);
    g.beginPath();
    g.arc(c.x + Math.cos(a) * (c.r + 24), c.y + Math.sin(a) * (c.r + 24), 4.5, 0, Math.PI * 2);
    g.fill();
  }
  // Under the wheel: its station's boards and a ticket strip leading in, past its lamps.
  const st = m.wheel.station;
  const wl = lamps.filter((l) => l.tag === "wheel");
  const first = wl[0];
  if (first) {
    g.save();
    g.lineCap = "round";
    g.strokeStyle = withAlpha(FAIR.red, 0.45);
    g.lineWidth = 64;
    g.beginPath();
    g.moveTo(first.x - (st.x - first.x) * 0.15, first.y - (st.y - first.y) * 0.15);
    g.lineTo(st.x, st.y);
    g.stroke();
    g.setLineDash([10, 12]);
    g.strokeStyle = withAlpha(FAIR.cream, 0.5);
    g.lineWidth = 3;
    for (const off of [-26, 26]) {
      const dx = st.x - first.x;
      const dy = st.y - first.y;
      const l = Math.hypot(dx, dy) || 1;
      const px = (-dy / l) * off;
      const py = (dx / l) * off;
      g.beginPath();
      g.moveTo(first.x + px, first.y + py);
      g.lineTo(st.x + px, st.y + py);
      g.stroke();
    }
    g.restore();
  }
  g.fillStyle = withAlpha("#000000", 0.35);
  g.beginPath();
  g.arc(st.x, st.y, st.r - 4, 0, Math.PI * 2);
  g.fill();
  // The high striker: a target under its pad, and chevrons up to it.
  const sk = m.striker;
  const px = (sk.pad.ax + sk.pad.bx) / 2;
  const py = sk.pad.ay + 52;
  for (const [r, col] of [
    [44, FAIR.red],
    [32, FAIR.cream],
    [20, FAIR.red],
    [8, FAIR.cream],
  ] as const) {
    g.fillStyle = withAlpha(col, 0.55);
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  }
  lead(g, px - m.side * 120, py + 190, px, py, FAIR.gold);
  // The cannon's flight, dotted from the muzzle to where it lands.
  const cn = m.cannon;
  g.fillStyle = withAlpha(FAIR.cream, 0.4);
  for (let i = 1; i < 12; i++) {
    const k = i / 12;
    const bulge = Math.sin(Math.PI * k) * 40 * -m.side;
    g.beginPath();
    g.arc(
      cn.mouth.x + (cn.landing.x - cn.mouth.x) * k + bulge,
      cn.mouth.y + (cn.landing.y - cn.mouth.y) * k,
      4 + 3 * Math.sin(Math.PI * k),
      0,
      Math.PI * 2,
    );
    g.fill();
  }
  // The fuse: a rope from the bells' lamps down to the cannon's.
  const fuse = [
    ...lamps.filter((l) => l.tag === "bell"),
    ...lamps.filter((l) => l.tag === "cannon"),
  ];
  if (fuse.length > 1) {
    g.save();
    g.strokeStyle = withAlpha("#c9a06a", 0.6);
    g.lineWidth = 5;
    g.setLineDash([9, 6]);
    g.beginPath();
    fuse.forEach((l, i) => {
      if (i === 0) g.moveTo(l.x, l.y);
      else {
        const p = fuse[i - 1]!;
        g.quadraticCurveTo((p.x + l.x) / 2 + 22, (p.y + l.y) / 2, l.x, l.y);
      }
    });
    g.stroke();
    g.restore();
  }
  // Stars scattered over the stripes.
  const rnd = stream(m.mirror ? 9 : 8);
  for (let i = 0; i < 14; i++) {
    const x = 60 + rnd() * (w - 200);
    const y = 140 + rnd() * 1000;
    const r = 7 + rnd() * 9;
    star(g, x, y, r);
    g.fillStyle = withAlpha(FAIR.gold, 0.25 + rnd() * 0.25);
    g.fill();
  }
  // A ring in the table's colour under the lanes' stars.
  for (const p of m.lanes) {
    star(g, p.x, p.y, 36);
    g.strokeStyle = withAlpha(color, 0.6);
    g.lineWidth = 3;
    g.stroke();
  }
};

/** The carousel's floor seen from above: boards in wedges, a gold rim, a ring of stars. */
export const paintCarouselFloor = (g: CanvasRenderingContext2D, size: number) => {
  const c = size / 2;
  const n = 16;
  for (let i = 0; i < n; i++) {
    g.fillStyle = i % 2 === 0 ? "#8a1e30" : "#e9d7b4";
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c, (i * Math.PI * 2) / n, ((i + 1) * Math.PI * 2) / n);
    g.closePath();
    g.fill();
  }
  const shade = g.createRadialGradient(c, c, c * 0.2, c, c, c);
  shade.addColorStop(0, "rgba(0,0,0,0.05)");
  shade.addColorStop(1, "rgba(0,0,0,0.35)");
  g.fillStyle = shade;
  g.fillRect(0, 0, size, size);
  g.strokeStyle = FAIR.gold;
  g.lineWidth = size * 0.035;
  g.beginPath();
  g.arc(c, c, c * 0.96, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = size * 0.012;
  g.beginPath();
  g.arc(c, c, c * 0.42, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) * Math.PI * 2) / 8;
    star(g, c + Math.cos(a) * c * 0.7, c + Math.sin(a) * c * 0.7, size * 0.035);
    g.fillStyle = FAIR.gold;
    g.fill();
  }
};

/** A lollipop's swirl, white and a colour, wound from the middle. */
export const paintSwirl = (g: CanvasRenderingContext2D, size: number, color: string) => {
  const c = size / 2;
  g.fillStyle = "#fff6ec";
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.translate(c, c);
  g.strokeStyle = color;
  g.lineCap = "round";
  for (let arm = 0; arm < 3; arm++) {
    g.beginPath();
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      const a = arm * ((Math.PI * 2) / 3) + t * Math.PI * 3.2;
      const r = c * 0.95 * t;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.lineWidth = size * 0.09;
    g.stroke();
  }
  g.restore();
  const shine = g.createRadialGradient(c * 0.7, c * 0.6, 0, c, c, c);
  shine.addColorStop(0, "rgba(255,255,255,0.35)");
  shine.addColorStop(0.5, "rgba(255,255,255,0)");
  shine.addColorStop(1, "rgba(0,0,0,0.25)");
  g.fillStyle = shine;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
};

/** The deck's night: a dusky sky, stars, and the fair's tents low down. */
export const paintFairNight = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  U: number,
  seed: number,
) => {
  const rnd = stream(seed);
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#0d0820");
  sky.addColorStop(0.6, "#22102e");
  sky.addColorStop(1, "#3a1424");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const stars = Math.round((w * h) / (U * U * 5));
  for (let i = 0; i < stars; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.6;
    g.fillStyle = rnd() > 0.7 ? "#ffe9c0" : "#ffffff";
    g.beginPath();
    g.arc(rnd() * w, rnd() * h * 0.75, (rnd() > 0.95 ? 0.16 : 0.08) * U, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // Tents along the bottom, striped and dim, in front of a glow.
  const glow = g.createLinearGradient(0, h * 0.55, 0, h);
  glow.addColorStop(0, "rgba(255,170,90,0)");
  glow.addColorStop(1, "rgba(255,150,80,0.16)");
  g.fillStyle = glow;
  g.fillRect(0, h * 0.55, w, h * 0.45);
  const base = h * 0.86;
  let x = -U * 4;
  let i = 0;
  while (x < w + U * 4) {
    const tw = U * (9 + rnd() * 7);
    const th = U * (6 + rnd() * 5);
    const stripes = 6;
    for (let k = 0; k < stripes; k++) {
      const x0 = x + (tw * k) / stripes;
      const x1 = x + (tw * (k + 1)) / stripes;
      g.fillStyle = withAlpha(k % 2 === 0 ? (i % 2 ? FAIR.blue : FAIR.red) : FAIR.cream, 0.16);
      g.beginPath();
      g.moveTo(x + tw / 2, base - th);
      g.lineTo(x0, base);
      g.lineTo(x1, base);
      g.closePath();
      g.fill();
    }
    g.fillStyle = withAlpha(FAIR.gold, 0.25);
    g.beginPath();
    g.arc(x + tw / 2, base - th - U * 0.3, U * 0.3, 0, Math.PI * 2);
    g.fill();
    x += tw * (0.8 + rnd() * 0.4);
    i++;
  }
  // Strings of lights swagged across the sky.
  for (let row = 0; row < 2; row++) {
    const y0 = h * (0.12 + row * 0.1);
    const span = w / (3 + row);
    for (let sx = 0; sx < w; sx += span) {
      const sag = U * (2.2 + row);
      g.strokeStyle = withAlpha("#000000", 0.5);
      g.lineWidth = U * 0.08;
      g.beginPath();
      g.moveTo(sx, y0);
      g.quadraticCurveTo(sx + span / 2, y0 + sag * 2, sx + span, y0);
      g.stroke();
      for (let k = 1; k < 12; k++) {
        const t = k / 12;
        const bx = sx + span * t;
        const by = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * (y0 + sag * 2) + t * t * y0;
        const hue = [FAIR.bulb, "#ff9fb0", "#9fd0ff", "#b8f0a0"][k % 4]!;
        const halo = g.createRadialGradient(bx, by, 0, bx, by, U * 0.7);
        halo.addColorStop(0, withAlpha(hue, 0.45));
        halo.addColorStop(1, withAlpha(hue, 0));
        g.fillStyle = halo;
        g.fillRect(bx - U * 0.7, by - U * 0.7, U * 1.4, U * 1.4);
        g.fillStyle = hue;
        g.beginPath();
        g.arc(bx, by, U * 0.14, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
};
