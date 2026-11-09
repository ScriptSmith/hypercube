/**
 * Draws the family tree into a box, in venue px. Now is the bottom edge and the past runs up:
 * every living fish's line rises from its tip, joins its parent's line where it hatched, and so
 * on up, so families merge into fewer and fewer lines towards the top. Each line has its fish's
 * colour. Behind each pond's column, faint bands show which floor the pond had at each moment,
 * and a strip at the column's edge shows the pond's average fish colour, so the lines can be
 * seen taking on the floor's colour after each change. Time is stretched near the bottom (a
 * power below 1), where most hatching happens.
 *
 * Lines that lose their last living descendant fade out over a second.
 */
import { type Columns, layoutTree, type Lineage, type TreeNode } from "./lineage";
import { FLOOR_LOOK } from "./art";
import type { Box } from "./pond";
import type { Band } from "./world";

type Ctx = CanvasRenderingContext2D;

export interface TreeStyle {
  /** Line width of a single lineage, venue px. */
  line: number;
  /** Most ms of history shown. Less is shown while the tree is younger, at least `MIN_WINDOW`. */
  window: number;
  /** Time stretch: the bottom of the box is `t^gamma`. */
  gamma: number;
  /** Width of each column's colour strip, venue px. */
  strip: number;
  /** Size of the time labels, venue px (0 for none). */
  label: number;
}

export interface TreeFrame {
  box: Box;
  /** Tip ranges per column. */
  cols: Columns;
  /** Each column's full extent (for its floor bands), and its history. */
  extents: readonly [number, number][];
  bands: readonly (Band | null)[];
  now: number;
}

interface Ghost {
  x: number;
  born: number;
  end: number;
  color: string;
  width: number;
  at: number;
}

const MAX_GHOSTS = 160;
const GHOST_MS = 1200;
const EASE_S = 0.35;
const GRID_MIN = [1, 2, 5, 10, 15, 20];
const MIN_WINDOW = 3 * 60_000;
/** The shown history eases to its new length over a few seconds. */
const WINDOW_EASE_S = 4;

export interface TreeView {
  /** Lines that just died out, to fade. */
  fade(removed: readonly TreeNode[], now: number): void;
  draw(g: Ctx, lin: Lineage, f: TreeFrame, style: TreeStyle, dt: number): void;
  clear(): void;
  readonly ghosts: number;
}

