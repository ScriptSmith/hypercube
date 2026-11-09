/**
 * The machine stretched along a band: the screen's lower part above a bank, the wall's banner
 * above its columns, or a lone screen. Each part hangs over the chapters that explain it
 * (parts.ts), and a leader line runs from the part down to a bracket over those chapters' frames
 * at the band's bottom edge, with their numbers. The 3D is one view of the frame's layer; the
 * lines and names are drawn by the caller's 2D canvas (`drawOverlay`), in frame venue px.
 */
import { withAlpha } from "../../core/ui/palette";
import { COMMON } from "./captions";
import { COLOR } from "./config";
import { font } from "./controls";
import { disc, label } from "./draw";
import type { Layer3D, View3D } from "./layer3d";
import type { Rect } from "./layout";
import { createMachine3D, type Look3D, type Machine3D } from "./machine3d";
import type { PartId, PartSpot } from "./parts";

export interface Leader {
  part: PartId;
  /** The part's anchor, frame venue px. */
  from: { x: number; y: number };
  /** Where the line meets the bracket: the middle of the part's frames, at the band's bottom. */
  to: { x: number; y: number };
  /** The bracket's ends, frame venue px: the edges of the part's frames. */
  x0: number;
  x1: number;
  numbers: number[];
}

export interface Band {
  readonly machine: Machine3D;
  /** The band (frame venue px) and where the parts go; `leaders` draws lines down to the frames. */
  place(rect: Rect, spots: readonly PartSpot[], leaders: boolean): void;
  update(look: Look3D, now: number): void;
  drawOverlay(
    g: CanvasRenderingContext2D,
    o: { size: number; active: Partial<Record<PartId, unknown>> },
  ): void;
  leaders(): Leader[];
  show(on: boolean): void;
  dispose(): void;
}

/** Bracket height above the band's bottom edge, as a share of the band's height. */
const BRACKET = 0.035;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * A label's box moved as little as it can so it overlaps none placed so far and stays inside
 * `bounds`: first down and up by its own height, then sideways.
 */
export const fit = (want: Box, placed: readonly Box[], bounds: Rect): Box => {
  const clampBox = (b: Box): Box => ({
    ...b,
    x: Math.min(bounds.x + bounds.width - b.w, Math.max(bounds.x, b.x)),
    y: Math.min(bounds.y + bounds.height - b.h, Math.max(bounds.y, b.y)),
  });
  const tries: Box[] = [];
  for (let k = 0; k <= 6; k++) {
    for (const dir of k === 0 ? [0] : [-1, 1])
      tries.push(clampBox({ ...want, y: want.y + dir * k * want.h * 1.05 }));
  }
  for (let k = 1; k <= 6; k++) {
    for (const dir of [1, -1])
      tries.push(clampBox({ ...want, x: want.x + dir * k * want.w * 0.6 }));
  }
  return tries.find((b) => !placed.some((p) => overlaps(p, b))) ?? clampBox(want);
};

