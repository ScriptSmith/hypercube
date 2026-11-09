/**
 * The arcade strip: the wall, the cabinets and the prizes on their way out, drawn into one canvas
 * that `Strip.draw` wraps round the ball. Everything that never changes (the wall and each
 * cabinet's body, sign, glass back and controls' bezels) is drawn once into a background; each
 * frame copies that and draws the live parts on top.
 */
import { createStrip, type SphereMap, type Strip, wrapOffsets } from "../../core/sphere";
import type { Rng, SphereInfo } from "../../core/types";
import type { Arcade } from "./arcade";
import { MIXES } from "./arcade";
import { type CabinetArt, createCabinetArt } from "./cabinet";
import { DESIGNS } from "./designs";
import { cabinetBox, type CabinetBox } from "./layout";
import { blitSprite, createSprites, type SpriteSet } from "./plush";
import { themeOf } from "./themes";

const MAX_WIDTH = 8192;
const NEON = ["#ff4fb8", "#38e8ff", "#b8ff4a", "#a26bff"];

export interface StripScene {
  readonly strip: Strip;
  readonly canvas: HTMLCanvasElement;
  readonly box: CabinetBox;
  /** Draw this frame's strip. */
  draw(now: number): void;
  /** Copy it onto the feed. */
  paint(fg: CanvasRenderingContext2D, map: SphereMap): void;
  dispose(): void;
}

export interface SceneOptions {
  arcade: Arcade;
  sphere: SphereInfo;
  feedWidth: number;
  rng: Rng;
}

const canvas2d = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d")];
};

/** How far open cabinet `cabinet`'s door is at `now`, from the prizes coming out of it. */
const doorOpen = (arcade: Arcade, cabinet: number, now: number): number => {
  let open = 0;
  for (const f of arcade.heap.flights) {
    if (f.cabinet !== cabinet) continue;
    const p = arcade.heap.pose(f, now);
    if (p.stage === "door") open = Math.max(open, p.k);
    else if (p.stage === "fall") {
      // Swinging shut behind it.
      open = Math.max(open, 1 - Math.max(0, Math.min(1, (p.k - 0.5) * 2)));
    }
  }
  return open;
};

export const createStripScene = (o: SceneOptions): StripScene => {
  const { arcade } = o;
  const layout = arcade.layout;
  const W = Math.max(256, Math.min(MAX_WIDTH, Math.round(o.feedWidth)));
  const strip = createStrip(o.sphere, W, layout.top, layout.bottom);
  const H = Math.max(8, Math.ceil(strip.height));
  const box = cabinetBox(layout, W);
  const sprites: SpriteSet = createSprites(Math.max(4, box.k));
  const [canvas, g] = canvas2d(W, H);
  const [back, bg] = canvas2d(W, H);
  const cabY = H - box.height;

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
    });
  });
  const cabX = layout.cabinets.map((c) => c.centre * W - box.bodyW / 2);
  const offsets = cabX.map((x) => wrapOffsets(x - box.margin, x + box.bodyW + box.margin, W));

  const drawWall = (c: CanvasRenderingContext2D) => {
    c.fillStyle = (() => {
      const grad = c.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#150b2e");
      grad.addColorStop(0.6, "#0f0a24");
      grad.addColorStop(1, "#0a0718");
      return grad;
    })();
    c.fillRect(0, 0, W, H);
    // Faint stripes of wallpaper.
    c.fillStyle = "rgba(120,90,200,0.05)";
    const stripe = Math.max(2, 0.03 * H);
    for (let x = 0; x < W; x += stripe * 2) c.fillRect(x, 0, stripe, H);
    // Neon in each gap between cabinets: two tubes and a star.
    const n = layout.cabinets.length;
    for (let i = 0; i < n; i++) {
      const right = cabX[i]! + box.bodyW;
      let next = cabX[(i + 1) % n]!;
      if (next < right) next += W;
      const gap = next - right;
      if (gap < 0.05 * H) continue;
      const mid = right + gap / 2;
      const colour = NEON[i % NEON.length]!;
      const other = NEON[(i + 2) % NEON.length]!;
      c.save();
      c.lineCap = "round";
      c.shadowBlur = 0.03 * H;
      for (const [dx, col] of [
        [-0.32, colour],
        [0.32, other],
      ] as const) {
        const x = mid + dx * gap;
        for (const off of wrapOffsets(x - 0.05 * H, x + 0.05 * H, W)) {
          c.shadowColor = col;
          c.strokeStyle = col;
          c.lineWidth = Math.max(1.5, 0.008 * H);
          c.beginPath();
          c.moveTo(x + off, 0.16 * H);
          c.lineTo(x + off, 0.8 * H);
          c.stroke();
          c.strokeStyle = "rgba(255,255,255,0.8)";
          c.lineWidth = Math.max(0.75, 0.003 * H);
          c.stroke();
        }
      }
      const r = Math.min(0.09 * H, gap * 0.22);
      for (const off of wrapOffsets(mid - r, mid + r, W)) {
        c.shadowColor = other;
        c.strokeStyle = other;
        c.lineWidth = Math.max(1.5, 0.007 * H);
        c.lineJoin = "round";
        c.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const rr = k % 2 ? r * 0.45 : r;
          const x = mid + off + rr * Math.cos(a);
          const y = 0.45 * H + rr * Math.sin(a);
          if (k === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.closePath();
        c.stroke();
      }
      c.restore();
    }
    // The skirting where the wall meets the floor.
    c.fillStyle = "#07050f";
    c.fillRect(0, H - 0.02 * H, W, 0.02 * H);
    c.fillStyle = "rgba(255,255,255,0.08)";
    c.fillRect(0, H - 0.02 * H, W, Math.max(1, 0.002 * H));
  };

  if (bg) {
    drawWall(bg);
    arts.forEach((art, i) => {
      for (const dx of offsets[i]!) art.drawStatic(bg, cabX[i]! + dx, cabY);
    });
  }

  const glassCos = Math.cos(layout.glassLat);

  const drawFlights = (c: CanvasRenderingContext2D, now: number) => {
    for (const f of arcade.heap.flights) {
      const p = arcade.heap.pose(f, now);
      if (p.stage !== "door" && p.stage !== "fall") continue;
      const sp = sprites.get(f.design, f.colour);
      const size = (glassCos / Math.cos(p.lat)) * (p.stage === "door" ? 0.55 + 0.45 * p.out : 1);
      const x = strip.x(p.lon);
      const y = strip.y(p.lat);
      const r = Math.max(sp.canvas.width, sp.canvas.height) * size;
      for (const dx of wrapOffsets(x - r, x + r, W)) blitSprite(c, sp, x + dx, y, p.turn, size);
    }
  };

  return {
    strip,
    canvas,
    box,
    draw(now) {
      if (!g) return;
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.drawImage(back, 0, 0);
      arts.forEach((art, i) => {
        const door = doorOpen(arcade, i, now);
        for (const dx of offsets[i]!) art.drawLive(g, cabX[i]! + dx, cabY, { now, door });
      });
      drawFlights(g, now);
    },
    paint(fg, map) {
      strip.draw(fg, canvas, map);
    },
    dispose() {
      for (const a of arts) a.dispose();
      sprites.dispose();
      canvas.width = canvas.height = 0;
      back.width = back.height = 0;
    },
  };
};

/** The neon tube along the top of the wall, linear colour. */
export const NEON_LINEAR = [0.9, 0.12, 0.5] as const;
