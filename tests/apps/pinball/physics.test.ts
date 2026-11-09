import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { BALL_R, HZ, SUBSTEPS, TABLE_H, VMAX } from "../../../src/apps/pinball/config";
import { buildTable } from "../../../src/apps/pinball/layout";
import { buildPlayfield, DECK_SUBSTEPS } from "../../../src/apps/pinball/deckgeo";
import {
  arc,
  circle,
  type Flipper,
  makeBall,
  makeWorld,
  moveCircle,
  seg,
  stepReach,
  stepWorld,
  type World,
} from "../../../src/apps/pinball/physics";
import { seeded } from "./helpers";

const DT = 1 / HZ;
const BOUNDS = { x0: -5000, y0: -5000, x1: 5000, y1: 5000 };

const world = (o: Partial<World> = {}) =>
  makeWorld({ gravity: 0, vmax: VMAX, damping: 0, bounds: BOUNDS, ...o });

const shoot = (w: World, x: number, y: number, angle: number, speed = VMAX) => {
  const b = makeBall(1, x, y, BALL_R);
  b.vx = Math.cos(angle) * speed;
  b.vy = Math.sin(angle) * speed;
  w.balls.push(b);
  return b;
};

/** Signed side of (x, y) relative to the flipper's axis: + on one face, - on the other. */
const sideOf = (f: Flipper, x: number, y: number) => {
  const dx = Math.cos(f.angle);
  const dy = Math.sin(f.angle);
  const rx = x - f.px;
  const ry = y - f.py;
  const along = (rx * dx + ry * dy) / f.len;
  return { across: dx * ry - dy * rx, along };
};

