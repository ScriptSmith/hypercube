/**
 * Pre-drawn images for things drawn many times a frame. Blurs and big text are slow to draw
 * on a canvas every frame at wall size, but drawing a small image scaled up is cheap.
 */
import { FONT, withAlpha } from "../../core/ui";

const GLOW_PX = 128;
const MAX_TEXT = 48;

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

export interface Sprites {
  /** A soft round glow in `color`, to be drawn centred and scaled to the radius wanted. */
  glow(color: string): HTMLCanvasElement;
  /**
   * `text` in a heavy face at `px` tall (device px), cached. The image is 1.4 × px tall.
   * `outline` draws a bright outline over a light fill, for numbers that sit under play.
   */
  text(text: string, color: string, px: number, outline?: boolean): HTMLCanvasElement;
  clear(): void;
}

export const createSprites = (): Sprites => {
  const glows = new Map<string, HTMLCanvasElement>();
  // Insertion order doubles as recency: a hit is moved to the end, the oldest goes first.
  const texts = new Map<string, HTMLCanvasElement>();

  return {
    glow(color) {
      let c = glows.get(color);
      if (c) return c;
      c = canvas(GLOW_PX, GLOW_PX);
      const g = c.getContext("2d");
      if (g) {
        const r = GLOW_PX / 2;
        const grad = g.createRadialGradient(r, r, 0, r, r, r);
        grad.addColorStop(0, withAlpha(color, 0.9));
        grad.addColorStop(0.25, withAlpha(color, 0.45));
        grad.addColorStop(0.6, withAlpha(color, 0.12));
        grad.addColorStop(1, withAlpha(color, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, GLOW_PX, GLOW_PX);
      }
      glows.set(color, c);
      return c;
    },
    text(text, color, px, outline = false) {
      const size = Math.max(4, Math.round(px));
      const key = `${text}|${color}|${size}|${outline}`;
      const hit = texts.get(key);
      if (hit) {
        texts.delete(key);
        texts.set(key, hit);
        return hit;
      }
      const font = `900 ${size}px ${FONT}`;
      const probe = canvas(1, 1).getContext("2d");
      if (probe) probe.font = font;
      const width = (probe?.measureText(text).width ?? size * 0.6 * text.length) + size * 0.2;
      const c = canvas(width, size * 1.4);
      const g = c.getContext("2d");
      if (g) {
        g.font = font;
        g.textAlign = "center";
        g.textBaseline = "middle";
        const x = c.width / 2;
        const y = c.height / 2 + size * 0.04;
        if (outline) {
          g.fillStyle = withAlpha(color, 0.12);
          g.fillText(text, x, y);
          g.strokeStyle = color;
          g.lineWidth = Math.max(1, size * 0.045);
          g.lineJoin = "round";
          g.strokeText(text, x, y);
        } else {
          g.fillStyle = color;
          g.fillText(text, x, y);
        }
      }
      texts.set(key, c);
      while (texts.size > MAX_TEXT) texts.delete(texts.keys().next().value!);
      return c;
    },
    clear() {
      glows.clear();
      texts.clear();
    },
  };
};
