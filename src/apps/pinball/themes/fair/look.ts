/**
 * Fun fair's look: a fair at night. Dark boards under a big top's red and cream stripes, warm
 * bulbs, brass bells, chrome balls reflecting a dusky room, its toys in 3D (table3d.ts) and its
 * deck skin (deck3d.ts).
 */
import { TABLE_H, TABLE_W } from "../../config";
import type { ThemeLook } from "../../view3d/look";
import type { FairMiddle } from ".";
import { paintFairField } from "./art";
import { fairDeck } from "./deck3d";
import { fairTable } from "./table3d";

const look: ThemeLook = {
  id: "fair",
  palette: {
    cabinet: "#100610",
    fieldTop: "#2a1414",
    fieldLow: "#160c0e",
    rail: "#e9dcc0",
    lamp: "#ffd98a",
    lampOff: "#3a2026",
    glass: "#ffe2c0",
    plastic: "#fff6e6",
    envRoom: "#b0948a",
    envField: "#5a2a32",
    envLight: "#fff6e4",
  },
  playfield(g, layout, color) {
    paintFairField(g, TABLE_W, TABLE_H, layout.middle as FairMiddle, layout.lamps, color);
  },
  table: fairTable,
  deck: fairDeck,
};

export default look;
