/**
 * Reef's painted art: the seabed under a table and the open water behind the deck, and the
 * textures its models wear (pufferfish skin, a turtle's shell, brain coral, a whirlpool, the
 * caustic light that plays over everything, air bubbles). All drawn here from seeded noise, so
 * every table and deck looks the same each time.
 */
import { withAlpha } from "../../../../core/ui/palette";

/** A small seeded stream, so the sand and the coral are the same on every run. */
export const seeded = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

type G = CanvasRenderingContext2D;

/** Sand grain: tiny light and dark specks over a box. */
const grain = (
  g: G,
  rnd: () => number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  k: number,
) => {
  const n = Math.round((w * h) / (260 * k * k));
  for (let i = 0; i < n; i++) {
    g.fillStyle = rnd() > 0.5 ? "rgba(255,244,214,0.10)" : "rgba(0,28,36,0.12)";
    const s = (0.8 + rnd() * 1.6) * k;
    g.fillRect(x0 + rnd() * w, y0 + rnd() * h, s, s);
  }
};

/** Ripples in the sand: soft light crests with a shadow just below, `from` to `to` in y. */
const ripples = (g: G, rnd: () => number, w: number, from: number, to: number, k: number) => {
  let y = from;
  while (y < to) {
    const amp = (6 + rnd() * 10) * k;
    const freq = (0.006 + rnd() * 0.006) / k;
    const ph = rnd() * Math.PI * 2;
    const fade = Math.min(1, (y - from) / Math.max(1, (to - from) * 0.4));
    for (const [dy, c] of [
      [0, `rgba(255,240,200,${(0.1 * fade).toFixed(3)})`],
      [3 * k, `rgba(0,30,40,${(0.12 * fade).toFixed(3)})`],
    ] as const) {
      g.strokeStyle = c;
      g.lineWidth = 3 * k;
      g.beginPath();
      for (let x = 0; x <= w; x += 12 * k) {
        const yy =
          y + dy + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 2.7 + ph * 2) * amp * 0.3;
        if (x === 0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    y += (22 + rnd() * 22) * k;
  }
};

/** A branch of soft coral: a forking stroke with round tips. */
const coralBranch = (
  g: G,
  rnd: () => number,
  x: number,
  y: number,
  a: number,
  len: number,
  width: number,
  color: string,
  depth = 0,
) => {
  const x1 = x + Math.cos(a) * len;
  const y1 = y + Math.sin(a) * len;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(
    (x + x1) / 2 + Math.cos(a + 1.5) * len * 0.15,
    (y + y1) / 2 + Math.sin(a + 1.5) * len * 0.15,
    x1,
    y1,
  );
  g.stroke();
  if (depth < 3) {
    const n = 2 + (rnd() > 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const da = (i - (n - 1) / 2) * (0.5 + rnd() * 0.3);
      coralBranch(
        g,
        rnd,
        x1,
        y1,
        a + da,
        len * (0.62 + rnd() * 0.15),
        width * 0.72,
        color,
        depth + 1,
      );
    }
  } else {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x1, y1, width * 0.9, 0, Math.PI * 2);
    g.fill();
  }
};

/** A sea fan: fine lines spreading from a foot, as a lacy fan. */
const seaFan = (
  g: G,
  rnd: () => number,
  x: number,
  y: number,
  a: number,
  r: number,
  color: string,
) => {
  g.strokeStyle = color;
  g.lineCap = "round";
  for (let i = 0; i < 14; i++) {
    const b = a + (i / 13 - 0.5) * 1.6;
    g.lineWidth = 1.6 + rnd();
    g.beginPath();
    g.moveTo(x, y);
    const l = r * (0.7 + rnd() * 0.3);
    g.quadraticCurveTo(
      x + Math.cos(b - 0.2) * l * 0.6,
      y + Math.sin(b - 0.2) * l * 0.6,
      x + Math.cos(b) * l,
      y + Math.sin(b) * l,
    );
    g.stroke();
  }
  g.lineWidth = 1;
  for (let k = 1; k <= 3; k++) {
    g.beginPath();
    g.arc(x, y, (r * k) / 3.6, a - 0.8, a + 0.8);
    g.stroke();
  }
};

/** A clump of seagrass blades. */
const seagrass = (g: G, rnd: () => number, x: number, y: number, h: number) => {
  for (let i = 0; i < 6; i++) {
    const lean = (rnd() - 0.5) * 0.9;
    g.strokeStyle = rnd() > 0.5 ? "rgba(92,170,96,0.55)" : "rgba(130,190,90,0.5)";
    g.lineWidth = 3 + rnd() * 2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x + (rnd() - 0.5) * 14, y);
    const l = h * (0.6 + rnd() * 0.5);
    g.quadraticCurveTo(x + lean * l * 0.5, y - l * 0.55, x + lean * l, y - l);
    g.stroke();
  }
};

