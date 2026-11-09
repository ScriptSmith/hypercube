import { describe, expect, it } from "vitest";
import { VENUE_SIZE } from "../../../src/core/frame";
import { seedLabel } from "../../../src/apps/touchdown/config";
import { createCrew, type Crew } from "../../../src/apps/touchdown/crew";
import {
  createFleet,
  DELAY_MS,
  DROP_MS,
  emptyPose,
  MAX_REMOTES,
} from "../../../src/apps/touchdown/fleet";
import { layoutFor, type LayoutInput } from "../../../src/apps/touchdown/layout";
import { createUplink, type ShipMeta, shipOf } from "../../../src/apps/touchdown/link";
import {
  cameraFor,
  columnView,
  viewScale,
  viewX,
  ZOOM,
} from "../../../src/apps/touchdown/screenview";
import { decodeShip, encodeShip, type Ship, TOPIC_SHIP } from "../../../src/apps/touchdown/wire";
import { createRng, hashSeed } from "../../../src/core/rng";
import type { Channel, PeerInfo } from "../../../src/core/types";
import { config, DT, layoutInput, run } from "./helpers";

const rngOf = (label: string) => createRng(label);

/** A touch frame's crew as `index.ts` builds it in a bank, with what its messages carry. */
const bankFrame = (
  kind: "panel" | "pair",
  variant: "duo" | "crew" = "duo",
  pos = 2,
  over: Partial<LayoutInput> = {},
) => {
  const input = layoutInput(kind, variant, over);
  const layout = layoutFor(input);
  const seed = hashSeed(`${hashSeed("touchdown:main")}:${pos}`);
  const crew = createCrew({
    spec: layout.crews[0]!,
    layout,
    config: config(variant),
    rng: createRng(seedLabel(seed)).fork("crew:0"),
    events: [],
  });
  const meta: ShipMeta = {
    pos,
    count: 6,
    seed,
    geo: {
      kind,
      span: kind === "pair" ? 2 : 1,
      width: input.width,
      height: input.height,
      adult: input.reachTop.adult,
      child: input.reachTop.child,
      variant,
    },
  };
  return { crew, layout, meta };
};

/** What the screen decodes from a frame's message at sender ms `t`. */
const wire = (crew: Crew, meta: ShipMeta, t: number): Ship =>
  decodeShip(JSON.parse(JSON.stringify(encodeShip(shipOf(crew, meta, t)))))!;

