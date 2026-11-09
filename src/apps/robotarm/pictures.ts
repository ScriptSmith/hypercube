/**
 * The pictures a bank builds on its screen, our own pixel art in the three piece colours.
 * Rows run top to bottom; `B` is blue, `Y` yellow, `P` pink and `.` an empty square. Each
 * picture says how it leaves the screen when it is finished.
 *
 * Pictures are pre-made and the screen chooses where every piece goes, so nobody can arrange
 * anything of their own (rule 4).
 */

export type Exit = "up" | "left" | "right" | "rise";

export interface PictureDef {
  name: string;
  exit: Exit;
  rows: readonly string[];
}

export interface Cell {
  x: number;
  y: number;
  color: number;
}

export interface Picture {
  name: string;
  exit: Exit;
  w: number;
  h: number;
  /** In build order: bottom row first, left to right. */
  cells: Cell[];
}

const COLORS: Record<string, number> = { B: 0, Y: 1, P: 2 };

export const PICTURE_DEFS: readonly PictureDef[] = [
  {
    name: "rocket",
    exit: "up",
    rows: [
      "....P....",
      "...PPP...",
      "..PPPPP..",
      "..BBBBB..",
      "..BYYYB..",
      "..BYBYB..",
      "..BYYYB..",
      "..BBBBB..",
      "..BBBBB..",
      ".PBBBBBP.",
      "PPBBBBBPP",
      "PP.BBB.PP",
      "...YYY...",
      "..YY.YY..",
    ],
  },
  {
    name: "boat",
    exit: "right",
    rows: [
      ".....B......",
      ".....BY.....",
      ".....BYY....",
      ".....BYYY...",
      ".....BYYYY..",
      ".....BYYYYY.",
      ".....B......",
      "PPPPPPPPPPPP",
      ".PPPPPPPPPP.",
      "BBBBBBBBBBBB",
      ".B..B..B..B.",
    ],
  },
  {
    name: "house",
    exit: "rise",
    rows: [
      ".....P.....",
      "....PPP....",
      "...PPPPP...",
      "..PPPPPPP..",
      ".PPPPPPPPP.",
      "..BBBBBBB..",
      "..BYYBYYB..",
      "..BYYBYYB..",
      "..BBBBBBB..",
      "..BBBYBBB..",
      "..BBBYBBB..",
    ],
  },
  {
    name: "fish",
    exit: "left",
    rows: [
      ".....YYY.....",
      "...PPYPPYP..B",
      "..PPPYPPYPPBB",
      ".PBPPYPPYPPBB",
      "PPPPPYPPYPBBB",
      ".PPPPYPPYPPBB",
      "..PPPYPPYPPBB",
      "...PPYPPYP..B",
      ".....YYY.....",
    ],
  },
  {
    name: "robot",
    exit: "up",
    rows: [
      "....Y....",
      "....B....",
      ".BBBBBBB.",
      ".BYYBYYB.",
      ".BBBBBBB.",
      ".BBPPPBB.",
      ".BBBBBBB.",
      "...BBB...",
      "PBBBBBBBP",
      "PBBYBYBBP",
      "PBBBBBBBP",
      "..BB.BB..",
      ".PPP.PPP.",
    ],
  },
  {
    name: "flower",
    exit: "rise",
    rows: [
      "...PPP...",
      "..PPPPP..",
      ".PPYYYPP.",
      ".PPYYYPP.",
      ".PPYYYPP.",
      "..PPPPP..",
      "...PPP...",
      "....B....",
      ".BB.B....",
      "..BBB.BB.",
      "....BBB..",
      "....B....",
    ],
  },
];

export const parsePicture = (def: PictureDef): Picture => {
  const h = def.rows.length;
  const w = Math.max(...def.rows.map((r) => r.length));
  const cells: Cell[] = [];
  for (let y = h - 1; y >= 0; y--) {
    const row = def.rows[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const color = COLORS[row[x] ?? "."];
      if (color !== undefined) cells.push({ x, y, color });
    }
  }
  return { name: def.name, exit: def.exit, w, h, cells };
};

export const PICTURES: readonly Picture[] = PICTURE_DEFS.map(parsePicture);