/** A sea anemone from above: a ring of soft tentacles round a pale middle. */
const anemone = (g: G, rnd: () => number, x: number, y: number, r: number) => {
  const col = ["255,120,200", "170,240,120", "255,170,100"][Math.floor(rnd() * 3)]!;
  g.lineCap = "round";
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
    const l = r * (0.8 + rnd() * 0.3);
    g.strokeStyle = `rgba(${col},0.55)`;
    g.lineWidth = r * 0.16;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r * 0.3, y + Math.sin(a) * r * 0.3);
    g.quadraticCurveTo(
      x + Math.cos(a + 0.3) * l * 0.7,
      y + Math.sin(a + 0.3) * l * 0.7,
      x + Math.cos(a + 0.15) * l,
      y + Math.sin(a + 0.15) * l,
    );
    g.stroke();
  }
  g.fillStyle = "rgba(255,240,220,0.5)";
  g.beginPath();
  g.arc(x, y, r * 0.28, 0, Math.PI * 2);
  g.fill();
};

/** A rock: a dark lump with a lit top. */
const rock = (g: G, rnd: () => number, x: number, y: number, r: number) => {
  g.fillStyle = "rgba(20,44,52,0.55)";
  g.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const rr = r * (0.75 + rnd() * 0.35);
    if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.75);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.75);
  }
  g.closePath();
  g.fill();
  const lit = g.createRadialGradient(x - r * 0.3, y - r * 0.35, 0, x, y, r);
  lit.addColorStop(0, "rgba(160,200,190,0.35)");
  lit.addColorStop(1, "rgba(160,200,190,0)");
  g.fillStyle = lit;
  g.fill();
};

/** A little shell or starfish lying in the sand. */
const trinket = (g: G, rnd: () => number, x: number, y: number, s: number) => {
  g.save();
  g.translate(x, y);
  g.rotate(rnd() * Math.PI * 2);
  if (rnd() > 0.5) {
    scallop(g, 0, 0, s, "rgba(255,236,214,0.55)", "rgba(120,90,80,0.35)");
  } else {
    g.fillStyle = rnd() > 0.5 ? "rgba(255,170,120,0.55)" : "rgba(200,150,255,0.5)";
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? s : s * 0.42;
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }
  g.restore();
};

/** A scallop shell, its hinge at the bottom, opening upwards. */
export const scallop = (g: G, x: number, y: number, s: number, fill: string, line: string) => {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.moveTo(-s * 0.25, s * 0.55);
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    const r = s * (i % 1 === 0 ? 1 : 0.9);
    const ax = Math.cos(a) * r;
    const ay = Math.sin(a) * r * 0.95;
    if (i === 0) g.lineTo(ax, ay);
    else {
      const pa = Math.PI + ((i - 0.5) / n) * Math.PI;
      g.quadraticCurveTo(Math.cos(pa) * r * 1.12, Math.sin(pa) * r * 1.07, ax, ay);
    }
  }
  g.lineTo(s * 0.25, s * 0.55);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = line;
  g.lineWidth = Math.max(1, s * 0.06);
  for (let i = 1; i < n; i++) {
    const a = Math.PI + (i / n) * Math.PI;
    g.beginPath();
    g.moveTo(0, s * 0.45);
    g.lineTo(Math.cos(a) * s * 0.92, Math.sin(a) * s * 0.88);
    g.stroke();
  }
  g.restore();
};

