/**
 * Pre-rendered balls: one shaded sprite per answer colour and shade, a soft glow per colour for
 * balls whooshing through pipes, and a lattice tile per colour for the packed part of a column.
 * All are drawn at a reference radius and scaled.
 */

export const SHADES = 3;

const hexRgb = (hex: string): [number, number, number] => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

const mix = (c: [number, number, number], to: number, f: number) =>
  `rgb(${c.map((v) => Math.round(v + (to - v) * f)).join(",")})`;

const canvasOf = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
};

/** Shades lighten or darken the base colour a little so a pile isn't flat. */
const SHADE_SHIFT = [0, 0.14, -0.12];

const drawBall = (
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  hex: string,
  shade: number,
) => {
  const base = hexRgb(hex);
  const s = SHADE_SHIFT[shade] ?? 0;
  const body: [number, number, number] =
    s >= 0
      ? (base.map((v) => v + (255 - v) * s) as [number, number, number])
      : (base.map((v) => v * (1 + s)) as [number, number, number]);
  const grad = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.08, x, y, r);
  grad.addColorStop(0, mix(body, 255, 0.75));
  grad.addColorStop(0.28, mix(body, 255, 0.12));
  grad.addColorStop(0.78, mix(body, 0, 0.12));
  grad.addColorStop(1, mix(body, 0, 0.45));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
};

export interface Sprites {
  /** Reference radius the sprites were drawn at, canvas px. */
  readonly radius: number;
  ball(color: number, shade: number): HTMLCanvasElement;
  /** A glow three radii across, centred. */
  glow(color: number): HTMLCanvasElement;
  /**
   * One row of a lattice kind: three balls across (centres at R + 2Ri) halfway down a tile two
   * lattice rows high, so it repeats onto every other row.
   */
  tile(color: number): HTMLCanvasElement;
  dispose(): void;
}

export const createSprites = (colors: readonly string[], radius: number): Sprites => {
  const R = Math.max(4, Math.min(96, Math.ceil(radius)));
  const balls: HTMLCanvasElement[][] = colors.map((hex) =>
    Array.from({ length: SHADES }, (_, shade) => {
      const c = canvasOf(2 * R + 2, 2 * R + 2);
      const g = c.getContext("2d");
      if (g) drawBall(g, R + 1, R + 1, R, hex, shade);
      return c;
    }),
  );
  const glows: HTMLCanvasElement[] = colors.map((hex) => {
    const c = canvasOf(6 * R, 6 * R);
    const g = c.getContext("2d");
    if (!g) return c;
    const [r, gr, b] = hexRgb(hex);
    const grad = g.createRadialGradient(3 * R, 3 * R, R * 0.5, 3 * R, 3 * R, 3 * R);
    grad.addColorStop(0, `rgba(${r},${gr},${b},0.55)`);
    grad.addColorStop(0.45, `rgba(${r},${gr},${b},0.18)`);
    grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 6 * R, 6 * R);
    return c;
  });
  const tiles: HTMLCanvasElement[] = colors.map((hex) => {
    const w = 6 * R;
    const h = Math.round(2 * Math.sqrt(3) * R);
    const c = canvasOf(w, h);
    const g = c.getContext("2d");
    if (!g) return c;
    // Balls past the edges too, so neighbouring tiles complete each other's halves.
    for (let i = -1; i <= 3; i++)
      drawBall(g, R + 2 * R * i, h / 2, R * 0.97, hex, (i + 3) % SHADES);
    return c;
  });
  return {
    radius: R,
    ball: (color, shade) => balls[color % balls.length]![shade % SHADES]!,
    glow: (color) => glows[color % glows.length]!,
    tile: (color) => tiles[color % tiles.length]!,
    dispose() {
      for (const set of balls) for (const c of set) c.width = c.height = 0;
      for (const c of [...tiles, ...glows]) c.width = c.height = 0;
    },
  };
};
