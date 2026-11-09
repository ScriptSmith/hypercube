/**
 * Holds outgoing car snapshots back by a set delay, as a slow network would. Tests use it
 * (`__traffic.setLag`) to check that cars stay whole across frame edges with added delay.
 */
import type { Channel } from "../../core/types";
import { TOPIC } from "./wire";

const MAX_TIMERS = 64;

export interface LagSend {
  send(topic: string, data: unknown, to?: string): void;
  setLag(ms: number): void;
  dispose(): void;
}

export const createLagSend = (net: Channel): LagSend => {
  let lag = 0;
  const timers = new Set<number>();
  return {
    send(topic, data, to) {
      if (lag <= 0 || topic !== TOPIC.cars) {
        net.send(topic, data, to);
        return;
      }
      if (timers.size >= MAX_TIMERS) return;
      const id = window.setTimeout(() => {
        timers.delete(id);
        net.send(topic, data, to);
      }, lag);
      timers.add(id);
    },
    setLag(ms) {
      lag = Math.max(0, Math.min(5000, ms));
    },
    dispose() {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    },
  };
};