describe("pinball physics", () => {
  it("moves a ball less than its radius per sub-step, flipper tips included", () => {
    const t = buildTable({ mirror: false });
    const w = world({ flippers: t.flippers });
    expect(stepReach(w, DT, SUBSTEPS)).toBeLessThan(BALL_R);
  });

  it("never lets a ball at full speed through a wall", () => {
    let checked = 0;
    for (const from of [-1, 1]) {
      for (let deg = -80; deg <= 80; deg += 8) {
        for (const x of [100, 333, 500, 777, 900]) {
          const w = world();
          w.shapes.push(seg(0, 500, 1000, 500, { r: 7 }));
          const a = ((from === -1 ? 90 : -90) + deg) * (Math.PI / 180);
          const b = shoot(w, x - Math.cos(a) * 200, 500 - from * 200, a);
          for (let i = 0; i < 60; i++) {
            stepWorld(w, DT, SUBSTEPS);
            expect(Math.sign(b.y - 500), `from ${from} at ${deg} deg, x ${x}`).toBe(-from);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("never lets a ball at full speed into a post", () => {
    for (let deg = 0; deg < 360; deg += 15) {
      for (const off of [-30, -15, 0, 15, 30]) {
        const w = world();
        w.shapes.push(circle(0, 0, 8));
        const a = (deg * Math.PI) / 180;
        // Start 300 px out, aimed past the post by `off`.
        const b = shoot(
          w,
          -Math.cos(a) * 300 - Math.sin(a) * off,
          -Math.sin(a) * 300 + Math.cos(a) * off,
          a,
        );
        for (let i = 0; i < 40; i++) {
          stepWorld(w, DT, SUBSTEPS);
          expect(Math.hypot(b.x, b.y)).toBeGreaterThan(BALL_R + 8 - 0.5);
        }
      }
    }
  });

  it("keeps a ball inside an arc", () => {
    for (let deg = 180; deg <= 360; deg += 10) {
      const w = world();
      w.shapes.push(arc(0, 0, 500, Math.PI, Math.PI * 2, { r: 7 }));
      const a = (deg * Math.PI) / 180;
      const b = shoot(w, 0, -100, a);
      for (let i = 0; i < 90; i++) {
        stepWorld(w, DT, SUBSTEPS);
        if (b.y < 0) expect(Math.hypot(b.x, b.y)).toBeLessThan(500 - 7 - BALL_R + 0.5);
      }
    }
  });

  it("lets a ball up through a one-way gate and not back down", () => {
    const w = world();
    w.shapes.push(seg(0, 0, 200, 0, { r: 7, oneWay: { nx: 0, ny: -1 } }));
    const up = shoot(w, 100, 200, -Math.PI / 2, 2000);
    for (let i = 0; i < 30; i++) stepWorld(w, DT, SUBSTEPS);
    expect(up.y).toBeLessThan(-100);
    up.vy = 3000;
    for (let i = 0; i < 30; i++) stepWorld(w, DT, SUBSTEPS);
    expect(up.y).toBeLessThan(-BALL_R);
  });

  it("never lets a full-speed ball through a flipper, still or swinging", () => {
    let checked = 0;
    for (const swing of [false, true]) {
      for (const fromAbove of [true, false]) {
        for (let k = 0.1; k <= 0.95; k += 0.12) {
          for (let deg = -50; deg <= 50; deg += 10) {
            const t = buildTable({ mirror: false });
            const w = world({ flippers: t.flippers });
            const f = t.flippers[0]!;
            // A swinging flipper is already raised when a ball comes from below, so it meets the
            // ball on the way back down; from above it meets the ball on the way up.
            if (swing && !fromAbove) {
              f.angle = f.up;
              f.held = false;
            }
            const tipX = f.px + Math.cos(f.angle) * f.len * k;
            const tipY = f.py + Math.sin(f.angle) * f.len * k;
            const a = ((fromAbove ? 90 : -90) + deg) * (Math.PI / 180);
            const b = shoot(w, tipX - Math.cos(a) * 160, tipY - Math.sin(a) * 160, a);
            // Going round an end of the flipper is fine; crossing its length between two looks
            // is going through it.
            let last = sideOf(f, b.x, b.y);
            for (let i = 0; i < 40; i++) {
              if (swing && fromAbove && i === 2) f.held = true;
              stepWorld(w, DT, SUBSTEPS);
              const s = sideOf(f, b.x, b.y);
              const within = (v: { along: number }) => v.along > 0.02 && v.along < 0.98;
              if (within(s) && within(last)) {
                expect(
                  Math.sign(s.across),
                  `swing ${swing} above ${fromAbove} k ${k.toFixed(2)} ${deg}`,
                ).toBe(Math.sign(last.across));
                checked++;
              }
              last = s;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("keeps full-speed balls inside the table's walls", () => {
    const rnd = seeded(21);
    for (let n = 0; n < 160; n++) {
      const t = buildTable({ mirror: n % 2 === 1 });
      const w = world({
        gravity: 2300,
        shapes: t.shapes,
        flippers: t.flippers,
        bounds: { x0: -500, y0: -500, x1: 1600, y1: TABLE_H + BALL_R + 8 },
      });
      for (const f of t.flippers) f.held = rnd() < 0.5;
      // Somewhere open in the playfield, any direction, flat out.
      const x = 200 + rnd() * 600;
      const y = 650 + rnd() * 500;
      const b = shoot(w, x, y, rnd() * Math.PI * 2);
      for (let i = 0; i < 360 && w.balls.length > 0; i++) {
        if (i % 30 === 0) for (const f of t.flippers) f.held = rnd() < 0.5;
        stepWorld(w, DT, SUBSTEPS);
        expect(b.x, `run ${n}`).toBeGreaterThan(24 + 7 - 1);
        expect(b.x, `run ${n}`).toBeLessThan(1058 - 7 + 1);
        if (b.y < 640) {
          expect(Math.hypot(b.x - 540, b.y - 640), `run ${n}`).toBeLessThan(516 - 7 - BALL_R + 1);
        }
      }
    }
  });

  it("gives the same result for the same inputs", () => {
    const run = () => {
      const t = buildTable({ mirror: false });
      const w = world({ gravity: 2300, shapes: t.shapes, flippers: t.flippers });
      const b = shoot(w, 500, 700, 1.1, 3000);
      for (let i = 0; i < 240; i++) {
        if (i === 100) t.flippers[0]!.held = true;
        stepWorld(w, DT, SUBSTEPS);
      }
      return [b.x, b.y, b.vx, b.vy];
    };
    expect(run()).toEqual(run());
  });

  it("never lets a full-speed ball into a moving bumper, on a track or turning in a cluster", () => {
    const pf = buildPlayfield(VENUE_SIZE.screen.width, VENUE_SIZE.screen.height);
    const R = pf.U;
    const vmax = pf.vmax;
    let checked = 0;
    let met = 0;
    for (const kind of ["shuttle", "cluster"] as const) {
      for (let phase = 0; phase < 1; phase += 0.125) {
        for (let deg = 0; deg < 360; deg += 20) {
          for (const off of [-0.6, 0, 0.6]) {
            const w = makeWorld({ gravity: 0, vmax, damping: 0, bounds: BOUNDS });
            const c = circle(0, 0, kind === "shuttle" ? 1.5 * R : 1.25 * R, { kick: 1000, e: 0.5 });
            w.shapes.push(c);
            let t = phase * 8;
            const place = (h: number) => {
              t += h;
              if (kind === "shuttle") {
                // Twice the deck's speed: across 1100 px and back in 3 s.
                moveCircle(c, 550 * Math.sin((t * Math.PI * 2) / 3), 0, h);
              } else {
                const a = t * 1.2;
                moveCircle(c, Math.cos(a) * 7.2 * R, Math.sin(a) * 7.2 * R, h);
              }
            };
            place(0);
            w.tick = place;
            const a = (deg * Math.PI) / 180;
            const aim = { x: c.x - Math.sin(a) * off * c.r, y: c.y + Math.cos(a) * off * c.r };
            const b = makeBall(1, aim.x - Math.cos(a) * 400, aim.y - Math.sin(a) * 400, R);
            b.vx = Math.cos(a) * vmax;
            b.vy = Math.sin(a) * vmax;
            w.balls.push(b);
            let touched = false;
            for (let i = 0; i < 40; i++) {
              stepWorld(w, 1 / 120, DECK_SUBSTEPS);
              touched ||= Math.hypot(b.x - c.x, b.y - c.y) < c.r + R + 4;
              expect(
                Math.hypot(b.x - c.x, b.y - c.y),
                `${kind} ${phase} ${deg} ${off}`,
              ).toBeGreaterThan(c.r + R - 2);
              checked++;
            }
            if (touched) met++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
    // Most shots really do meet the bumper.
    expect(met).toBeGreaterThan(200);
  });

  it("caps speed and reports bumper kicks", () => {
    const w = world();
    w.shapes.push(circle(0, 0, 46, { tag: "bumper", kick: 1150, hitMin: 25, scores: true }));
    const b = shoot(w, -200, 0, 0, 600);
    let kicked = false;
    for (let i = 0; i < 60; i++) {
      stepWorld(w, DT, SUBSTEPS);
      kicked ||= w.events.some((e) => e.type === "hit" && e.kicked);
      expect(Math.hypot(b.vx, b.vy)).toBeLessThanOrEqual(VMAX + 1e-6);
    }
    expect(kicked).toBe(true);
    expect(b.vx).toBeLessThan(-1000);
  });
});
