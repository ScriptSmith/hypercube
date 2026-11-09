import type { FrameKind } from "../../core/types";
import type { Direction } from "./layout";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameGeometry {
  kind: FrameKind;
  width: number;
  height: number;
  unit: number;
  /** Stage y of the top of adult reach. */
  reachTop: number;
  seams: readonly number[];
  /** False hands the card's space to the viewer. */
  card: boolean;
  /** Which edge the reset and layout buttons sit against. Default "right". */
  buttons?: "left" | "right";
}

export interface Regions {
  /** Where the viewer goes, in stage CSS px. */
  viewer: Box;
  /** Where the card for the picked node goes. */
  card: Box;
  /** Text size multiplier for the card. */
  cardScale: number;
  direction: Direction;
  /** A free square (side `RESET_SIZE * unit`) for the reset button, inside reach. */
  reset: Box;
  /** The square above it for the layout button. */
  layout: Box;
  /** A free square of the same size for the Home control, or null for the runtime's default. */
  home: Box | null;
}

/** Venue px. Touch targets are at least 120. */
export const RESET_SIZE = 140;

/**
 * The card for the picked node takes a strip at the foot of a panel or pair, a column beside a
 * kiosk or a wall, and a strip below a screen; the viewer takes the rest, all the height of a
 * wall included (adults reach only its lower part, so the buttons sit there). Without a card
 * the viewer takes all of it. `buttons: "left"` moves the reset and layout buttons to the
 * viewer's left edge, clear of the info panel that docks on the right.
 */
export function regionsFor(f: FrameGeometry): Regions {
  const { width: W, height: H, unit: u } = f;
  const size = RESET_SIZE * u;
  const m = 24 * u;
  const square = (x: number, y: number): Box => ({ x, y, width: size, height: size });
  const none: Box = { x: 0, y: 0, width: 0, height: 0 };
  const above = (b: Box): Box => (b.width > 0 ? { ...b, y: b.y - size - m } : none);
  const left = f.buttons === "left";
  const bottom = H - size - m;
  /** The buttons' column: at the right or left of the first segment of a frame, `x0` to `x1`. */
  const buttons = (x0: number, x1: number) => {
    const reset = square(left ? x0 + m : x1 - size - m, bottom);
    return { reset, layout: above(reset) };
  };
  switch (f.kind) {
    case "wall":
    case "kiosk": {
      const wall = f.kind === "wall";
      const side = f.card ? Math.round((wall ? 0.22 : 0.3) * W) : 0;
      const viewer = { x: side, y: 0, width: W - side, height: H };
      return {
        viewer,
        card: f.card ? { x: 0, y: 0, width: side, height: H } : none,
        cardScale: wall ? 1.9 : 0.9,
        // A short, wide viewer reads better left to right.
        direction: viewer.width / viewer.height > 2.6 ? "right" : "up",
        ...buttons(side, W),
        home: null,
      };
    }
    case "screen": {
      const strip = f.card ? Math.round(0.16 * H) : 0;
      return {
        viewer: { x: 0, y: 0, width: W, height: H - strip },
        card: f.card ? { x: 0.1 * W, y: H - strip, width: 0.8 * W, height: strip } : none,
        cardScale: 2.6,
        direction: "up",
        reset: none,
        layout: none,
        home: null,
      };
    }
    default: {
      const strip = f.card ? Math.round(350 * u) : 0;
      // On a pair the card sits left of the seam, where a pair's two halves never split it.
      const right = f.seams[0] ?? W;
      return {
        viewer: { x: 0, y: 0, width: W, height: H - strip },
        card: f.card ? { x: 0, y: H - strip, width: right, height: strip } : none,
        cardScale: 1,
        direction: "up",
        ...buttons(0, right),
        home: f.card ? square(m, bottom) : null,
      };
    }
  }
}
