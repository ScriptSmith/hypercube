/**
 * The parts of a table's drawing shared by the 2D view (tableview.ts) and the 3D one
 * (view3d/tableview3d.ts): the scene each frame draws, and the overlay on top of the playfield in
 * table px (pads, the score, gifts running, a held ball's ring, game over and the best today).
 */
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import type { FrameInfo } from "../../core/types";
import { type Gift, TABLE_H, TABLE_W } from "./config";
import { drawGiftIcon, GIFT_COLOR } from "./gifticon";
import type { Box, Control, TablePads } from "./pads";
import type { Table } from "./table";
import type { Place, Region } from "./wallgeo";

const AMBER = "#ffcc33";

export interface TableScene {
  table: Table;
  /** Where the table sits in the frame. */
  place: Place;
  /** On a wall, the table's share of the width, drawn as a faint cabinet behind it (venue px). */
  cell?: Region;
  /** In table px offset by `pads.ox`. */
  pads: TablePads;
  color: string;
  /** Deck shots go to the screen (else round the orbit). */
  deck: boolean;
  attract: boolean;
  /** A bot kept for testing is playing. */
  bot: boolean;
  pressed: ReadonlySet<Control>;
  /** Best score today on this table. */
  best: number;
}

export interface TableView {
  readonly canvas: HTMLCanvasElement;
  /** Size the canvases for the frame, covering `region` (venue px) or the whole frame. */
  resize(frame: FrameInfo, region?: Region): void;
  /** Redraw the static layer before the next frame. */
  invalidate(): void;
  draw(scenes: readonly TableScene[], alpha: number, time: number): void;
  dispose(): void;
}

