/**
 * What shows through the white behind the conjunctiva, where a real eye sits in the orbit: the
 * large veins that drain the choroid, at least one to each quarter, which gather just behind the
 * equator and leave the sclera a little further back, and the two long arteries that run forward
 * along the horizontal meridian. They lie in and under the sclera, so they show
 * only as soft blue-grey shadows, clearest round the equator, where the sclera is thinnest, and
 * faint towards the back pole, where it is twice as thick.
 *
 * Painted once into a texture in the same frame as the vessels' (rows from the limbus to the back
 * pole, columns once round the line of sight) as optical depth: red holds each vessel's blurred
 * core and green the wider shadow round it.
 */
import type { Rng } from "../../core/types";

const DEG = Math.PI / 180;

export const BACK = { width: 2048, height: 1024 };

/** A vessel's points: angle round the line of sight and from it, width (radians) and depth. */
export interface BackPoint {
  phi: number;
  th: number;
  width: number;
  depth: number;
}

/** How much shows through the sclera at angle `th` from the line of sight: most at the equator. */
export const throughSclera = (th: number): number => {
  // Thickness after Olsen 1998: 0.53 mm at the limbus, 0.39 at the equator,
  // 0.9 to 1.0 by the optic nerve.
  const t = th < Math.PI / 2 ? 0.39 + 0.16 * Math.cos(th) : 0.39 + 0.56 * (1 - Math.sin(th)) ** 0.7;
  return Math.min(1, (0.39 / t) ** 2);
};

/** Grow the back's vessels: a few vortex veins and the two long arteries. */
export const growBack = (rng: Rng): BackPoint[][] => {
  const out: BackPoint[][] = [];
  const path = (pts: BackPoint[]) => {
    for (const p of pts) p.depth *= throughSclera(p.th);
    out.push(pts);
  };

  // The vortex veins: one to each oblique quarter, never on the horizontal meridian, and now and
  // then a second (four to eight in all).
  for (const quarter of [45, 135, -135, -45]) {
    const count = rng.next() < 0.3 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const spread = count === 2 ? (k === 0 ? -14 : 14) : 0;
      const phi = (quarter + spread + rng.range(-12, 12)) * DEG;
      // The ampulla just behind the equator; the trunk runs obliquely back through the sclera to
      // where it leaves, about 14 to 18 mm behind the limbus.
      const amp = rng.range(92, 99) * DEG;
      const exit = amp + rng.range(13, 18) * DEG;
      const drift = rng.range(-0.12, 0.12);
      const width = rng.range(0.02, 0.027);
      const trunk: BackPoint[] = [];
      const n = 14;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        // Deep under the sclera at the ampulla, nearest the surface where it leaves.
        trunk.push({
          phi: phi + drift * t + 0.03 * Math.sin(t * Math.PI),
          th: amp + (exit - amp) * t,
          width: width * (1.3 - 0.4 * t),
          depth: 0.06 + 0.09 * t ** 1.5,
        });
      }
      path(trunk);
      // Choroidal veins gather into the ampulla, deep and faint, mostly from in front of it.
      const branch = (th0: number, phi0: number, heading: number, len: number, width: number) => {
        const pts: BackPoint[] = [];
        const m = 12;
        const bend = rng.range(-0.5, 0.5);
        const wave = rng.range(0, 2 * Math.PI);
        let th = th0;
        let ph = phi0;
        for (let i = 0; i <= m; i++) {
          const t = i / m;
          pts.push({ phi: ph, th, width: width * (1 - 0.6 * t), depth: 0.05 - 0.03 * t });
          // Heading 0 runs towards the iris; it wanders and curls a little.
          const h = heading + bend * t + 0.25 * Math.sin(wave + t * 7);
          const step = len / m;
          th -= Math.cos(h) * step;
          ph += (Math.sin(h) * step) / Math.max(0.3, Math.sin(th));
        }
        path(pts);
        return pts;
      };
      const tributaries = 3 + Math.floor(rng.next() * 3);
      for (let j = 0; j < tributaries; j++) {
        const heading = ((j + 0.5) / tributaries - 0.5) * 2.6 + rng.range(-0.2, 0.2);
        const pts = branch(amp, phi, heading, rng.range(8, 15) * DEG, rng.range(0.009, 0.013));
        // Some fork once along the way.
        if (rng.next() < 0.6) {
          const at = pts[Math.floor(rng.range(4, 8))]!;
          const side = rng.next() < 0.5 ? 1 : -1;
          branch(at.th, at.phi, heading + side * rng.range(0.5, 0.9), rng.range(4, 8) * DEG, 0.006);
        }
      }
    }
  }

  // The long posterior ciliary arteries enter beside the optic nerve on the horizontal meridian
  // and run forward through the sclera and under it towards the iris's root.
  for (const side of [0, Math.PI]) {
    const wave = rng.range(0, 2 * Math.PI);
    const pts: BackPoint[] = [];
    const from = rng.range(158, 164) * DEG;
    const to = rng.range(52, 60) * DEG;
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const th = from + (to - from) * t;
      pts.push({
        phi: side + (0.035 * Math.sin(wave + t * 5)) / Math.max(0.3, Math.sin(th)),
        th,
        width: 0.008,
        // Fading in where it enters and out where the conjunctiva's vessels take over.
        depth: 0.17 * Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.3),
      });
    }
    path(pts);
  }
  return out;
};

