/**
 * The wall's picture: the arcade wall with its neon and the row of cabinets, drawn flat. What
 * never changes (the wall and each cabinet's body, sign, glass back, panel and hatch) is drawn
 * once into a canvas at the back; the claws, prizes, lights and buttons are drawn each frame into
 * a clear canvas in front of it.
 */
import type { Rng } from "../../core/types";
import { MIXES } from "./arcade";
import { type CabinetArt, createCabinetArt } from "./cabinet";
import { DESIGNS } from "./designs";
import { createWallFront } from "./front";
import type { CabinetBox } from "./layout";
import { createSprites, type SpriteSet } from "./plush";
import { themeOf } from "./themes";
import { WALL_PLAY_S, type WallArcade } from "./wallarcade";
import type { Button, WallLayout } from "./walllayout";

type G = CanvasRenderingContext2D;

const NEON = ["#ff4fb8", "#38e8ff", "#b8ff4a", "#a26bff"];

export interface WallScene {
  readonly box: CabinetBox;
  draw(now: number): void;
  dispose(): void;
}

export interface WallSceneOptions {
  arcade: WallArcade;
  back: HTMLCanvasElement;
  live: HTMLCanvasElement;
  /** Canvas px per venue px. */
  px: number;
  rng: Rng;
  pressed(cabinet: number, button: Button): boolean;
}

/** A cabinet's parts in canvas px, from the wall layout in venue px. */
export const wallBox = (l: WallLayout, px: number): CabinetBox => {
  const rows = {} as CabinetBox["rows"];
  for (const [key, [a, b]] of Object.entries(l.rows)) {
    rows[key as keyof CabinetBox["rows"]] = [a * px, b * px];
  }
  const k = l.k * px;
  return {
    k,
    height: l.cabinetH * px,
    bodyW: l.bodyW * px,
    margin: Math.ceil(0.035 * l.scale * px) + 2,
    glass: {
      x: l.pillar * px,
      y: rows.glass[0],
      w: l.play.width * k,
      h: rows.glass[1] - rows.glass[0],
    },
    floorY: rows.glass[1],
    rows,
    scale: l.scale * px,
  };
};

const drawWall = (c: G, l: WallLayout, px: number, W: number, H: number) => {
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#150b2e");
  grad.addColorStop(0.6, "#0f0a24");
  grad.addColorStop(1, "#0a0718");
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);
  // Faint stripes of wallpaper.
  c.fillStyle = "rgba(120,90,200,0.05)";
  const stripe = Math.max(2, 0.012 * l.height * px);
  for (let x = 0; x < W; x += stripe * 2) c.fillRect(x, 0, stripe, H);

  const tube = (x0: number, y0: number, x1: number, y1: number, col: string, w: number) => {
    c.shadowColor = col;
    c.strokeStyle = col;
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    c.strokeStyle = "rgba(255,255,255,0.8)";
    c.lineWidth = w * 0.4;
    c.stroke();
  };
  const star = (cx: number, cy: number, r: number, col: string, w: number) => {
    c.shadowColor = col;
    c.strokeStyle = col;
    c.lineWidth = w;
    c.lineJoin = "round";
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? r * 0.45 : r;
      const x = cx + rr * Math.cos(a);
      const y = cy + rr * Math.sin(a);
      if (k === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    c.stroke();
  };

  const u = l.height * px;
  c.save();
  c.lineCap = "round";
  c.shadowBlur = 0.012 * u;
  // A neon tube along the ceiling.
  tube(0.01 * W, 0.012 * u, 0.99 * W, 0.012 * u, NEON[0]!, Math.max(1.5, 0.004 * u));
  const cabs = l.cabinets;
  const glassTop = (cabs[0]?.y ?? 0) + l.rows.glass[0];
  const glassBottom = (cabs[0]?.y ?? 0) + l.rows.glass[1];
  // Two tubes and a star in each gap between cabinets, and at the ends where there is room.
  const gaps: [number, number][] = [];
  if (cabs.length) gaps.push([0, cabs[0]!.x]);
  for (let i = 0; i + 1 < cabs.length; i++) gaps.push([cabs[i]!.x + l.bodyW, cabs[i + 1]!.x]);
  if (cabs.length) gaps.push([cabs[cabs.length - 1]!.x + l.bodyW, l.width]);
  gaps.forEach(([a, b], i) => {
    const gap = b - a;
    if (gap < 0.05 * l.height) return;
    const mid = ((a + b) / 2) * px;
    const colour = NEON[i % NEON.length]!;
    const other = NEON[(i + 2) % NEON.length]!;
    const w = Math.max(1.5, 0.006 * u);
    for (const [dx, col] of [
      [-0.28, colour],
      [0.28, other],
    ] as const) {
      const x = mid + dx * gap * px;
      tube(x, glassTop * px, x, glassBottom * px, col, w);
    }
    const r = Math.min(0.06 * u, gap * px * 0.2);
    star(mid, ((glassTop + glassBottom) / 2) * px, r, other, w);
  });
  // Above short cabinets, a few stars along the top.
  const free = cabs[0]?.y ?? 0;
  if (free > 0.12 * l.height) {
    const n = cabs.length * 2 + 1;
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * W;
      const y = (0.025 * l.height + free * 0.5) * px;
      star(
        x,
        y,
        Math.min(0.05 * u, free * px * 0.25),
        NEON[i % NEON.length]!,
        Math.max(1.5, 0.005 * u),
      );
    }
  }
  c.restore();
  // The skirting, and a shadow on the floor under each cabinet.
  const sk = 0.012 * u;
  c.fillStyle = "#07050f";
  c.fillRect(0, H - sk, W, sk);
  c.fillStyle = "rgba(255,255,255,0.08)";
  c.fillRect(0, H - sk, W, Math.max(1, 0.002 * u));
  for (const cab of cabs) {
    const x = cab.x * px;
    const w = l.bodyW * px;
    const g = c.createRadialGradient(x + w / 2, H, 0, x + w / 2, H, w * 0.6);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(x - w * 0.2, H - 0.05 * u, w * 1.4, 0.05 * u);
  }
};

