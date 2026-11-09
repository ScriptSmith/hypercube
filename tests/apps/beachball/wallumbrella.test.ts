import { describe, expect, it } from "vitest";
import { isRed, isYellow } from "../../../src/apps/beachball/palettes";
import { pxPerM, wallLayout } from "../../../src/apps/beachball/walllayout";
import { extentAt } from "../../../src/apps/beachball/wallprops";
import {
  CANOPY_SKIN,
  createWobble,
  FOLD_S,
  HOLD_S,
  knock,
  nearestOn,
  stepWobble,
  UMBRELLA_PAINT,
  umbrellaSegments,
} from "../../../src/apps/beachball/wallumbrella";
import { beach, DT, FITS, prop, REACH, run, WALL } from "./beach";

/** How far a ball reaches into the umbrella's outline at worst, metres. */
const intoUmbrella = (w: ReturnType<typeof beach>["w"]) => {
  const u = w.umbrella!;
  if (u.state === "loose") return 0;
  const segs = umbrellaSegments(u.at, w.bounds.floor, u.fold);
  const c = Math.cos(u.wobble.tilt + u.stand);
  const s = Math.sin(u.wobble.tilt + u.stand);
  let worst = 0;
  for (const b of w.balls) {
    for (const g of segs) {
      const ax = u.at.x + c * g.ax - s * g.ay;
      const ay = w.bounds.floor + s * g.ax + c * g.ay;
      const bx = u.at.x + c * g.bx - s * g.by;
      const by = w.bounds.floor + s * g.bx + c * g.by;
      const t = nearestOn(ax, ay, bx, by, b.x, b.y);
      const d = Math.hypot(b.x - (ax + (bx - ax) * t), b.y - (ay + (by - ay) * t));
      worst = Math.max(worst, b.r + g.skin - d);
    }
  }
  return worst;
};