/**
 * Paint the back's vessels as optical depth: each one's core, a little blurred, into red, and a
 * wider, fainter shadow round it into green, as if seen through the sclera. `sharp` is a scratch
 * canvas the same size, so each layer is blurred once rather than stroke by stroke.
 */
export const paintBack = (
  g: CanvasRenderingContext2D,
  sharp: CanvasRenderingContext2D,
  size: { width: number; height: number },
  paths: readonly BackPoint[][],
  iris: number,
): void => {
  const { width: W, height: H } = size;
  const rows = H / (Math.PI - iris);
  const cols = W / (2 * Math.PI);
  const clear = (c: CanvasRenderingContext2D) => {
    c.globalCompositeOperation = "source-over";
    c.filter = "none";
    c.fillStyle = "#000";
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = "lighten";
    c.lineCap = "round";
  };
  const level = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  const layers = [
    { blur: 2, wide: 1, strength: 1, colour: (v: number) => `rgb(${level(v)},0,0)` },
    { blur: 10, wide: 3.5, strength: 0.12, colour: (v: number) => `rgb(0,${level(v)},0)` },
  ];
  clear(g);
  for (const layer of layers) {
    clear(sharp);
    for (const pts of paths) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const th = (a.th + b.th) / 2;
        // Width across a vessel is along the row, which shrinks by sin θ.
        const across = (((a.width + b.width) / 2) * cols) / Math.max(0.3, Math.sin(th));
        const w = Math.max(1, across * layer.wide);
        sharp.strokeStyle = layer.colour(((a.depth + b.depth) / 2) * layer.strength);
        sharp.lineWidth = w;
        const x0 = (a.phi + Math.PI) * cols;
        const x1 = x0 + (b.phi - a.phi) * cols;
        const y0 = (a.th - iris) * rows;
        const y1 = (b.th - iris) * rows;
        // Draw it again a width over where it crosses the picture's left or right edge.
        for (const dx of [-W, 0, W]) {
          if (Math.max(x0, x1) + dx < -w || Math.min(x0, x1) + dx > W + w) continue;
          sharp.beginPath();
          sharp.moveTo(x0 + dx, y0);
          sharp.lineTo(x1 + dx, y1);
          sharp.stroke();
        }
      }
    }
    g.filter = `blur(${layer.blur}px)`;
    g.drawImage(sharp.canvas, 0, 0);
  }
  g.filter = "none";
  g.globalCompositeOperation = "source-over";
};
