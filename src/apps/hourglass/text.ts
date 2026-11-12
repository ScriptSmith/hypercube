/**
 * What the rings of lettering say, and how a line is set round a ring: repeated as a sign
 * repeats it when it fits several times, crawling when someone standing still would otherwise
 * never see all of it.
 */
import { cutText } from "../../core/options";
import type { OptionValues } from "../../core/types";
import { TEXT_MAX } from "./manifest";

/** Shown in the countdown's place once the sand has run out, unless the operator set a line. */
export const TIMES_UP = "Time's up";

/**
 * Punctuation beyond Latin-1 that the lettering draws: the two long dashes, curly quotes and the
 * ellipsis, by code point.
 */
const EXTRA = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026]);

/**
 * Whether the lettering draws a character: Latin letters with their accents, digits and everyday
 * punctuation. Anything else, such as a pictograph the display's font may lack, is dropped.
 */
const drawn = (code: number): boolean =>
  (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || EXTRA.has(code);

/** An operator's line as the rings draw it. Anything but a string is no line. */
export const cleanLine = (value: unknown, max = TEXT_MAX): string => {
  if (typeof value !== "string") return "";
  let kept = "";
  for (const ch of value) kept += drawn(ch.codePointAt(0) ?? 0) ? ch : " ";
  return cutText(kept.replace(/\s+/g, " "), max);
};

export interface Lines {
  /** Shown all day on its own ring. */
  message: string;
  /** The operator's own line for when the sand has run out. */
  ending: string;
  countdown: boolean;
}

export const linesOf = (o: OptionValues): Lines => ({
  message: cleanLine(o.message),
  ending: cleanLine(o.ending),
  countdown: o.countdown !== false,
});

/**
 * What the countdown's rings say. With the countdown switched off they stay empty through the
 * run, and afterwards carry only a line the operator wrote.
 */
export const timeLine = (lines: Lines, running: boolean, countdown: string): string => {
  if (running) return lines.countdown ? countdown : "";
  return lines.ending || (lines.countdown ? TIMES_UP : "");
};

export interface RingFit {
  /** Copies of the line round the ring; 0 when it is longer than the ring. */
  repeats: number;
  /** From the start of one copy to the start of the next, in the units `textLength` came in. */
  period: number;
  /** The line is longer than the ring, so it appears and leaves at one place on it. */
  seam: boolean;
  crawl: boolean;
}

/** A ring shows at least this many copies before it can stand still. */
const STILL_COPIES = 3;

/**
 * Set a line `textLength` long round a ring `around` long, leaving at least `gap` between
 * copies. A ring that must be read from one spot (`still`) stands still when it holds enough
 * copies for everyone to face one.
 */
export const fitRing = (
  textLength: number,
  around: number,
  gap: number,
  still: boolean,
): RingFit => {
  const repeats = Math.floor(around / (textLength + gap));
  if (repeats < 1) return { repeats: 0, period: textLength + gap, seam: true, crawl: true };
  return {
    repeats,
    period: around / repeats,
    seam: false,
    crawl: !still || repeats < STILL_COPIES,
  };
};