export const createBand = (layer: Layer3D): Band => {
  const machine = createMachine3D("band");
  const view: View3D = layer.view(machine.scene, machine.camera);
  let rect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  let spots: readonly PartSpot[] = [];
  let withLeaders = false;
  let shown = true;

  const at = (p: PartId) => spots.find((s) => s.part === p)?.at ?? null;

  return {
    machine,
    place(r, s, leaders) {
      rect = r;
      spots = s;
      withLeaders = leaders;
      view.rect = shown ? r : null;
      machine.setBand(r.width, r.height, {
        tube: at("tube") ?? 0.06,
        sample: at("sample") ?? 0.2,
        detector: at("detector") ?? 0.5,
        computer: at("computer"),
        fibre: at("fibre"),
        cards: at("cards"),
      });
    },
    update(look, now) {
      if (shown) machine.update(look, now);
    },
    leaders() {
      if (!withLeaders) return [];
      const out: Leader[] = [];
      for (const s of spots) {
        if (!s.span) continue;
        const a = machine.anchor(s.part);
        if (!a) continue;
        const x0 = rect.x + s.span.from * rect.width;
        const x1 = rect.x + s.span.to * rect.width;
        out.push({
          part: s.part,
          from: { x: rect.x + a.x, y: rect.y + a.y },
          to: { x: (x0 + x1) / 2, y: rect.y + rect.height },
          x0,
          x1,
          numbers: s.numbers,
        });
      }
      return out;
    },
    drawOverlay(g, o) {
      if (!shown) return;
      const size = o.size;
      const bracketY = rect.y + rect.height * (1 - BRACKET);
      const placed: Box[] = [];
      const bounds: Rect = {
        x: rect.x + size * 0.5,
        y: rect.y + size * 0.5,
        width: rect.width - size,
        height: rect.height - size * 0.5,
      };
      for (const l of this.leaders()) {
        const lit = o.active[l.part] !== undefined;
        const c = lit ? COLOR.accent : withAlpha(COLOR.ink, 0.6);
        // Down from the part, then across to the middle of its frames.
        const midY = Math.max(l.from.y + size * 1.2, bracketY - rect.height * 0.14);
        g.save();
        g.strokeStyle = c;
        g.lineWidth = Math.max(3, size * 0.1);
        g.lineJoin = "round";
        g.beginPath();
        g.moveTo(l.from.x, l.from.y);
        g.lineTo(l.from.x, midY);
        g.lineTo(l.to.x, bracketY);
        g.lineTo(l.to.x, l.to.y);
        g.stroke();
        // The bracket over the frames, its ends at their edges.
        const inset = Math.min((l.x1 - l.x0) * 0.08, size);
        g.beginPath();
        g.moveTo(l.x0 + inset, l.to.y);
        g.lineTo(l.x0 + inset, bracketY);
        g.lineTo(l.x1 - inset, bracketY);
        g.lineTo(l.x1 - inset, l.to.y);
        g.stroke();
        g.restore();
        disc(g, l.from.x, l.from.y, size * 0.2, c);
      }
      // Names (with their chapters' numbers on a bank), laid out so none overlap.
      const items = withLeaders
        ? this.leaders().map((l) => ({
            part: l.part,
            x: l.to.x,
            y: bracketY - size * 1.6,
            numbers: l.numbers,
          }))
        : spots.flatMap((s) => {
            const a = machine.anchor(s.part);
            return a
              ? [{ part: s.part, x: rect.x + a.x, y: rect.y + a.y + size * 1.1, numbers: [] }]
              : [];
          });
      items.sort((a, b) => a.x - b.x);
      for (const it of items) {
        const lit = o.active[it.part] !== undefined;
        const name = COMMON.parts[it.part];
        g.font = font(800, size);
        const w = Math.max(g.measureText(name).width, it.numbers.length * size * 1.45) + size * 0.6;
        const h = size * (it.numbers.length ? 2.6 : 1.3);
        const box = fit({ x: it.x - w / 2, y: it.y - h / 2, w, h }, placed, bounds);
        placed.push(box);
        const cx = box.x + box.w / 2;
        const nameY = box.y + box.h - size * 0.65;
        label(g, name, cx, nameY, { size, color: lit ? COLOR.accent : COLOR.ink, weight: 800 });
        // The chapters' numbers, in badges, so the bank reads as one poster.
        const r = size * 0.55;
        const n = it.numbers.length;
        it.numbers.forEach((num, i) => {
          const x = cx + (i - (n - 1) / 2) * r * 2.6;
          const y = box.y + r;
          disc(g, x, y, r, COLOR.accent);
          label(g, String(num), x, y, { size: r * 1.2, color: COLOR.background, weight: 900 });
        });
      }
    },
    show(on) {
      shown = on;
      view.rect = on ? rect : null;
    },
    dispose() {
      view.dispose();
      machine.dispose();
    },
  };
};
