/**
 * What a host lends a chapter's `watch` drawing: pattern views kept by name between calls, the
 * engine's grid size, the simulated maps and the options. The screen draws every slot's watch view
 * from states it hears, so it keeps one view per place it draws.
 */
import type { WatchLook } from "./chapter";
import type { Config } from "./config";
import type { Engine, PatternView, Tint } from "./engine/client";
import type { MapStore } from "./maps";

const MAX_NAMED = 8;

export interface WatchHost {
  /** A look for one drawing place: its views are named under `scope`. */
  look(scope: string, now: number): WatchLook;
  dispose(): void;
}

export const createWatchHost = (
  engine: () => Engine,
  size: 256 | 512,
  maps: MapStore,
  config: Config,
): WatchHost => {
  const views = new Map<string, PatternView>();
  const get = (key: string, tint: Tint) => {
    let v = views.get(key);
    if (!v) {
      if (views.size >= MAX_NAMED) {
        const [first, old] = views.entries().next().value!;
        old.release();
        views.delete(first);
      }
      v = engine().view({ tint });
      views.set(key, v);
    }
    return v;
  };
  return {
    look(scope, now) {
      return {
        view: (name, tint = "recip") => get(`${scope}:${name}:${tint}`, tint),
        size,
        maps,
        config,
        now,
      };
    },
    dispose() {
      for (const v of views.values()) v.release();
      views.clear();
    },
  };
};
