import { describe, expect, it } from "vitest";
import { CREW_IDLE_MS, ENGINE_CAP_S, NEXT_RUN_MS } from "../../../src/apps/touchdown/config";
import { FOOT } from "../../../src/apps/touchdown/craft";
import { crewOf, DT, flyUntilContact, KINDS, run } from "./helpers";

/** Put the craft just over the middle of the pad with `stars`, coming down gently. */
const overPad = (c: ReturnType<typeof crewOf>["crew"], stars?: number) => {
  const pad = c.terrain.pads.find((p) => stars === undefined || p.stars === stars)!;
  c.craft.x = (pad.x0 + pad.x1) / 2;
  c.craft.y = pad.y - FOOT.y * c.physics.S - 3;
  c.craft.vx = 0;
  c.craft.vy = c.physics.landVy * 0.5;
  return pad;
};

/** Finish the pause after a landing or bump. */
const pause = (c: ReturnType<typeof crewOf>["crew"], now: number) =>
  run(c, NEXT_RUN_MS / 1000 + 0.05, now);

describe("touchdown crew", () => {
  it("starts on the autopilot and hands over at the first touch", () => {
    const { crew } = crewOf();
    expect(crew.mode).toBe("auto");
    run(crew, 5);
    expect(crew.craft.y).toBeGreaterThan(200);
    const runs = crew.run;
    crew.touched(true, 5000);
    expect(crew.mode).toBe("people");
    expect(crew.run).toBe(runs + 1);
    expect(crew.runT).toBe(0);
    expect(crew.craft.x).toBeCloseTo(crew.terrain.spawn.x, 6);
  });

  it("takes 20 to 30 s to reach the ground with nobody firing, on every frame", () => {
    for (const kind of KINDS) {
      for (const variant of ["duo", "crew"] as const) {
        for (let s = 0; s < 12; s++) {
          const { crew } = crewOf(kind, variant, {}, `fall${s}`);
          crew.touched(true, 0);
          const t = flyUntilContact(crew);
          expect(t, `${kind} ${variant} seed ${s}`).toBeGreaterThanOrEqual(20);
          expect(t, `${kind} ${variant} seed ${s}`).toBeLessThanOrEqual(30);
          expect(crew.phase).toBe("bumped");
        }
      }
    }
  });

  it("lands most autopilot runs, on every frame", () => {
    for (const kind of KINDS) {
      for (const variant of ["duo", "crew"] as const) {
        let landed = 0;
        const n = 16;
        for (let s = 0; s < n; s++) {
          const { crew } = crewOf(kind, variant, {}, `auto${s}`);
          if (crew.plan) crew.plan.careless = false;
          flyUntilContact(crew, 0, 100);
          if (crew.phase === "landed") landed++;
        }
        expect(landed / n, `${kind} ${variant}`).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  it("keeps the terrain after a bump and shows the last run as a ghost", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    const terrain = crew.terrain;
    const now = run(crew, 0.5, 0);
    flyUntilContact(crew, now);
    expect(crew.phase).toBe("bumped");
    pause(crew, 30_000);
    expect(crew.phase).toBe("flying");
    expect(crew.terrain).toBe(terrain);
    expect(crew.ghost).not.toBeNull();
    expect(crew.ghostAlpha).toBe(1);
    // The ghost replays from the same start.
    expect(crew.ghost!.data[0]).toBeCloseTo(crew.terrain.spawn.x, 3);
    expect(crew.ghost!.stars).toBe(0);
  });

  it("brings new terrain after a three-star landing", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    overPad(crew, 3);
    flyUntilContact(crew, 0);
    expect(crew.outcome?.stars).toBe(3);
    const terrain = crew.terrainVersion;
    pause(crew, 1000);
    expect(crew.terrainVersion).toBe(terrain + 1);
    expect(crew.ghost).toBeNull();
    expect(crew.mode).toBe("people");
  });

  it("keeps the terrain once after a lesser landing, with that landing as the ghost", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    overPad(crew, 1);
    flyUntilContact(crew, 0);
    expect(crew.outcome?.stars).toBe(1);
    const terrain = crew.terrainVersion;
    let now = pause(crew, 1000);
    expect(crew.terrainVersion).toBe(terrain);
    expect(crew.ghost?.stars).toBe(1);
    // A bump next keeps the better landing as the ghost.
    crew.touched(true, now);
    now = run(crew, 0.2, now);
    flyUntilContact(crew, now);
    expect(crew.phase).toBe("bumped");
    now = pause(crew, now + 25_000);
    expect(crew.ghost?.stars).toBe(1);
    // A second landing on the same terrain moves on.
    crew.touched(true, now);
    overPad(crew, 1);
    flyUntilContact(crew, now);
    expect(crew.phase).toBe("landed");
    pause(crew, now + 1000);
    expect(crew.terrainVersion).toBe(terrain + 1);
  });

  it("returns an abandoned crew to the autopilot with new terrain", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    flyUntilContact(crew, 0);
    const terrain = crew.terrainVersion;
    pause(crew, CREW_IDLE_MS + 1000);
    expect(crew.mode).toBe("auto");
    expect(crew.terrainVersion).toBe(terrain + 1);
    expect(crew.ghost).toBeNull();
  });

  it("fades ghosts after a minute without play", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    flyUntilContact(crew, 0);
    pause(crew, 10_000);
    expect(crew.ghostAlpha).toBe(1);
    run(crew, 3, 61_000);
    expect(crew.ghost).toBeNull();
  });

  it("drains fuel while engines fire, then only sputters", () => {
    const { crew } = crewOf("pair", "duo", { assist: "strong" });
    crew.touched(true, 0);
    crew.setHeld("left", true);
    crew.setHeld("right", true);
    run(crew, 10, 0);
    expect(crew.fuel).toBeLessThan(0.6);
    expect(crew.fuel).toBeGreaterThan(0.4);
    run(crew, 15, 10_000);
    expect(crew.fuel).toBe(0);
    expect(crew.sputtering).toBe(true);
    expect(crew.spent).toBe(true);
    expect(crew.thrust.power).toBe(0);
    const vy = crew.craft.vy;
    run(crew, 3, 25_000);
    expect(crew.craft.vy).toBeGreaterThan(vy);
  });

  it("cuts the engines at the time limit even without a fuel gauge", () => {
    const { crew } = crewOf("pair", "duo", { fuel: false });
    crew.touched(true, 0);
    crew.setHeld("left", true);
    crew.setHeld("right", true);
    run(crew, ENGINE_CAP_S - 1, 0);
    expect(crew.phase).toBe("flying");
    expect(crew.thrust.power).toBe(1);
    expect(crew.fuel).toBe(1);
    run(crew, 2, ENGINE_CAP_S * 1000);
    expect(crew.thrust.power).toBe(0);
  });

  it("starts a fresh run on the same terrain when reset is held", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    run(crew, 6, 0);
    const terrain = crew.terrainVersion;
    const runs = crew.run;
    crew.restart(6000);
    expect(crew.run).toBe(runs + 1);
    expect(crew.terrainVersion).toBe(terrain);
    expect(crew.runT).toBe(0);
    expect(crew.mode).toBe("people");
    expect(crew.ghost).not.toBeNull();
  });

  it("goes back to the autopilot with fresh terrain on reset", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    flyUntilContact(crew, 0);
    pause(crew, 1000);
    const terrain = crew.terrainVersion;
    crew.reset();
    expect(crew.mode).toBe("auto");
    expect(crew.terrainVersion).toBe(terrain + 1);
    expect(crew.ghost).toBeNull();
  });

  it("keeps its event queue bounded", () => {
    const { crew, events } = crewOf();
    for (let i = 0; i < 100; i++) crew.newTerrain();
    expect(events.length).toBeLessThanOrEqual(24);
  });

  it("counts runs, landings and stars", () => {
    const { crew } = crewOf();
    crew.touched(true, 0);
    overPad(crew, 2);
    flyUntilContact(crew, 0);
    expect(crew.counts.landings).toBe(1);
    expect(crew.counts.stars).toBe(2);
    expect(crew.counts.runs).toBe(2);
  });

  it("steps the same way for the same seed", () => {
    const a = crewOf("pair", "duo", { wind: "gusty" }, "same").crew;
    const b = crewOf("pair", "duo", { wind: "gusty" }, "same").crew;
    run(a, 20);
    run(b, 20);
    expect(a.craft).toEqual(b.craft);
    expect(DT).toBeGreaterThan(0);
  });
});
