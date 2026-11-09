/**
 * Volcano's painted art: dark basalt with glowing lava cracks for the playfield and the deck, and
 * the textures its models wear (the cone, flowing lava, speckled eggs, footprints, craters, a lava
 * whirl). All drawn from seeded noise, so every table and deck looks the same each time.
 */
import { withAlpha } from "../../../../core/ui/palette";

/** A small seeded stream, so the art is the same on every run. */
export const stream = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

type Pt = { x: number; y: number };

/** A wandering line from a to b, as points: a crack or a river. */
export const wander = (a: Pt, b: Pt, steps: number, amp: number, rnd: () => number): Pt[] => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  const pts: Pt[] = [];
  let off = 0;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    // Pinned at both ends, free in between.
    const pin = Math.sin(k * Math.PI);
    off += (rnd() - 0.5) * amp;
    off *= 0.85;
    pts.push({ x: a.x + dx * k + nx * off * pin, y: a.y + dy * k + ny * off * pin });
  }
  return pts;
};

const strokePath = (g: CanvasRenderingContext2D, pts: readonly Pt[]) => {
  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.stroke();
};

/** A glowing lava crack along `pts`: a wide soft glow, a hot core, and a bright thread. */
export const lavaLine = (g: CanvasRenderingContext2D, pts: readonly Pt[], width: number) => {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.globalCompositeOperation = "lighter";
  g.strokeStyle = withAlpha("#ff3d0a", 0.16);
  g.lineWidth = width * 5;
  strokePath(g, pts);
  g.strokeStyle = withAlpha("#ff5a14", 0.35);
  g.lineWidth = width * 2.2;
  strokePath(g, pts);
  g.restore();
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  g.strokeStyle = "#ff7a1f";
  g.lineWidth = width;
  strokePath(g, pts);
  g.strokeStyle = "#ffd35a";
  g.lineWidth = Math.max(1, width * 0.35);
  strokePath(g, pts);
  g.restore();
};

/** Dark basalt over (0, 0)-(w, h): mottled rock, pale ash, and fine dark cracks. */
export const paintRock = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  o: { scale?: number; top?: string; low?: string } = {},
) => {
  const rnd = stream(seed);
  const k = o.scale ?? 1;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, o.top ?? "#2b1a16");
  grad.addColorStop(0.55, "#1c120f");
  grad.addColorStop(1, o.low ?? "#120b09");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // Mottling: soft dark and warm blotches.
  for (let i = 0; i < Math.round((w * h) / (9000 * k * k)); i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (20 + rnd() * 70) * k;
    const warm = rnd() > 0.7;
    const c = warm ? "#4a2a1e" : "#0a0605";
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, withAlpha(c, warm ? 0.35 : 0.45));
    blot.addColorStop(1, withAlpha(c, 0));
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Ash speckles.
  for (let i = 0; i < Math.round((w * h) / (700 * k * k)); i++) {
    g.fillStyle = withAlpha(rnd() > 0.5 ? "#8a7a70" : "#5a4a42", 0.15 + rnd() * 0.25);
    const s = (0.8 + rnd() * 1.8) * k;
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
  // Fine dark cracks between the rock's plates.
  g.save();
  g.strokeStyle = withAlpha("#050302", 0.55);
  g.lineCap = "round";
  for (let i = 0; i < Math.round((w * h) / (60000 * k * k)); i++) {
    const a = { x: rnd() * w, y: rnd() * h };
    const ang = rnd() * Math.PI * 2;
    const len = (60 + rnd() * 160) * k;
    const b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
    g.lineWidth = (1 + rnd() * 2) * k;
    strokePath(g, wander(a, b, 8, 18 * k, rnd));
  }
  g.restore();
};