/** A chevron of three bubbles leading somewhere, pointing along `a` (radians, y down). */
export const bubbleArrow = (g: G, x: number, y: number, a: number, size: number, color: string) => {
  g.save();
  g.translate(x, y);
  g.rotate(a + Math.PI / 2);
  for (const [bx, by, r] of [
    [0, -size * 0.7, size * 0.36],
    [-size * 0.55, size * 0.15, size * 0.28],
    [size * 0.55, size * 0.15, size * 0.28],
  ] as const) {
    g.fillStyle = withAlpha(color, 0.16);
    g.strokeStyle = withAlpha(color, 0.75);
    g.lineWidth = size * 0.09;
    g.beginPath();
    g.arc(bx, by, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.restore();
};

/** A soft hollow in the sand round something: darker in the middle, a lit rim. */
export const hollow = (g: G, x: number, y: number, r: number, rim: string) => {
  const d = g.createRadialGradient(x, y, r * 0.2, x, y, r);
  d.addColorStop(0, "rgba(0,20,28,0.32)");
  d.addColorStop(0.75, "rgba(0,20,28,0.14)");
  d.addColorStop(1, "rgba(0,20,28,0)");
  g.fillStyle = d;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = withAlpha(rim, 0.35);
  g.lineWidth = 3;
  g.setLineDash([10, 9]);
  g.beginPath();
  g.arc(x, y, r * 0.86, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
};

/**
 * The seabed over (0, 0)-(w, h): deep water at the top, warm sand below, ripples, grain, sunlit
 * patches, and reef along the sides (`edges`: x ranges where coral grows, with y spans).
 */
export const paintSeabed = (
  g: G,
  w: number,
  h: number,
  seed: number,
  o: {
    scale?: number;
    sandFrom?: number;
    edges?: { x: number; y0: number; y1: number; dir: number }[];
  } = {},
) => {
  const rnd = seeded(seed);
  const k = o.scale ?? 1;
  const sand = o.sandFrom ?? 0.3;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#08344c");
  grad.addColorStop(sand, "#11586a");
  grad.addColorStop(Math.min(0.95, sand + 0.3), "#3a7468");
  grad.addColorStop(1, "#6c8563");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // Sunlit patches, bluer up high and warmer on the sand.
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 7; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.15 + rnd() * 0.22) * Math.max(w, h * 0.5);
    const warm = y / h > sand + 0.2;
    const c = warm ? "#a8c48a" : "#3aa6c0";
    const p = g.createRadialGradient(x, y, 0, x, y, r);
    p.addColorStop(0, withAlpha(c, 0.12));
    p.addColorStop(1, withAlpha(c, 0));
    g.fillStyle = p;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.restore();
  // Faint shafts of light slanting down from the surface.
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const x = (0.1 + 0.2 * i + rnd() * 0.08) * w;
    const top = (30 + rnd() * 40) * k;
    const sh = g.createLinearGradient(0, 0, 0, h * 0.75);
    sh.addColorStop(0, "rgba(190,240,255,0.10)");
    sh.addColorStop(1, "rgba(190,240,255,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.moveTo(x - top, 0);
    g.lineTo(x + top, 0);
    g.lineTo(x + top * 2.4 + h * 0.18, h * 0.75);
    g.lineTo(x - top * 0.4 + h * 0.18, h * 0.75);
    g.closePath();
    g.fill();
  }
  g.restore();
  ripples(g, rnd, w, h * (sand + 0.05), h, k);
  grain(g, rnd, 0, h * sand * 0.6, w, h * (1 - sand * 0.6), k);
  for (const e of o.edges ?? []) {
    let y = e.y0;
    while (y < e.y1) {
      const pick = rnd();
      const x = e.x + e.dir * rnd() * 30 * k;
      if (pick < 0.3) {
        const col = ["rgba(255,140,170,0.5)", "rgba(255,170,110,0.5)", "rgba(190,140,255,0.45)"][
          Math.floor(rnd() * 3)
        ]!;
        coralBranch(
          g,
          rnd,
          x,
          y,
          e.dir > 0 ? -0.4 - rnd() * 0.5 : Math.PI + 0.4 + rnd() * 0.5,
          34 * k,
          8 * k,
          col,
        );
      } else if (pick < 0.45) {
        seaFan(g, rnd, x, y, e.dir > 0 ? -0.3 : Math.PI + 0.3, 60 * k, "rgba(255,200,230,0.32)");
      } else if (pick < 0.6) {
        anemone(g, rnd, x + e.dir * 14 * k, y, 22 * k);
      } else if (pick < 0.8) {
        rock(g, rnd, x + e.dir * 10 * k, y, (14 + rnd() * 16) * k);
      } else {
        seagrass(g, rnd, x + e.dir * 8 * k, y, 46 * k);
      }
      y += (40 + rnd() * 50) * k;
    }
  }
  // A few shells and starfish dropped about.
  for (let i = 0; i < Math.round((w * h) / (90000 * k * k)); i++) {
    trinket(g, rnd, rnd() * w, h * sand + rnd() * h * (1 - sand), (7 + rnd() * 6) * k);
  }
};

/**
 * Open water for the deck: lighter towards the surface at the top, deep blue below, reef and
 * kelp silhouettes along the sides and the floor, shafts of light from above, sand at the bottom.
 */
export const paintOpenWater = (g: G, w: number, h: number, seed: number, u: number) => {
  const rnd = seeded(seed);
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#1f8aa0");
  grad.addColorStop(0.35, "#0d5672");
  grad.addColorStop(0.8, "#073452");
  grad.addColorStop(1, "#0b4552");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // Shafts of light from the surface.
  g.save();
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w * 1.1 - w * 0.05;
    const top = u * (3 + rnd() * 6);
    const lean = (rnd() - 0.3) * h * 0.25;
    const sh = g.createLinearGradient(0, 0, 0, h * 0.9);
    sh.addColorStop(0, "rgba(190,240,255,0.16)");
    sh.addColorStop(1, "rgba(190,240,255,0)");
    g.fillStyle = sh;
    g.beginPath();
    g.moveTo(x - top, 0);
    g.lineTo(x + top, 0);
    g.lineTo(x + top * 2.2 + lean, h * 0.9);
    g.lineTo(x - top * 0.6 + lean, h * 0.9);
    g.closePath();
    g.fill();
  }
  g.restore();
  // Faraway reef: soft dark mounds along the floor, and kelp up the sides.
  g.fillStyle = "rgba(4,30,44,0.55)";
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += u * 4) {
    const y = h * 0.86 - Math.abs(Math.sin(x / (u * 23) + 1.3)) * u * 6 - rnd() * u * 2;
    g.lineTo(x, y);
  }
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  for (const side of [0, 1]) {
    for (let i = 0; i < 7; i++) {
      const x = side ? w - rnd() * u * 14 : rnd() * u * 14;
      const len = h * (0.35 + rnd() * 0.45);
      g.strokeStyle = `rgba(40,110,70,${(0.25 + rnd() * 0.2).toFixed(2)})`;
      g.lineWidth = u * (0.5 + rnd() * 0.5);
      g.lineCap = "round";
      g.beginPath();
      const ph = rnd() * 6;
      for (let s = 0; s <= 24; s++) {
        const y = h - (s / 24) * len;
        const xx = x + Math.sin(s * 0.5 + ph) * u * 1.2;
        if (s === 0) g.moveTo(xx, y);
        else g.lineTo(xx, y);
      }
      g.stroke();
    }
  }
  // Tiny far fish, faint.
  for (let i = 0; i < Math.round(w / (u * 30)); i++) {
    const x = rnd() * w;
    const y = h * (0.15 + rnd() * 0.5);
    const s = u * (0.5 + rnd() * 0.5);
    const dir = rnd() > 0.5 ? 1 : -1;
    g.fillStyle = "rgba(180,230,255,0.12)";
    g.beginPath();
    g.ellipse(x, y, s * 1.4, s * 0.6, 0, 0, Math.PI * 2);
    g.moveTo(x - dir * s * 1.2, y);
    g.lineTo(x - dir * s * 2.2, y - s * 0.6);
    g.lineTo(x - dir * s * 2.2, y + s * 0.6);
    g.fill();
  }
  // Sand on the floor.
  const floor = g.createLinearGradient(0, h * 0.88, 0, h);
  floor.addColorStop(0, "rgba(120,150,120,0)");
  floor.addColorStop(1, "rgba(150,160,120,0.35)");
  g.fillStyle = floor;
  g.fillRect(0, h * 0.85, w, h * 0.15);
  ripples(g, rnd, w, h * 0.9, h, u / 14);
};

