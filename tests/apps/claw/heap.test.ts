import { describe, expect, it } from "vitest";
import { DESIGN_IDS, DESIGNS, partArea } from "../../../src/apps/claw/designs";
import {
  createHeap,
  floorPoint,
  floorTheta,
  HEAP_MAX,
  itemLook,
} from "../../../src/apps/claw/heap";
import { createRng } from "../../../src/core/rng";
import { DEG } from "../../../src/core/sphere";

const R = 2;
const FLOOR = -50 * DEG;
const HEAP = 0.64;
const door = { lat: -44 * DEG, lon: 0.3 };

const makeHeap = (seed = "heap") =>
  createHeap({ radius: R, floor: FLOOR, heap: HEAP, rng: createRng(seed) });

describe("claw prizes", () => {
  it("are made of convex parts the physics accepts, inside their drawing", () => {
    for (const id of DESIGN_IDS) {
      const d = DESIGNS[id];
      expect(d.colourways.length, id).toBeGreaterThanOrEqual(2);
      for (const p of d.parts) {
        expect(partArea(p), id).toBeGreaterThan(0.001);
        if (p.kind === "circle") {
          expect(p.x - p.r, id).toBeGreaterThanOrEqual(d.box.x0 - 1e-9);
          expect(p.x + p.r, id).toBeLessThanOrEqual(d.box.x1 + 1e-9);
          continue;
        }
        expect(p.points.length, id).toBeLessThanOrEqual(8);
        // Convex: every turn the same way.
        let sign = 0;
        const n = p.points.length;
        for (let i = 0; i < n; i++) {
          const [ax, ay] = p.points[i]!;
          const [bx, by] = p.points[(i + 1) % n]!;
          const [cx, cy] = p.points[(i + 2) % n]!;
          const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
          if (Math.abs(cross) < 1e-9) continue;
          if (sign === 0) sign = Math.sign(cross);
          expect(Math.sign(cross), id).toBe(sign);
        }
        for (const [x, y] of p.points) {
          expect(x, id).toBeGreaterThanOrEqual(d.box.x0 - 1e-9);
          expect(x, id).toBeLessThanOrEqual(d.box.x1 + 1e-9);
          expect(y, id).toBeGreaterThanOrEqual(d.box.y0 - 1e-9);
          expect(y, id).toBeLessThanOrEqual(d.box.y1 + 1e-9);
        }
      }
    }
  });
});

describe("claw heap", () => {
  it("maps the floor plane round the pole and back", () => {
    for (const theta of [0.01, 0.2, 0.5, 0.7]) {
      for (const lon of [-3, -1, 0, 0.5, 2.9]) {
        const p = floorPoint(R, theta, lon);
        expect(floorTheta(R, p.x, p.y)).toBeCloseTo(theta, 9);
        // Longitude 0 is straight up the picture seen from underneath, and it turns clockwise.
        expect(Math.atan2(p.x, -p.y)).toBeCloseTo(lon, 9);
      }
    }
    // Near the pole a metre of plane is a metre of ball.
    expect(Math.hypot(floorPoint(R, 0.02, 0).x, floorPoint(R, 0.02, 0).y)).toBeCloseTo(0.02 * R, 4);
  });

  it("brings a prize out of the door, down to the floor and across to the heap without jumps", () => {
    const heap = makeHeap();
    heap.launch({ design: "bear", colour: 0, cabinet: 0, door }, 0);
    const f = heap.flights[0]!;
    const total = heap.duration(f);
    expect(total).toBeGreaterThan(1.5);
    expect(total).toBeLessThan(6);
    const stages: string[] = [];
    let last = heap.pose(f, 0);
    for (let t = 0; t <= total; t += 1 / 120) {
      const p = heap.pose(f, t);
      if (stages[stages.length - 1] !== p.stage) stages.push(p.stage);
      if (last.stage !== "chute" && last.stage !== "door" && p.stage !== "door") {
        expect(Math.hypot(p.x - last.x, p.y - last.y)).toBeLessThan(0.1);
        expect(Math.abs(p.turn - last.turn)).toBeLessThan(0.1);
      }
      if (p.stage === "fall") expect(p.lat).toBeGreaterThanOrEqual(FLOOR - 1e-6);
      last = p;
    }
    expect(stages).toEqual(["chute", "door", "fall", "slide"]);
    // It ends where it lands, and lands on the heap.
    const end = heap.pose(f, total);
    expect(end.x).toBeCloseTo(f.to.x, 6);
    expect(end.y).toBeCloseTo(f.to.y, 6);
    expect(Math.hypot(f.to.x, f.to.y)).toBeLessThanOrEqual(HEAP + 1e-9);
    heap.step(total + 0.01);
    expect(heap.flights).toHaveLength(0);
    expect(heap.items).toHaveLength(1);
    expect(heap.landed).toBe(1);
  });

  it("never holds more than its limit, fading the oldest away", () => {
    const heap = makeHeap("bounded");
    heap.prefill(
      Array.from({ length: 20 }, () => ({ design: "star" as const, colour: 0 })),
      0,
    );
    let t = 0;
    let most = 0;
    for (let i = 0; i < 400; i++) {
      heap.launch(
        { design: DESIGN_IDS[i % DESIGN_IDS.length]!, colour: i, cabinet: i % 4, door },
        t,
      );
      for (let k = 0; k < 40; k++) {
        t += 0.05;
        heap.step(t);
        most = Math.max(most, heap.items.length);
        expect(heap.flights.length).toBeLessThanOrEqual(8);
      }
    }
    const live = heap.items.filter((it) => it.fading === null).length;
    expect(live).toBeLessThanOrEqual(HEAP_MAX);
    // Fading ones are on their way out: never more than a couple at once.
    expect(most).toBeLessThanOrEqual(HEAP_MAX + 3);
    expect(heap.landed + heap.flights.length).toBe(400);
    for (const it of heap.items) {
      const look = itemLook(it, t);
      expect(look.alpha).toBeGreaterThanOrEqual(0);
      expect(look.alpha).toBeLessThanOrEqual(1);
    }
  });

  it("lands every prize at once when too many are on their way", () => {
    const heap = makeHeap("burst");
    for (let i = 0; i < 20; i++) heap.launch({ design: "frog", colour: 0, cabinet: 0, door }, 0);
    expect(heap.flights.length).toBeLessThanOrEqual(8);
    expect(heap.items.length + heap.flights.length).toBe(20);
  });
});
