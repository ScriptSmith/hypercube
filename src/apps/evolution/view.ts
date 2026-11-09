/**
 * Drawing a touch frame. Three canvases: the tree (or, under a screen, the lines rising to it)
 * at the top, redrawn a dozen or so times a second; the floors, reeds and controls, redrawn when
 * a floor sweeps or a control changes; and the moving picture over the ponds and controls (fish,
 * herons, ripples, hints), redrawn every frame. Everything is in venue px.
 *
 * A catch: a heron leans out of the reeds, its beak dips to the fish, closes, and lifts it away to
 * the row of caught fish on the reeds. An automatic heron first peeks over the reeds above the
 * fish it has spotted, with a ring closing on that fish, so watchers see which ones get picked.
 */
import type { FrameInfo, FrameKind } from "../../core/types";
import { SWEEP_S } from "./config";
import {
  drawBrood,
  drawFish,
  drawHand,
  drawHeron,
  heronRest,
  drawRim,
  FLOOR_LOOK,
  FLOOR_TITLE,
  fishSprite,
  floorTile,
  TILE,
} from "./art";
import type { FloorId, Look } from "./genes";
import type { Layout, PondLayout } from "./layout";
import { type Fish, type Pond, sizeOf } from "./pond";
import type { Box } from "./pond";
import { drawComb, type TreeFrame, type TreeStyle, type TreeView } from "./treeview";
import type { Lineage } from "./lineage";
import type { WorldEvent } from "./world";

type Ctx = CanvasRenderingContext2D;

export type TopMode = "tree" | "comb" | "none";

export interface Scene {
  ponds: readonly Pond[];
  /** Local seconds, for animation. */
  t: number;
  /** Shared-clock ms, for the tree. */
  now: number;
  events: readonly WorldEvent[];
  top: TopMode;
  lineage: Lineage;
  tree: TreeFrame | null;
  treeStyle: TreeStyle;
  tips: readonly { x: number; color: string }[];
  /** Per pond: show the tap hint, and when the pond was last touched (local s). */
  hint: readonly boolean[];
}

export interface FrameView {
  setup(frame: FrameInfo, layout: Layout): void;
  draw(s: Scene): void;
  /** Controls changed (floor or switch): redraw them. */
  dirty(): void;
  press(kind: "tile" | "small" | "big", pond: number, floor?: FloorId): void;
  readonly sprites: number;
  readonly anims: number;
  dispose(): void;
}

interface Strike {
  pond: number;
  fish: Fish;
  sprite: HTMLCanvasElement | null;
  from: { x: number; y: number; face: number };
  t0: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  t0: number;
  life: number;
  color: string;
}

interface Caught {
  look: Look;
  sprite: HTMLCanvasElement | null;
  t: number;
}

const STRIKE_S = 1.0;
const DIP_S = 0.22;
const MAX_STRIKES = 16;
const MAX_RINGS = 60;
const CAUGHT_ROW = 7;
const CAUGHT_S = 30;
const PRESS_S = 0.35;
const GHOST_HAND_S = 1.6;
const TREE_EVERY: Record<FrameKind, number> = {
  panel: 1 / 24,
  pair: 1 / 20,
  wall: 1 / 12,
  screen: 1 / 10,
  kiosk: 1 / 20,
  sphere: 1 / 10,
};

const canvas = (root: HTMLElement, z: number): [HTMLCanvasElement, Ctx | null] => {
  const c = document.createElement("canvas");
  c.style.cssText = `position:absolute;pointer-events:none;z-index:${z};`;
  root.append(c);
  return [c, c.getContext("2d")];
};

