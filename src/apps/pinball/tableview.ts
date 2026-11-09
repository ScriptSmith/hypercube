/**
 * Draws a touch frame's tables with Canvas2D: a static layer (playfield, walls, bumpers, lanes)
 * drawn once per size or deck change, and a live layer each frame (lamps, flashes, flippers,
 * balls, pads and scores). Everything is in table px, placed and scaled to the backing store. On
 * a wall the canvases cover only the tables' part of the frame.
 */
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import { BALL_R, TABLE_H, TABLE_W } from "./config";
import { drawGiftIcon, GIFT_COLOR } from "./gifticon";
import type { TableLayout } from "./layout";
import type { Arc, Circle, Seg } from "./physics";
import {
  drawAttractFade,
  drawGifts,
  drawHud,
  drawPads,
  drawScore,
  flashOf,
  GIFT_R,
  glow,
  heldMark,
  playfieldPath,
  type TableScene,
  type TableView,
} from "./tablehud";
import type { Place, Region } from "./wallgeo";

export { formatScore } from "./tablehud";
export type { TableScene, TableView } from "./tablehud";

const RAIL = "#cfe6ff";
const RAIL_GLOW = "#3b8cff";
const FIELD_TOP = "#121a46";
const FIELD_MID = "#0b1233";
const FIELD_LOW = "#070b20";
const OUTSIDE = "#03040b";
const AMBER = "#ffcc33";
const LAMP_OFF = "#1c2348";
/** Chevron inserts up the middle of the lower playfield. */
const CHEVRONS = [1110, 1160, 1210];

const tubePath = (g: CanvasRenderingContext2D, pts: readonly { x: number; y: number }[]) => {
  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
};

/** A glass tube over the playfield, with chevrons showing which way balls run along it. */
const drawTube = (
  g: CanvasRenderingContext2D,
  pts: readonly { x: number; y: number }[],
  color: string,
) => {
  g.save();
  g.lineCap = "round";
  g.lineJoin = "round";
  tubePath(g, pts);
  g.strokeStyle = withAlpha(color, 0.12);
  g.lineWidth = BALL_R * 2 + 22;
  g.stroke();
  // Two rails either side of the ball's path, mitred at the corners.
  const d = BALL_R + 10;
  g.strokeStyle = withAlpha(RAIL, 0.7);
  g.lineWidth = 4;
  for (const side of [-1, 1]) {
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const prev = pts[i - 1];
      const next = pts[i + 1];
      const n = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
      };
      const n0 = prev ? n(prev, p) : n(p, next!);
      const n1 = next ? n(p, next) : n0;
      let mx = n0.x + n1.x;
      let my = n0.y + n1.y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
      const k = d / Math.max(0.3, mx * n0.x + my * n0.y);
      const x = p.x + mx * k * side;
      const y = p.y + my * k * side;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // Chevrons every so often along the way.
  g.fillStyle = withAlpha(color, 0.45);
  let s = 60;
  let at = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.x - a.x, -(b.y - a.y));
    while (s <= at + l) {
      const k = (s - at) / l;
      g.save();
      g.translate(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
      g.rotate(ang);
      g.beginPath();
      g.moveTo(0, -14);
      g.lineTo(16, 8);
      g.lineTo(0, 0);
      g.lineTo(-16, 8);
      g.closePath();
      g.fill();
      g.restore();
      s += 120;
    }
    at += l;
  }
  g.restore();
};