describe("touchdown bank: the screen's copy of each frame", () => {
  for (const kind of ["panel", "pair"] as const) {
    for (const variant of ["duo", "crew"] as const) {
      it(`rebuilds the frame's terrain from its seed on a ${kind} (${variant})`, () => {
        // An uneven reach, as a venue profile can give.
        const { crew, meta } = bankFrame(kind, variant, 3, {
          reachTop: { adult: 21.37, child: 913.6363636363636 },
        });
        const fleet = createFleet(rngOf);
        let now = 0;
        for (let i = 0; i < 4; i++) {
          if (i > 0) crew.newTerrain();
          const r = fleet.accept(wire(crew, meta, 1000 + i * 100), "f3", now)!;
          expect(r.terrainKey).toBe(crew.terrainKey);
          expect(Array.from(r.terrain.xs)).toEqual(Array.from(crew.terrain.xs));
          expect(Array.from(r.terrain.ys)).toEqual(Array.from(crew.terrain.ys));
          expect(r.terrain.pads).toEqual(crew.terrain.pads);
          expect(r.terrain.spawn).toEqual(crew.terrain.spawn);
          now += 100;
        }
      });
    }
  }

  it("gives each frame of a bank its own terrain", () => {
    const a = bankFrame("panel", "duo", 0).crew.terrain;
    const b = bankFrame("panel", "duo", 1).crew.terrain;
    expect(Array.from(a.ys)).not.toEqual(Array.from(b.ys));
  });

  it("drops a frame's craft 3 s after its last message", () => {
    const { crew, meta } = bankFrame("panel");
    const fleet = createFleet(rngOf);
    fleet.accept(wire(crew, meta, 500), "f2", 10_000);
    fleet.accept(wire(crew, meta, 566), "f2", 10_066);
    expect(fleet.prune(10_066 + DROP_MS - 1)).toBe(0);
    expect(fleet.size).toBe(1);
    expect(fleet.prune(10_066 + DROP_MS + 1)).toBe(1);
    expect(fleet.size).toBe(0);
    // It comes back with its next message.
    fleet.accept(wire(crew, meta, 4000), "f2", 14_000);
    expect(fleet.size).toBe(1);
  });

  it("marks the autopilot's craft as attract and a crew's as flown", () => {
    const { crew, meta } = bankFrame("pair");
    const fleet = createFleet(rngOf);
    const pose = emptyPose();
    run(crew, 2);
    expect(crew.mode).toBe("auto");
    const r = fleet.accept(wire(crew, meta, 100), "f", 0)!;
    expect(fleet.poseOf(r, 1000, pose)).toBe(true);
    expect(pose.attract).toBe(true);
    crew.touched(true, 2000);
    run(crew, 1, 2000);
    fleet.accept(wire(crew, meta, 200), "f", 100);
    expect(fleet.poseOf(r, 1000, pose)).toBe(true);
    expect(pose.attract).toBe(false);
  });

  it("draws a little in the past, between samples, and never across a new run", () => {
    const { crew, meta } = bankFrame("panel");
    const fleet = createFleet(rngOf);
    const pose = emptyPose();
    const a = wire(crew, meta, 1000);
    const r = fleet.accept(a, "f", 5000)!;
    run(crew, 1 / 15);
    const b = wire(crew, meta, 1066);
    fleet.accept(b, "f", 5066);
    // Halfway between the two, DELAY_MS behind the sender's clock.
    fleet.poseOf(r, 5000 + 33 + DELAY_MS, pose);
    expect(pose.y).toBeCloseTo((a.y + b.y) / 2, 0);
    expect(pose.y).toBeGreaterThan(Math.min(a.y, b.y) - 1e-9);
    // A new run jumps straight to the new start rather than sliding there.
    crew.restart(0);
    const c = wire(crew, meta, 1133);
    fleet.accept(c, "f", 5133);
    fleet.poseOf(r, 5066 + 60 + DELAY_MS, pose);
    expect(pose.run).toBe(b.run);
    expect(pose.y).toBe(b.y);
    fleet.poseOf(r, 5133 + DELAY_MS + 1, pose);
    expect(pose.run).toBe(c.run);
    expect(pose.x).toBeCloseTo(c.x, 1);
  });

  it("holds at most MAX_REMOTES frames", () => {
    const { crew, meta } = bankFrame("panel");
    const fleet = createFleet(rngOf);
    for (let i = 0; i < MAX_REMOTES + 5; i++) fleet.accept(wire(crew, meta, 100), `f${i}`, 0);
    expect(fleet.size).toBe(MAX_REMOTES);
  });

  it("keeps every craft over its own frame, zoomed in, on six panels and three pairs", () => {
    for (const [kind, count] of [
      ["panel", 6],
      ["pair", 3],
    ] as const) {
      const W = VENUE_SIZE.screen.width;
      const H = VENUE_SIZE.screen.height;
      const l = layoutFor(layoutInput(kind));
      const s = viewScale(l, count, W, H);
      const bank = W / count / l.width;
      expect(s / bank).toBeCloseTo(ZOOM, 6);
      // The craft is at least twice its size on the panel below.
      expect(l.craft * s).toBeGreaterThan(2 * l.craft * bank);
      for (let pos = 0; pos < count; pos++) {
        for (const x of [0, 0.1, 0.5, 0.9, 1].map((f) => f * l.width)) {
          const v = columnView(l, pos, count, W, H, cameraFor(l, x, W / count, s));
          const X = viewX(v, x);
          expect(X).toBeGreaterThanOrEqual((pos / count) * W - 1e-6);
          expect(X).toBeLessThanOrEqual(((pos + 1) / count) * W + 1e-6);
        }
      }
    }
  });
});

describe("touchdown bank: the frame's uplink", () => {
  const fakeNet = (peers: PeerInfo[], online = true) => {
    const sent: { topic: string; data: unknown; to?: string }[] = [];
    const net: Channel = {
      online,
      self: "me",
      peers: () => peers,
      leader: () => null,
      send: (topic, data, to) => sent.push({ topic, data, to }),
      on: () => () => {},
      onPeers: () => () => {},
    };
    return { net, sent };
  };
  const peer = (frame: string, role: PeerInfo["role"], side = 0): PeerInfo => ({
    frame,
    app: "touchdown",
    group: "main",
    kind: role === "screen" ? "screen" : "panel",
    role,
    pos: 0,
    side,
  });

  it("sends about 15 times a second to the screen on its side and nobody else", () => {
    const { crew, meta } = bankFrame("panel");
    const { net, sent } = fakeNet([
      peer("me", "station"),
      peer("p2", "station"),
      peer("scr", "screen"),
      peer("other", "screen", 1),
    ]);
    const link = createUplink(net, 0, () => meta);
    for (let t = 0; t <= 2000; t += DT * 1000) link.tick(t, crew);
    expect(sent.every((m) => m.topic === TOPIC_SHIP && m.to === "scr")).toBe(true);
    expect(sent.length).toBeGreaterThanOrEqual(29);
    expect(sent.length).toBeLessThanOrEqual(32);
    expect(decodeShip(sent[0]!.data)).not.toBeNull();
  });

  it("sends nothing with no screen, or offline", () => {
    const { crew, meta } = bankFrame("panel");
    const alone = fakeNet([peer("me", "station"), peer("p2", "station")]);
    const offline = fakeNet([peer("me", "station"), peer("scr", "screen")], false);
    for (const f of [alone, offline]) {
      const link = createUplink(f.net, 0, () => meta);
      for (let t = 0; t <= 1000; t += 10) link.tick(t, crew);
      expect(f.sent).toHaveLength(0);
    }
  });
});
