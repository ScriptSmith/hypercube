/**
 * Reef's look: a sandy seabed under shallow water, with caustic light sliding over it, reef and
 * seagrass along the walls, its toys in 3D (table3d.ts) and its deck skin (deck3d.ts). Chrome balls
 * reflect a sea-green room.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TABLE_H, TABLE_W } from "../../config";
import type { ThemeLook } from "../../view3d/look";
import type { ReefMiddle } from ".";
import { bubbleArrow, hollow, paintSeabed, scallop } from "./art";
import { reefDeck } from "./deck3d";
import { reefTable } from "./table3d";

const look: ThemeLook = {
  id: "reef",
  palette: {
    cabinet: "#031724",
    fieldTop: "#08344c",
    fieldLow: "#3f7a6c",
    rail: "#cfe9e6",
    lamp: "#ffd27a",
    lampOff: "#123a46",
    glass: "#9fe8ff",
    plastic: "#fff6ea",
    envRoom: "#0f4458",
    envField: "#2f8f8c",
    envLight: "#e2fcff",
  },
  playfield(g, layout, color) {
    const m = layout.middle as ReefMiddle;
    const side = m.mirror ? -1 : 1;
    const X = (x: number) => (m.mirror ? TABLE_W - x : x);
    paintSeabed(g, TABLE_W, TABLE_H, m.mirror ? 22 : 21, {
      sandFrom: 0.26,
      edges: [
        { x: X(36), y0: 900, y1: 1290, dir: side },
        { x: X(960), y0: 820, y1: 1290, dir: -side },
      ],
    });
    // The current: faint ripples across its stretch of water, with no way marked.
    const cb = m.current.box;
    g.save();
    g.strokeStyle = "rgba(200,245,255,0.08)";
    g.lineWidth = 3;
    g.setLineDash([60, 40]);
    for (let y = cb.y0 + 40; y < cb.y1; y += 64) {
      g.beginPath();
      for (let x = cb.x0; x <= cb.x1; x += 16) {
        const yy = y + Math.sin(x * 0.018 + y) * 9;
        if (x === cb.x0) g.moveTo(x, yy);
        else g.lineTo(x, yy);
      }
      g.stroke();
    }
    g.restore();
    // Scallops under the shell lanes.
    for (const p of m.lanes)
      scallop(g, p.x, p.y + 6, 40, "rgba(255,236,214,0.22)", "rgba(255,236,214,0.4)");
    // Hollows under the pufferfish and the clam, and bubbles leading into the clam's mouth.
    for (const c of m.puffers) hollow(g, c.x, c.y, 82, "#ffd27a");
    hollow(g, m.clam.x, m.clam.y, 112, "#e6c8ff");
    const lead = (x: number, y: number, tx: number, ty: number, c: string, n: number) => {
      const a = Math.atan2(ty - y, tx - x);
      for (let i = 0; i < n; i++)
        bubbleArrow(g, x + Math.cos(a) * i * 46, y + Math.sin(a) * i * 46, a, 22, c);
    };
    lead(m.clam.x - side * 170, m.clam.y + 150, m.clam.x - side * 40, m.clam.y + 30, "#e6c8ff", 3);
    // The ramp's shadow on the sand (the light is above the table's top edge), and bubbles
    // leading up into its mouth.
    g.save();
    g.strokeStyle = "rgba(0,22,30,0.2)";
    g.lineWidth = 64;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    m.ramp.path.forEach((p, i) => {
      const y = p.y + (p.z - 26) * 0.45;
      if (i === 0) g.moveTo(p.x, y);
      else g.lineTo(p.x, y);
    });
    g.stroke();
    g.restore();
    const d = m.ramp.dir;
    const mo = m.ramp.mouth;
    lead(mo.x - d.x * 112, mo.y - d.y * 112, mo.x, mo.y, TURTLE_COLOR, 2);
    // A ring of the table's colour round the mouth.
    g.strokeStyle = withAlpha(color, 0.35);
    g.lineWidth = 4;
    g.beginPath();
    g.arc(mo.x, mo.y, m.ramp.half + 20, 0, Math.PI * 2);
    g.stroke();
  },
  table: reefTable,
  deck: reefDeck,
};

const TURTLE_COLOR = "#7dffb8";

export default look;
