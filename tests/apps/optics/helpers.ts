import type { Channel, FrameKind, PeerInfo, Role } from "../../../src/core/types";

/** A synchronous message bus standing in for a room's app channel, with a manual clock. */
export const createBus = () => {
  const members = new Map<
    string,
    { info: PeerInfo; handlers: Map<string, Set<(d: unknown, from: string) => void>> }
  >();
  let now = 0;
  let online = true;

  const leaderOf = () => {
    let best: PeerInfo | null = null;
    for (const { info: p } of members.values()) {
      if (
        !best ||
        (p.role === "screen" ? 0 : 1) - (best.role === "screen" ? 0 : 1) < 0 ||
        ((p.role === "screen") === (best.role === "screen") &&
          (p.pos < best.pos || (p.pos === best.pos && p.frame < best.frame)))
      ) {
        best = p;
      }
    }
    return best?.frame ?? null;
  };

  const join = (
    frame: string,
    opts: { role?: Role; pos?: number; kind?: FrameKind } = {},
  ): Channel => {
    const info: PeerInfo = {
      frame,
      app: "optics",
      group: "main",
      kind: opts.kind ?? "panel",
      role: opts.role ?? "station",
      pos: opts.pos ?? 0,
      side: 0,
    };
    const handlers = new Map<string, Set<(d: unknown, from: string) => void>>();
    members.set(frame, { info, handlers });
    return {
      get online() {
        return online && members.has(frame);
      },
      self: frame,
      peers: () => [...members.values()].map((m) => m.info),
      leader: leaderOf,
      send(topic, data, to) {
        if (!online || !members.has(frame)) return;
        for (const [id, m] of members) {
          if (id === frame || (to && id !== to)) continue;
          for (const cb of m.handlers.get(topic) ?? []) cb(JSON.parse(JSON.stringify(data)), frame);
        }
      },
      on(topic, cb) {
        let set = handlers.get(topic);
        if (!set) handlers.set(topic, (set = new Set()));
        set.add(cb);
        return () => set.delete(cb);
      },
      onPeers: () => () => {},
    };
  };

  return {
    join,
    leave: (frame: string) => members.delete(frame),
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    setOnline: (v: boolean) => {
      online = v;
    },
  };
};
