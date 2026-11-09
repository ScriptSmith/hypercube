import { describe, expect, it } from "vitest";
import { bankBench, bankChain } from "../../../src/apps/optics/chain";
import {
  type BenchLayout,
  frameLayout,
  PANEL_SIZES,
  WALL_SIZES,
} from "../../../src/apps/optics/layout";
import { buildSky, skySceneOf } from "../../../src/apps/optics/sky";
import { trace } from "../../../src/apps/optics/trace";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { FrameKind } from "../../../src/core/types";
import { DEFAULT_VENUE } from "../../../src/core/venue";

const minGap = (b: BenchLayout) => {
  let m = Infinity;
  for (let i = 0; i < b.sockets.length; i++)
    for (let j = i + 1; j < b.sockets.length; j++) {
      const p = b.sockets[i]!;
      const q = b.sockets[j]!;
      m = Math.min(m, Math.hypot(p.x - q.x, p.y - q.y));
    }
  return m;
};

const layouts: { name: string; kind: FrameKind; benches?: number; bank?: boolean }[] = [
  { name: "panel", kind: "panel" },
  { name: "pair", kind: "pair" },
  { name: "kiosk", kind: "kiosk" },
  { name: "wall x1", kind: "wall", benches: 1 },
  { name: "wall x2", kind: "wall", benches: 2 },
  { name: "wall x3", kind: "wall", benches: 3 },
  { name: "bank panel", kind: "panel", bank: true },
  { name: "bank pair", kind: "pair", bank: true },
];

describe("layout", () => {
  it("sizes pieces, rings and knobs for touch", () => {
    expect(PANEL_SIZES.piece * 2).toBeGreaterThanOrEqual(240);
    expect(PANEL_SIZES.ring * 2).toBeGreaterThanOrEqual(360);
    expect(PANEL_SIZES.knob * 2).toBeGreaterThanOrEqual(120);
    expect(WALL_SIZES.knob * 2).toBeGreaterThanOrEqual(120);
    // The wall is about three times coarser per metre: its pieces are larger in metres.
    const { wall, panel } = DEFAULT_VENUE;
    expect((WALL_SIZES.piece * 2 * wall.widthM) / wall.width).toBeGreaterThan(
      (PANEL_SIZES.piece * 2 * panel.widthM) / panel.width,
    );
  });

  for (const l of layouts) {
    it(`${l.name}: sockets, trays and controls in reach and clear of seams`, () => {
      const f = frameLayout(l.kind, VENUE_SIZE[l.kind], DEFAULT_REACH[l.kind], {
        benches: l.benches,
        bank: l.bank,
      });
      expect(f.benches.length).toBe(l.benches ?? 1);
      for (const b of f.benches) {
        const R = b.sizes.piece;
        expect(b.sockets.length).toBeGreaterThanOrEqual(6);
        if (l.kind !== "wall") expect(minGap(b)).toBeGreaterThanOrEqual(240);
        else expect(minGap(b)).toBeGreaterThanOrEqual(2 * R + 60);
        for (const s of b.sockets) {
          // Inside the bench and within adult reach.
          expect(s.x - R).toBeGreaterThanOrEqual(b.box.x);
          expect(s.x + R).toBeLessThanOrEqual(b.box.x + b.box.width);
          expect(s.y - R * 0.5).toBeGreaterThanOrEqual(b.reachTop);
          expect(s.child).toBe(s.y >= b.childTop);
          for (const seam of b.seams) expect(Math.abs(s.x - seam)).toBeGreaterThanOrEqual(120 + R);
        }
        for (const t of b.trays) {
          for (const seam of b.seams) {
            expect(t.box.x + t.box.width <= seam - 120 || t.box.x >= seam + 120).toBe(true);
          }
          expect(t.box.y).toBeGreaterThanOrEqual(b.reachTop);
          // Children's trays sit in the child band, adults' above it.
          const mid = t.box.y + t.box.height / 2;
          if (t.child) expect(mid).toBeGreaterThanOrEqual(b.childTop);
          else if (b.childTop > b.reachTop + 1) expect(mid).toBeLessThan(b.childTop);
          expect(t.slots.length).toBeGreaterThanOrEqual(2);
        }
        expect(Math.min(b.reset.width, b.reset.height)).toBeGreaterThanOrEqual(120);
        expect(b.reset.y).toBeGreaterThanOrEqual(b.reachTop);
        if (l.kind === "wall") {
          // Everything placed is within adult reach.
          const top = f.H * (1 - DEFAULT_REACH.wall.adult);
          for (const s of b.sockets) expect(s.y - R).toBeGreaterThanOrEqual(top - 10);
          for (const t of b.trays) expect(t.box.y).toBeGreaterThanOrEqual(top);
        }
        if (l.kind === "pair") {
          // Each half has its own trays, filled from the outer edge.
          const halves = new Set(b.trays.map((t) => t.half));
          expect(halves.size).toBe(2);
          const right = b.trays.find((t) => t.half === 1)!;
          expect(right.slots[0]!.x).toBeGreaterThan(right.slots[1]!.x);
        }
        if (l.bank) {
          expect(b.skyLane).not.toBeNull();
          for (const s of b.sockets) expect(b.skyLane! - s.x).toBeGreaterThan(R * 1.6);
        }
      }
    });
  }
});

describe("the screen's sky", () => {
  for (const kind of ["panel", "pair"] as const) {
    it(`hangs a crystal on each ${kind}'s beam, lit by that beam only`, () => {
      const count = kind === "pair" ? 3 : 6;
      const bench = bankBench(kind, kind === "pair" ? 2 : 1);
      let mirrors = 0;
      let shared = 0;
      for (let serial = 0; serial < 4; serial++) {
        const chain = bankChain(
          { seed: "sky", bench, serial, level: "m2", colour: true, count },
          count - 1,
        );
        const sky = buildSky(chain, bench.box.width, count, VENUE_SIZE.screen, `sky:${serial}`);
        expect(sky.crystals.length).toBe(count);
        mirrors += sky.mirrors.length;
        const scene = skySceneOf(sky);
        for (let pos = 0; pos < count; pos++) {
          const t = trace(
            scene,
            sky.intended[pos]!.map((s) => ({ ...s, guide: false })),
          );
          sky.crystals.forEach((c, i) => {
            const lit = (t.real[i] ?? 0) >= c.need;
            if (sky.owners[i] === pos)
              expect(lit, `serial ${serial} frame ${pos} lights its crystal`).toBe(true);
            else if (lit) shared++;
          });
        }
        expect(new Set(sky.owners).size).toBe(count);
        for (const c of sky.crystals) {
          expect(c.x).toBeGreaterThan(0);
          expect(c.x).toBeLessThan(sky.W);
          expect(c.y).toBeGreaterThan(0);
          expect(c.y).toBeLessThan(sky.H);
        }
      }
      expect(mirrors, "some beams pass a fixed mirror").toBeGreaterThan(0);
      // Now and then two frames' beams run too close to keep apart.
      expect(shared).toBeLessThanOrEqual(count * 4 * 0.15);
    });
  }
});
