/**
 * One ring's words as a model: the crawl, the tape and the schedule that feeds it, with no
 * drawing, so tests can run it for hours in a moment.
 */
import type { Line, Schedule } from "./schedule";
import { type Crawl, createTape, headAt, printerX, type Tape, type TapeItem } from "./tape";

const RECENT = 32;

export type Piece = { kind: "line"; line: Line } | { kind: "star"; n: number };

export interface RingModelOptions {
  crawl: Crawl;
  /** The dot grid's spacing, px; items start on it. */
  pitch: number;
  /** Printed ahead of the printer, px, so the next tile is ready before it shows. */
  lookahead: number;
  schedule: Schedule;
  /** Width of a line's lettering and its padding, px. */
  measure(line: Line): number;
  /** Width of the star between lines, px. */
  starWidth: number;
  /** The clock, ms, for the time and the date. */
  now(): number;
  /** Show time when this ring started, s: the schedule counts in show time. */
  startS?: number;
}

export interface Shown {
  item: TapeItem<Piece>;
  /**
   * Its left edge, unwrapped: the printer's x less how far behind the head it is, so it runs
   * from printer - width (about to go) up to the printer. Draw it at `wrapOffsets`.
   */
  x: number;
}

export interface RingModel {
  readonly crawl: Crawl;
  readonly tape: Tape<Piece>;
  readonly t: number;
  /** Lines printed so far. */
  readonly printed: number;
  /** The last few lines printed, oldest first. */
  recent(): readonly Line[];
  /** Move to `t` seconds into the show, printing and forgetting as needed. */
  advance(t: number): void;
  /** Tape position at the printer now. */
  head(): number;
  /** The printer's x now, in [0, width). */
  printer(): number;
  /** Items on the ring now, oldest first; `x` is unwrapped, from printer - width to printer. */
  shown(): Shown[];
  /** The lines on the ring now, oldest first. */
  lines(): Line[];
}

export const createRingModel = (o: RingModelOptions): RingModel => {
  const { crawl } = o;
  const W = crawl.width;
  // At the start the ring is already full, as if it had been running.
  const tape = createTape<Piece>(headAt(crawl, 0) - W, o.pitch);
  let t = 0;
  let printed = 0;
  let stars = 0;
  const recent: Line[] = [];

  const fill = () => {
    const want = headAt(crawl, t) + o.lookahead;
    while (tape.end < want) {
      const line = o.schedule.next((o.startS ?? 0) + t, o.now());
      tape.append(o.measure(line), { kind: "line", line });
      recent.push(line);
      if (recent.length > RECENT) recent.shift();
      tape.append(o.starWidth, { kind: "star", n: stars++ });
      printed++;
    }
    tape.dropBefore(headAt(crawl, t) - W);
  };
  fill();

  const model: RingModel = {
    crawl,
    tape,
    get t() {
      return t;
    },
    get printed() {
      return printed;
    },
    recent: () => recent,
    advance(next) {
      t = next;
      fill();
    },
    head: () => headAt(crawl, t),
    printer: () => printerX(crawl, t),
    shown() {
      const head = headAt(crawl, t);
      const px = printerX(crawl, t);
      const out: Shown[] = [];
      for (const item of tape.items) {
        if (item.start >= head) break;
        if (item.start + item.width <= head - W) continue;
        out.push({ item, x: px - (head - item.start) });
      }
      return out;
    },
    lines: () =>
      model.shown().flatMap((s) => (s.item.data.kind === "line" ? [s.item.data.line] : [])),
  };
  return model;
};
