/**
 * The chapter contract. A chapter is a module in `chapters/<id>/index.ts` whose default export is
 * a `ChapterDef`. The poster shell (card.ts) owns everything common to every card: the headline,
 * date tag, caption, "So" line, the Maths button and fold, tabs or Back and Next, the ghost hand,
 * the beam stubs at the card's edges, hit-testing and bots. A chapter owns its watch view, its
 * figure and its controls.
 *
 * All geometry is venue px in frame coordinates: the card's canvas is set up so a chapter draws
 * at the same numbers its layout gave it.
 *
 * What a chapter gives the bank's screen (and the wall's banner) is small: `state()`, a few
 * integers, and two pure functions of such a state, `watch` (its watch view, drawn again at the
 * screen's size) and `drive` (what it does to the shared machine).
 */
import type { Line } from "./captions";
import type { CrystalId } from "./crystals";
import type { Config } from "./config";
import type { Control, Gesture } from "./controls";
import type { Engine, PatternView, Tint } from "./engine/client";
import type { Link } from "./formula";
import type { ChapterId } from "./ids";
import type { Layer3D } from "./layer3d";
import type { CardLayout, Rect } from "./layout";
import type { DetectorKind, StageAngles } from "./machine";
import type { MapStore } from "./maps";
import type { FrameKind, OptionValue, Rng } from "../../core/types";

/** A chapter's state for the screen: integers, at most MAX_STATE of them. */
export type ChapterState = readonly number[];
export const MAX_STATE = 8;

/** What the shell lends a chapter. */
export interface ChapterEnv {
  readonly id: ChapterId;
  readonly kind: Exclude<FrameKind, "screen">;
  readonly config: Config;
  /** A stream that is the same on every frame for this chapter. */
  readonly rng: Rng;
  /** The frame's diffraction engine, started on first use. */
  engine(): Engine;
  /** The frame's 3D layer, started on first use. */
  layer3d(): Layer3D;
  readonly maps: MapStore;
  /** The card's formula link: figure and fold pulse together. */
  readonly link: Link;
  /** The chapter's key move happened: show its "So" line until idle. */
  earn(): void;
  /** Whether the card's Maths fold is open now (optional, so test stand-ins can leave it out). */
  mathsOpen?(): boolean;
  /**
   * Show another of the chapter's own lines (from captions.ts) as its caption or "So" line for
   * now, as chapter 9 does after its swap; null or absent puts the usual one back. A "So" line
   * still shows only once earned. Reset puts both back.
   */
  say?(lines: { caption?: Line | null; so?: Line | null }): void;
  /**
   * The figure has left the state that earned the "So" line (true) or is back in it (false): the
   * card dims an earned "So" line meanwhile, so the words and the picture agree. Reset clears it.
   */
  away?(away: boolean): void;
  /** performance.now(). */
  now(): number;
}

/** One step of an attract demo, played by a ghost finger through the real controls. */
export type DemoStep =
  /** A gesture on a control: a slider or rotary to `to`, a choice to option `to`, a tap otherwise. */
  | { control: string; to?: number; ms?: number }
  /** Any gesture, venue px. */
  | { gesture: Gesture }
  | { wait: number }
  /** Open or close the Maths fold. */
  | { maths: boolean }
  /** Touch a formula part, as a finger on the fold would. */
  | { part: string };

export interface Chapter {
  /** Place everything in the card's areas, and make or move the controls. Called again on resize. */
  layout(card: CardLayout): void;
  /** Hit-tested in order, last first, so later controls sit on top. */
  readonly controls: readonly Control[];
  /** Fixed step, seconds. Read control values here. */
  update(dt: number, now: number): void;
  /** Draw the watch view and the figure; the card draws the controls after. */
  draw(g: CanvasRenderingContext2D, now: number): void;
  /** A linked part of the figure under a finger, so touching it pulses the formula. */
  partAt?(x: number, y: number): string | null;
  /** Live numbers for the Maths fold, a line each. */
  numbers(): readonly string[];
  state(): ChapterState;
  /** The attract demo: it must make the key move happen, so the "So" line shows. */
  demo(): readonly DemoStep[];
  /** A bot's move; null or absent picks a random control and a random value. */
  botMove?(rand: () => number): DemoStep | null;
  /** Where the resting ghost hand points, between demos: usually the main control. */
  hint(): { x: number; y: number } | null;
  status(): Record<string, OptionValue>;
  /** Back to the starting state. */
  reset(): void;
  /** The card shows this chapter, or stops showing it (hide 3D views, pause work). */
  show(shown: boolean): void;
  dispose(): void;
}