/**
 * Caustics: the net of light the surface throws on the sand, tileable, grey (the view tints
 * it). A cellular pattern: bright where a pixel is nearly as close to two cells as to one.
 */
export const paintCaustics = (g: G, size: number, seed: number, base = 0.02, width = 0.05) => {
  const rnd = seeded(seed);
  const n = 18;
  const pts: number[] = [];
  for (let i = 0; i < n; i++) pts.push(rnd(), rnd());
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let f1 = 9;
      let f2 = 9;
      for (let i = 0; i < n; i++) {
        let dx = Math.abs(u - pts[i * 2]!);
        let dy = Math.abs(v - pts[i * 2 + 1]!);
        if (dx > 0.5) dx = 1 - dx;
        if (dy > 0.5) dy = 1 - dy;
        const dd = Math.sqrt(dx * dx + dy * dy);
        if (dd < f1) {
          f2 = f1;
          f1 = dd;
        } else if (dd < f2) f2 = dd;
      }
      const e = Math.max(0, 1 - (f2 - f1) / width);
      const b = base + (1 - base) * e * e * e;
      const o = (y * size + x) * 4;
      const c = Math.round(b * 255);
      d[o] = c;
      d[o + 1] = c;
      d[o + 2] = c;
      d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
};

/**
 * A pufferfish's skin wrapped round a sphere (u across, v down from the top), facing +z at
 * u 0.25: spotted back, pale belly, rosy cheeks and a little round mouth.
 */
