/** Pieces of scenery more than one scene uses. */
import type { BufferGeometry } from "three";
import type { Rng } from "../../../core/types";
import { type GroundLook, moundGeometry } from "../ground";
import { ball, cyl, Parts, put, ring, SNOW, stone } from "../kit";
import { FOOT_Y, flankRho, type Hills, R, RIM_Y } from "../mound";

/** The mound under a scene, with its hills, and boulders round its flank. */
export const ground = (
  parts: Parts,
  rng: Rng,
  hills: Hills,
  look: Partial<GroundLook> & { boulder?: string } = {},
) => {
  parts.addColored(moundGeometry(hills, look));
  const boulder = look.boulder ?? "#77706a";
  const count = 46;
  for (let i = 0; i < count; i++) {
    const th = ((i + rng.range(-0.35, 0.35)) / count) * Math.PI * 2;
    const s = rng.range(0.05, 0.9);
    const y = RIM_Y + (FOOT_Y - RIM_Y) * s;
    const r = rng.range(0.07, 0.16) * (1 - 0.4 * s);
    // Proud of the flank, but never through the glass, however lumpy.
    const room = R - 0.012 - r * 1.15;
    if (room <= Math.abs(y)) continue;
    const rho = Math.min(flankRho(y) + r * 0.25, Math.sqrt(room * room - y * y));
    const x = rho * Math.sin(th);
    const z = rho * Math.cos(th);
    parts.add(put(stone(rng, r, 1), x, y, z, 0, rng.range(0, 6), 0), boulder, "solid", 0.12);
    // Snow caps the boulders near the top, where it can lie.
    if (s < 0.45) {
      parts.add(
        put(stone(rng, r * 0.85, 1), x, y + r * 0.45, z, 0, rng.range(0, 6), 0, 1, 0.32, 1),
        SNOW,
        "solid",
        0.03,
      );
    }
  }
};

const SKIN = ["#e9c6a1", "#c99367", "#8f5d3d", "#f0d2b6"];
const COATS = ["#3f6fa8", "#b4485c", "#3d8a6d", "#d08a3c", "#6b4f9e", "#2f7e8c"];

/**
 * A small person `h` tall, standing at the origin facing +z, arms out a little, in their own
 * geometry with colours baked in, so they can move as one piece.
 */
export const person = (rng: Rng, h: number, sitting = false): BufferGeometry => {
  const p = new Parts(rng);
  const coat = rng.pick(COATS);
  const hat = rng.pick(COATS.filter((c) => c !== coat));
  const skin = rng.pick(SKIN);
  const legs = "#2d3440";
  const legH = sitting ? h * 0.18 : h * 0.36;
  const bodyH = h * 0.36;
  const head = h * 0.11;
  if (sitting) {
    for (const s of [-1, 1]) {
      p.add(
        put(
          cyl(h * 0.045, h * 0.045, h * 0.22, 6),
          s * h * 0.06,
          legH + 0.01,
          h * 0.1,
          Math.PI / 2,
          0,
          0,
        ),
        legs,
      );
      p.add(put(cyl(h * 0.04, h * 0.04, legH, 6), s * h * 0.06, legH / 2, h * 0.2), legs);
    }
  } else {
    for (const s of [-1, 1]) {
      p.add(put(cyl(h * 0.04, h * 0.05, legH, 6), s * h * 0.055, legH / 2, 0), legs);
    }
  }
  const by = legH + bodyH / 2;
  p.add(put(cyl(h * 0.1, h * 0.14, bodyH, 9), 0, by, 0), coat, "solid", 0.06);
  for (const s of [-1, 1]) {
    p.add(
      put(cyl(h * 0.035, h * 0.04, h * 0.28, 6), s * h * 0.16, by + h * 0.04, 0, 0, 0, s * 0.9),
      coat,
    );
    p.add(put(ball(h * 0.04, 6, 4), s * h * 0.27, by - h * 0.05, 0), hat);
  }
  p.add(put(ring(h * 0.08, h * 0.03, 10), 0, legH + bodyH, 0, Math.PI / 2, 0, 0), hat);
  p.add(put(ball(head, 10, 7), 0, legH + bodyH + head * 1.05, 0), skin, "solid", 0.02);
  p.add(put(ball(head * 1.05, 10, 6), 0, legH + bodyH + head * 1.35, 0, 0, 0, 0, 1, 0.75, 1), hat);
  p.add(put(ball(head * 0.4, 6, 4), 0, legH + bodyH + head * 2.1, 0), "#f4f1ea");
  return p.merged();
};
