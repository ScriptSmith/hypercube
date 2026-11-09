/**
 * The die's printing, painted once at mount: the twenty answers, one per triangular face, in a
 * grid of cells four across and five down. Red is the letters, sharp; green their raised height,
 * softened, so the shader can light their bevels; blue a soft shadow just below them. The prompt
 * has a small picture of its own.
 *
 * Each face's triangle has its corner up and its centre at `centre(i)`, with circumradius
 * `radius` px, so face coordinates (circumradius 1, y up) map straight onto the cell.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter } from "three";
import { ANSWERS, PROMPT } from "./answers";
import { layoutFace } from "./layout";

export const COLUMNS = 4;
export const ROWS = 5;
/** The triangle's circumradius and centre within its cell, as shares of the cell. */
const RADIUS = 0.55;
const CENTRE_Y = 0.57;
const FONT = `"Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif`;
const WEIGHT = 700;

export interface Atlas {
  readonly texture: CanvasTexture;
  readonly width: number;
  readonly height: number;
  /** Cell size, px. */
  readonly cell: number;
  /** Face `i`'s triangle centre, as a share of the atlas across and down. */
  centre(i: number): [number, number];
  /** The triangle's circumradius as a share of the atlas across and down. */
  readonly radius: [number, number];
  dispose(): void;
}

/** A cell size for a feed `rows` tall: about one texel per feed pixel on the die's face. */
export const cellFor = (rows: number): number =>
  Math.max(128, Math.min(512, Math.round((rows * 0.21) / 32) * 32));

export const createAtlas = (cell: number): Atlas => {
  const width = COLUMNS * cell;
  const height = ROWS * cell;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  const r = RADIUS * cell;
  const centre = (i: number): [number, number] => [
    (i % COLUMNS) * cell + cell / 2,
    Math.floor(i / COLUMNS) * cell + CENTRE_Y * cell,
  ];

  if (g) {
    const sharp = document.createElement("canvas");
    sharp.width = width;
    sharp.height = height;
    const gs = sharp.getContext("2d");
    if (gs) {
      gs.textAlign = "center";
      gs.textBaseline = "middle";
      gs.fillStyle = "#fff";
      const measure = (s: string) => {
        gs.font = `${WEIGHT} 100px ${FONT}`;
        return gs.measureText(s).width / 100;
      };
      ANSWERS.forEach((a, i) => {
        const [cx, cy] = centre(i);
        const lay = layoutFace(a.text, measure);
        gs.font = `${WEIGHT} ${Math.max(1, lay.size * r).toFixed(1)}px ${FONT}`;
        for (const line of lay.lines) gs.fillText(line.text, cx, cy - line.y * r);
      });
    }
    g.fillStyle = "#000";
    g.fillRect(0, 0, width, height);
    // Each channel is the white letters seen through one colour, added in.
    const add = (filter: string, dy: number, colour: string) => {
      const tint = document.createElement("canvas");
      tint.width = width;
      tint.height = height;
      const gt = tint.getContext("2d");
      if (!gt) return;
      gt.drawImage(sharp, 0, 0);
      gt.globalCompositeOperation = "source-in";
      gt.fillStyle = colour;
      gt.fillRect(0, 0, width, height);
      g.globalCompositeOperation = "lighter";
      g.filter = filter;
      g.drawImage(tint, 0, dy);
      g.filter = "none";
      tint.width = 0;
    };
    add("none", 0, "#f00");
    add(`blur(${(cell * 0.006).toFixed(2)}px)`, 0, "#0f0");
    add(`blur(${(cell * 0.012).toFixed(2)}px)`, cell * 0.01, "#00f");
    g.globalCompositeOperation = "source-over";
    sharp.width = 0;
  }

  const texture = new CanvasTexture(canvas);
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  return {
    texture,
    width,
    height,
    cell,
    centre: (i) => {
      const [x, y] = centre(i);
      return [x / width, y / height];
    },
    radius: [r / width, r / height],
    dispose() {
      texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
};

export interface PromptPicture {
  readonly texture: CanvasTexture;
  dispose(): void;
}

/** The prompt in two lines, white on black, softened as if seen through the liquid. */
export const createPromptPicture = (size: number): PromptPicture => {
  const w = Math.max(256, Math.min(1024, size));
  const h = w / 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (g) {
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    const words = PROMPT.split(" ");
    const lines = [words.slice(0, -1).join(" "), words[words.length - 1]!];
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    let px = h * 0.36;
    g.font = `600 ${px}px ${FONT}`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > w * 0.92) px *= (w * 0.92) / widest;
    g.font = `600 ${px.toFixed(1)}px ${FONT}`;
    g.filter = `blur(${(h * 0.006).toFixed(2)}px)`;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - 0.5) * px * 1.1));
    g.filter = "none";
  }
  const texture = new CanvasTexture(canvas);
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  return {
    texture,
    dispose() {
      texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
};