export const createTreeView = (): TreeView => {
  const ghosts: Ghost[] = [];
  const order: TreeNode[] = [];
  let shown = 0;

  const yOf = (f: TreeFrame, s: TreeStyle, t: number) => {
    const u = Math.min(1, Math.max(0, (f.now - t) / (shown || s.window)));
    return f.box.y + f.box.h - f.box.h * Math.pow(u, s.gamma);
  };

  const widthOf = (s: TreeStyle, n: TreeNode) =>
    s.line * Math.min(3.2, 0.75 + 0.42 * Math.sqrt(Math.max(1, n.leaves)));

  const drawBands = (g: Ctx, f: TreeFrame, s: TreeStyle) => {
    const top = f.box.y;
    f.bands.forEach((band, c) => {
      const ext = f.extents[c];
      if (!band || !ext) return;
      const [x0, x1] = ext;
      g.globalAlpha = 0.13;
      for (let i = 0; i < band.floors.length; i++) {
        const fl = band.floors[i]!;
        const next = band.floors[i + 1];
        const yb = next ? yOf(f, s, next.t) : f.box.y + f.box.h;
        const yt = i === 0 ? top : yOf(f, s, fl.t);
        if (yb <= yt) continue;
        g.fillStyle = FLOOR_LOOK[fl.floor].body;
        g.fillRect(x0, yt, x1 - x0, yb - yt);
      }
      g.globalAlpha = 1;
      if (s.strip > 0 && band.colors.length > 0) {
        const sx = x0;
        for (let i = 0; i < band.colors.length; i++) {
          const cur = band.colors[i]!;
          const next = band.colors[i + 1];
          const yb = next ? yOf(f, s, next.t) : f.box.y + f.box.h;
          const yt = yOf(f, s, cur.t);
          if (yb <= yt) continue;
          g.fillStyle = cur.color;
          g.fillRect(sx, yt, s.strip, yb - yt + 0.5);
        }
      }
    });
  };

  const drawGrid = (g: Ctx, f: TreeFrame, s: TreeStyle) => {
    if (s.label <= 0) return;
    g.font = `600 ${s.label}px system-ui, sans-serif`;
    g.textAlign = "right";
    g.textBaseline = "top";
    const right = f.box.x + f.box.w;
    for (const min of GRID_MIN) {
      const ms = min * 60_000;
      if (ms > (shown || s.window) * 0.97) break;
      if (min === 2 && shown > 8 * 60_000) continue;
      const y = yOf(f, s, f.now - ms);
      g.fillStyle = "rgba(200,214,230,0.16)";
      g.fillRect(f.box.x, y, f.box.w, Math.max(1, s.line * 0.3));
      g.fillStyle = "rgba(200,214,230,0.55)";
      g.fillText(min === 1 ? "1 minute ago" : `${min} minutes ago`, right, y + s.label * 0.25);
    }
    g.textBaseline = "bottom";
    g.fillText("now", right, f.box.y + f.box.h - s.label * 0.3);
  };

  return {
    fade(removed, now) {
      for (const n of removed) {
        if (!n.placed) continue;
        if (ghosts.length >= MAX_GHOSTS) ghosts.shift();
        ghosts.push({
          x: n.x,
          born: n.born,
          end: n.died ?? now,
          color: n.color,
          width: 1,
          at: now,
        });
      }
    },
    draw(g, lin, f, s, dt) {
      layoutTree(lin, f.cols);
      // Show as much history as the tree has, so a young tree fills its box.
      let oldest = f.now;
      for (const n of lin.nodes()) if (n.born < oldest) oldest = n.born;
      const want = Math.min(s.window, Math.max(MIN_WINDOW, (f.now - oldest) * 1.12));
      shown =
        shown === 0 || dt <= 0
          ? want
          : shown + (want - shown) * (1 - Math.exp(-dt / WINDOW_EASE_S));
      const k = dt > 0 ? 1 - Math.exp(-dt / EASE_S) : 1;
      order.length = 0;
      for (const n of lin.nodes()) order.push(n);
      // Parents are placed before their young, so a hatchling's line grows out of its parent's.
      order.sort((a, b) => a.born - b.born);
      for (const n of order) {
        if (!n.placed) {
          const p = n.parent > 0 ? lin.get(n.parent) : undefined;
          n.x = p && p.placed ? p.x : n.tx;
          n.placed = true;
        } else {
          n.x += (n.tx - n.x) * k;
        }
      }
      drawBands(g, f, s);
      drawGrid(g, f, s);
      // Fading lines.
      const now = f.now;
      g.lineCap = "round";
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const gh = ghosts[i]!;
        const age = now - gh.at;
        if (age > GHOST_MS || age < -GHOST_MS) {
          ghosts.splice(i, 1);
          continue;
        }
        g.globalAlpha = 0.8 * (1 - Math.max(0, age) / GHOST_MS);
        g.strokeStyle = gh.color;
        g.lineWidth = s.line * gh.width;
        g.beginPath();
        g.moveTo(gh.x, yOf(f, s, gh.born));
        g.lineTo(gh.x, yOf(f, s, gh.end));
        g.stroke();
      }
      g.globalAlpha = 1;
      // Thin lines first, so the trunks of big families sit on top where branches join them.
      order.sort((a, b) => a.leaves - b.leaves);
      const top = f.box.y;
      for (const n of order) {
        const p = n.parent > 0 ? lin.get(n.parent) : undefined;
        const yBorn = yOf(f, s, n.born);
        const yEnd = n.died === null ? f.box.y + f.box.h : yOf(f, s, n.last);
        const w = widthOf(s, n);
        g.strokeStyle = n.color;
        g.lineWidth = w;
        g.beginPath();
        if (p) {
          const bend = Math.min(s.line * 7, Math.max(0, yEnd - yBorn));
          g.moveTo(p.x, yBorn);
          g.bezierCurveTo(p.x, yBorn + bend * 0.6, n.x, yBorn + bend * 0.4, n.x, yBorn + bend);
          g.lineTo(n.x, yEnd);
        } else if (n.parent === 0) {
          g.moveTo(n.x, yBorn);
          g.lineTo(n.x, yEnd);
        } else {
          g.moveTo(n.x, top);
          g.lineTo(n.x, yEnd);
        }
        g.stroke();
        if (n.parent === 0 && yBorn > top + w) {
          g.fillStyle = n.color;
          g.beginPath();
          g.arc(n.x, yBorn, w * 0.9, 0, Math.PI * 2);
          g.fill();
        }
      }
      // Tips.
      for (const n of order) {
        if (n.died !== null) continue;
        g.fillStyle = n.color;
        g.beginPath();
        g.arc(n.x, f.box.y + f.box.h, widthOf(s, n) * 1.15, 0, Math.PI * 2);
        g.fill();
      }
    },
    clear() {
      ghosts.length = 0;
      order.length = 0;
      shown = 0;
    },
    get ghosts() {
      return ghosts.length;
    },
  };
};

/** Lines from each living fish's tip straight up to the top of the box (a bank under a screen). */
export const drawComb = (
  g: Ctx,
  box: Box,
  tips: readonly { x: number; color: string }[],
  line: number,
) => {
  g.lineCap = "round";
  for (const t of tips) {
    g.strokeStyle = t.color;
    g.lineWidth = line;
    g.beginPath();
    g.moveTo(t.x, box.y + box.h);
    g.lineTo(t.x, box.y - 2);
    g.stroke();
    g.fillStyle = t.color;
    g.beginPath();
    g.arc(t.x, box.y + box.h, line * 1.3, 0, Math.PI * 2);
    g.fill();
  }
};