/** A flat fern frond, as a dark silhouette on the playfield's edge. */
export const fernSilhouette = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  len: number,
  color: string,
) => {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = len * 0.025;
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(len * 0.5, -len * 0.08, len, 0);
  g.stroke();
  for (let i = 1; i < 14; i++) {
    const k = i / 14;
    const px = len * k;
    const py = -len * 0.08 * 4 * k * (1 - k);
    const l = len * 0.2 * (1 - k * 0.8);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(px + l * 0.35, py + s * l * 0.45, l * 0.5, l * 0.16, s * 0.9, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
};

/** A three-toed footprint, toes towards -y, filling about `size` across. */
export const footprint = (g: CanvasRenderingContext2D, x: number, y: number, size: number) => {
  const s = size / 2;
  g.beginPath();
  g.ellipse(x, y + s * 0.35, s * 0.42, s * 0.5, 0, 0, Math.PI * 2);
  for (const a of [-0.55, 0, 0.55]) {
    const tx = x + Math.sin(a) * s * 0.75;
    const ty = y - Math.cos(a) * s * 0.55;
    g.moveTo(tx, ty);
    g.ellipse(tx, ty, s * 0.17, s * 0.42, a, 0, Math.PI * 2);
  }
  g.fill();
};

/**
 * Flowing lava for strips and pools, `w` x `h`, seamless top to bottom so it can scroll along a
 * strip: molten orange with hot yellow streaks and darker red wisps running along the flow.
 */
export const paintLava = (g: CanvasRenderingContext2D, w: number, h: number, seed: number) => {
  const rnd = stream(seed);
  g.fillStyle = "#ff6a12";
  g.fillRect(0, 0, w, h);
  // Streaks along the flow, each drawn a height above and below too, so the texture wraps.
  const streak = (x: number, y: number, len: number, wd: number, c: string, a: number) => {
    for (const dy of [-h, 0, h]) {
      const grad = g.createLinearGradient(0, y + dy - len / 2, 0, y + dy + len / 2);
      grad.addColorStop(0, withAlpha(c, 0));
      grad.addColorStop(0.5, withAlpha(c, a));
      grad.addColorStop(1, withAlpha(c, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y + dy, wd, len / 2, (rnd() - 0.5) * 0.15, 0, Math.PI * 2);
      g.fill();
    }
  };
  for (let i = 0; i < 40; i++) {
    streak(
      rnd() * w,
      rnd() * h,
      h * (0.2 + rnd() * 0.4),
      w * (0.02 + rnd() * 0.05),
      "#b8200a",
      0.35 + rnd() * 0.3,
    );
  }
  for (let i = 0; i < 46; i++) {
    streak(
      w * (0.15 + rnd() * 0.7),
      rnd() * h,
      h * (0.15 + rnd() * 0.35),
      w * (0.015 + rnd() * 0.04),
      "#ffe48a",
      0.45 + rnd() * 0.45,
    );
  }
  for (let i = 0; i < 18; i++) {
    streak(
      w * (0.3 + rnd() * 0.4),
      rnd() * h,
      h * (0.1 + rnd() * 0.2),
      w * (0.01 + rnd() * 0.015),
      "#fff6d0",
      0.6,
    );
  }
  // The edges cool darker, so a strip glows hottest down its middle.
  const edge = g.createLinearGradient(0, 0, w, 0);
  edge.addColorStop(0, withAlpha("#6a1404", 0.9));
  edge.addColorStop(0.2, withAlpha("#6a1404", 0));
  edge.addColorStop(0.8, withAlpha("#6a1404", 0));
  edge.addColorStop(1, withAlpha("#6a1404", 0.9));
  g.fillStyle = edge;
  g.fillRect(0, 0, w, h);
};

/**
 * The volcano cone's skin, u round it and v from the base (0) to the crater (1): basalt darkening
 * towards the top, ash bands, and lava channels running down from the rim. `glow` paints only the
 * lava, for the emissive map.
 */
export const paintCone = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  glow: boolean,
) => {
  const rnd = stream(seed);
  if (glow) {
    g.fillStyle = "#000000";
    g.fillRect(0, 0, w, h);
  } else {
    // v runs down the canvas from the base (top row) to the crater (bottom row).
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#7a6252");
    grad.addColorStop(0.35, "#5e4a3e");
    grad.addColorStop(0.72, "#4a3830");
    grad.addColorStop(0.8, "#6a2a14");
    grad.addColorStop(0.86, "#c8481a");
    grad.addColorStop(1, "#ffb347");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = withAlpha(rnd() > 0.5 ? "#6a5a50" : "#140c0a", 0.25 + rnd() * 0.3);
      const s = 1 + rnd() * 4;
      g.fillRect(rnd() * w, rnd() * h * 0.85, s * 2, s);
    }
    // Ash bands round the slope.
    for (let i = 0; i < 5; i++) {
      g.fillStyle = withAlpha("#8a7a6a", 0.08 + rnd() * 0.08);
      g.fillRect(0, h * (0.1 + rnd() * 0.65), w, h * (0.01 + rnd() * 0.025));
    }
  }
  // Lava channels from the rim down the slope, wrapped round in u.
  const channels = 7;
  for (let c = 0; c < channels; c++) {
    const u = ((c + rnd() * 0.5) / channels) * w;
    const end = h * (0.01 + rnd() * 0.16);
    const pts = wander(
      { x: u, y: h * 0.84 },
      { x: u + (rnd() - 0.5) * w * 0.06, y: end },
      14,
      w * 0.012,
      rnd,
    );
    for (const dx of [-w, 0, w]) {
      const shifted = pts.map((p) => ({ x: p.x + dx, y: p.y }));
      g.save();
      g.lineCap = "round";
      g.lineJoin = "round";
      if (glow) {
        g.strokeStyle = "#ff7a1a";
        g.lineWidth = w * 0.022;
        strokePath(g, shifted);
        g.strokeStyle = "#ffe08a";
        g.lineWidth = w * 0.008;
        strokePath(g, shifted);
      } else {
        g.strokeStyle = "#1a0805";
        g.lineWidth = w * 0.032;
        strokePath(g, shifted);
        g.strokeStyle = "#ff6a1a";
        g.lineWidth = w * 0.02;
        strokePath(g, shifted);
      }
      g.restore();
    }
  }
  if (glow) {
    // The rim and the crater's inside glow.
    const lip = g.createLinearGradient(0, h * 0.8, 0, h);
    lip.addColorStop(0, "#000000");
    lip.addColorStop(0.5, "#5a1404");
    lip.addColorStop(1, "#ff7a1a");
    g.fillStyle = lip;
    g.globalCompositeOperation = "lighter";
    g.fillRect(0, h * 0.8, w, h * 0.2);
    g.globalCompositeOperation = "source-over";
  }
};

/** A speckled eggshell, white so instance colours tint it. */
export const paintEgg = (g: CanvasRenderingContext2D, w: number, h: number, seed: number) => {
  const rnd = stream(seed);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 140; i++) {
    g.fillStyle = withAlpha(rnd() > 0.4 ? "#7a6a5a" : "#a0805a", 0.25 + rnd() * 0.4);
    g.beginPath();
    const r = 1 + rnd() * 3.5;
    g.ellipse(rnd() * w, rnd() * h, r * 1.4, r, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
};

/** A lava whirlpool seen from above: hot spiral arms round a dark middle. */
export const paintWhirl = (g: CanvasRenderingContext2D, size: number) => {
  const c = size / 2;
  g.clearRect(0, 0, size, size);
  const glow = g.createRadialGradient(c, c, c * 0.1, c, c, c);
  glow.addColorStop(0, withAlpha("#ffb347", 0.95));
  glow.addColorStop(0.5, withAlpha("#ff4a0a", 0.75));
  glow.addColorStop(0.85, withAlpha("#5a1204", 0.6));
  glow.addColorStop(1, withAlpha("#2a0802", 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, size, size);
  g.save();
  g.translate(c, c);
  for (let arm = 0; arm < 5; arm++) {
    g.beginPath();
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const a = arm * ((Math.PI * 2) / 5) + t * Math.PI * 1.7;
      const r = c * (0.15 + t * 0.75);
      if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.strokeStyle = withAlpha("#2a0a04", 0.7);
    g.lineWidth = size * 0.05;
    g.stroke();
    g.strokeStyle = withAlpha("#ffe08a", 0.5);
    g.lineWidth = size * 0.012;
    g.stroke();
  }
  g.restore();
};

/** A small crater for the deck's saucers and scoop: a rocky rim round a glowing floor. */
export const paintCrater = (g: CanvasRenderingContext2D, size: number, glow: string) => {
  const c = size / 2;
  const rim = g.createRadialGradient(c, c, c * 0.4, c, c, c);
  rim.addColorStop(0, "#160a06");
  rim.addColorStop(0.5, "#2a1810");
  rim.addColorStop(0.72, "#7a6050");
  rim.addColorStop(0.88, "#3a2a22");
  rim.addColorStop(1, "rgba(30,20,16,0)");
  g.fillStyle = rim;
  g.fillRect(0, 0, size, size);
  const hot = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
  hot.addColorStop(0, withAlpha(glow, 0.55));
  hot.addColorStop(1, withAlpha(glow, 0));
  g.fillStyle = hot;
  g.fillRect(0, 0, size, size);
};

/**
 * Rock with glowing cracks for boulders and lava bombs, u round and v down a sphere. `glow` paints
 * only the cracks, for the emissive map.
 */
export const paintMagma = (
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
  glow: boolean,
) => {
  const rnd = stream(seed);
  if (glow) {
    g.fillStyle = "#000000";
    g.fillRect(0, 0, w, h);
  } else {
    g.fillStyle = "#6a564a";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = withAlpha(rnd() > 0.5 ? "#8a7466" : "#3a2c26", 0.3 + rnd() * 0.4);
      const r = 2 + rnd() * 8;
      g.beginPath();
      g.ellipse(rnd() * w, rnd() * h, r * 1.5, r, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let i = 0; i < 9; i++) {
    const a = { x: rnd() * w, y: h * (0.15 + rnd() * 0.7) };
    const ang = rnd() * Math.PI * 2;
    const len = w * (0.15 + rnd() * 0.25);
    const b = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len * 0.5 };
    const pts = wander(a, b, 8, w * 0.03, rnd);
    if (glow) {
      g.strokeStyle = "#ff7a1a";
      g.lineWidth = w * 0.018;
      strokePath(g, pts);
      g.strokeStyle = "#ffe08a";
      g.lineWidth = w * 0.006;
      strokePath(g, pts);
    } else {
      g.strokeStyle = "#1a0a06";
      g.lineWidth = w * 0.024;
      strokePath(g, pts);
      g.strokeStyle = "#ff6a1a";
      g.lineWidth = w * 0.012;
      strokePath(g, pts);
    }
  }
  g.restore();
};
