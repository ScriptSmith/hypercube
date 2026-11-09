import { BELT_SPEED } from "../../../src/apps/recycling/config";
import { ITEMS, type ItemId } from "../../../src/apps/recycling/items";
import { type Layout, layoutFor } from "../../../src/apps/recycling/layout";
import { createWorld, type World } from "../../../src/apps/recycling/world";
import { DEFAULT_REACH, VENUE_SIZE } from "../../../src/core/frame";
import type { Channel, FrameKind, PeerInfo } from "../../../src/core/types";

export const DT = 1 / 60;
export const TOUCH_KINDS = ["panel", "pair", "kiosk", "wall"] as const;
export type TouchKind = (typeof TOUCH_KINDS)[number];

export const layoutOf = (kind: TouchKind, variant: "sort" | "simple" = "sort"): Layout => {
  const { width, height } = VENUE_SIZE[kind];
  const reach = DEFAULT_REACH[kind];
  return layoutFor({
    kind,
    width,
    height,
    reachTop: { adult: height * (1 - reach.adult), child: height * (1 - reach.child) },
    seams: kind === "pair" ? [width / 2] : [],
    variant,
  });
};

export const worldOf = (
  kind: TouchKind,
  o: {
    variant?: "sort" | "simple";
    hints?: boolean;
    maxItems?: number;
    goal?: number;
    speed?: number;
  } = {},
): World => {
  const layout = layoutOf(kind, o.variant ?? "sort");
  return createWorld({
    layout,
    hints: o.hints ?? true,
    beltSpeed: (b) => (o.speed ?? 1) * BELT_SPEED[b.speed] * layout.d,
    liftGoal: () => o.goal ?? layout.ground,
    maxItems: o.maxItems ?? 60,
  });
};

export const kindOf = (id: ItemId): number => ITEMS.findIndex((it) => it.id === id);

/** Step a world `seconds`, advancing a fake clock from `t0` ms; stop early when `until` holds. */
export const run = (
  w: World,
  seconds: number,
  clock: { t: number },
  until?: () => boolean,
): boolean => {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    clock.t += DT * 1000;
    w.step(DT, clock.t);
    if (until?.()) return true;
  }
  return false;
};

/** Put an item straight onto a belt at `s`, by dropping it in and stepping until it rides. */
export const onBelt = (w: World, line: number, kind: number, clock: { t: number }) => {
  const it = w.spawn(line, kind, clock.t);
  if (!it) throw new Error("no room");
  run(w, 20, clock, () => it.state === "belt");
  if (it.state !== "belt") throw new Error(`item stuck in ${it.state}`);
  return it;
};

/** Drag a held item along points with the finger, a step per frame. */
export const dragTo = (
  w: World,
  finger: number,
  pts: { x: number; y: number }[],
  clock: { t: number },
  stepsPer = 8,
) => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    for (let k = 1; k <= stepsPer; k++) {
      w.move(finger, a.x + ((b.x - a.x) * k) / stepsPer, a.y + ((b.y - a.y) * k) / stepsPer);
      clock.t += DT * 1000;
      w.step(DT, clock.t);
    }
  }
};

export interface Bus {
  join(info: Partial<PeerInfo> & { frame: string }): Channel & { leave(): void };
  readonly log: { topic: string; from: string; to?: string; data: unknown }[];
  online: boolean;
}

export const createBus = (): Bus => {
  const members = new Map<
    string,
    { info: PeerInfo; handlers: Map<string, Set<(d: unknown, f: string) => void>> }
  >();
  const log: Bus["log"] = [];
  const bus: Bus = {
    log,
    online: true,
    join(partial) {
      const info: PeerInfo = {
        app: "recycling",
        group: "g",
        kind: "panel" as FrameKind,
        role: "station",
        pos: 0,
        side: 0,
        ...partial,
      };
      const handlers = new Map<string, Set<(d: unknown, f: string) => void>>();
      members.set(info.frame, { info, handlers });
      return {
        get online() {
          return bus.online;
        },
        self: info.frame,
        peers: () => [...members.values()].map((m) => m.info),
        leader: () => null,
        send(topic, data, to) {
          if (!bus.online) return;
          log.push({ topic, from: info.frame, to, data });
          if (log.length > 2000) log.shift();
          for (const [frame, m] of members) {
            if (frame === info.frame || (to !== undefined && to !== frame)) continue;
            for (const cb of m.handlers.get(topic) ?? []) cb(structuredClone(data), info.frame);
          }
        },
        on(topic, cb) {
          let set = handlers.get(topic);
          if (!set) handlers.set(topic, (set = new Set()));
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