const drawStatic = (
  g: CanvasRenderingContext2D,
  t: TableLayout,
  color: string,
  deck: boolean,
  cabinet: boolean,
) => {
  g.save();
  if (t.mirror) {
    g.translate(TABLE_W, 0);
    g.scale(-1, 1);
  }
  // On a wall the cabinet behind shows round the arch.
  if (!cabinet) {
    g.fillStyle = OUTSIDE;
    g.fillRect(0, 0, TABLE_W, TABLE_H);
  }
  const grad = g.createLinearGradient(0, 120, 0, TABLE_H);
  grad.addColorStop(0, FIELD_TOP);
  grad.addColorStop(0.5, FIELD_MID);
  grad.addColorStop(1, FIELD_LOW);
  playfieldPath(g);
  g.fillStyle = grad;
  g.fill();
  // A soft wash of the table's colour low on the playfield.
  const wash = g.createRadialGradient(500, 1500, 40, 500, 1500, 620);
  wash.addColorStop(0, withAlpha(color, 0.16));
  wash.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = wash;
  playfieldPath(g);
  g.fill();
  g.restore();

  // Decorations that sit under the rails: arrows towards the deck lane and the targets.
  const arrow = (x: number, y: number, ang: number, size: number, c: string) => {
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(0, -size);
    g.lineTo(size * 0.7, size * 0.5);
    g.lineTo(0, size * 0.15);
    g.lineTo(-size * 0.7, size * 0.5);
    g.closePath();
    g.fillStyle = c;
    g.fill();
    g.restore();
  };
  const dl = t.deckLane;
  const dang = Math.atan2(dl.dir.x, -dl.dir.y);
  arrow(dl.mouth.x - dl.dir.x * 70, dl.mouth.y - dl.dir.y * 70, dang, 34, LAMP_OFF);
  const mid = t.mirror ? TABLE_W - 500 : 500;
  for (const y of CHEVRONS) arrow(mid, y, 0, 30, LAMP_OFF);

  g.lineCap = "round";
  for (const s of t.shapes) {
    if (s.kind === "seg" && s.tag === "wall" && s.on && s !== t.plunger.tip) {
      railSeg(g, s);
    } else if (s.kind === "arc") {
      railArc(g, s);
    } else if (s.kind === "seg" && s.tag === "sling") {
      sling(g, s, t, color);
    } else if (s.kind === "seg" && s.tag === "target") {
      g.strokeStyle = withAlpha(AMBER, 0.75);
      g.lineWidth = s.r * 2;
      g.beginPath();
      g.moveTo(s.ax, s.ay);
      g.lineTo(s.bx, s.by);
      g.stroke();
    } else if (s.kind === "circle" && s.tag === "bumper") {
      bumperBase(g, s, color);
    }
  }
  for (const l of t.lamps) {
    if (l.tag === "deck" || l.tag === "spinner") continue;
    g.beginPath();
    g.arc(l.x, l.y, l.r, 0, Math.PI * 2);
    g.fillStyle = LAMP_OFF;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = withAlpha(RAIL, 0.25);
    g.stroke();
  }
  // Tubes over everything else: to the screen, or the orbit ramp back into the plunger lane.
  drawTube(g, deck ? t.exitTube : t.orbitTube, deck ? "#7fd7ff" : color);
  if (deck) drawTube(g, t.returnTube, "#7fd7ff");
  // Multiplier lamp labels.
  g.font = `800 26px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = withAlpha(RAIL, 0.4);
  for (const l of t.lamps) if (l.tag === "mult") g.fillText(`${l.index + 2}x`, l.x, l.y + 1);
  // Plunger housing.
  const z = t.plunger.zone;
  g.fillStyle = "#0d1230";
  g.fillRect(z.x0 + 8, t.plunger.tipY + 10, z.x1 - z.x0 - 16, TABLE_H - t.plunger.tipY);
};

/** A wall table's cabinet: its share of the wall, lit faintly in its colour from below. */
const drawCabinet = (g: CanvasRenderingContext2D, c: Region, color: string) => {
  const inset = c.w * 0.03;
  const grad = g.createLinearGradient(0, c.y, 0, c.y + c.h);
  grad.addColorStop(0, withAlpha(color, 0));
  grad.addColorStop(1, withAlpha(color, 0.1));
  g.beginPath();
  g.roundRect(c.x + inset, c.y + inset, c.w - inset * 2, c.h - inset, 40);
  g.fillStyle = grad;
  g.fill();
  g.strokeStyle = withAlpha(color, 0.14);
  g.lineWidth = 4;
  g.stroke();
};

const railSeg = (g: CanvasRenderingContext2D, s: Seg) => {
  g.save();
  g.shadowColor = RAIL_GLOW;
  g.shadowBlur = 14;
  g.strokeStyle = RAIL;
  g.lineWidth = s.r * 2;
  g.beginPath();
  g.moveTo(s.ax, s.ay);
  g.lineTo(s.bx, s.by);
  g.stroke();
  g.restore();
};

const railArc = (g: CanvasRenderingContext2D, a: Arc) => {
  g.save();
  g.shadowColor = RAIL_GLOW;
  g.shadowBlur = 14;
  g.strokeStyle = RAIL;
  g.lineWidth = a.r * 2;
  g.beginPath();
  g.arc(a.cx, a.cy, a.rad, a.a0, a.a1);
  g.stroke();
  g.restore();
};

const sling = (g: CanvasRenderingContext2D, face: Seg, t: TableLayout, color: string) => {
  // The triangle's third corner is the wall end that isn't on the face.
  const corner = t.shapes.find(
    (s) =>
      s.kind === "seg" &&
      s.tag === "wall" &&
      Math.abs(s.ax - face.ax) < 1 &&
      Math.abs(s.ay - face.ay) < 1,
  ) as Seg | undefined;
  if (!corner) return;
  g.beginPath();
  g.moveTo(face.ax, face.ay);
  g.lineTo(corner.bx, corner.by);
  g.lineTo(face.bx, face.by);
  g.closePath();
  g.fillStyle = withAlpha(color, 0.28);
  g.fill();
};

const bumperBase = (g: CanvasRenderingContext2D, c: Circle, color: string) => {
  const glow = g.createRadialGradient(c.x, c.y, c.r * 0.5, c.x, c.y, c.r * 2.2);
  glow.addColorStop(0, withAlpha(color, 0.25));
  glow.addColorStop(1, withAlpha(color, 0));
  g.fillStyle = glow;
  g.beginPath();
  g.arc(c.x, c.y, c.r * 2.2, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
  g.fillStyle = "#151c44";
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = color;
  g.stroke();
};

const ballAt = (g: CanvasRenderingContext2D, x: number, y: number, r: number, tint: string) => {
  const body = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.35, "#d9e2f0");
  body.addColorStop(0.8, "#7c8aa6");
  body.addColorStop(1, "#3b4458");
  g.fillStyle = withAlpha(tint, 0.35);
  g.beginPath();
  g.arc(x, y, r + 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = body;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = tint;
  g.stroke();
};

export const createTableView = (root: HTMLElement, palette: readonly string[]): TableView => {
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;";
  const bg = document.createElement("canvas");
  const fg = document.createElement("canvas");
  for (const c of [bg, fg]) {
    c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;";
    wrap.append(c);
  }
  root.append(wrap);
  const gb = bg.getContext("2d");
  const gf = fg.getContext("2d");
  let scale = 1;
  let dirty = true;
  let lastKey = "";
  /** The canvases' top left corner, venue px. */
  let ox = 0;
  let oy = 0;
  const place = (g: CanvasRenderingContext2D, p: Place) =>
    g.setTransform(scale * p.k, 0, 0, scale * p.k, (p.x - ox) * scale, (p.y - oy) * scale);

  const view: TableView = {
    canvas: fg,
    resize(frame, region) {
      const u = frame.unit;
      const w = Math.max(1, Math.round((region ? region.w * u : frame.width) * frame.pixelRatio));
      const h = Math.max(1, Math.round((region ? region.h * u : frame.height) * frame.pixelRatio));
      for (const c of [bg, fg]) {
        if (c.width !== w) c.width = w;
        if (c.height !== h) c.height = h;
      }
      ox = region?.x ?? 0;
      oy = region?.y ?? 0;
      wrap.style.cssText = region
        ? `position:absolute;left:${ox * u}px;top:${oy * u}px;width:${region.w * u}px;height:${region.h * u}px;`
        : "position:absolute;inset:0;";
      scale = frame.unit * frame.pixelRatio;
      dirty = true;
    },
    invalidate() {
      dirty = true;
    },
    draw(scenes, alpha, time) {
      if (!gb || !gf) return;
      const key = scenes.map((s) => `${s.deck}${s.color}${s.table.layout.posts[0]?.on}`).join("|");
      if (dirty || key !== lastKey) {
        dirty = false;
        lastKey = key;
        gb.setTransform(1, 0, 0, 1, 0, 0);
        gb.fillStyle = OUTSIDE;
        gb.fillRect(0, 0, bg.width, bg.height);
        for (const s of scenes) {
          if (!s.cell) continue;
          gb.setTransform(scale, 0, 0, scale, -ox * scale, -oy * scale);
          drawCabinet(gb, s.cell, s.color);
        }
        for (const s of scenes) {
          place(gb, s.place);
          drawStatic(gb, s.table.layout, s.color, s.deck, s.cell !== undefined);
        }
      }
      gf.setTransform(1, 0, 0, 1, 0, 0);
      gf.clearRect(0, 0, fg.width, fg.height);
      for (const s of scenes) {
        place(gf, s.place);
        drawLive(gf, s, alpha, time, palette);
      }
    },
    dispose() {
      wrap.remove();
      bg.width = 0;
      fg.width = 0;
    },
  };
  return view;
};

const drawLive = (
  g: CanvasRenderingContext2D,
  s: TableScene,
  alpha: number,
  time: number,
  palette: readonly string[],
) => {
  const t = s.table;
  const L = t.layout;
  /** Shadow glows, on panels and pairs; not on a wall (see `glow`). */
  const soft = s.cell === undefined;
  const blink = (hz: number) => Math.sin(time * Math.PI * 2 * hz) > 0;
  // Lamps.
  for (const l of L.lamps) {
    let on = 0;
    let c = AMBER;
    if (l.tag === "lane") {
      on = t.lanes[l.index] ? 1 : 0;
      on = Math.max(on, flashOf(t, "lane", l.index));
    } else if (l.tag === "target") {
      on = t.targets[l.index] ? 1 : flashOf(t, "target", l.index);
      c = "#ff8a3d";
    } else if (l.tag === "mult") {
      on = t.multiplier >= l.index + 2 ? 1 : 0;
      c = s.color;
    } else if (l.tag === "save") {
      const left = t.saveLeft();
      on = left === Infinity ? 0.5 : left > 2 ? 1 : left > 0 ? (blink(4) ? 1 : 0) : 0;
      c = "#6cf7a0";
    } else if (l.tag === "deck") {
      on = flashOf(t, "deck", 0) > 0 ? 1 : blink(1.2) ? 0.9 : 0.25;
      c = s.deck ? "#7fd7ff" : s.color;
      drawLaneArrow(g, L, c, on, soft);
      continue;
    } else if (l.tag === "spinner") {
      continue;
    }
    if (on <= 0) continue;
    g.save();
    g.globalAlpha = Math.min(1, on);
    g.fillStyle = c;
    if (!soft) {
      g.globalAlpha = Math.min(1, on) * 0.3;
      g.beginPath();
      g.arc(l.x, l.y, l.r * 1.45, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = Math.min(1, on);
    }
    glow(g, soft, c, 24);
    g.beginPath();
    g.arc(l.x, l.y, l.r * 0.86, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // Bumper and slingshot flashes.
  for (const sh of L.shapes) {
    if (sh.kind === "circle" && sh.tag === "bumper") {
      const f = flashOf(t, "bumper", sh.index);
      g.save();
      g.beginPath();
      g.arc(sh.x, sh.y, sh.r * 0.62, 0, Math.PI * 2);
      g.fillStyle = f > 0 ? "#ffffff" : withAlpha(s.color, 0.85);
      g.globalAlpha = 0.6 + 0.4 * f;
      g.fill();
      if (f > 0) {
        g.globalAlpha = f;
        g.lineWidth = 10;
        g.strokeStyle = "#ffffff";
        g.beginPath();
        g.arc(sh.x, sh.y, sh.r + 6 + (1 - f) * 18, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    } else if (sh.kind === "seg" && sh.tag === "sling") {
      const f = flashOf(t, "sling", sh.index);
      g.save();
      g.lineCap = "round";
      g.strokeStyle = f > 0 ? "#ffffff" : s.color;
      g.lineWidth = sh.r * 2 + 4 * f;
      g.globalAlpha = 0.85;
      g.beginPath();
      g.moveTo(sh.ax, sh.ay);
      g.lineTo(sh.bx, sh.by);
      g.stroke();
      g.restore();
    } else if (sh.kind === "seg" && sh.tag === "target" && flashOf(t, "target", sh.index) > 0) {
      g.save();
      g.lineCap = "round";
      g.strokeStyle = "#ffffff";
      g.lineWidth = sh.r * 2;
      g.beginPath();
      g.moveTo(sh.ax, sh.ay);
      g.lineTo(sh.bx, sh.by);
      g.stroke();
      g.restore();
    }
  }
  // Chevrons up the middle chase towards the bumpers.
  const mid = L.mirror ? TABLE_W - 500 : 500;
  const lit = Math.floor(time * 7) % (CHEVRONS.length + 2);
  CHEVRONS.forEach((y, i) => {
    if (CHEVRONS.length - 1 - i !== lit) return;
    g.save();
    g.translate(mid, y);
    glow(g, soft, s.color, 18);
    g.fillStyle = withAlpha(s.color, 0.9);
    g.beginPath();
    g.moveTo(0, -30);
    g.lineTo(21, 15);
    g.lineTo(0, 4.5);
    g.lineTo(-21, 15);
    g.closePath();
    g.fill();
    g.restore();
  });
  // Outlane posts (a posts gift).
  for (const p of L.posts) {
    if (!p.on) continue;
    g.save();
    g.lineCap = "round";
    g.strokeStyle = "#6cf7a0";
    g.lineWidth = p.r * 2;
    g.beginPath();
    g.moveTo(p.ax, p.ay);
    g.lineTo(p.bx, p.by);
    g.stroke();
    g.restore();
  }
  // Spinner: a plate seen edge on as it turns.
  const sp = L.gates.find((x) => x.tag === "spinner");
  if (sp) {
    const cx = (sp.ax + sp.bx) / 2;
    const half = Math.abs(sp.bx - sp.ax) / 2;
    const k = Math.abs(Math.cos(t.spinner.angle));
    g.save();
    g.fillStyle = withAlpha(RAIL, 0.35);
    g.fillRect(cx - half - 8, sp.ay - 4, 8, 8);
    g.fillRect(cx + half, sp.ay - 4, 8, 8);
    g.fillStyle = t.spinner.speed > 1 ? "#ffffff" : withAlpha(AMBER, 0.85);
    g.fillRect(cx - half, sp.ay - 3 - 14 * k, half * 2, 6 + 28 * k);
    g.restore();
  }
  // Plunger rod.
  const z = L.plunger.zone;
  const tipY = L.plunger.tip.ay;
  g.save();
  g.fillStyle = "#9aa6c4";
  g.fillRect(z.x0 + 14, tipY, z.x1 - z.x0 - 28, 10);
  g.strokeStyle = withAlpha(RAIL, 0.5);
  g.lineWidth = 4;
  g.beginPath();
  const cx = (z.x0 + z.x1) / 2;
  for (let i = 0; i <= 10; i++) {
    const y = tipY + 10 + ((TABLE_H - tipY - 10) * i) / 10;
    g.lineTo(cx + (i % 2 === 0 ? -16 : 16), y);
  }
  g.stroke();
  g.restore();
  // Flippers.
  for (const f of t.world.flippers) {
    const tx = f.px + Math.cos(f.angle) * f.len;
    const ty = f.py + Math.sin(f.angle) * f.len;
    const nx = -Math.sin(f.angle);
    const ny = Math.cos(f.angle);
    g.save();
    g.beginPath();
    g.arc(f.px, f.py, f.r0, 0, Math.PI * 2);
    g.arc(tx, ty, f.r1, 0, Math.PI * 2);
    g.moveTo(f.px + nx * f.r0, f.py + ny * f.r0);
    g.lineTo(tx + nx * f.r1, ty + ny * f.r1);
    g.lineTo(tx - nx * f.r1, ty - ny * f.r1);
    g.lineTo(f.px - nx * f.r0, f.py - ny * f.r0);
    g.closePath();
    g.fillStyle = "#f2f5fa";
    glow(g, soft, s.color, f.held ? 22 : 10);
    g.fill();
    g.restore();
    g.save();
    g.beginPath();
    g.arc(f.px, f.py, f.r0 * 0.45, 0, Math.PI * 2);
    g.fillStyle = s.color;
    g.fill();
    g.restore();
  }
  drawScore(g, s);
  drawGifts(g, s);
  // Balls in tubes, then on the table.
  for (const tb of t.tubes) {
    if (tb.gift) {
      drawGiftIcon(g, tb.gift, tb.x, tb.y, GIFT_R, GIFT_COLOR[tb.gift]);
      continue;
    }
    const c = palette[tb.color % palette.length] ?? s.color;
    ballAt(g, tb.x, tb.y, BALL_R, c);
  }
  for (const b of t.world.balls) {
    const x = b.px + (b.x - b.px) * alpha;
    const y = b.py + (b.y - b.py) * alpha;
    const c = palette[b.color % palette.length] ?? s.color;
    ballAt(g, x, y, b.r, c);
    if (b.hold) heldMark(g, x, y, b.r, b.hold, s.color, soft);
  }
  drawPads(g, s, time);
  if (s.attract) drawAttractFade(g, s);
  drawHud(g, s);
};

const drawLaneArrow = (
  g: CanvasRenderingContext2D,
  L: TableLayout,
  c: string,
  on: number,
  soft: boolean,
) => {
  const dl = L.deckLane;
  const ang = Math.atan2(dl.dir.x, -dl.dir.y);
  const x = dl.mouth.x - dl.dir.x * 70;
  const y = dl.mouth.y - dl.dir.y * 70;
  g.save();
  g.translate(x, y);
  g.rotate(ang);
  g.globalAlpha = on;
  glow(g, soft, c, 26);
  g.fillStyle = c;
  g.beginPath();
  g.moveTo(0, -34);
  g.lineTo(24, 17);
  g.lineTo(0, 5);
  g.lineTo(-24, 17);
  g.closePath();
  g.fill();
  g.restore();
};
