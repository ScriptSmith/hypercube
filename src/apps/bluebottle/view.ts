/**
 * Draws a run of a patch's columns as sand cells into a box: a touch frame's own columns, or the
 * whole patch as the screen's map. Only cells that change are redrawn; animations (digs opening
 * outwards, sand blowing back after a sting, crabs, the tide) go on a second canvas above.
 */
import { CRAB_WALK_MS, type Counts, TIDE_MS } from "./config";
import { COLORS, createTiles, drawCrab, type TileSet, variantOf } from "./art";
import type { Box } from "./layout";
import type { Effect } from "./patch";
import type { Current } from "./shore";

export interface Grid {
  box: Box;
  cols: number;
  rows: number;
  cell: number;
  /** Child rows from the bottom (dots in `mixed`). */
  kid: number;
}

export interface Hold {
  /** Local cell index (row * cols + column on this grid). */
  cell: number;
  /** 0 to 1, or -1 for a refused flag. */
  fill: number;
}

export interface BeachView {
  setGrid(grid: Grid, unit: number, pixelRatio: number): void;
  /** A new patch (or none, while joining): the tide washes the old one away first. */
  setPatch(cur: Current | null, c0: number): void;
  effect(e: Effect, cur: Current, c0: number): void;
  draw(now: number, holds: readonly Hold[]): void;
  /** Whether the view is still animating the change to a new patch. */
  readonly tiding: boolean;
  dispose(): void;
}

const K_COVERED = 0;
const K_FLAG = 1;
const K_STUNG = 2;
const K_LIFEGUARD = 3;
const K_DUG = 16;

const A_NONE = 0;
const A_OPEN = 1;
const A_COVER = 2;
const A_PLANT = 3;
const A_POP = 4;

const ANIM_MS = [0, 240, 300, 260, 520];
const CASCADE_STEP_MS = 32;
const CASCADE_MAX_MS = 700;
const MAX_CRABS = 12;
const MAX_GRAINS = 260;
const CRAB_DIG_MS = 260;
const CRAB_LEAVE_MS = 650;

interface Crab {
  cell: number;
  start: number;
}

interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  r: number;
}

