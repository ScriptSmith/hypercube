/**
 * Bots: injected touches on the tiles, sliders, buttons, More and the parts of the eye, through
 * the runtime's input like fingers. A bot stands back for a while after a person touches.
 */
import { type BotHand, createBotHand } from "../../core/input";
import type { Input, Rng } from "../../core/types";
import type { PartId } from "./captions";
import { PART_IDS } from "./captions";
import { BOT_YIELD_MS } from "./config";
import { sliderX } from "./controls";
import type { ButtonId, Layout, Rect } from "./layout";

export interface BotView {
  layout(): Layout;
  unit(): number;
  sliders(): number;
  buttons(): ReadonlySet<ButtonId>;
  more(): boolean;
  /** Where a part shows, venue px, or null. */
  partAt(part: PartId): { x: number; y: number } | null;
  lastPerson(): number;
}

export interface Bot {
  readonly actions: number;
  update(now: number): void;
  release(): void;
  dispose(): void;
}

const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const createBot = (input: Pick<Input, "inject">, rng: Rng, view: BotView): Bot => {
  const hand: BotHand = createBotHand(input);
  let busy = false;
  let next = 0;
  let actions = 0;
  let disposed = false;

  const tap = (p: { x: number; y: number }) => {
    const u = view.unit();
    return hand.tap(p.x * u, p.y * u, 90);
  };

  const act = async () => {
    const l = view.layout();
    const r = rng.next();
    if (r < 0.22) {
      const t = l.tiles[rng.int(l.tiles.length)];
      if (t) await tap(centre(t));
    } else if (r < 0.48) {
      const n = Math.min(view.sliders(), l.sliderSlots.length);
      const slot = n > 0 ? l.sliderSlots[rng.int(n)] : undefined;
      if (slot) {
        const y = slot.y + slot.height * 0.68;
        const from = sliderX(slot, rng.next());
        const to = sliderX(slot, rng.next());
        const u = view.unit();
        await hand.drag(
          Array.from({ length: 8 }, (_, i) => ({
            x: (from + ((to - from) * i) / 7) * u,
            y: y * u,
          })),
          900,
        );
      }
    } else if (r < 0.66) {
      const ids = [...view.buttons()].filter((b) => b !== "prev");
      const id = ids[rng.int(ids.length)];
      const rect = id ? l.buttons[id] : undefined;
      if (rect) await tap(centre(rect));
    } else if (r < 0.74) {
      if (view.more()) await tap(centre(l.more));
    } else {
      const part = rng.pick(PART_IDS);
      const chip = l.chips[PART_IDS.indexOf(part)];
      const at = chip ? centre(chip) : view.partAt(part);
      if (at) await tap(at);
    }
  };

  return {
    get actions() {
      return actions;
    },
    update(now) {
      if (disposed || busy) return;
      if (now - view.lastPerson() < BOT_YIELD_MS) return;
      if (now < next) return;
      next = now + 2200 + rng.next() * 2800;
      busy = true;
      actions++;
      act()
        .catch(() => undefined)
        .finally(() => {
          busy = false;
        });
    },
    release() {
      hand.release();
      busy = false;
    },
    dispose() {
      disposed = true;
      hand.dispose();
    },
  };
};