export const createFrameView = (root: HTMLElement, treeView: TreeView): FrameView => {
  const [treeC, gt] = canvas(root, 1);
  const [backC, gb] = canvas(root, 1);
  const [frontC, gf] = canvas(root, 2);
  let layout: Layout | null = null;
  let k = 1;
  let unit = 1;
  let kind: FrameInfo["kind"] = "panel";
  let treeBox: Box = { x: 0, y: 0, w: 1, h: 1 };
  let lowBox: Box = { x: 0, y: 0, w: 1, h: 1 };
  const tiles = new Map<FloorId, HTMLCanvasElement>();
  const patterns = new Map<FloorId, CanvasPattern | null>();
  const sprites = new Map<number, HTMLCanvasElement>();
  const strikes: Strike[] = [];
  /** Where each pond's automatic heron stands while it eyes a fish. */
  const aims = new Map<number, { x: number; y: number; face: number }>();
  const rings: Ring[] = [];
  let caught: Caught[][] = [];
  let pressed: { kind: "tile" | "small" | "big"; pond: number; floor?: FloorId; t: number } | null =
    null;
  let ghostHands: { pond: number; floor: FloorId; t: number }[] = [];
  let staticDirty = true;
  let sweeping = false;
  let lastT = 0;
  let treeAt = -Infinity;
  let lastTreeT = 0;
  let spriteSweepAt = 0;

  const place = (c: HTMLCanvasElement, b: Box, pr: number) => {
    c.style.left = `${b.x * unit}px`;
    c.style.top = `${b.y * unit}px`;
    c.style.width = `${b.w * unit}px`;
    c.style.height = `${b.h * unit}px`;
    c.width = Math.max(1, Math.round(b.w * unit * pr));
    c.height = Math.max(1, Math.round(b.h * unit * pr));
  };

  const spriteOf = (f: Fish): HTMLCanvasElement => {
    let s = sprites.get(f.id);
    if (!s) {
      s = fishSprite(f.look, layout?.fish ?? 84, k, f.id);
      sprites.set(f.id, s);
    }
    return s;
  };

  const patternOf = (g: Ctx, floor: FloorId): CanvasPattern | null => {
    if (patterns.has(floor)) return patterns.get(floor) ?? null;
    let tile = tiles.get(floor);
    if (!tile) {
      tile = floorTile(floor, k);
      tiles.set(floor, tile);
    }
    const p = g.createPattern(tile, "repeat");
    p?.setTransform(new DOMMatrix().scale(TILE / tile.width, TILE / tile.height));
    patterns.set(floor, p);
    return p;
  };

  const fillFloor = (g: Ctx, floor: FloorId, b: Box, ox: number) => {
    const p = patternOf(g, floor);
    g.save();
    g.beginPath();
    g.rect(b.x, b.y, b.w, b.h);
    g.clip();
    g.translate(ox, 0);
    g.fillStyle = p ?? FLOOR_LOOK[floor].body;
    g.fillRect(b.x - ox, b.y, b.w, b.h);
    g.restore();
  };

  // ---- Static layer: floors, reeds, controls ------------------------------------------------

  const drawTile = (g: Ctx, floor: FloorId, b: Box, selected: boolean) => {
    const r = b.w * 0.14;
    g.save();
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.clip();
    fillFloor(g, floor, b, b.x * 0.37);
    const bar = b.h * 0.24;
    g.fillStyle = "rgba(5,7,13,0.62)";
    g.fillRect(b.x, b.y + b.h - bar, b.w, bar);
    g.fillStyle = "#f2f5fa";
    g.font = `700 ${Math.round(bar * 0.62)}px system-ui, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(FLOOR_TITLE[floor], b.x + b.w / 2, b.y + b.h - bar / 2);
    g.restore();
    g.lineWidth = selected ? 9 : 3;
    g.strokeStyle = selected ? "#f2f5fa" : "rgba(242,245,250,0.28)";
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.stroke();
    if (selected) {
      // A notch pointing down at the pond: this floor is the pond's.
      const cx = b.x + b.w / 2;
      const y = b.y + b.h + 8;
      g.fillStyle = "#f2f5fa";
      g.beginPath();
      g.moveTo(cx - 18, y);
      g.lineTo(cx + 18, y);
      g.lineTo(cx, y + 16);
      g.closePath();
      g.fill();
    }
  };

  const drawSwitch = (g: Ctx, pl: PondLayout, value: "small" | "big") => {
    const all: Box = { x: pl.small.x, y: pl.small.y, w: pl.small.w + pl.big.w, h: pl.small.h };
    const r = all.h * 0.3;
    g.fillStyle = "rgba(20,28,40,0.9)";
    g.beginPath();
    g.roundRect(all.x, all.y, all.w, all.h, r);
    g.fill();
    for (const which of ["small", "big"] as const) {
      const b = which === "small" ? pl.small : pl.big;
      const on = value === which;
      if (on) {
        g.fillStyle = "rgba(111,164,252,0.32)";
        g.beginPath();
        g.roundRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12, r * 0.8);
        g.fill();
        g.strokeStyle = "#f2f5fa";
        g.lineWidth = 6;
        g.stroke();
      }
      const label = b.h * 0.2;
      drawBrood(
        g,
        b.x + b.w / 2,
        b.y + b.h * 0.4,
        Math.min(b.w * 0.7, b.h * 0.9),
        which === "big",
        on ? 1 : 0.55,
      );
      const text = which === "small" ? "Small changes" : "Big changes";
      g.font = `700 ${Math.round(label)}px system-ui, sans-serif`;
      const fit = Math.min(1, (b.w * 0.86) / Math.max(1, g.measureText(text).width));
      g.font = `700 ${Math.floor(label * fit)}px system-ui, sans-serif`;
      g.fillStyle = on ? "#f2f5fa" : "rgba(242,245,250,0.6)";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, b.x + b.w / 2, b.y + b.h * 0.82);
    }
  };

  const drawFloors = (g: Ctx, ponds: readonly Pond[]) => {
    if (!layout) return;
    layout.ponds.forEach((pl, i) => {
      const p = ponds[i];
      if (!p) return;
      const w = pl.water;
      const below: Box = { x: w.x, y: w.y + pl.rim.h, w: w.w, h: w.h - pl.rim.h };
      const s = p.sweep;
      const ox = i * 131;
      if (!s) {
        fillFloor(g, p.floor, below, ox);
      } else {
        fillFloor(g, s.from, below, ox);
        const reach = Math.max(s.x - w.x, w.x + w.w - s.x);
        const r = Math.min(1, s.t / SWEEP_S) * reach;
        const front: Box = { x: s.x - r, y: below.y, w: 2 * r, h: below.h };
        const clipped: Box = {
          x: Math.max(below.x, front.x),
          y: below.y,
          w: Math.min(below.x + below.w, front.x + front.w) - Math.max(below.x, front.x),
          h: below.h,
        };
        if (clipped.w > 0) fillFloor(g, p.floor, clipped, ox);
        // A soft swirl of silt at the moving edges.
        g.fillStyle = "rgba(230,236,240,0.16)";
        for (const ex of [s.x - r, s.x + r]) {
          if (ex < below.x || ex > below.x + below.w) continue;
          g.fillRect(ex - 14, below.y, 28, below.h);
        }
      }
      // Water: a cool tint and a darker edge.
      g.fillStyle = "rgba(20,70,90,0.12)";
      g.fillRect(below.x, below.y, below.w, below.h);
      g.strokeStyle = "rgba(8,20,24,0.55)";
      g.lineWidth = 10;
      g.strokeRect(below.x + 5, below.y, below.w - 10, below.h - 5);
      drawRim(g, pl.rim.x, pl.rim.y, pl.rim.w, pl.rim.h, i);
    });
  };

  const drawStatic = (ponds: readonly Pond[]) => {
    if (!gb || !layout) return;
    gb.setTransform(1, 0, 0, 1, 0, 0);
    gb.clearRect(0, 0, backC.width, backC.height);
    gb.setTransform(k, 0, 0, k, -lowBox.x * k, -lowBox.y * k);
    drawFloors(gb, ponds);
    layout.ponds.forEach((pl, i) => {
      const p = ponds[i];
      if (!p) return;
      for (const t of pl.tiles) drawTile(gb, t.floor, t.box, p.floor === t.floor);
      drawSwitch(gb, pl, p.mutation);
    });
  };

  // ---- Moving layer ---------------------------------------------------------------------------

  /** Where a heron stands on the reeds to reach a fish at x: off to the side nearer the middle. */
  const anchorFor = (pl: PondLayout, x: number) => {
    const w = pl.water;
    const side = x < w.x + w.w / 2 ? 1 : -1;
    const ax = Math.min(w.x + w.w - 70, Math.max(w.x + 70, x + side * 150));
    return { x: ax, y: pl.rim.y + pl.rim.h * 0.42, face: ax <= x ? 1 : -1 };
  };

  const heronSize = () => (kind === "wall" ? 70 : 62);

  const addRing = (x: number, y: number, r: number, life: number, color: string) => {
    if (rings.length >= MAX_RINGS) rings.shift();
    rings.push({ x, y, r, t0: lastT, life, color });
  };

  const handleEvents = (s: Scene) => {
    if (!layout) return;
    for (const { pond, e } of s.events) {
      const pl = layout.ponds[pond];
      if (!pl) continue;
      switch (e.kind) {
        case "catch": {
          if (strikes.length >= MAX_STRIKES) strikes.shift();
          strikes.push({
            pond,
            fish: e.fish,
            sprite: sprites.get(e.fish.id) ?? spriteOf(e.fish),
            from: aims.get(pond) ?? anchorFor(pl, e.fish.x),
            t0: s.t,
          });
          aims.delete(pond);
          break;
        }
        case "birth":
          if (e.parent)
            addRing(e.fish.x, e.fish.y, (layout.fish ?? 84) * 0.45, 0.8, "rgba(242,245,250,0.55)");
          break;
        case "miss":
          addRing(e.x, e.y, 70, 0.7, "rgba(242,245,250,0.6)");
          break;
        case "floor":
          staticDirty = true;
          if (e.ghost) {
            ghostHands = ghostHands.filter((h) => h.pond !== pond);
            ghostHands.push({ pond, floor: e.floor, t: s.t });
          }
          break;
        case "arrive":
          addRing(e.fish.x, e.fish.y, 50, 0.6, "rgba(242,245,250,0.35)");
          break;
        default:
          break;
      }
    }
  };

  const drawRings = (g: Ctx, t: number) => {
    g.lineWidth = 5;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]!;
      const a = (t - r.t0) / r.life;
      if (a >= 1 || a < 0) {
        if (a >= 1) rings.splice(i, 1);
        continue;
      }
      g.strokeStyle = r.color;
      g.globalAlpha = 1 - a;
      for (const f of [1, 0.6]) {
        g.beginPath();
        g.ellipse(r.x, r.y, r.r * (0.3 + a) * f, r.r * (0.3 + a) * f * 0.7, 0, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  };

  const drawStrikes = (g: Ctx, t: number) => {
    if (!layout) return;
    const s = heronSize();
    for (let i = strikes.length - 1; i >= 0; i--) {
      const st = strikes[i]!;
      const pl = layout.ponds[st.pond];
      const a = t - st.t0;
      if (!pl || a >= STRIKE_S) {
        if (pl && a >= STRIKE_S) {
          const row = caught[st.pond] ?? (caught[st.pond] = []);
          row.unshift({ look: st.fish.look, sprite: st.sprite, t });
          if (row.length > CAUGHT_ROW) row.length = CAUGHT_ROW;
        }
        strikes.splice(i, 1);
        continue;
      }
      const f = st.fish;
      const base = st.from;
      const rest = heronRest(base, base.face, s);
      let hx: number;
      let hy: number;
      let open = 1;
      let carry = false;
      if (a < DIP_S) {
        const u = a / DIP_S;
        const e = u * u * (3 - 2 * u);
        hx = rest.x + (f.x - rest.x) * e;
        hy = rest.y + (f.y - rest.y) * e;
      } else if (a < DIP_S + 0.1) {
        hx = f.x;
        hy = f.y;
        open = 1 - (a - DIP_S) / 0.1;
        carry = true;
        if (a - DIP_S < 1 / 30 + 0.001) addRing(f.x, f.y, 80, 0.9, "rgba(220,235,245,0.7)");
      } else {
        const u = Math.min(1, (a - DIP_S - 0.1) / (STRIKE_S - DIP_S - 0.35));
        const e = u * u * (3 - 2 * u);
        hx = f.x + (rest.x - f.x) * e;
        hy = f.y + (rest.y - s * 0.6 - f.y) * e;
        open = 0;
        carry = true;
      }
      const dir = Math.atan2(f.y - base.y, f.x - base.x);
      const fade = a > STRIKE_S - 0.25 ? (STRIKE_S - a) / 0.25 : 1;
      if (!carry && st.sprite) {
        drawFish(g, st.sprite, f.look, layout.fish, f.x, f.y, f.heading, Math.sin(t * 30) * 0.8);
      }
      const lifted = carry && a > DIP_S + 0.1 ? Math.min(1, (a - DIP_S - 0.1) * 3) : 0;
      const hdir = dir - base.face * 0.5 * lifted;
      drawHeron(g, base, { x: hx, y: hy }, hdir, open, s, fade, base.face);
      if (carry && st.sprite) {
        const tip = { x: hx + Math.cos(hdir) * s * 0.95, y: hy + Math.sin(hdir) * s * 0.95 };
        drawFish(
          g,
          st.sprite,
          f.look,
          layout.fish * 0.8,
          tip.x,
          tip.y,
          hdir + Math.PI / 2 + Math.sin(t * 22) * 0.25,
          Math.sin(t * 30),
          fade,
        );
      }
    }
  };

  const drawAim = (g: Ctx, p: Pond, pl: PondLayout, pond: number) => {
    const f = p.aim;
    if (!f) {
      aims.delete(pond);
      return;
    }
    const s = heronSize();
    const u = Math.max(0, Math.min(1, p.aimT / 0.6));
    const len = layout?.fish ?? 84;
    g.strokeStyle = "rgba(200,214,230,0.85)";
    g.lineWidth = 5;
    g.setLineDash([16, 12]);
    g.beginPath();
    g.arc(f.x, f.y, len * (0.65 + 0.9 * u), 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    let base = aims.get(pond);
    if (!base) {
      base = anchorFor(pl, f.x);
      aims.set(pond, base);
    }
    const rest = heronRest(base, base.face, s);
    const dir = Math.atan2(f.y - base.y, f.x - base.x);
    drawHeron(g, base, rest, dir, 0.15, s, Math.min(1, (1 - u) * 3), base.face);
  };

  const drawCaughtRow = (g: Ctx, pond: number, pl: PondLayout, t: number) => {
    const row = caught[pond];
    if (!row || !layout) return;
    const len = layout.fish * 0.5;
    for (let i = row.length - 1; i >= 0; i--) {
      const c = row[i]!;
      const age = t - c.t;
      if (age > CAUGHT_S) {
        row.splice(i, 1);
        continue;
      }
      if (!c.sprite) continue;
      const a = Math.min(1, age * 3) * Math.min(1, (CAUGHT_S - age) / 3);
      const x = pl.rim.x + 46 + i * (len * 1.25);
      drawFish(g, c.sprite, c.look, len, x, pl.rim.y + pl.rim.h * 0.55, -0.3, 0, a);
    }
  };

  const drawHint = (g: Ctx, p: Pond, t: number) => {
    let best: Fish | null = null;
    for (const f of p.fish) {
      if (f.state !== "swim" || f.arriving > 0) continue;
      if (!best || f.standout > best.standout) best = f;
    }
    if (!best) return;
    const len = layout?.fish ?? 84;
    const cyc = t % 5;
    if (cyc > 3.2) return;
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    g.strokeStyle = "rgba(242,245,250,0.9)";
    g.globalAlpha = 0.45 + 0.45 * pulse;
    g.lineWidth = 7;
    g.beginPath();
    g.arc(best.x, best.y, len * (0.85 + 0.15 * pulse), 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    const press = cyc > 1.2 && cyc < 1.6 ? 1 : 0;
    drawHand(g, best.x + len * 0.15, best.y + len * (0.25 - 0.1 * press), len * 0.95, 0.85);
  };

  const drawControlsFx = (g: Ctx, t: number) => {
    if (!layout) return;
    if (pressed) {
      const a = (t - pressed.t) / PRESS_S;
      const pl = layout.ponds[pressed.pond];
      if (a >= 1 || !pl) {
        pressed = null;
      } else {
        const b =
          pressed.kind === "tile"
            ? pl.tiles.find((x) => x.floor === pressed!.floor)?.box
            : pressed.kind === "small"
              ? pl.small
              : pl.big;
        if (b) {
          g.fillStyle = `rgba(242,245,250,${0.35 * (1 - a)})`;
          g.beginPath();
          g.roundRect(b.x, b.y, b.w, b.h, b.w * 0.14);
          g.fill();
        }
      }
    }
    for (let i = ghostHands.length - 1; i >= 0; i--) {
      const h = ghostHands[i]!;
      const a = (t - h.t) / GHOST_HAND_S;
      const pl = layout.ponds[h.pond];
      const b = pl?.tiles.find((x) => x.floor === h.floor)?.box;
      if (a >= 1 || !b) {
        ghostHands.splice(i, 1);
        continue;
      }
      const down = a < 0.35 ? a / 0.35 : 1;
      drawHand(
        g,
        b.x + b.w * 0.55,
        b.y + b.h * (0.5 - 0.15 * (1 - down)),
        b.w * 0.55,
        Math.min(1, (1 - a) * 3),
      );
    }
  };

  const drawFishes = (g: Ctx, p: Pond, t: number) => {
    if (!layout) return;
    const len = layout.fish;
    const b = p.spec.box;
    for (const f of p.fish) {
      const sz = sizeOf(f) * (f.state === "dying" ? 0.9 + 0.1 * (f.fade / 1.6) : 1);
      const alpha = f.state === "dying" ? Math.max(0, f.fade / 1.6) : 1;
      // Outside its pond (arriving or leaving), a fish fades at the edge.
      const out = Math.max(b.x - f.x, f.x - (b.x + b.w), 0);
      const edge = out > 0 ? Math.max(0, 1 - out / (len * 0.6)) : 1;
      const sway = Math.sin(t * (4 + f.speed * 0.04) + f.w);
      drawFish(g, spriteOf(f), f.look, len * sz, f.x, f.y, f.heading, sway, alpha * edge);
    }
  };

  /** Under a screen: say where the lines go. */
  const drawCaption = (g: Ctx, cx: number, cy: number) => {
    const size = 40;
    g.font = `700 ${size}px system-ui, sans-serif`;
    const text = "Family tree above";
    const w = g.measureText(text).width + size * 1.6;
    const h = size * 2.9;
    g.fillStyle = "rgba(11,18,25,0.85)";
    g.beginPath();
    g.roundRect(cx - w / 2, cy - h / 2, w, h, size * 0.5);
    g.fill();
    g.strokeStyle = "rgba(242,245,250,0.85)";
    g.lineWidth = 7;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(cx - size * 0.6, cy - size * 0.5);
    g.lineTo(cx, cy - size * 1.05);
    g.lineTo(cx + size * 0.6, cy - size * 0.5);
    g.stroke();
    g.fillStyle = "rgba(242,245,250,0.9)";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, cx, cy + size * 0.55);
  };

  const drawTop = (s: Scene, t: number) => {
    if (!gt || !layout) return;
    const every = TREE_EVERY[kind] ?? 1 / 20;
    if (t - treeAt < every) return;
    const dt = treeAt === -Infinity ? 0 : t - lastTreeT;
    treeAt = t;
    lastTreeT = t;
    gt.setTransform(1, 0, 0, 1, 0, 0);
    gt.clearRect(0, 0, treeC.width, treeC.height);
    gt.setTransform(k, 0, 0, k, -treeBox.x * k, -treeBox.y * k);
    if (s.top === "tree" && s.tree) {
      const tb = s.tree.box;
      gt.fillStyle = "rgba(14,22,32,0.9)";
      gt.beginPath();
      gt.roundRect(tb.x - 16, tb.y - 16, tb.w + 32, tb.h + 32, 24);
      gt.fill();
      treeView.draw(gt, s.lineage, s.tree, s.treeStyle, dt);
    } else if (s.top === "comb") {
      const box: Box = { x: treeBox.x, y: 0, w: treeBox.w, h: treeBox.y + treeBox.h };
      drawComb(gt, box, s.tips, s.treeStyle.line);
      drawCaption(gt, box.x + box.w / 2, box.y + box.h * 0.55);
    }
  };

  const view: FrameView = {
    setup(frame, l) {
      layout = l;
      unit = frame.unit;
      kind = frame.kind;
      k = frame.unit * frame.pixelRatio;
      const ctlTop = Math.min(
        ...l.ponds.map((p) => Math.min(p.small.y, p.tiles[0]?.box.y ?? p.small.y)),
      );
      treeBox = { x: 0, y: 0, w: l.width, h: Math.max(1, ctlTop - 40) };
      lowBox = { x: 0, y: ctlTop - 40, w: l.width, h: l.height - (ctlTop - 40) };
      place(treeC, treeBox, frame.pixelRatio);
      place(backC, lowBox, frame.pixelRatio);
      place(frontC, lowBox, frame.pixelRatio);
      tiles.clear();
      patterns.clear();
      for (const s of sprites.values()) s.width = s.height = 0;
      sprites.clear();
      caught = l.ponds.map(() => []);
      strikes.length = 0;
      staticDirty = true;
      treeAt = -Infinity;
    },
    draw(s) {
      if (!layout || !gf) return;
      const t = s.t;
      lastT = t;
      handleEvents(s);
      const anySweep = s.ponds.some((p) => p.sweep !== null);
      if (staticDirty || anySweep || sweeping) {
        drawStatic(s.ponds);
        staticDirty = false;
      }
      sweeping = anySweep;
      gf.setTransform(1, 0, 0, 1, 0, 0);
      gf.clearRect(0, 0, frontC.width, frontC.height);
      gf.setTransform(k, 0, 0, k, -lowBox.x * k, -lowBox.y * k);
      layout.ponds.forEach((pl, i) => {
        const p = s.ponds[i];
        if (!p) return;
        gf.save();
        gf.beginPath();
        gf.rect(pl.water.x, pl.rim.y + pl.rim.h, pl.water.w, pl.water.h - pl.rim.h);
        gf.clip();
        drawFishes(gf, p, t);
        drawRings(gf, t);
        if (s.hint[i] && !p.aim) drawHint(gf, p, t);
        gf.restore();
        drawCaughtRow(gf, i, pl, t);
        drawAim(gf, p, pl, i);
      });
      drawStrikes(gf, t);
      drawControlsFx(gf, t);
      drawTop(s, t);
      if (t > spriteSweepAt) {
        spriteSweepAt = t + 1;
        const keep = new Set<number>();
        for (const p of s.ponds) for (const f of p.fish) keep.add(f.id);
        for (const st of strikes) keep.add(st.fish.id);
        for (const [id, c] of sprites) {
          if (keep.has(id)) continue;
          // The caught row keeps its own reference; dropping it here only frees the cache entry.
          sprites.delete(id);
          if (!caught.some((row) => row.some((r) => r.sprite === c))) c.width = c.height = 0;
        }
      }
    },
    dirty() {
      staticDirty = true;
    },
    press(kind2, pond, floor) {
      pressed = { kind: kind2, pond, floor, t: lastT };
      staticDirty = true;
    },
    get sprites() {
      return sprites.size;
    },
    get anims() {
      return strikes.length + rings.length + ghostHands.length;
    },
    dispose() {
      for (const s of sprites.values()) s.width = s.height = 0;
      sprites.clear();
      for (const t of tiles.values()) t.width = t.height = 0;
      tiles.clear();
      patterns.clear();
      strikes.length = 0;
      rings.length = 0;
      caught = [];
      ghostHands = [];
      for (const c of [treeC, backC, frontC]) {
        c.width = c.height = 0;
        c.remove();
      }
    },
  };
  return view;
};