export const paintPuffer = (
  g: G,
  w: number,
  h: number,
  seed: number,
  base: string,
  spot: string,
) => {
  const rnd = seeded(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const belly = g.createLinearGradient(0, h * 0.5, 0, h);
  belly.addColorStop(0, withAlpha("#fff8e6", 0));
  belly.addColorStop(0.3, withAlpha("#fff8e6", 0.9));
  belly.addColorStop(1, "#fff8e6");
  g.fillStyle = belly;
  g.fillRect(0, h * 0.5, w, h * 0.5);
  const fx = w * 0.25;
  const fy = h * 0.5;
  for (let i = 0; i < 70; i++) {
    const x = rnd() * w;
    const y = rnd() * h * 0.62;
    const near = Math.hypot((x - fx) / w, (y - fy) / h);
    if (near < 0.13) continue;
    const r = (0.012 + rnd() * 0.02) * w;
    g.fillStyle = withAlpha(spot, 0.6 + rnd() * 0.3);
    g.beginPath();
    g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2);
    g.fill();
  }
  // Cheeks either side of the mouth, and the mouth itself: a small pursed "o".
  for (const dx of [-0.075, 0.075]) {
    const cx = fx + dx * w;
    const cy = fy + h * 0.06;
    const ch = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.04);
    ch.addColorStop(0, "rgba(255,140,150,0.55)");
    ch.addColorStop(1, "rgba(255,140,150,0)");
    g.fillStyle = ch;
    g.fillRect(cx - w * 0.05, cy - w * 0.05, w * 0.1, w * 0.1);
  }
  g.fillStyle = "#ff9a76";
  g.beginPath();
  g.ellipse(fx, fy + h * 0.1, w * 0.022, h * 0.05, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#5a2a2a";
  g.beginPath();
  g.ellipse(fx, fy + h * 0.1, w * 0.011, h * 0.028, 0, 0, Math.PI * 2);
  g.fill();
};

