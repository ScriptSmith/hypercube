/**
 * Fitting an answer's words inside a face of the die: an equilateral triangle, corner up, with
 * circumradius 1 round its centre (corners at (0, 1) and (±√3/2, -1/2), y up). Words break into
 * one to three lines, whichever lets the text be largest, up to a cap so short answers don't
 * shout.
 */

export interface FaceLine {
  text: string;
  /** Height of the line's middle, face units. */
  y: number;
}

export interface FaceLayout {
  /** Font size, face units. */
  size: number;
  lines: FaceLine[];
}

export interface LayoutOptions {
  /** Inset from every edge, face units. */
  margin: number;
  /** Largest font size, face units. */
  maxSize: number;
  /** Line spacing and the height of a line's box, as multiples of the font size. */
  leading: number;
  box: number;
}

export const FACE_LAYOUT: LayoutOptions = { margin: 0.1, maxSize: 0.3, leading: 1.02, box: 0.84 };

const SQRT3 = Math.sqrt(3);
/** Heights to try for the text block's middle, nearest the face's visual middle first. */
const CENTRES = Array.from({ length: 17 }, (_, k) => -0.3 + (k / 16) * 0.4).sort(
  (a, b) => Math.abs(a + 0.08) - Math.abs(b + 0.08),
);

/** Half the inset triangle's width at height `y`, or -1 below its base. */
export const halfWidth = (y: number, margin: number): number => {
  if (y < -0.5 + margin) return -1;
  return (1 - 2 * margin - y) / SQRT3;
};

const splits = (words: string[], lines: number): string[][] => {
  if (lines === 1) return [[words.join(" ")]];
  const out: string[][] = [];
  for (let i = 1; i < words.length; i++) {
    for (const rest of splits(words.slice(i), lines - 1))
      out.push([words.slice(0, i).join(" "), ...rest]);
  }
  return out;
};

/** Whether `lines` at `size`, centred on `centre`, fit the inset triangle. */
const fits = (
  lines: string[],
  size: number,
  centre: number,
  measure: (s: string) => number,
  o: LayoutOptions,
): boolean => {
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    const y = centre + ((n - 1) / 2 - i) * o.leading * size;
    const top = y + (o.box * size) / 2;
    const bottom = y - (o.box * size) / 2;
    if (halfWidth(bottom, o.margin) < 0) return false;
    const w = halfWidth(top, o.margin);
    if (w <= 0 || (measure(lines[i]!) * size) / 2 > w) return false;
  }
  return true;
};

/**
 * Lay out `text`. `measure` gives a string's width at font size 1. Ties go to fewer lines, so a
 * phrase breaks only when that makes it larger.
 */
export const layoutFace = (
  text: string,
  measure: (s: string) => number,
  o: LayoutOptions = FACE_LAYOUT,
): FaceLayout => {
  const words = text.split(/\s+/).filter(Boolean);
  let best: FaceLayout = { size: 0, lines: [] };
  for (let n = 1; n <= Math.min(3, words.length); n++) {
    let mine: FaceLayout = { size: 0, lines: [] };
    for (const lines of splits(words, n)) {
      // A lone letter on a line reads as a stray mark.
      if (lines.some((l) => l.length < 2)) continue;
      for (const centre of CENTRES) {
        let lo = 0;
        let hi = o.maxSize;
        if (fits(lines, hi, centre, measure, o)) lo = hi;
        else {
          for (let it = 0; it < 24; it++) {
            const mid = (lo + hi) / 2;
            if (fits(lines, mid, centre, measure, o)) lo = mid;
            else hi = mid;
          }
        }
        if (lo > mine.size + 1e-9) {
          mine = {
            size: lo,
            lines: lines.map((t, i) => ({
              text: t,
              y: centre + ((lines.length - 1) / 2 - i) * o.leading * lo,
            })),
          };
        }
      }
    }
    if (mine.size > best.size * 1.04) best = mine;
  }
  return best;
};