export const formatScore = (n: number): string => {
  const s = String(Math.max(0, Math.floor(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const playfieldPath = (g: CanvasRenderingContext2D) => {
  g.beginPath();
  g.moveTo(24, TABLE_H);
  g.lineTo(24, 640);
  g.arc(540, 640, 516, Math.PI, Math.PI * 2);
  g.lineTo(1058, TABLE_H);
  g.closePath();
};

/** A ring wide enough to show round a fingertip, and a line to the finger when the ball lags. */
export const heldMark = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  hold: { x: number; y: number },
  tint: string,
  soft: boolean,
) => {
  g.save();
  g.strokeStyle = tint;
  glow(g, soft, tint, 18);
  g.lineWidth = 6;
  g.beginPath();
  g.arc(x, y, r + 22, 0, Math.PI * 2);
  g.stroke();
  const gap = Math.hypot(hold.x - x, hold.y - y);
  if (gap > r * 2) {
    g.globalAlpha = 0.5;
    g.lineWidth = 4;
    g.setLineDash([12, 12]);
    g.beginPath();
    g.moveTo(x + ((hold.x - x) / gap) * (r + 22), y + ((hold.y - y) / gap) * (r + 22));
    g.lineTo(hold.x, hold.y);
    g.stroke();
  }
  g.restore();
};

export const roundRect = (g: CanvasRenderingContext2D, b: Box, r: number) => {
  g.beginPath();
  g.roundRect(b.x, b.y, b.w, b.h, r);
};

/**
 * A glow round what is drawn next: a shadow blur on a panel, nothing on a wall, where five tables'
 * blurs every frame cost the page's main thread about 8 ms (lamps there get a halo instead).
 */
export const glow = (g: CanvasRenderingContext2D, soft: boolean, color: string, blur: number) => {
  if (!soft) return;
  g.shadowColor = color;
  g.shadowBlur = blur;
};

export const flashOf = (t: Table, tag: string, index: number) => {
  const age = t.flashAge(tag, index);
  return age < 0.25 ? 1 - age / 0.25 : 0;
};

export const drawPads = (g: CanvasRenderingContext2D, s: TableScene, time: number) => {
  const p = s.pads;
  const t = s.table;
  const ox = p.ox;
  const live = t.waiting();
  const pulse = s.attract ? 0.5 + 0.5 * Math.sin(time * 3) : 0;
  const pad = (c: Control, b: Box) => {
    const pressed = s.pressed.has(c) || t.world.flippers.some((f) => f.name === c && f.held);
    const local = { x: b.x - ox, y: b.y, w: b.w, h: b.h };
    const inset = 14;
    const box = {
      x: local.x + inset,
      y: local.y + inset,
      w: local.w - inset * 2,
      h: local.h - inset * 2,
    };
    g.save();
    roundRect(g, box, 36);
    g.fillStyle = withAlpha(s.color, pressed ? 0.24 : 0.06 + pulse * 0.08);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = withAlpha(s.color, pressed ? 0.8 : 0.28 + pulse * 0.3);
    g.stroke();
    g.restore();
  };
  pad("upLeft", p.upLeft);
  pad("upRight", p.upRight);
  if (live) {
    // The plunger pad takes its corner of the flipper half.
    const cut = (b: Box): Box => {
      const pl = p.plunger;
      if (pl.x + pl.w <= b.x || pl.x >= b.x + b.w) return b;
      return { x: b.x, y: b.y, w: b.w, h: pl.y - b.y };
    };
    pad("left", cut(p.left));
    pad("right", cut(p.right));
    const pl = p.plunger;
    const box = { x: pl.x - ox + 14, y: pl.y + 14, w: pl.w - 28, h: pl.h - 28 };
    const glow = 0.5 + 0.5 * Math.sin(time * 5);
    g.save();
    roundRect(g, box, 36);
    g.fillStyle = withAlpha(AMBER, s.pressed.has("plunger") ? 0.28 : 0.1 + glow * 0.08);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = withAlpha(AMBER, 0.6 + glow * 0.3);
    g.stroke();
    // Strength bar.
    const fill = t.pull;
    const bar = { x: box.x + box.w / 2 - 22, y: box.y + 36, w: 44, h: box.h - 72 };
    roundRect(g, bar, 22);
    g.fillStyle = withAlpha(AMBER, 0.15);
    g.fill();
    if (fill > 0) {
      g.beginPath();
      g.roundRect(bar.x, bar.y, bar.w, bar.h * fill, 22);
      g.fillStyle = AMBER;
      g.fill();
    }
    // Chevrons pointing down: pull back.
    g.strokeStyle = withAlpha(AMBER, 0.9);
    g.lineWidth = 8;
    g.lineCap = "round";
    for (let i = 0; i < 2; i++) {
      const cy = box.y + box.h - 70 + i * 26;
      g.beginPath();
      g.moveTo(box.x + 34, cy - 12);
      g.lineTo(box.x + 50, cy);
      g.lineTo(box.x + 66, cy - 12);
      g.stroke();
    }
    g.restore();
  } else {
    pad("left", p.left);
    pad("right", p.right);
  }
};

export const GIFT_R = 32;
/** Where each lasting gift shows, inside the top of the arch and clear of the tubes. */
const GIFT_AT: Partial<Record<Gift, number>> = { shield: 405, double: 480, posts: 640 };

/** Gifts running now, each with a ring that runs down until it ends. */
export const drawGifts = (g: CanvasRenderingContext2D, s: TableScene) => {
  const t = s.table;
  if (s.attract) return;
  for (const gift of t.gifts) {
    const at = GIFT_AT[gift.kind];
    if (at === undefined) continue;
    const x = t.layout.mirror ? TABLE_W - at : at;
    const y = 175;
    const left = Math.max(0, Math.min(1, (gift.until - t.world.t) / (gift.until - gift.at)));
    // It swells in as it arrives.
    const grow = Math.min(1, (t.world.t - gift.at) / 0.25);
    drawGiftIcon(g, gift.kind, x, y, GIFT_R * (0.6 + 0.4 * grow), GIFT_COLOR[gift.kind]);
    g.save();
    g.strokeStyle = withAlpha(GIFT_COLOR[gift.kind], 0.9);
    g.lineWidth = 7;
    g.lineCap = "round";
    g.beginPath();
    g.arc(x, y, GIFT_R + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    g.stroke();
    g.restore();
  }
};

/** The score sits in the gap between the adult and child bands, where the player looks. */
export const drawScore = (g: CanvasRenderingContext2D, s: TableScene) => {
  const t = s.table;
  if (s.attract) return;
  const cx = t.layout.mirror ? TABLE_W - 500 : 500;
  g.save();
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = formatScore(t.score);
  const size = text.length > 9 ? 72 : 88;
  g.font = `800 ${size}px ${FONT}`;
  g.globalAlpha = 0.5;
  g.fillStyle = "#000000";
  g.fillText(text, cx + 4, 944);
  g.globalAlpha = 0.92;
  g.fillStyle = "#f2f5fa";
  g.fillText(text, cx, 940);
  // Balls left as balls, then the multiplier.
  const n = Math.max(0, Math.min(5, t.left));
  const mult = t.multiplier > 1 ? `${t.multiplier}x` : "";
  const width = n * 44 + (mult ? 90 : 0);
  let x = cx - width / 2 + 22;
  g.globalAlpha = 0.9;
  for (let i = 0; i < n; i++) {
    g.beginPath();
    g.arc(x, 1012, 14, 0, Math.PI * 2);
    g.fillStyle = i === 0 && t.mode === "play" ? s.color : "#c9d3ea";
    g.fill();
    x += 44;
  }
  if (mult) {
    g.font = `800 44px ${FONT}`;
    g.fillStyle = s.color;
    g.fillText(mult, x + 24, 1014);
  }
  g.restore();
};

export const drawHud = (g: CanvasRenderingContext2D, s: TableScene) => {
  const t = s.table;
  if (t.mode === "over" && !s.attract) {
    g.save();
    g.fillStyle = "rgba(3,4,11,0.72)";
    g.beginPath();
    g.roundRect(120, 700, 840, 470, 48);
    g.fill();
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = s.color;
    g.font = `800 110px ${FONT}`;
    g.fillText(formatScore(t.score), 540, 840);
    g.fillStyle = "#c9d3ea";
    g.font = `700 54px ${FONT}`;
    g.fillText("Best today", 540, 975);
    g.font = `800 72px ${FONT}`;
    g.fillStyle = "#f2f5fa";
    g.fillText(formatScore(Math.max(s.best, t.score)), 540, 1065);
    g.restore();
  }
};

/** Attract play is faded, table by table; on a wall only the playfield, over its cabinet. */
export const drawAttractFade = (g: CanvasRenderingContext2D, s: TableScene) => {
  g.fillStyle = "rgba(3,4,11,0.42)";
  if (s.cell) {
    g.save();
    if (s.table.layout.mirror) {
      g.translate(TABLE_W, 0);
      g.scale(-1, 1);
    }
    playfieldPath(g);
    g.fill();
    g.restore();
  } else {
    g.fillRect(0, 0, TABLE_W, TABLE_H);
  }
};