export const createBeachView = (
  root: HTMLElement,
  initial: Grid,
  unit0: number,
  pr0: number,
  counts: Counts,
): BeachView => {
  const base = document.createElement("canvas");
  const fx = document.createElement("canvas");
  for (const [c, z] of [
    [base, 2],
    [fx, 3],
  ] as const) {
    c.style.cssText = `position:absolute;pointer-events:none;z-index:${z};`;
    root.append(c);
  }
  const g = base.getContext("2d");
  const f = fx.getContext("2d");

  let grid = initial;
  let unit = unit0;
  let pr = pr0;
  let scale = 1;
  let tiles: TileSet | null = null;
  let n = 0;
  let target = new Int16Array(0);
  let shown = new Int16Array(0);
  let changeAt = new Float64Array(0);
  let animAt = new Float64Array(0);
  let animKind = new Uint8Array(0);
  let schedule = new Float64Array(0);
  let redrawAll = true;

  let current: Current | null = null;
  let c0 = 0;
  let pending: { cur: Current | null; c0: number } | null = null;
  let tideAt = -Infinity;
  const crabs: Crab[] = [];
  const grains: Grain[] = [];
  let fxDirty = false;

  const size = () => {
    scale = unit * pr;
    const b = grid.box;
    for (const c of [base, fx]) {
      c.style.left = `${b.x * unit}px`;
      c.style.top = `${b.y * unit}px`;
      c.style.width = `${b.width * unit}px`;
      c.style.height = `${b.height * unit}px`;
      c.width = Math.max(1, Math.round(b.width * scale));
      c.height = Math.max(1, Math.round(b.height * scale));
    }
    tiles = createTiles(grid.cell * scale);
    n = grid.cols * grid.rows;
    target = new Int16Array(n);
    shown = new Int16Array(n).fill(-1);
    changeAt = new Float64Array(n);
    animAt = new Float64Array(n);
    animKind = new Uint8Array(n);
    schedule = new Float64Array(n);
    redrawAll = true;
  };
  size();

  const kidRow = (r: number) => r >= grid.rows - grid.kid;
  const dotsAt = (r: number) => counts === "dots" || (counts === "mixed" && kidRow(r));

  /** The patch cell behind a local cell, or -1. */
  const patchCell = (cur: Current, local: number): number => {
    const r = Math.floor(local / grid.cols);
    const c = (local % grid.cols) + c0;
    if (r >= cur.spec.rows || c >= cur.spec.cols) return -1;
    return r * cur.spec.cols + c;
  };
  /** The local cell for a patch cell, or -1 when it is not on this grid. */
  const localCell = (cur: Current, i: number): number => {
    const c = (i % cur.spec.cols) - c0;
    const r = Math.floor(i / cur.spec.cols);
    if (c < 0 || c >= grid.cols || r >= grid.rows) return -1;
    return r * grid.cols + c;
  };

  const keyOf = (cur: Current | null, local: number): number => {
    if (!cur) return K_COVERED;
    const i = patchCell(cur, local);
    if (i < 0) return K_COVERED;
    const p = cur.patch;
    if (p.found[i] === 1) return K_STUNG;
    if (p.found[i] === 2) return K_LIFEGUARD;
    if (p.dug[i]) return K_DUG + p.board.count[i]!;
    if (p.flag[i]) return K_FLAG;
    return K_COVERED;
  };

  const drawCell = (local: number, now: number) => {
    if (!g || !tiles) return;
    const s = tiles.size;
    const c = local % grid.cols;
    const r = Math.floor(local / grid.cols);
    const x = Math.round(c * grid.cell * scale);
    const y = Math.round(r * grid.cell * scale);
    const w = Math.round((c + 1) * grid.cell * scale) - x;
    const h = Math.round((r + 1) * grid.cell * scale) - y;
    const kid = kidRow(r) ? 1 : 0;
    const key = shown[local]!;
    const kind = animKind[local]!;
    const k = kind === A_NONE ? 1 : Math.min(1, (now - animAt[local]!) / ANIM_MS[kind]!);
    g.fillStyle = COLORS.gutter;
    g.fillRect(x, y, w, h);
    const covered = tiles.covered[kid]![variantOf(local + c0 * 131)]!;
    const put = (img: HTMLCanvasElement, sx = 1, sy = 1, alpha = 1) => {
      g.globalAlpha = alpha;
      const dw = s * sx;
      const dh = s * sy;
      g.drawImage(img, x + (s - dw) / 2, y + (s - dh) * (sy < 1 ? 1 : 0.5), dw, dh);
      g.globalAlpha = 1;
    };
    if (key >= K_DUG) {
      put(tiles.dug[kid]!);
      put(tiles.counts[dotsAt(r) ? 1 : 0]![key - K_DUG]!);
      if (kind === A_OPEN && k < 1) put(covered, 1 - k * 0.6, 1 - k * 0.6, 1 - k);
      return;
    }
    if (key === K_STUNG || key === K_LIFEGUARD) {
      put(key === K_STUNG ? tiles.stung : tiles.lifeguard);
      const pop = kind === A_POP && k < 1 ? 0.4 + 0.75 * Math.sin(k * Math.PI * 0.8) : 1;
      put(tiles.bottle, pop, pop);
      return;
    }
    put(covered, kind === A_COVER ? 0.55 + 0.45 * k : 1, kind === A_COVER ? 0.55 + 0.45 * k : 1);
    if (key === K_FLAG) put(tiles.flag, 1, kind === A_PLANT ? Math.max(0.1, k) : 1);
  };

  const animFor = (from: number, to: number): number => {
    if (from < 0) return A_NONE;
    if (to >= K_DUG && from < K_DUG) return A_OPEN;
    if (to === K_COVERED && from >= K_DUG) return A_COVER;
    if (to === K_FLAG && from === K_COVERED) return A_PLANT;
    if ((to === K_STUNG || to === K_LIFEGUARD) && from !== to) return A_POP;
    return A_NONE;
  };

  // ---- Effects --------------------------------------------------------------------------------

  const centre = (local: number) => ({
    x: ((local % grid.cols) + 0.5) * grid.cell,
    y: (Math.floor(local / grid.cols) + 0.5) * grid.cell,
  });

  const gust = (local: number, now: number) => {
    const { x, y } = centre(local);
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2 + Math.random() * 0.3;
      const v = grid.cell * (2 + Math.random() * 3);
      grains.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - grid.cell * 1.5,
        born: now,
        life: 500 + Math.random() * 400,
        r: grid.cell * (0.025 + Math.random() * 0.035),
      });
    }
    while (grains.length > MAX_GRAINS) grains.shift();
  };

  const onEffect = (e: Effect, cur: Current, now: number) => {
    switch (e.kind) {
      case "dig": {
        const delay = e.crab ? CRAB_WALK_MS : 0;
        if (e.crab) {
          const l = localCell(cur, e.cells[0] ?? -1);
          if (l >= 0) {
            crabs.push({ cell: l, start: now });
            while (crabs.length > MAX_CRABS) crabs.shift();
          }
        }
        e.cells.forEach((i, k) => {
          const l = localCell(cur, i);
          if (l >= 0)
            schedule[l] = now + delay + Math.min(CASCADE_MAX_MS, e.depth[k]! * CASCADE_STEP_MS);
        });
        return;
      }
      case "sting": {
        const l = localCell(cur, e.cell);
        if (l >= 0) gust(l, now);
        const cols = cur.spec.cols;
        for (const i of e.covered) {
          const m = localCell(cur, i);
          if (m < 0) continue;
          const d = Math.max(
            Math.abs((i % cols) - (e.cell % cols)),
            Math.abs(Math.floor(i / cols) - Math.floor(e.cell / cols)),
          );
          schedule[m] = now + 120 + d * 90;
        }
        return;
      }
      case "end": {
        e.found.forEach((i, k) => {
          const l = localCell(cur, i);
          if (l >= 0) schedule[l] = now + 250 + (k % 24) * 70;
        });
        return;
      }
      default:
    }
  };

  // ---- Drawing --------------------------------------------------------------------------------

  const water = (now: number): number => {
    const k = (now - tideAt) / TIDE_MS;
    if (k < 0 || k >= 1) return -1;
    // Up to the middle the water comes in from the sea (the top); then it goes back out.
    return k < 0.5 ? k / 0.5 : 1 - (k - 0.5) / 0.5;
  };

  const drawFx = (now: number, holds: readonly Hold[]) => {
    if (!f) return;
    const active =
      holds.length > 0 || crabs.length > 0 || grains.length > 0 || water(now) >= 0 || fxDirty;
    if (!active) return;
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, fx.width, fx.height);
    fxDirty = false;
    f.setTransform(scale, 0, 0, scale, 0, 0);
    const W = grid.box.width;
    const H = grid.box.height;
    const cell = grid.cell;

    for (const h of holds) {
      const { x, y } = centre(h.cell);
      const rad = cell * 0.4;
      f.lineCap = "round";
      f.lineWidth = cell * 0.09;
      f.strokeStyle = "rgba(20,15,10,0.45)";
      f.beginPath();
      f.arc(x, y, rad, 0, Math.PI * 2);
      f.stroke();
      f.lineWidth = cell * 0.075;
      f.strokeStyle = h.fill < 0 ? "rgba(180,180,180,0.9)" : COLORS.flag;
      f.beginPath();
      const fill = h.fill < 0 ? 1 : h.fill;
      f.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
      f.stroke();
      fxDirty = true;
    }

    for (let k = crabs.length - 1; k >= 0; k--) {
      const cr = crabs[k]!;
      const t = now - cr.start;
      const total = CRAB_WALK_MS + CRAB_DIG_MS + CRAB_LEAVE_MS;
      if (t >= total) {
        crabs.splice(k, 1);
        fxDirty = true;
        continue;
      }
      const { x, y } = centre(cr.cell);
      const from = H + cell * 0.6;
      let cy: number;
      let step = 0;
      let wave = 0;
      if (t < CRAB_WALK_MS) {
        const u = t / CRAB_WALK_MS;
        cy = from + (y + cell * 0.18 - from) * (1 - (1 - u) ** 2);
        step = (t / 140) % 1;
      } else if (t < CRAB_WALK_MS + CRAB_DIG_MS) {
        cy = y + cell * 0.18;
        wave = Math.sin(((t - CRAB_WALK_MS) / CRAB_DIG_MS) * Math.PI);
      } else {
        const u = (t - CRAB_WALK_MS - CRAB_DIG_MS) / CRAB_LEAVE_MS;
        cy = y + cell * 0.18 + (from - y) * u * u;
        step = (t / 120) % 1;
        wave = 0.3;
      }
      const cx = x + Math.sin(t / 90) * cell * 0.05;
      drawCrab(f, cx, cy, cell * 0.95, step, wave);
      fxDirty = true;
    }

    for (let k = grains.length - 1; k >= 0; k--) {
      const gr = grains[k]!;
      const t = (now - gr.born) / 1000;
      if (t * 1000 >= gr.life) {
        grains.splice(k, 1);
        continue;
      }
      const x = gr.x + gr.vx * t;
      const y = gr.y + gr.vy * t + 0.5 * cell * 9 * t * t;
      f.globalAlpha = 1 - (t * 1000) / gr.life;
      f.fillStyle = k % 3 === 0 ? COLORS.sandKid : COLORS.sandAdult;
      f.beginPath();
      f.arc(x, y, gr.r, 0, Math.PI * 2);
      f.fill();
      f.globalAlpha = 1;
      fxDirty = true;
    }

    const w = water(now);
    if (w >= 0) {
      const front = H * Math.min(1, w * 1.06);
      const grad = f.createLinearGradient(0, 0, 0, Math.max(1, front));
      grad.addColorStop(0, "rgba(28,110,150,0.96)");
      grad.addColorStop(1, "rgba(60,170,190,0.9)");
      f.fillStyle = grad;
      f.beginPath();
      f.moveTo(0, 0);
      const steps = Math.max(8, Math.round(W / (cell * 0.5)));
      for (let k = 0; k <= steps; k++) {
        const x = (W * k) / steps;
        f.lineTo(x, front + Math.sin(k * 0.9 + now / 160) * cell * 0.12);
      }
      f.lineTo(W, 0);
      f.closePath();
      f.fill();
      f.lineWidth = cell * 0.12;
      f.strokeStyle = "rgba(240,250,255,0.9)";
      f.beginPath();
      for (let k = 0; k <= steps; k++) {
        const x = (W * k) / steps;
        const y = front + Math.sin(k * 0.9 + now / 160) * cell * 0.12;
        if (k === 0) f.moveTo(x, y);
        else f.lineTo(x, y);
      }
      f.stroke();
      fxDirty = true;
    }
  };

  return {
    get tiding() {
      return pending !== null || water(performance.now()) >= 0;
    },
    setGrid(next, u, p) {
      grid = next;
      unit = u;
      pr = p;
      size();
    },
    setPatch(cur, col0) {
      const now = performance.now();
      if (!current && !pending && cur === null) return;
      // From nothing (a frame that just booted) the beach appears under a receding tide.
      if (!current && !pending) {
        current = cur;
        c0 = col0;
        tideAt = now - TIDE_MS / 2;
        redrawAll = true;
        schedule.fill(0);
        return;
      }
      pending = { cur, c0: col0 };
      if (water(now) < 0) tideAt = now;
    },
    effect(e, cur, col0) {
      if (cur !== current || col0 !== c0) return;
      onEffect(e, cur, performance.now());
    },
    draw(now, holds) {
      if (pending && now - tideAt >= TIDE_MS / 2) {
        current = pending.cur;
        c0 = pending.c0;
        pending = null;
        crabs.length = 0;
        schedule.fill(0);
        redrawAll = true;
      }
      if (g && tiles) {
        g.setTransform(1, 0, 0, 1, 0, 0);
        for (let l = 0; l < n; l++) {
          const key = keyOf(current, l);
          if (redrawAll) {
            target[l] = key;
            shown[l] = key;
            animKind[l] = A_NONE;
            drawCell(l, now);
            continue;
          }
          if (key !== target[l]) {
            target[l] = key;
            changeAt[l] = Math.max(now, schedule[l]!);
            schedule[l] = 0;
          }
          if (shown[l] !== target[l] && now >= changeAt[l]!) {
            animKind[l] = animFor(shown[l]!, target[l]!);
            animAt[l] = now;
            shown[l] = target[l]!;
            drawCell(l, now);
          } else if (animKind[l] !== A_NONE) {
            drawCell(l, now);
            if (now - animAt[l]! >= ANIM_MS[animKind[l]!]!) {
              animKind[l] = A_NONE;
              drawCell(l, now);
            }
          }
        }
        redrawAll = false;
      }
      drawFx(now, holds);
    },
    dispose() {
      base.remove();
      fx.remove();
      crabs.length = 0;
      grains.length = 0;
    },
  };
};
