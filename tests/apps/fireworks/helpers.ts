import { readConfig } from "../../../src/apps/fireworks/config";
import {
  createDirector,
  type CornerSide,
  type ShowFit,
} from "../../../src/apps/fireworks/director";
import { createEngine } from "../../../src/apps/fireworks/engine";
import { bankSky } from "../../../src/apps/fireworks/sky";
import type { Channel, PeerInfo } from "../../../src/core/types";

export const W = 6 * 1080;

/**
 * A screen's director over a six-panel bank starting at `xo`. The show is off unless `show`
 * gives the show's span, so tests see only their own launches.
 */
export const screenDirector = (
  corner: CornerSide | null = null,
  xo = 0,
  show: Pick<ShowFit, "x0" | "x1"> | null = null,
  options: Record<string, string | number | boolean> = {},
) => {
  const engine = createEngine({ shells: 64, bursts: 96, budget: 80 });
  const config = { ...readConfig("build", options), ...(show ? {} : { showAfterMs: 1e9 }) };
  const director = createDirector({
    engine,
    config,
    seed: "test",
    sky: () => bankSky(W, xo),
    fit: () => ({
      x0: show?.x0 ?? xo,
      x1: show?.x1 ?? xo + W,
      launchY: -1500,
      density: 1,
      maxRank: 99,
      rx0: xo,
      rx1: xo + W,
    }),
    corner,
    pads: () => 6,
    showAllowed: () => show !== null,
  });
  return { engine, director };
};

/** A room in miniature: channels on one bus see each other's peers and messages at once. */
export interface Bus {
  join(info: Partial<PeerInfo> & { frame: string }): Channel & { leave(): void };
  /** Messages sent so far, for checks. */
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
        app: "fireworks",
        group: "g",
        kind: "panel",
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