export const createWallScene = (o: WallSceneOptions): WallScene => {
  const { arcade, back, live, px } = o;
  const layout = arcade.layout;
  const W = back.width;
  const H = back.height;
  const box = wallBox(layout, px);
  const sprites: SpriteSet = createSprites(Math.max(4, box.k));
  const bg = back.getContext("2d");
  const g = live.getContext("2d");

  const fronts = layout.cabinets.map((c, i) => {
    const local = (b: Button) => {
      const p = c.buttons[b];
      return { x: (p.x - c.x) * px, y: (p.y - c.y) * px, r: p.r * px };
    };
    return createWallFront({
      theme: themeOf(i),
      box,
      place: {
        buttons: { left: local("left"), right: local("right"), drop: local("drop") },
        timer: {
          x: (c.timer.x - c.x) * px,
          y: (c.timer.y - c.y) * px,
          width: c.timer.width * px,
          height: c.timer.height * px,
        },
        hatch: {
          x: (c.hatch.x - c.x) * px,
          y: (c.hatch.y - c.y) * px,
          width: c.hatch.width * px,
          height: c.hatch.height * px,
        },
        s: layout.button * px,
      },
      seat: arcade.seats[i]!,
      pressed: (b) => o.pressed(i, b),
      sprites,
      playLimit: WALL_PLAY_S,
    });
  });
  const arts: CabinetArt[] = layout.cabinets.map((c, i) => {
    const mix = MIXES[i % MIXES.length]!;
    const rng = o.rng.fork(`cabinet-${i}`);
    return createCabinetArt({
      theme: themeOf(i),
      box,
      machine: arcade.machines[i]!,
      sprites,
      mix,
      colours: (d) => rng.int(DESIGNS[d].colourways.length),
      rng,
      front: fronts[i],
      glassLive: true,
    });
  });

  if (bg) {
    drawWall(bg, layout, px, W, H);
    layout.cabinets.forEach((c, i) => arts[i]!.drawStatic(bg, c.x * px, c.y * px));
  }

  return {
    box,
    draw(now) {
      if (!g) return;
      g.clearRect(0, 0, W, H);
      layout.cabinets.forEach((c, i) => arts[i]!.drawLive(g, c.x * px, c.y * px, { now, door: 0 }));
    },
    dispose() {
      for (const a of arts) a.dispose();
      for (const f of fronts) f.dispose();
      sprites.dispose();
    },
  };
};
