/**
 * Light between the frames of a bank. A touch frame finds its neighbours by `pos` among the
 * touch frames on its side, sends each the light leaving through the shared edge whenever that
 * changes (at most 20 times a second) and every second, and keeps what each neighbour sends for
 * two seconds after its last message. Light leaving through the top edge goes to the screen on
 * its side, if there is one.
 */
import type { Channel, PeerInfo } from "../../core/types";
import { BEAM_BEAT_MS, BEAM_EXPIRE_MS, BEAM_MIN_MS } from "./config";
import { type EdgeBeam, type SkyBeam, TOPIC, decodeEdge, encodeEdge, encodeSky } from "./wire";

const sideOf = (p: PeerInfo) => p.side ?? 0;

export interface EdgeLink {
  /** Light that arrived through the left and right edges, still fresh. */
  incoming(): { left: EdgeBeam[]; right: EdgeBeam[] };
  /** Whether a frame is next to this one on each side. */
  neighbours(): { left: string | null; right: string | null; screen: string | null };
  /** Light leaving through the left, right and top edges now. */
  setOut(
    left: readonly EdgeBeam[],
    right: readonly EdgeBeam[],
    sky: readonly SkyBeam[],
    serial?: number,
  ): void;
  /** Send what is due. */
  tick(): void;
  /** Called when fresh light arrives or old light expires. */
  onChange(cb: () => void): () => void;
  dispose(): void;
}

interface Out {
  key: string;
  sentKey: string;
  sentAt: number;
  data: unknown;
  to: string | null;
}

export const createEdgeLink = (
  net: Channel,
  opts: { pos: number; side: number; now: () => number },
): EdgeLink => {
  const got: { left: { beams: EdgeBeam[]; at: number }; right: { beams: EdgeBeam[]; at: number } } =
    {
      left: { beams: [], at: -Infinity },
      right: { beams: [], at: -Infinity },
    };
  const listeners = new Set<() => void>();
  let hadLeft = false;
  let hadRight = false;
  const changed = () => {
    for (const cb of listeners) cb();
  };

  const stations = () => net.peers().filter((p) => p.role !== "screen" && sideOf(p) === opts.side);
  const neighbours = () => {
    let left: string | null = null;
    let right: string | null = null;
    for (const p of stations()) {
      if (p.frame === net.self) continue;
      if (p.pos === opts.pos - 1) left = p.frame;
      else if (p.pos === opts.pos + 1) right = p.frame;
    }
    const screen =
      net.peers().find((p) => p.role === "screen" && sideOf(p) === opts.side)?.frame ?? null;
    return { left, right, screen };
  };

  const off = net.on(TOPIC.beam, (data, from) => {
    const n = neighbours();
    const edge = from === n.left ? "left" : from === n.right ? "right" : null;
    if (!edge) return;
    const beams = decodeEdge(data);
    if (!beams) return;
    const slot = got[edge];
    const before = JSON.stringify(slot.beams);
    slot.beams = beams;
    slot.at = opts.now();
    if (edge === "left") hadLeft = beams.length > 0;
    else hadRight = beams.length > 0;
    if (JSON.stringify(beams) !== before) changed();
  });

  const outs: Record<"left" | "right" | "sky", Out> = {
    left: { key: "", sentKey: "", sentAt: -Infinity, data: null, to: null },
    right: { key: "", sentKey: "", sentAt: -Infinity, data: null, to: null },
    sky: { key: "", sentKey: "", sentAt: -Infinity, data: null, to: null },
  };

  const fresh = (slot: { beams: EdgeBeam[]; at: number }) =>
    opts.now() - slot.at <= BEAM_EXPIRE_MS ? slot.beams : [];

  return {
    incoming() {
      return { left: fresh(got.left), right: fresh(got.right) };
    },
    neighbours,
    setOut(left, right, sky, serial = 0) {
      const set = (o: Out, data: unknown) => {
        const key = JSON.stringify(data);
        o.key = key;
        o.data = data;
      };
      set(outs.left, encodeEdge(left));
      set(outs.right, encodeEdge(right));
      set(outs.sky, encodeSky(opts.pos, sky, serial));
    },
    tick() {
      const t = opts.now();
      // Light that has gone stale counts as gone.
      const l = fresh(got.left).length > 0;
      const r = fresh(got.right).length > 0;
      if (l !== hadLeft || r !== hadRight) {
        hadLeft = l;
        hadRight = r;
        changed();
      }
      if (!net.online) return;
      const n = neighbours();
      const targets: Record<"left" | "right" | "sky", string | null> = {
        left: n.left,
        right: n.right,
        sky: n.screen,
      };
      for (const k of ["left", "right", "sky"] as const) {
        const o = outs[k];
        const to = targets[k];
        if (!to || o.data === null) continue;
        const due = o.key !== o.sentKey || to !== o.to ? BEAM_MIN_MS : BEAM_BEAT_MS;
        if (t - o.sentAt < due) continue;
        net.send(k === "sky" ? TOPIC.sky : TOPIC.beam, o.data, to);
        o.sentAt = t;
        o.sentKey = o.key;
        o.to = to;
      }
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      off();
      listeners.clear();
    },
  };
};