describe("the beach umbrella", () => {
  it("stands at the left end, its canopy above a child's reach, clear of balls and toys", () => {
    for (const balls of [1, 2, 3]) {
      for (const net of [true, false]) {
        const l = wallLayout(WALL.width, WALL.height, REACH, balls, {
          net,
          props: FITS,
          umbrella: true,
        });
        const u = l.umbrella!;
        expect(u.x - u.radius).toBeGreaterThan(0.2);
        expect(u.x).toBeLessThan(l.width / 4);
        expect(u.rim).toBeGreaterThan(l.childTop);
        expect(u.top).toBeLessThan(l.adultTop + 0.05);
        // Its canopy reads across the room: more than 2 m wide.
        expect(2 * u.radius * pxPerM()).toBeGreaterThan(1000);
        for (const x of l.rest) expect(Math.abs(x - u.x)).toBeGreaterThan(l.radius + 0.3);
        l.props.forEach((x, i) => {
          const lo = x + FITS[i]!.left;
          const hi = x + FITS[i]!.right;
          expect(hi < u.x - 0.25 || lo > u.x + 0.25).toBe(true);
        });
        if (l.net) expect(Math.abs(l.net.x - u.x)).toBeGreaterThan(u.radius + 0.5);
      }
    }
    // Without it, everything stays where it was.
    const before = wallLayout(WALL.width, WALL.height, REACH, 2, { net: true, props: FITS });
    expect(before.umbrella).toBeNull();
    expect(before.rest).toEqual(
      wallLayout(WALL.width, WALL.height, REACH, 2, { net: true, props: FITS }).rest,
    );
  });

  it("is painted without red or yellow", () => {
    for (const hex of [...UMBRELLA_PAINT.stripes, UMBRELLA_PAINT.pole, UMBRELLA_PAINT.fittings]) {
      expect(isRed(hex), hex).toBe(false);
      expect(isYellow(hex), hex).toBe(false);
    }
  });

  it("folds its outline in to the pole", () => {
    const l = wallLayout(WALL.width, WALL.height, REACH, 2, { umbrella: true });
    const open = umbrellaSegments(l.umbrella!, l.floor, 0);
    const shut = umbrellaSegments(l.umbrella!, l.floor, 1);
    const wide = (segs: typeof open) => Math.max(...segs.map((g) => Math.abs(g.ax)));
    expect(wide(open)).toBeCloseTo(l.umbrella!.radius, 6);
    expect(wide(shut)).toBeLessThan(0.15);
    // The crown stays at the top of the pole.
    const crown = (segs: typeof open) => Math.max(...segs.map((g) => Math.max(g.ay, g.by)));
    expect(crown(shut)).toBeCloseTo(crown(open), 6);
  });

  it("rocks back upright after a knock, a few degrees at most", () => {
    const w = createWobble();
    knock(w, 400, 3);
    let most = 0;
    for (let i = 0; i < 120 * 12; i++) {
      stepWobble(w, DT);
      most = Math.max(most, Math.abs(w.tilt));
    }
    expect(most).toBeGreaterThan(0.02);
    expect(most).toBeLessThanOrEqual(0.11);
    expect(Math.abs(w.tilt)).toBeLessThan(1e-3);
    expect(Math.abs(w.yawRate)).toBeLessThan(0.01);
  });

  it("bounces a ball dropped on its canopy off onto the sand, and rocks", () => {
    const { w, l } = beach({ toys: false });
    const u = l.umbrella!;
    const b = w.balls[0]!;
    b.x = u.x + 0.5;
    b.y = u.top + 1.2;
    b.grounded = false;
    w.kick(0, 0, -1);
    let tilt = 0;
    run(w, 6, () => (tilt = Math.max(tilt, Math.abs(w.umbrella!.wobble.tilt))));
    expect(w.umbrella!.hits).toBeGreaterThan(0);
    expect(tilt).toBeGreaterThan(0.005);
    expect(b.grounded).toBe(true);
    expect(Math.abs(b.x - u.x)).toBeGreaterThan(b.r);
  });

  it("stops a ball rolling into its pole, and one thrown up under its canopy", () => {
    const { w, l } = beach({ toys: false });
    const u = l.umbrella!;
    const b = w.balls[0]!;
    w.place(0, u.x + 1.2);
    w.kick(0, -2.6, 0.01, [0, 0, 2.6 / b.r]);
    run(w, 3, () => expect(b.x).toBeGreaterThan(u.x));
    w.place(0, u.x + 0.6);
    w.kick(0, 0, 8);
    let top = 0;
    run(w, 3, () => (top = Math.max(top, b.y + b.r)));
    expect(top).toBeLessThan(u.top);
    expect(intoUmbrella(w)).toBeLessThan(0.02);
  });

  it("rocks under a finger that lands on it, and turns when swiped across its canopy", () => {
    const { w, l } = beach({ toys: false });
    const u = l.umbrella!;
    expect(w.down(1, u.x + 0.06, l.floor + 0.9)).toBe("nudge");
    w.up(1);
    let tilt = 0;
    run(w, 0.6, () => (tilt = Math.max(tilt, Math.abs(w.umbrella!.wobble.tilt))));
    expect(tilt).toBeGreaterThan(0.01);
    expect(w.umbrella!.nudges).toBe(1);
    // A fast swipe from the left across the canopy's face.
    const y = u.rim + 0.2;
    w.down(2, u.x - 1.6, y);
    for (let i = 1; i <= 20; i++) {
      w.move(2, u.x - 1.6 + i * 0.08, y, 9.6, 0);
      w.step(DT);
    }
    w.up(2);
    expect(Math.abs(w.umbrella!.wobble.yawRate)).toBeGreaterThan(0.5);
  });

  it("folds under a finger held on it, and unfolds when held again", () => {
    const { w, l } = beach({ toys: false });
    const u = l.umbrella!;
    const at = [u.x, l.floor + 1] as const;
    w.down(1, ...at);
    run(w, HOLD_S + 0.05, () => w.move(1, ...at, 0, 0));
    w.up(1);
    expect(w.umbrella!.state).toBe("closing");
    run(w, FOLD_S + 0.1);
    expect(w.umbrella!.state).toBe("closed");
    expect(w.umbrella!.closes).toBe(1);
    // A ball dropped where the canopy was now falls past it.
    const b = w.balls[0]!;
    b.x = u.x + 0.7;
    b.y = u.top + 0.8;
    b.grounded = false;
    w.kick(0, 0, -1);
    run(w, 2);
    expect(w.umbrella!.hits).toBe(0);
    w.down(2, ...at);
    run(w, HOLD_S + 0.05, () => w.move(2, ...at, 0, 0));
    w.up(2);
    run(w, FOLD_S + 0.1);
    expect(w.umbrella!.state).toBe("open");
  });

  it("closed, comes out of the sand when dragged, lies down, and stands up again when held", () => {
    const { w, l } = beach({ toys: false });
    const u = l.umbrella!;
    const at = [u.x, l.floor + 1] as const;
    w.down(1, ...at);
    run(w, HOLD_S + FOLD_S + 0.2, () => w.move(1, ...at, 0, 0));
    w.up(1);
    expect(w.umbrella!.state).toBe("closed");
    // Drag it up and along, and let go.
    w.down(2, ...at);
    for (let i = 1; i <= 40; i++) {
      w.move(2, u.x + i * 0.02, at[1] + i * 0.01, 2.4, 1.2);
      w.step(DT);
    }
    expect(w.umbrella!.state).toBe("loose");
    expect(w.umbrella!.pulls).toBe(1);
    const p = w.umbrella!.prop;
    expect(p.holder).toBe(2);
    w.up(2);
    run(w, 6);
    expect(p.asleep).toBe(true);
    // Lying along the sand, out of the way of the game.
    expect(Math.abs(Math.abs(p.a) - Math.PI / 2)).toBeLessThan(0.35);
    expect(p.y + extentAt(p.spec, p.a).top).toBeLessThan(l.floor + 0.6);
    // Held still on it, it stands up where it lies and opens.
    w.down(3, p.x, p.y);
    run(w, HOLD_S + 0.05, () => w.move(3, p.x, p.y, 0, 0));
    w.up(3);
    expect(w.umbrella!.state).toBe("rising");
    run(w, 3);
    expect(w.umbrella!.state).toBe("open");
    expect(w.umbrella!.plants).toBe(1);
    expect(p.off).toBe(true);
    const x = w.umbrella!.at.x;
    expect(x - u.radius).toBeGreaterThan(0);
    expect(Math.abs(x - l.net!.x)).toBeGreaterThan(u.radius);
    // And it can be put back where it was put out.
    w.resetUmbrella();
    expect(w.umbrella!.at.x).toBe(u.x);
    expect(w.umbrella!.state).toBe("open");
  });

  it("keeps balls out of its canopy and pole through ten minutes of play", () => {
    const { w, l } = beach({ balls: 3, seed: "umbrella hour" });
    const u = l.umbrella!;
    let worst = 0;
    let t = 0;
    let next = 0;
    let id = 10;
    while (t < 600) {
      if (t >= next) {
        next = t + 1.5;
        const i = Math.floor((t * 7) % 3);
        const b = w.balls[i]!;
        if (b.x < u.x + u.radius + 2) w.kick(i, ((t * 13) % 8) - 4, 4 + ((t * 5) % 6));
        else w.kick(i, -3 - ((t * 3) % 4), 3 + ((t * 11) % 5));
        // Now and then a finger rocks it or swipes across it.
        if (Math.floor(t) % 7 === 0) {
          const f = id++;
          w.down(f, u.x - 1, u.rim + 0.15);
          for (let s = 1; s <= 12; s++) {
            w.move(f, u.x - 1 + s * 0.15, u.rim + 0.15, 18, 0);
            w.step(DT);
            t += DT;
          }
          w.up(f);
        }
      }
      w.step(DT);
      t += DT;
      worst = Math.max(worst, intoUmbrella(w));
    }
    expect(worst).toBeLessThan(CANOPY_SKIN + 0.04);
    expect(w.umbrella!.state).toBe("open");
  }, 60_000);

  it("can be left out", () => {
    const { w, l } = beach({ umbrella: false });
    expect(l.umbrella).toBeNull();
    expect(w.umbrella).toBeNull();
    expect(w.props.some((p) => p.kind === "brolly")).toBe(false);
    expect(prop(w, "bucket")).toBeDefined();
  });
});