/** A sea turtle's shell from above, head towards +u, filling the canvas: scutes, pale seams. */
export const paintTurtleShell = (g: G, size: number) => {
  const c = size / 2;
  g.fillStyle = "#2f5a3a";
  g.fillRect(0, 0, size, size);
  const body = g.createRadialGradient(c * 0.9, c * 0.8, 0, c, c, c);
  body.addColorStop(0, "#c08a3e");
  body.addColorStop(0.7, "#8a5a2a");
  body.addColorStop(1, "#5a3a1e");
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(c, c, c * 0.98, c * 0.98, 0, 0, Math.PI * 2);
  g.fill();
  // Scutes: a row of five down the middle, four either side, and a ring of small ones.
  g.strokeStyle = "rgba(255,226,170,0.75)";
  g.lineWidth = size * 0.018;
  const cell = (x: number, y: number, rx: number, ry: number) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = x + Math.cos(a) * rx;
      const py = y + Math.sin(a) * ry;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    const f = g.createRadialGradient(x - rx * 0.3, y - ry * 0.3, 0, x, y, rx);
    f.addColorStop(0, "rgba(255,200,120,0.45)");
    f.addColorStop(1, "rgba(90,50,20,0.15)");
    g.fillStyle = f;
    g.fill();
    g.stroke();
  };
  // Rows run along u, the way the turtle swims.
  for (let i = -2; i <= 2; i++) cell(c + i * c * 0.34, c, c * 0.18, c * 0.2);
  for (const s of [-1, 1]) {
    for (let i = -1.5; i <= 1.5; i++) cell(c + i * c * 0.34, c + s * c * 0.4, c * 0.17, c * 0.19);
  }
  g.lineWidth = size * 0.01;
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * c * 0.8, c + Math.sin(a) * c * 0.8);
    g.lineTo(c + Math.cos(a) * c * 0.97, c + Math.sin(a) * c * 0.97);
    g.stroke();
  }
};

/** Brain coral wrapped round a dome: winding grooves over a base colour. */
export const paintBrainCoral = (
  g: G,
  w: number,
  h: number,
  base: string,
  groove: string,
  seed: number,
) => {
  const rnd = seeded(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = groove;
  g.lineWidth = Math.max(1.5, w / 90);
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    let x = rnd() * w;
    let y = rnd() * h * 0.55;
    let a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 40; s++) {
      a += (rnd() - 0.5) * 1.3;
      x += Math.cos(a) * w * 0.012;
      y += Math.sin(a) * h * 0.02;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const sh = g.createLinearGradient(0, 0, 0, h);
  sh.addColorStop(0, "rgba(255,255,255,0.12)");
  sh.addColorStop(0.5, "rgba(255,255,255,0)");
  g.fillStyle = sh;
  g.fillRect(0, 0, w, h);
};

/** A whirlpool from above: foamy arms spiralling into a dark middle. */
export const paintWhirl = (g: G, size: number) => {
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  const deep = g.createRadialGradient(c, c, 0, c, c, c);
  deep.addColorStop(0, "rgba(2,20,40,0.95)");
  deep.addColorStop(0.35, "rgba(10,70,110,0.6)");
  deep.addColorStop(1, "rgba(40,140,180,0)");
  g.fillStyle = deep;
  g.fillRect(0, 0, size, size);
  g.save();
  g.translate(c, c);
  for (let arm = 0; arm < 5; arm++) {
    g.beginPath();
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const a = arm * ((Math.PI * 2) / 5) + t * Math.PI * 2.2;
      const r = c * (0.12 + t * 0.82);
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.strokeStyle = "rgba(220,250,255,0.55)";
    g.lineWidth = size * 0.03;
    g.lineCap = "round";
    g.stroke();
  }
  g.restore();
};

/** An air bubble: clear, with a bright rim and a highlight. */
export const paintBubble = (g: G, size: number) => {
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  const rim = g.createRadialGradient(c, c, c * 0.62, c, c, c * 0.96);
  rim.addColorStop(0, "rgba(220,250,255,0.05)");
  rim.addColorStop(0.8, "rgba(220,250,255,0.75)");
  rim.addColorStop(1, "rgba(220,250,255,0)");
  g.fillStyle = rim;
  g.beginPath();
  g.arc(c, c, c, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.ellipse(c - c * 0.32, c - c * 0.36, c * 0.16, c * 0.1, -0.7, 0, Math.PI * 2);
  g.fill();
};
