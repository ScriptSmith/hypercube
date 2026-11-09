import { describe, expect, it } from "vitest";
import { MADE_MS, NEXT_GAP_MS, PERSON_HOLD_MS, SLIDE_MS } from "../../../src/apps/manyhands/config";
import { createSlot, type Slot, type Who } from "../../../src/apps/manyhands/slot";
import { dealNext, TASKS, tasksFor } from "../../../src/apps/manyhands/tasks/library";
import { createRng } from "../../../src/core/rng";
import { layoutOf } from "./helpers";

/** A slot whose bot or ghost touches go straight back into it, as injected touches do. */
const slotFor = (bot: boolean, band: "low" | "high" = "low", seed = "s") => {
  const l = layoutOf("panel");
  const spec = band === "low" ? l.stations[0]!.low : l.stations[0]!.high!;
  const done: Who[] = [];
  let id = 100;
  let slot: Slot | null = null;
  slot = createSlot({
    spec,
    defs: tasksFor(band, "mixed"),
    rng: createRng(seed),
    color: "#6fa4fc",
    bot,
    sink: {
      down: (x, y) => {
        const i = ++id;
        slot!.down(i, spec.task.x + x, spec.task.y + y, true, now);
        return i;
      },
      move: (i, x, y) => slot!.move(i, spec.task.x + x, spec.task.y + y),
      up: (i) => slot!.up(i),
    },
    onDone: (who) => done.push(who),
  });
  let now = 0;
  return {
    slot,
    spec,
    done,
    step(ms: number) {
      const end = now + ms;
      for (; now < end; now += 1000 / 60) slot!.update(1 / 60, now);
    },
    get now() {
      return now;
    },
  };
};

describe("slots", () => {
  it("never deal the same task twice in a row", () => {
    const rng = createRng("deal");
    for (const band of ["low", "high"] as const) {
      for (const variant of ["mixed", "simple"] as const) {
        const list = tasksFor(band, variant);
        expect(list.length).toBeGreaterThanOrEqual(4);
        let prev = dealNext(list, null, rng).id;
        const seen = new Set([prev]);
        for (let i = 0; i < 500; i++) {
          const next = dealNext(list, prev, rng).id;
          expect(next).not.toBe(prev);
          seen.add(next);
          prev = next;
        }
        expect(seen.size).toBe(list.length);
      }
    }
  });

  it("the simple variant deals children's tasks in the adult slot too", () => {
    expect(tasksFor("high", "simple").every((t) => t.band === "low")).toBe(true);
    expect(tasksFor("high", "mixed").every((t) => t.band === "high")).toBe(true);
    expect(TASKS.filter((t) => t.band === "low").length).toBeGreaterThanOrEqual(4);
    expect(TASKS.filter((t) => t.band === "high").length).toBeGreaterThanOrEqual(4);
  });

  it("a bot slot plays task after task, each one different from the last", () => {
    const s = slotFor(true);
    const ids: string[] = [];
    let last = "";
    for (let i = 0; i < 400 && s.done.length < 6; i++) {
      s.step(250);
      if (s.slot.taskId !== last) {
        ids.push(s.slot.taskId);
        last = s.slot.taskId;
      }
    }
    expect(s.done.length).toBeGreaterThanOrEqual(6);
    expect(s.done.every((w) => w === "bot")).toBe(true);
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });

  it("the ghost plays slowly when nobody is there, and its parts are practice", () => {
    const s = slotFor(false, "high", "g");
    s.step(80_000);
    expect(s.done.length).toBeGreaterThan(0);
    expect(s.done.every((w) => w === "ghost")).toBe(true);
    expect(s.slot.lastActive).toBe(Number.NEGATIVE_INFINITY);
  });

  it("a person's touch stops the ghost at once and the part is theirs", () => {
    const s = slotFor(false, "low", "p");
    s.step(SLIDE_MS + 2500);
    expect(s.slot.who).toBe("ghost");
    const t = s.spec.task;
    s.slot.down(1, t.x + 5, t.y + 5, false, s.now);
    s.step(20);
    expect(s.slot.who).toBe("person");
    expect(s.slot.player.busy).toBe(false);
    s.slot.up(1);
    // The ghost stays away while the person might come back.
    s.step(PERSON_HOLD_MS - 1000);
    expect(s.slot.player.busy).toBe(false);
    s.step(2000);
    expect(s.slot.who).toBe("ghost");
  });

  it("after a task the part shows, then the next task slides in", () => {
    const s = slotFor(true, "low", "m");
    for (let i = 0; i < 400 && s.slot.phase !== "made"; i++) s.step(50);
    expect(s.slot.phase).toBe("made");
    const first = s.slot.taskId;
    s.step(MADE_MS + NEXT_GAP_MS + 40);
    expect(s.slot.phase).toBe("slide");
    expect(s.slot.taskId).not.toBe(first);
    s.step(SLIDE_MS + 40);
    expect(s.slot.phase).toBe("play");
  });

  it("reset deals a new task and counts as a person", () => {
    const s = slotFor(true, "high", "r");
    s.step(1000);
    const before = s.slot.taskId;
    s.slot.deal(s.now, true);
    expect(s.slot.taskId).not.toBe(before);
    s.step(50);
    expect(s.slot.who).toBe("person");
  });
});
