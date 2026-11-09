/**
 * Volcano's look: dark basalt with glowing lava cracks, a lava river down from the volcano, a
 * straw nest and a trail of footprints, its toys in 3D (table3d.ts) and its deck skin (deck3d.ts).
 * Chrome balls reflect a warm, dim room lit by lava.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TABLE_H, TABLE_W } from "../../config";
import type { ThemeLook } from "../../view3d/look";
import type { VolcanoMiddle } from ".";
import { fernSilhouette, footprint, lavaLine, paintRock, stream, wander } from "./art";
import { volcanoDeck } from "./deck3d";
import { EGG_COLORS, volcanoTable } from "./table3d";

const look: ThemeLook = {
  id: "volcano",
  palette: {
    cabinet: "#0c0605",
    fieldTop: "#2b1a16",
    fieldLow: "#120b09",
    rail: "#c8b8aa",
    lamp: "#ffb347",
    lampOff: "#2e1a14",
    glass: "#ffc890",
    plastic: "#f6eee6",
    envRoom: "#6a4a3a",
    envField: "#5a1a0a",
    envLight: "#ffd8a8",
  },
  playfield(g, layout, color) {
    const m = layout.middle as VolcanoMiddle;
    const X = (x: number) => (m.mirror ? TABLE_W - x : x);
    const rnd = stream(m.mirror ? 41 : 40);
    paintRock(g, TABLE_W, TABLE_H, m.mirror ? 7 : 6);
    // Ferns crowd the edges of the rock.
    for (const [x, y, a, l] of [
      [40, 700, -0.5, 150],
      [36, 760, 0.2, 130],
      [70, 1240, -1.2, 120],
      [40, 1190, -0.3, 110],
      [990, 1250, Math.PI + 1.1, 110],
      [470, 140, 0.9, 110],
      [610, 150, Math.PI - 0.8, 100],
    ] as const) {
      fernSilhouette(g, X(x), y, m.mirror ? Math.PI - a : a, l, withAlpha("#1e4a26", 0.75));
    }
    // A lava river from the volcano's foot down the far side, and cracks across the rock.
    const v = m.volcano;
    const river = wander(
      { x: v.x + (m.mirror ? 70 : -70), y: v.y + 100 },
      { x: X(905), y: 1250 },
      22,
      40,
      rnd,
    );
    lavaLine(g, river, 9);
    for (const [a, b, w] of [
      [{ x: 90, y: 860 }, { x: 260, y: 960 }, 3],
      [{ x: 300, y: 1230 }, { x: 520, y: 1160 }, 3],
      [{ x: 560, y: 380 }, { x: 700, y: 330 }, 2.5],
      [{ x: 120, y: 520 }, { x: 60, y: 640 }, 2],
      [{ x: 820, y: 1000 }, { x: 960, y: 1080 }, 3],
    ] as const) {
      lavaLine(g, wander({ x: X(a.x), y: a.y }, { x: X(b.x), y: b.y }, 10, 18, rnd), w);
    }
    // A dark ring of ash round the volcano, and the lava's glow round the ramp's mouth.
    const ash = g.createRadialGradient(v.x, v.y, v.base * 0.8, v.x, v.y, v.base * 1.5);
    ash.addColorStop(0, "rgba(8,5,4,0.85)");
    ash.addColorStop(1, "rgba(8,5,4,0)");
    g.fillStyle = ash;
    g.fillRect(v.x - v.base * 1.6, v.y - v.base * 1.6, v.base * 3.2, v.base * 3.2);
    const mouth = m.ramp.mouth;
    const pool = g.createRadialGradient(mouth.x, mouth.y - 30, 10, mouth.x, mouth.y - 30, 140);
    pool.addColorStop(0, withAlpha("#ff6a1a", 0.55));
    pool.addColorStop(1, withAlpha("#ff6a1a", 0));
    g.fillStyle = pool;
    g.fillRect(mouth.x - 150, mouth.y - 180, 300, 300);
    // The ramp's shadow, falling a little down the playfield as the balls' do.
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    for (const path of [m.ramp.path, m.spill.path]) {
      g.strokeStyle = "rgba(0,0,0,0.38)";
      g.lineWidth = 86;
      g.beginPath();
      path.forEach((p, i) => {
        const y = p.y + p.z * 0.4;
        if (i === 0) g.moveTo(p.x, y);
        else g.lineTo(p.x, y);
      });
      g.stroke();
    }
    g.restore();
    // Chevrons up into the ramp's mouth, in the table's colour.
    for (let i = 0; i < 3; i++) {
      const y = mouth.y + 120 + i * 46;
      g.save();
      g.translate(mouth.x, y);
      g.beginPath();
      g.moveTo(0, -22);
      g.lineTo(26, 12);
      g.lineTo(0, 0);
      g.lineTo(-26, 12);
      g.closePath();
      g.fillStyle = withAlpha(color, 0.22);
      g.fill();
      g.strokeStyle = withAlpha(color, 0.85);
      g.lineWidth = 2.5;
      g.stroke();
      g.restore();
    }
    // The nest's bed of straw, with a ring in each egg's colour under it.
    const n = m.nest;
    g.save();
    g.translate(n.x, n.y);
    g.rotate(Math.atan2(n.along.y, n.along.x));
    const straw = g.createRadialGradient(0, 0, 10, 0, 0, 150);
    straw.addColorStop(0, "rgba(170,130,70,0.75)");
    straw.addColorStop(0.75, "rgba(120,86,44,0.55)");
    straw.addColorStop(1, "rgba(120,86,44,0)");
    g.fillStyle = straw;
    g.beginPath();
    g.ellipse(0, 0, 150, 70, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(220,180,110,0.5)";
    g.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 40 + rnd() * 90;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.45;
      const t = rnd() * Math.PI;
      g.beginPath();
      g.moveTo(x - Math.cos(t) * 14, y - Math.sin(t) * 6);
      g.lineTo(x + Math.cos(t) * 14, y + Math.sin(t) * 6);
      g.stroke();
    }
    g.restore();
    m.eggs.forEach((s, i) => {
      const x = (s.ax + s.bx) / 2;
      const y = (s.ay + s.by) / 2;
      g.strokeStyle = withAlpha(EGG_COLORS[i]!, 0.5);
      g.lineWidth = 3;
      g.beginPath();
      g.ellipse(x, y, 42, 30, Math.atan2(s.by - s.ay, s.bx - s.ax), 0, Math.PI * 2);
      g.stroke();
    });
    // Footprints from the nest up to the dinosaur.
    g.fillStyle = "rgba(10,6,5,0.55)";
    const d = m.dino.body;
    for (let i = 1; i <= 5; i++) {
      const k = i / 6;
      const x = n.x + (d.x - n.x) * k + (i % 2 ? 16 : -16);
      const y = n.y + (d.y - n.y) * k;
      g.save();
      g.translate(x, y);
      g.rotate(Math.atan2(d.y - n.y, d.x - n.x) + Math.PI / 2);
      footprint(g, 0, 0, 40);
      g.restore();
    }
    // A vent under each top lane.
    for (const p of m.lanes) {
      const vent = g.createRadialGradient(p.x, p.y, 4, p.x, p.y, 40);
      vent.addColorStop(0, "rgba(0,0,0,0.9)");
      vent.addColorStop(0.6, "rgba(40,20,14,0.6)");
      vent.addColorStop(1, "rgba(40,20,14,0)");
      g.fillStyle = vent;
      g.fillRect(p.x - 40, p.y - 40, 80, 80);
    }
  },
  table: volcanoTable,
  deck: volcanoDeck,
};

export default look;
