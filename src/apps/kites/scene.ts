/**
 * The sky's scenery, shared by the screen and frames that draw their own sky: drifting clouds,
 * tree tops swaying along the bottom, a windsock, the rings, the ring tally along the top edge
 * and the live-wind attribution. Also the static backgrounds: the sky gradient and the park.
 */
import { FONT } from "../../core/ui";
import {
  drawRing,
  drawTallyRing,
  drawTreeTops,
  drawWindsock,
  fillSky,
  makeCloud,
  tint,
} from "./art";
import type { Ring } from "./rings";
import { travelSpeed, windAt, windDir, type WindField } from "./wind";

type Ctx = CanvasRenderingContext2D;

/** Where a sky sits on a canvas, px, and how many px one sky unit is. */
export interface SkyRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** px per sky unit (the sky's height for a full sky). */
  unit: number;
  /** Wind position for a px x on this sky. */
  fOf(px: number): number;
}

interface Cloud {
  f: number;
  h: number;
  size: number;
  sprite: HTMLCanvasElement;
}

export interface SkyScene {
  /** Move clouds on. `t` is the shared clock, seconds. */
  step(dt: number, t: number): void;
  /** Clouds behind everything. */
  drawBack(g: Ctx, r: SkyRect): void;
  /** Tree tops and the windsock, in front of lines' lower ends. */
  drawFront(g: Ctx, r: SkyRect, t: number, windsockAt: number | null): void;
  dispose(): void;
}

export const createSkyScene = (
  field: () => WindField,
  opts: { clouds: number; px: number; seed: number },
): SkyScene => {
  const clouds: Cloud[] = [];
  let s = opts.seed >>> 0 || 7;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < opts.clouds; i++) {
    const size = 0.22 + 0.18 * rnd();
    clouds.push({
      f: (i + rnd() * 0.8) / opts.clouds,
      h: 0.42 + 0.5 * rnd(),
      size,
      sprite: makeCloud(Math.round(opts.px * size), Math.floor(rnd() * 1e9)),
    });
  }
  return {
    step(dt, t) {
      const w = field();
      const v = travelSpeed(w, t) * windDir(w, t) * 0.55;
      for (const c of clouds) {
        c.f += v * dt;
        if (c.f > 1.25) c.f -= 1.5;
        else if (c.f < -0.25) c.f += 1.5;
      }
    },
    drawBack(g, r) {
      g.save();
      g.globalAlpha = 0.8;
      for (const c of clouds) {
        const w = c.size * r.unit;
        const h = w * 0.45;
        g.drawImage(c.sprite, r.x + c.f * r.w - w / 2, r.y + r.h - c.h * r.unit - h / 2, w, h);
      }
      g.restore();
    },
    drawFront(g, r, t, windsockAt) {
      const w = field();
      const base = r.y + r.h;
      const size = Math.max(6, r.unit * 0.045);
      drawTreeTops(
        g,
        r.x,
        r.x + r.w,
        base + size * 0.35,
        size,
        (x) => windAt(w, t, r.fOf(x), 0.05) * size * 0.12,
        3,
      );
      if (windsockAt !== null) {
        const x = r.x + windsockAt * r.w;
        drawWindsock(g, x, base - size * 0.2, r.unit * 0.17, windAt(w, t, r.fOf(x), 0.15), t);
      }
    },
    dispose() {
      clouds.length = 0;
    },
  };
};

/** Rings over a sky, minus the ones in `hide`. */
export const drawRings = (
  g: Ctx,
  r: SkyRect,
  rings: readonly Ring[],
  radius: number,
  t: number,
  hide: (id: number) => boolean,
): void => {
  for (const ring of rings) {
    if (hide(ring.id)) continue;
    drawRing(g, r.x + ring.f * r.w, r.y + r.h - ring.h * r.unit, radius * r.unit, t);
  }
};

