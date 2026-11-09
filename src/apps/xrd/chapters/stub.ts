/**
 * A stand-in chapter: its headline and caption come from the shell as for any chapter, with a
 * placeholder figure (the beam crossing, a ring where a finger lands, fading at once) and one
 * button that shows the "So" line.
 */
import type { Chapter, ChapterDef, ChapterEnv, ChapterState } from "../chapter";
import { TEXT } from "../captions";
import { COLOR } from "../config";
import { button, type Control, pad } from "../controls";
import { beam, glow, label, TAU, well } from "../draw";
import type { ChapterId } from "../ids";
import { type CardLayout, centre, inset, type Rect, square } from "../layout";

const MAX_RINGS = 8;

const placeholder = (g: CanvasRenderingContext2D, r: Rect, t: number, n: number) => {
  well(g, r);
  const c = centre(r);
  const s = Math.min(r.width, r.height);
  for (let i = 0; i < 5; i++) {
    const k = (((t * 0.25 + i / 5) % 1) + 1) % 1;
    g.save();
    g.globalAlpha = (1 - k) * 0.6;
    g.strokeStyle = COLOR.recip;
    g.lineWidth = 6;
    g.beginPath();
    g.arc(c.x, c.y, s * 0.06 + k * s * 0.4, 0, TAU);
    g.stroke();
    g.restore();
  }
  label(g, String(n), c.x, c.y, { size: s * 0.22, color: COLOR.muted, weight: 900 });
};

export const stubChapter = (id: ChapterId): ChapterDef => {
  const text = TEXT[id];
  return {
    id,
    state: [[0, 1]],
    start: [0],
    parts: Object.fromEntries(
      text.maths.formula.flatMap((r) => (r.part ? [[r.part, COLOR.accent] as const] : [])),
    ),
    create(env: ChapterEnv): Chapter {
      let card: CardLayout | null = null;
      let rings: { x: number; y: number; at: number }[] = [];
      let pressed = false;
      const controls: Control[] = [];
      const make = (l: CardLayout) => {
        controls.length = 0;
        const b = l.child;
        const w = Math.min(b.width, 460);
        controls.push(
          button({
            id: "go",
            rect: {
              x: b.x + (b.width - w) / 2,
              y: b.y + (b.height - l.target * 1.2) / 2,
              width: w,
              height: l.target * 1.2,
            },
            band: "child",
            label: text.verb,
            look: "solid",
            color: COLOR.accent,
            size: l.type.label,
            onPress: () => {
              pressed = true;
              env.earn();
            },
          }),
          pad({
            id: "figure",
            rect: l.figure,
            band: "adult",
            onDown: (t) => {
              rings.push({ x: t.x, y: t.y, at: t.time });
              if (rings.length > MAX_RINGS) rings = rings.slice(-MAX_RINGS);
            },
          }),
        );
      };
      return {
        layout(l) {
          card = l;
          make(l);
        },
        get controls() {
          return controls;
        },
        update(_dt, now) {
          rings = rings.filter((r) => now - r.at < 900);
        },
        draw(g, now) {
          if (!card) return;
          const t = now / 1000;
          placeholder(g, square(inset(card.watch, 4)), t, text.number);
          well(g, card.figure);
          const y = card.beamY;
          beam(g, card.figure.x, y, card.figure.x + card.figure.width, y);
          for (const r of rings)
            glow(g, r.x, r.y, 60 + (now - r.at) * 0.12, COLOR.accent, 1 - (now - r.at) / 900);
        },
        numbers: () => [],
        state: (): ChapterState => [pressed ? 1 : 0],
        demo: () => [{ control: "figure" }, { wait: 600 }, { control: "go" }],
        hint() {
          const c = controls[0];
          return c ? centre(c.rect) : null;
        },
        status: () => ({ stub: true }),
        reset() {
          pressed = false;
          rings = [];
        },
        show() {},
        dispose() {
          rings = [];
        },
      };
    },
    watch(g, rect, _state, look) {
      placeholder(g, square(rect), look.now / 1000, text.number);
    },
  };
};
