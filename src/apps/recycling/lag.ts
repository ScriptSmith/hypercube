/**
 * Debug only: a channel whose sends wait out a set delay, like a slow network, so tests can
 * check that items still cross the bezel without a jump.
 */
import type { Channel } from "../../core/types";

const MAX_HELD = 256;

export interface Lagged {
  readonly net: Channel;
  lag: number;
  dispose(): void;
}

export const createLagged = (base: Channel): Lagged => {
  const held = new Set<number>();
  const state = { lag: 0 };
  const net: Channel = {
    get online() {
      return base.online;
    },
    get self() {
      return base.self;
    },
    peers: () => base.peers(),
    leader: () => base.leader(),
    on: (topic, cb) => base.on(topic, cb),
    onPeers: (cb) => base.onPeers(cb),
    send(topic, data, to) {
      if (state.lag <= 0) {
        base.send(topic, data, to);
        return;
      }
      if (held.size >= MAX_HELD) return;
      const id = window.setTimeout(() => {
        held.delete(id);
        base.send(topic, data, to);
      }, state.lag);
      held.add(id);
    },
  };
  return {
    net,
    get lag() {
      return state.lag;
    },
    set lag(ms: number) {
      state.lag = Math.max(0, Math.min(3000, ms));
    },
    dispose() {
      for (const id of held) window.clearTimeout(id);
      held.clear();
    },
  };
};