/** The ring tally along the top edge: one small ring per catch, grouped by colour. */
export const drawTally = (
  g: Ctx,
  r: SkyRect,
  tally: ReadonlyMap<number, number>,
  colors: readonly string[],
  size: number,
): void => {
  if (tally.size === 0) return;
  const step = size * 2.6;
  let x = r.x + size * 2;
  const y = r.y + size * 2;
  g.save();
  g.font = `800 ${Math.round(size * 1.6)}px ${FONT}`;
  g.textBaseline = "middle";
  for (const [color, n] of [...tally].sort((a, b) => a[0] - b[0])) {
    const c = colors[color % colors.length] ?? "#ffffff";
    const shown = Math.min(n, 12);
    for (let i = 0; i < shown; i++) {
      drawTallyRing(g, x, y, size * 0.8, c);
      x += step * 0.8;
    }
    if (n > shown) {
      g.fillStyle = c;
      g.fillText(String(n), x, y);
      x += g.measureText(String(n)).width + size;
    }
    x += step * 0.7;
    if (x > r.x + r.w - step * 3) break;
  }
  g.restore();
};

export const drawAttribution = (
  g: Ctx,
  text: string,
  x: number,
  y: number,
  size: number,
  align: CanvasTextAlign,
) => {
  g.save();
  g.font = `600 ${Math.round(size)}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = "top";
  g.fillStyle = "rgba(242,245,250,0.72)";
  g.fillText(text, x, y);
  g.restore();
};

/** The sky's gradient and a faint far range of hills, for the static background. */
export const paintSky = (
  g: Ctx,
  r: { x: number; y: number; w: number; h: number },
  unit: number,
) => {
  fillSky(g, r.x, r.y, r.w, r.h);
  // A soft glow low in the sky.
  const glow = g.createLinearGradient(0, r.y + r.h * 0.6, 0, r.y + r.h);
  glow.addColorStop(0, "rgba(120,190,220,0)");
  glow.addColorStop(1, "rgba(120,190,220,0.18)");
  g.fillStyle = glow;
  g.fillRect(r.x, r.y + r.h * 0.6, r.w, r.h * 0.4);
  g.fillStyle = "#16324f";
  g.beginPath();
  const base = r.y + r.h;
  g.moveTo(r.x, base);
  const hill = unit * 0.07;
  for (let x = 0; x <= r.w; x += Math.max(8, r.w / 60)) {
    const f = x / Math.max(1, r.w);
    const yy = base - hill * (0.55 + 0.3 * Math.sin(f * 9.1) + 0.2 * Math.sin(f * 23.7 + 1));
    g.lineTo(r.x + x, yy);
  }
  g.lineTo(r.x + r.w, base);
  g.closePath();
  g.fill();
};

/** Lawn from `top` to the bottom, with faint mowing stripes. */
export const paintPark = (
  g: Ctx,
  x: number,
  top: number,
  w: number,
  bottom: number,
  stripe: number,
) => {
  const grad = g.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, "#123a28");
  grad.addColorStop(1, "#0a2418");
  g.fillStyle = grad;
  g.fillRect(x, top, w, bottom - top);
  g.fillStyle = "rgba(255,255,255,0.025)";
  for (let sx = x; sx < x + w; sx += stripe * 2) g.fillRect(sx, top, stripe, bottom - top);
};

/**
 * The bottoms of the screen's trees across a touch frame's top edge, so the screen's tree tops
 * carry on down onto the panels.
 */
export const paintFoliage = (g: Ctx, w: number, depth: number, seed: number) => {
  const grad = g.createLinearGradient(0, 0, 0, depth);
  grad.addColorStop(0, "#0d2c22");
  grad.addColorStop(1, "#123a28");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, depth);
  const r = depth * 0.42;
  let i = 0;
  for (let x = -r; x < w + r; x += r * 1.3, i++) {
    const h = ((Math.imul(i + seed, 2654435761) >>> 0) % 1000) / 1000;
    g.fillStyle = tint(i % 2 ? "#0d2c22" : "#11352a", -0.1 + 0.2 * h);
    g.beginPath();
    g.arc(x, depth * (0.7 + 0.25 * h), r * (0.8 + 0.4 * h), 0, Math.PI * 2);
    g.fill();
  }
  // Trunks.
  g.fillStyle = "#1c2a24";
  for (let x = r * 0.6, j = 0; x < w; x += r * 2.7, j++) {
    g.fillRect(x, depth * 0.85, depth * 0.07, depth * (0.35 + 0.1 * (j % 3)));
  }
};
