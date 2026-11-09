import { describe, expect, it } from "vitest";
import { createRng } from "../../../src/core/rng";
import { sphereInfo } from "../../../src/core/sphere";
import {
  buildLayout,
  CAP_LAT,
  CAP_ROWS,
  GROUT,
  halfWidth,
  locate,
  onMirror,
  PITCH,
  POLE_RADIUS,
  ROWS,
  rowCount,
  TEX_WIDTH,
  TILE,
  TILT,
} from "../../../src/apps/discoball/tiles";

const layout = buildLayout(createRng("discoball:tiles"));
const TAU = 2 * Math.PI;

describe("discoball tiles", { timeout: 60_000 }, () => {
  it("are about 11 cm apart on the default 4 m ball, with grout between", () => {
    const s = sphereInfo();
    expect(PITCH * s.radius).toBeGreaterThan(0.095);
    expect(PITCH * s.radius).toBeLessThan(0.12);
    expect(GROUT * s.radius).toBeGreaterThan(0.008);
    expect(TILE + GROUT).toBeCloseTo(PITCH, 12);
  });

  it("thin out towards both poles, with one round mirror at the bottom and the plate at the top", () => {
    const counts = Array.from({ length: ROWS }, (_, i) => rowCount(i));
    expect(counts[0]).toBe(1);
    for (let i = ROWS - CAP_ROWS; i < ROWS; i++) expect(counts[i]).toBe(0);
    const widest = Math.max(...counts);
    expect(widest).toBeLessThan(TEX_WIDTH);
    expect(widest).toBe(Math.floor(TAU / PITCH - 1e-9));
    for (let i = 1; i < ROWS - CAP_ROWS; i++) {
      // Rows mirror each other about the equator.
      expect(counts[i]).toBe(rowCount(ROWS - 1 - i) || counts[i]);
      if (i < ROWS / 2) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
      if (i < 20) expect(counts[i]!).toBeGreaterThan(counts[i - 1]!);
    }
    expect(layout.count).toBe(counts.reduce((a, b) => a + b, 0));
    expect(CAP_LAT).toBeCloseTo(TAU / 4 - CAP_ROWS * PITCH, 12);
  });

  it("never overlap within a row and leave only grout at the row's middle", () => {
    layout.rows.forEach((row, i) => {
      if (row.count < 2) return;
      const slot = TAU / row.count;
      for (let f = 0; f <= 1; f += 0.125) {
        const lat = row.lat - TILE / 2 + f * TILE;
        // Tile plus grout fits its slot everywhere up the tile.
        expect(2 * halfWidth(row, lat) + GROUT, `row ${i} at ${f}`).toBeLessThanOrEqual(
          slot * Math.cos(lat) + 1e-12,
        );
        // Never narrower than square.
        expect(2 * halfWidth(row, lat)).toBeGreaterThan(TILE * 0.85);
      }
      expect(2 * halfWidth(row, row.lat) + GROUT).toBeCloseTo(slot * Math.cos(row.lat), 12);
    });
  });

  it("find each tile from its centre, and grout between neighbours", () => {
    for (let t = 0; t < layout.count; t += 7) {
      const r = layout.row[t]!;
      const row = layout.rows[r]!;
      const k = layout.index[t]!;
      const slot = TAU / row.count;
      const lon = row.offset + (k + 0.5) * slot - TAU * (k % 2);
      const lat = r === 0 ? -TAU / 4 : row.lat;
      const at = locate(layout, lat, lon);
      expect(at?.row).toBe(r);
      expect(at?.index).toBe(k);
      expect(onMirror(layout, lat, lon)).toBe(true);
      if (r > 0) {
        expect(onMirror(layout, row.lat, row.offset + (k + 1) * slot)).toBe(false);
        expect(onMirror(layout, row.lat + PITCH / 2, lon)).toBe(false);
      }
    }
    expect(onMirror(layout, -TAU / 4 + POLE_RADIUS * 0.9, 1)).toBe(true);
    expect(onMirror(layout, -TAU / 4 + POLE_RADIUS + GROUT * 0.4, 1)).toBe(false);
    expect(locate(layout, CAP_LAT + 0.01, 0)).toBeNull();
  });

  it("tilt each mirror a little at random", () => {
    let sum = 0;
    let most = 0;
    for (let t = 1; t < layout.count; t++) {
      const j = t * 3;
      const dot =
        layout.centre[j]! * layout.normal[j]! +
        layout.centre[j + 1]! * layout.normal[j + 1]! +
        layout.centre[j + 2]! * layout.normal[j + 2]!;
      const angle = Math.acos(Math.min(1, dot));
      sum += angle * angle;
      most = Math.max(most, angle);
      const m = Math.hypot(layout.mirror[j]!, layout.mirror[j + 1]!, layout.mirror[j + 2]!);
      expect(m).toBeCloseTo(1, 9);
      expect(layout.shine[t]!).toBeGreaterThanOrEqual(0.5);
    }
    // Two independent tilts of spread TILT give a mean square angle of 2 TILT^2.
    const rms = Math.sqrt(sum / (layout.count - 1));
    expect(rms).toBeGreaterThan(TILT * 1.2);
    expect(rms).toBeLessThan(TILT * 1.6);
    expect(most).toBeLessThan(6 * (Math.PI / 180));
  });

  it("are the same on every run", () => {
    const again = buildLayout(createRng("discoball:tiles"));
    expect(Array.from(again.normal.slice(0, 300))).toEqual(Array.from(layout.normal.slice(0, 300)));
  });
});
