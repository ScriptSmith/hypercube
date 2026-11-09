/**
 * Drawing one crane's site from its simulation: buildings and outlines (the slow layer), and the
 * moving parts: trolley, cable, hook and load, yard, loose blocks, flags and the tall tower (the
 * fast layer). Shared by frames and the screen. Venue px; callers set the transform.
 */
import {
  drawBlock,
  drawCraneStatic,
  drawFlag,
  drawHook,
  drawWorldBlock,
  type G,
  rgba,
} from "./art";
import { BH, BLOCK_DRAW_W } from "./config";
import { type Crane, type Lot, sheaveY } from "./crane";
import type { Scene } from "./layout";

const LIGHT_UP_S = 1.6;
const FLAG_S = 0.9;

const easeOutBack = (t: number) => {
  const c = 1.5;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
const easeInOut = (t: number) => t * t * (3 - 2 * t);

const roundOf = (lot: Lot, i: number): "left" | "right" | "both" | null => {
  if (lot.bp.shape !== "round") return null;
  const s = lot.bp.slots[i]!;
  const xs = lot.bp.slots.filter((o) => o.r === s.r).map((o) => o.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (lo === hi) return "both";
  return s.x === lo ? "left" : s.x === hi ? "right" : null;
};

/** How lit a lot's row is: finished buildings light up floor by floor, then stay lit. */
const rowLight = (lot: Lot, row: number, time: number, light: number) => {
  if (lot.phase === "build") return 0;
  const t = (time - lot.doneAt) / LIGHT_UP_S;
  const rows = Math.max(1, lot.bp.rows);
  return light * Math.max(0, Math.min(1, t * rows - row));
};

/** True while something on the slow layer is still animating (a building lighting up). */
export const buildingsAnimating = (crane: Crane): boolean =>
  crane.lots.some((l) => l.phase !== "build" && crane.time - l.doneAt < LIGHT_UP_S + 0.1);

/** A number that changes whenever the slow layer would look different. */
export const buildingsKey = (crane: Crane): number => {
  let k = 17;
  for (const lot of crane.lots) {
    k =
      (k * 31 +
        lot.bp.slots.length * 7 +
        (lot.phase === "build" ? 1 : lot.phase === "done" ? 2 : 3)) |
      0;
    for (const f of lot.filled) k = (k * 31 + (f === null ? 9 : f)) | 0;
    k = (k * 31 + Math.round(lot.left * 10)) | 0;
  }
  return k;
};

export interface SiteLook {
  color: string;
  /** How to draw a block rising from below (a bank's screen): offset across and scale. */
  rise?: (x: number, y: number) => { dx: number; scale: number };
  /** Window light for finished buildings (sky.windowLight). */
  light: number;
  assist: boolean;
  /** Venue y the mast starts from. */
  footY?: number;
  /** Seconds, for gentle pulses. */
  t: number;
}

/** The slow layer: the crane's frame, lot outlines and buildings. */
export const drawSiteStatic = (g: G, sc: Scene, crane: Crane, look: SiteLook) => {
  const s = sc.s;
  drawCraneStatic(g, sc, crane.world, { color: look.color, footY: look.footY });
  crane.lots.forEach((lot, li) => {
    // Ground plot.
    const x0 = sc.ox + (lot.left - 0.2) * s;
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(x0, sc.gy - 0.06 * s, (lot.bp.cols + 0.4) * s, 0.06 * s);
    lot.bp.slots.forEach((slot, i) => {
      const kind = lot.filled[i];
      const x = sc.ox + (lot.left + slot.x + (1 - BLOCK_DRAW_W) / 2) * s;
      const y = sc.gy - (slot.r + 1) * BH * s;
      const w = BLOCK_DRAW_W * s;
      const h = BH * s * 0.96;
      if (kind === null || kind === undefined) {
        if (lot.phase !== "build") return;
        g.strokeStyle = "rgba(235,242,255,0.28)";
        g.lineWidth = Math.max(1.5, 0.03 * s);
        g.setLineDash([0.12 * s, 0.09 * s]);
        g.strokeRect(x + 1, y + h * 0.04 + 1, w - 2, h - 2);
        g.setLineDash([]);
        return;
      }
      drawBlock(g, x, y + h * 0.04, w, h, kind, {
        lit: rowLight(lot, slot.r, crane.time, look.light),
        round: roundOf(lot, i),
        spire: lot.bp.shape === "spire" && slot.top && slot.r === lot.bp.rows - 1,
        seed: li * 100 + i,
      });
    });
  });
};

/** The fast layer: moving crane parts, yard, loose blocks, flags and the tall tower. */
export const drawSiteDynamic = (g: G, sc: Scene, crane: Crane, look: SiteLook) => {
  const s = sc.s;
  const w = crane.world;
  // Flags on finished buildings, rising as the lights come on.
  crane.lots.forEach((lot) => {
    if (lot.phase === "build") return;
    let top: (typeof lot.bp.slots)[number] | null = null;
    lot.bp.slots.forEach((sl, i) => {
      if (lot.filled[i] !== null && (!top || sl.r >= top.r)) top = sl;
    });
    if (!top) return;
    top = top as (typeof lot.bp.slots)[number];
    const rise = Math.min(1, Math.max(0, (crane.time - lot.doneAt - 0.4) / FLAG_S));
    const fx = sc.ox + (lot.left + top.x + 0.5) * s;
    const fy = sc.gy - ((top.r + 1) * BH + (lot.bp.shape === "spire" ? BH * 0.5 : 0.12)) * s;
    drawFlag(g, fx, fy, 0.42 * s, look.color, look.t, easeOutBack(rise));
  });
  // The tall tower, with its wobble.
  if (crane.tower) drawTower(g, sc, crane, look);
  // Yard.
  w.yard.forEach((x, i) => {
    const b = crane.yard[i];
    const px = sc.ox + x * s;
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(px - 0.5 * s, sc.gy - 0.05 * s, s, 0.05 * s);
    if (b) drawWorldBlock(g, sc, x, BH / 2, b.kind, { lit: 0, seed: b.id });
  });
  for (const l of crane.loose) {
    if ((l.state === "rise" || l.state === "wait") && look.rise) {
      const r = look.rise(l.x, l.y);
      drawWorldBlock(g, sc, l.x + r.dx, l.y, l.kind, { lit: 0, seed: l.id, scale: r.scale });
      continue;
    }
    drawWorldBlock(g, sc, l.x, l.y, l.kind, { lit: 0, spin: l.spin, seed: l.id, alpha: l.alpha });
  }
  for (const st of crane.settles) {
    const f = easeOutBack(Math.min(1, st.t));
    const x = st.x0 + (st.x1 - st.x0) * f;
    const y = st.y0 + (st.y1 - st.y0) * f;
    drawWorldBlock(g, sc, x, y, st.kind, { lit: 0, seed: st.id });
  }
  // Trolley, cable, hook and load.
  const hook = crane.hook();
  const load = crane.load();
  let drawnLoad: { x: number; y: number } | null = null;
  if (load && crane.carrying) {
    const e = easeInOut(Math.min(1, crane.catching));
    drawnLoad = {
      x: load.x + crane.catchFrom.x * (1 - e),
      y: load.y + crane.catchFrom.y * (1 - e),
    };
  }
  drawHook(g, sc, crane.trolley.x, sheaveY(w), hook, drawnLoad, look.color);
  if (drawnLoad && crane.carrying) {
    drawWorldBlock(g, sc, drawnLoad.x, drawnLoad.y, crane.carrying.kind, {
      lit: 0,
      seed: crane.carrying.id,
      spin: crane.catching >= 1 ? crane.swing.theta * 0.25 : 0,
    });
  }
  // The assist's guide: from the load to the slot it would snap to.
  if (look.assist && load && crane.carrying) {
    const h = crane.hint();
    if (h.snap) {
      const ax = sc.ox + load.x * s;
      const ay = sc.gy - load.y * s;
      const bx = sc.ox + h.snap.x * s;
      const by = sc.gy - h.snap.y * s;
      g.strokeStyle = rgba(look.color, 0.85);
      g.lineWidth = Math.max(2, 0.04 * s);
      g.setLineDash([0.1 * s, 0.08 * s]);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = rgba("#ffffff", 0.55 + 0.25 * Math.sin(look.t * 6));
      g.lineWidth = Math.max(2, 0.05 * s);
      g.strokeRect(
        bx - 0.5 * BLOCK_DRAW_W * s,
        by - 0.48 * BH * s,
        BLOCK_DRAW_W * s,
        0.96 * BH * s,
      );
    }
  }
};

const drawTower = (g: G, sc: Scene, crane: Crane, look: SiteLook) => {
  const t = crane.tower!;
  const s = sc.s;
  // Best today: a dashed line with a small flag.
  if (crane.best > 0) {
    const y = sc.gy - crane.best * BH * s;
    const x0 = sc.ox + (t.x - 1.4) * s;
    const x1 = sc.ox + (t.x + 1.4) * s;
    g.strokeStyle = rgba(look.color, 0.75);
    g.lineWidth = Math.max(2, 0.035 * s);
    g.setLineDash([0.16 * s, 0.1 * s]);
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x1, y);
    g.stroke();
    g.setLineDash([]);
    drawFlag(g, x1, y, 0.3 * s, look.color, look.t, 1);
  }
  const wobble = t.phase === "wobble" ? Math.sin(look.t * 15) * 0.06 : 0;
  const capped = t.phase === "capped" || t.phase === "clear";
  t.blocks.forEach((b, i) => {
    const above = t.phase === "wobble" ? Math.max(0, i - t.breakAt) : 0;
    const x = b.x + wobble * above;
    drawWorldBlock(g, sc, x, i * BH + BH / 2, b.kind, {
      lit: capped ? look.light : 0,
      seed: b.id,
      spin: wobble * above * 0.08,
    });
  });
  if (t.phase === "build" && look.assist) {
    const n = t.blocks.length;
    const x = n > 0 ? t.blocks[n - 1]!.x : t.x;
    g.strokeStyle = "rgba(235,242,255,0.28)";
    g.lineWidth = Math.max(1.5, 0.03 * s);
    g.setLineDash([0.12 * s, 0.09 * s]);
    const px = sc.ox + (x - BLOCK_DRAW_W / 2) * s;
    const py = sc.gy - (n + 1) * BH * s;
    g.strokeRect(px, py + 0.04 * BH * s, BLOCK_DRAW_W * s, BH * s * 0.92);
    g.setLineDash([]);
  }
  if (capped && t.blocks.length > 0) {
    const top = t.blocks[t.blocks.length - 1]!;
    drawFlag(
      g,
      sc.ox + top.x * s,
      sc.gy - t.blocks.length * BH * s,
      0.45 * s,
      look.color,
      look.t,
      1,
    );
  }
};