/** What a chapter does to the shared machine on the screen and the wall's banner. */
export interface MachineDrive {
  /** The tube's wavelength, Å; null for light no crystal diffracts (the detector stays dark). */
  lambda?: number | null;
  sample?: {
    /** Which crystal; a fibre may leave it out, keeping the machine's own. */
    crystal?: CrystalId;
    form: "single" | "powder" | "foil" | "fibre";
    /** Foil: how far the grains stray, degrees. */
    spread?: number;
  };
  stage?: Partial<StageAngles>;
  arm?: number;
  distance?: number;
  detector?: DetectorKind;
  /** How bright the detector's flash is now, 0 to 1. */
  flash?: number;
  /** The computer's picture: rebuilt atoms, as a share of the spots added. */
  rebuilt?: number;
}

/** What the host lends a watch drawing: the screen or a frame. */
export interface WatchLook {
  /** A pattern view kept for this drawing place across calls, by name. */
  view(name: string, tint?: Tint): PatternView;
  /** Engine grid size here: 256 on frames, 512 for the screen's big picture. */
  readonly size: 256 | 512;
  readonly maps: MapStore;
  readonly config: Config;
  readonly now: number;
}

export interface ChapterDef {
  id: ChapterId;
  /** Inclusive integer ranges of each `state()` value, for checking messages. */
  state: readonly (readonly [number, number])[];
  /** The state at reset: what the screen shows for this chapter before it hears anything. */
  start: ChapterState;
  /**
   * A state that moves by itself, `t` seconds into a showing, so a screen with no frames can play
   * the chapter's watch view. Absent: the start state, still.
   */
  play?(t: number): ChapterState;
  /** Colours of the formula's parts, which the figure uses for the same things. */
  parts: Readonly<Record<string, string>>;
  /**
   * Share of a column card's middle the figure takes, the watch view getting the rest (0.32 to
   * 0.62, default 0.5). The beam's height doesn't move, so a bank's beam still lines up.
   */
  split?: number;
  /**
   * On the kiosk, the watch view's share of the card's width (0.3 to 0.6, default 0.47): less for
   * a chapter whose figure needs the room.
   */
  kioskWatch?: number;
  /**
   * What the open Maths fold covers: the watch view and caption (default), or the caption and
   * figure, for a chapter whose watch view shows the maths itself (chapter 5's lattice).
   */
  foldOver?: "watch" | "figure";
  create(env: ChapterEnv): Chapter;
  /** The watch view for a state, into `rect`. Pure apart from the engine and maps in `look`. */
  watch(g: CanvasRenderingContext2D, rect: Rect, state: ChapterState, look: WatchLook): void;
  drive?(state: ChapterState): MachineDrive;
}

/** A state checked against the chapter's ranges: integers, in range, the right length. */
export const checkState = (def: Pick<ChapterDef, "state">, v: unknown): ChapterState | null => {
  if (!Array.isArray(v) || v.length !== def.state.length || v.length > MAX_STATE) return null;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    const [lo, hi] = def.state[i]!;
    if (typeof x !== "number" || !Number.isInteger(x) || x < lo || x > hi) return null;
  }
  return v as number[];
};

/** Quantise a number into a state value: `v / step`, rounded and clamped to the range. */
export const quant = (v: number, step: number, range: readonly [number, number]): number =>
  Math.max(range[0], Math.min(range[1], Math.round((Number.isFinite(v) ? v : 0) / step)));
