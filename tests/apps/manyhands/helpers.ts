import { createPlayer, type Gesture } from "../../../src/apps/manyhands/gesture";
import {
  type Layout,
  layoutFor,
  type LayoutInput,
  slotsOf,
} from "../../../src/apps/manyhands/layout";
import type { Task, TaskDef, TaskEnv } from "../../../src/apps/manyhands/tasks/common";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import { createRng } from "../../../src/core/rng";
import type { Channel, FrameKind, PeerInfo } from "../../../src/core/types";

export const inputFor = (kind: FrameKind, over: Partial<LayoutInput> = {}): LayoutInput => {
  const { width, height } = VENUE_SIZE[kind];
  const reach = DEFAULT_REACH[kind];
  return {
    kind,
    width,
    height,
    reachTop: { adult: height * (1 - reach.adult), child: height * (1 - reach.child) },
    seams: kind === "pair" ? [width / 2] : [],
    span: kind === "pair" ? 2 : 1,
    stations: 6,
    slots: "both",
    ...over,
  };
};

export const layoutOf = (kind: FrameKind, over: Partial<LayoutInput> = {}): Layout =>
  layoutFor(inputFor(kind, over));

/** Every distinct slot size the frames give tasks, with a label. */
export const slotSizes = (): {
  label: string;
  band: "low" | "high";
  env: Omit<TaskEnv, "rng">;
}[] => {
  const out: { label: string; band: "low" | "high"; env: Omit<TaskEnv, "rng"> }[] = [];
  const cases: [FrameKind, Partial<LayoutInput>][] = [
    ["panel", {}],
    ["pair", {}],
    ["wall", { stations: 4 }],
    ["wall", { stations: 6 }],
    ["wall", { stations: 8 }],
  ];
  for (const [kind, over] of cases) {
    const l = layoutOf(kind, over);
    const seen = new Set<string>();
    for (const { spec } of slotsOf(l)) {
      const key = `${spec.band}:${Math.round(spec.task.w)}x${Math.round(spec.task.h)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        label: `${kind}${over.stations ? over.stations : ""} ${key}`,
        band: spec.band,
        env: {
          w: spec.task.w,
          h: spec.task.h,
          color: "#6fa4fc",
          target: spec.target,
          coarse: spec.coarse,
        },
      });
    }
  }
  return out;
};

/** A canvas context that accepts any drawing call, for checking draw code runs. */
export const fakeContext = (): CanvasRenderingContext2D => {
  const gradient = { addColorStop() {} };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, key) {
      if (key in target) return target[key as string];
      if (key === "createRadialGradient" || key === "createLinearGradient") return () => gradient;
      if (key === "measureText") return () => ({ width: 10 });
      return () => undefined;
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
};

export interface BotRun {
  task: Task;
  seconds: number;
  gestures: number;
}

/**
 * Play a task with its own bot routine through the gesture player, as a slot does, at 60 Hz.
 * `gap` is the pause between gestures in ms.
 */
export const runBot = (
  def: TaskDef,
  env: Omit<TaskEnv, "rng">,
  opts: { pace?: number; gap?: number; seed?: string; maxS?: number; draw?: boolean } = {},
): BotRun => {
  const pace = opts.pace ?? 1;
  const gap = opts.gap ?? 150;
  const task = def.create({ ...env, rng: createRng(opts.seed ?? "test") });
  let nextId = 1;
  const player = createPlayer({
    down: (x, y) => {
      const id = nextId++;
      task.down(id, x, y);
      return id;
    },
    move: (id, x, y) => task.move(id, x, y),
    up: (id) => task.up(id),
  });
  const g = opts.draw ? fakeContext() : null;
  const dt = 1 / 60;
  const maxS = opts.maxS ?? 120;
  let t = 0;
  let waitUntil = 0;
  let gestures = 0;
  let current: Gesture | null = null;
  while (!task.done && t < maxS) {
    t += dt;
    const now = t * 1000;
    task.update(dt);
    if (current && !player.update(now)) {
      current = null;
      waitUntil = now + gap;
    }
    if (!current && now >= waitUntil) {
      const next = task.bot(pace);
      if (next) {
        current = next;
        gestures++;
        player.start(next, now);
        player.update(now);
      } else {
        waitUntil = now + 50;
      }
    }
    if (g) task.draw(g, t);
  }
  player.cancel();
  return { task, seconds: t, gestures };
};

/** A room in miniature: channels on one bus see each other's peers and messages at once. */
export interface Bus {
  join(info: Partial<PeerInfo> & { frame: string }): Channel & { leave(): void };
  online: boolean;
  readonly log: { topic: string; from: string; to?: string }[];
}

export const createBus = (): Bus => {
  const members = new Map<
    string,
    { info: PeerInfo; on: Map<string, Set<(d: unknown, f: string) => void>> }
  >();
  const log: Bus["log"] = [];
  const bus: Bus = {
    online: true,
    log,
    join(partial) {
      const info: PeerInfo = {
        app: "manyhands",
        group: "g",
        kind: "panel",
        role: "station",
        pos: 0,
        side: 0,
        ...partial,
      };
      const on = new Map<string, Set<(d: unknown, f: string) => void>>();
      members.set(info.frame, { info, on });
      return {
        get online() {
          return bus.online;
        },
        self: info.frame,
        peers: () => [...members.values()].map((m) => m.info),
        leader: () => null,
        send(topic, data, to) {
          if (!bus.online) return;
          log.push({ topic, from: info.frame, to });
          for (const [frame, m] of members) {
            if (frame === info.frame || (to !== undefined && to !== frame)) continue;
            for (const cb of m.on.get(topic) ?? []) cb(structuredClone(data), info.frame);
          }
        },
        on(topic, cb) {
          let set = on.get(topic);
          if (!set) on.set(topic, (set = new Set()));
          set.add(cb);
          return () => set.delete(cb);
        },
        onPeers: () => () => {},
        leave() {
          members.delete(info.frame);
        },
      };
    },
  };
  return bus;
};

/** A cover with `columns` columns, the listed ones worked, and `active` slots in use. */
export const coverOf = (columns: number, working: number[] = [], active = 0) => ({
  columns,
  working: (c: number) => working.includes(c),
  active,
});
