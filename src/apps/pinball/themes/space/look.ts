/**
 * Space's look: a deep-space playfield with neon inserts, metal rails, chrome balls reflecting a
 * dark room, its toys in 3D (table3d.ts) and its deck skin (deck3d.ts).
 */
import { TABLE_H, TABLE_W } from "../../config";
import type { ThemeLook } from "../../view3d/look";
import type { SpaceMiddle } from ".";
import { neonArrow, neonRing, paintSpace } from "./art";
import { spaceDeck } from "./deck3d";
import { spaceTable } from "./table3d";

const look: ThemeLook = {
  id: "space",
  palette: {
    cabinet: "#04050d",
    fieldTop: "#0a1036",
    fieldLow: "#04050f",
    rail: "#c9d6ea",
    lamp: "#ffcc33",
    lampOff: "#1c2348",
    glass: "#7fd7ff",
    plastic: "#f2f5fa",
    envRoom: "#8a96c0",
    envField: "#232c6e",
    envLight: "#ffffff",
  },
  playfield(g, layout, color) {
    const m = layout.middle as SpaceMiddle;
    paintSpace(g, TABLE_W, TABLE_H, layout.mirror ? 12 : 11, { scale: 1.3 });
    // The moons' orbit, the black hole's reach, the landing pad's rings.
    neonRing(g, m.orbit.x, m.orbit.y, m.orbit.radius, "#5fd4ff", 3, 16);
    neonRing(g, m.hole.x, m.hole.y, m.hole.disc + 16, "#b06bff", 3, 10);
    neonRing(g, m.pad.x, m.pad.y, 40, color, 3);
    neonRing(g, m.pad.x, m.pad.y, 20, color, 2);
    // Chevrons leading into the pad, the black hole and the asteroids.
    const lead = (x: number, y: number, tx: number, ty: number, c: string) => {
      const a = Math.atan2(ty - y, tx - x);
      for (let i = 0; i < 3; i++) {
        neonArrow(g, x + Math.cos(a) * i * 40, y + Math.sin(a) * i * 40, a, 20, c);
      }
    };
    lead(m.pad.x - (m.mirror ? -1 : 1) * 70, m.pad.y + 200, m.pad.x, m.pad.y, color);
    lead(m.hole.x - (m.mirror ? -1 : 1) * 40, m.hole.y + 170, m.hole.x, m.hole.y, "#b06bff");
    const mid = m.asteroids[1]!;
    const ax = (mid.ax + mid.bx) / 2;
    const ay = (mid.ay + mid.by) / 2;
    lead(ax + (m.mirror ? -1 : 1) * 150, ay + 150, ax, ay, "#ffb37a");
    // A star under each top lane.
    for (const p of m.lanes) {
      g.save();
      g.translate(p.x, p.y);
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 38 : 16;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
      g.strokeStyle = "rgba(255,204,51,0.6)";
      g.lineWidth = 3;
      g.stroke();
      g.restore();
    }
  },
  table: spaceTable,
  deck: spaceDeck,
};

export default look;
