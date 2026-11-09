/**
 * The poster shell: one card showing one chapter at a time, from its list.
 *
 * The card owns the chrome every chapter shares: the headline with its number, the date tag, the
 * caption, the "So" line (hidden until the chapter's key move, then kept until reset), the Maths
 * button and its fold, the tabs or Back and Next, the ghost hand, and the beam's stubs from the
 * card's edges to the figure. It hit-tests every touch against the fold's parts, its own
 * controls, then the chapter's, so fingers, bots and demos share one path.
 *
 * Text is DOM (crisp, wrapped by the browser) with no pointer events; drawing is one canvas per
 * card, with a transform so chapters draw in frame venue px. The card paints no background, so a
 * chapter's 3D view shows through underneath.
 */
import { withAlpha } from "../../core/ui/palette";
import { FONT } from "../../core/ui/style";
import type { FrameInfo, FrameKind, OptionValue, Rng } from "../../core/types";
import { COMMON, type Line, TEXT } from "./captions";
import type { Chapter, ChapterDef, ChapterEnv, ChapterState } from "./chapter";
import { COLOR, type Config } from "./config";
import { Button, button, type Control, type Touch } from "./controls";
import { beam, disc, glow, ICON } from "./draw";
import type { Engine } from "./engine/client";
import { createFold, createLink, type Fold, type Link } from "./formula";
import { createHand, type GhostHand } from "./hand";
import type { ChapterId } from "./ids";
import { TAB_ICON } from "./tabicons";
import type { Layer3D } from "./layer3d";
import {
  type CardLayout,
  DEFAULT_SPLIT,
  foldOverFigure,
  inRect,
  withSplit,
  withWatchShare,
} from "./layout";
import type { MapStore } from "./maps";

export interface CardHost {
  root: HTMLElement;
  frame(): FrameInfo;
  kind: Exclude<FrameKind, "screen">;
  config: Config;
  defs: Readonly<Record<ChapterId, ChapterDef>>;
  engine(): Engine;
  layer3d(): Layer3D;
  maps: MapStore;
  rng(label: string): Rng;
  /** The number shown on a chapter's badge and tab. */
  numberOf(id: ChapterId): number;
}

export interface CardSnapshot {
  chapter: ChapterId;
  state: ChapterState;
  /** performance.now() of the latest touch on the chapter's controls, or -Infinity. */
  touchedAt: number;
  person: boolean;
  held: boolean;
}

export type CardMode = "attract" | "people";

export interface Card {
  readonly layout: CardLayout;
  readonly chapters: readonly ChapterId[];
  readonly chapter: ChapterId;
  readonly current: Chapter;
  readonly mathsOpen: boolean;
  readonly lastPerson: number;
  mode: CardMode;
  /** Between demos in attract: the ghost hand rests over the main control. */
  resting: boolean;
  /** A bright pulse travelling the beam, x in frame venue px, or null. */
  pulse: { x: number; strength: number } | null;
  setLayout(l: CardLayout): void;
  show(id: ChapterId): void;
  step(by: 1 | -1): void;
  /** True when the card took the touch. */
  down(t: Touch): boolean;
  move(t: Touch): void;
  up(t: Touch, cancelled: boolean): void;
  /** Every control a finger could use now: the shell's and the chapter's. */
  controls(): Control[];
  control(id: string): Control | undefined;
  setMaths(open: boolean): void;
  /** Where a formula part sits on the open fold, venue px. */
  partRect(part: string): { x: number; y: number; width: number; height: number } | null;
  earned(id: ChapterId): boolean;
  /** Whether the "So" line shows now (for tests: it must match `earned`). */
  soShown(): boolean;
  /** The formula part pulsing now, from a touch on the fold or the figure. */
  linked(): string | null;
  snapshot(): CardSnapshot;
  touches(): number;
  /**
   * Fingers that bots or demos have down on this card, venue px; `demo` when they play the
   * chapter's demo, so the hand carries the chapter's verb.
   */
  setGhost(points: readonly { x: number; y: number }[], demo?: boolean): void;
  update(dt: number, now: number): void;
  render(now: number): void;
  status(): Record<string, OptionValue>;
  /** First chapter, starting states, Maths as the option says, "So" lines hidden. */
  reset(): void;
  dispose(): void;
}

type Capture = { kind: "control"; c: Control } | { kind: "part" } | { kind: "swallow" };

const px = (v: number, u: number) => `${Math.round(v * u * 100) / 100}px`;

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The first hidden chapter is made this long after mount, ms. */
const WARM_START_MS = 1000;
/** Then one more every this long, ms. */
const WARM_GAP_MS = 250;

export const createCard = (
  host: CardHost,
  initial: CardLayout,
  chapters: readonly ChapterId[],
  startAt: ChapterId | null,
): Card => {
  let base = initial;
  let frame = host.frame();
  const list = [...chapters];
  const startIndex = startAt && list.includes(startAt) ? list.indexOf(startAt) : 0;
  let index = startIndex;
  /** The card's layout as a chapter wants its middle split, and its fold placed. */
  const splitFor = (id: ChapterId): CardLayout => {
    const def = host.defs[id];
    let l = withSplit(base, def.split ?? DEFAULT_SPLIT);
    if (def.kioskWatch !== undefined) l = withWatchShare(l, def.kioskWatch);
    return def.foldOver === "figure" ? foldOverFigure(l) : l;
  };
  let layout = splitFor(list[index]!);
  const instances = new Map<ChapterId, Chapter>();
  const earned = new Set<ChapterId>();
  const mathsAllowed = host.config.maths !== "off";
  let mathsOpen = host.config.maths === "open";
  const link: Link = createLink();
  const captured = new Map<number, Capture>();
  let lastPerson = Number.NEGATIVE_INFINITY;
  let ghosts: readonly { x: number; y: number }[] = [];
  let ghostDemo = false;
  let disposed = false;
  /** While a hidden chapter runs for its warm-up, which must not earn its "So" line. */
  let warming = false;
  let renderTick = 0;

  // ---- DOM -------------------------------------------------------------------------------------

  const wrap = document.createElement("div");
  wrap.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:2;font-family:${FONT};`;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;z-index:1;pointer-events:none;";
  host.root.append(canvas, wrap);
  const g = canvas.getContext("2d")!;

  const head = document.createElement("div");
  const badge = document.createElement("div");
  const headline = document.createElement("div");
  const tag = document.createElement("div");
  const caption = document.createElement("div");
  const so = document.createElement("div");
  const dots = document.createElement("div");
  const row = document.createElement("div");
  row.append(badge, headline);
  head.append(row, tag);
  wrap.append(head, caption, so, dots);
  let fold: Fold | null = null;
  let hand: GhostHand = createHand(wrap, frame.unit, layout.target * 1.15, layout.type.label);

  const placeDom = () => {
    const u = frame.unit;
    const t = layout.type;
    const h = layout.head;
    const badgeSize = t.headline * 1.25;
    head.style.cssText =
      `position:absolute;left:${px(h.x, u)};top:${px(h.y, u)};width:${px(h.width, u)};` +
      `height:${px(h.height, u)};display:flex;flex-direction:column;gap:${px(12, u)};overflow:hidden;`;
    row.style.cssText = `display:flex;align-items:flex-start;gap:${px(24, u)};flex:none;`;
    badge.style.cssText =
      `flex:none;width:${px(badgeSize, u)};height:${px(badgeSize, u)};border-radius:50%;` +
      `display:flex;align-items:center;justify-content:center;background:${COLOR.accent};` +
      `color:${COLOR.background};font:900 ${px(t.headline * 0.62, u)} ${FONT};margin-top:${px(t.headline * 0.02, u)};`;
    headline.style.cssText =
      `font:800 ${px(t.headline, u)} ${FONT};line-height:1.08;color:${COLOR.ink};` +
      `letter-spacing:-0.01em;text-wrap:balance;max-height:${px(t.headline * 2.2, u)};overflow:hidden;`;
    tag.style.cssText =
      `font:600 ${px(t.tag, u)} ${FONT};line-height:1.2;color:${COLOR.muted};overflow:hidden;` +
      "flex:1 1 auto;min-height:0;transition:opacity 0.6s ease-out;";
    const tx = layout.text;
    caption.style.cssText =
      `position:absolute;left:${px(tx.x, u)};top:${px(tx.y, u)};width:${px(tx.width, u)};` +
      `font:600 ${px(t.caption, u)} ${FONT};line-height:1.16;color:${COLOR.ink};` +
      `max-height:${px(t.caption * 2.36, u)};overflow:hidden;text-wrap:pretty;`;
    so.style.cssText =
      `position:absolute;left:${px(tx.x, u)};top:${px(tx.y + t.caption * 2.55, u)};width:${px(tx.width, u)};` +
      `font:800 ${px(t.so, u)} ${FONT};line-height:1.16;color:${COLOR.accent};` +
      `max-height:${px(t.so * 2.36, u)};overflow:hidden;text-wrap:pretty;transition:color 0.4s;`;
    const n = layout.nav?.dots;
    dots.style.cssText = n
      ? `position:absolute;left:${px(n.x, u)};top:${px(n.y, u)};width:${px(n.width, u)};height:${px(n.height, u)};` +
        `display:flex;align-items:center;justify-content:center;gap:${px(22, u)};`
      : "display:none;";
    const r = layout.rect;
    const k = frame.pixelRatio;
    canvas.style.left = px(r.x, u);
    canvas.style.top = px(r.y, u);
    canvas.style.width = px(r.width, u);
    canvas.style.height = px(r.height, u);
    canvas.width = Math.max(1, Math.round(r.width * u * k));
    canvas.height = Math.max(1, Math.round(r.height * u * k));
  };

  /** Shrink an element's font until its text fits its box, down to `min` of its size. */
  const fit = (el: HTMLElement, base: number, maxH: number, min = 0.66) => {
    let size = base;
    el.style.fontSize = `${size}px`;
    while (el.scrollHeight > maxH + 1 && size > base * min) {
      size *= 0.94;
      el.style.fontSize = `${size}px`;
    }
  };
  const fitAll = () => {
    const u = frame.unit;
    const t = layout.type;
    fit(headline, t.headline * u, t.headline * 2.2 * u);
    fit(tag, t.tag * u, Math.max(1, layout.head.height * u - row.offsetHeight - 12 * u), 0.7);
    fit(caption, t.caption * u, t.caption * 2.36 * u);
    // The So line sits under the caption, however many lines the caption took.
    so.style.top = `${caption.offsetTop + caption.offsetHeight + 10 * u}px`;
    const room =
      (layout.text.y + layout.text.height) * u -
      (caption.offsetTop + caption.offsetHeight + 10 * u);
    fit(so, t.so * u, Math.max(t.so * 1.2 * u, room));
  };

  /** Lines a chapter has put up in place of its usual caption or "So" line (`ChapterEnv.say`). */
  const said = new Map<ChapterId, { caption?: Line; so?: Line }>();
  /** Chapters whose figure has left the state that earned their "So" line (`ChapterEnv.away`). */
  const awayFrom = new Set<ChapterId>();
  const shownText: {
    headline: string;
    tag: string;
    caption: string;
    so: string;
    soOn: boolean;
    dots: string;
    fitted: CardLayout | null;
  } = { headline: "", tag: "", caption: "", so: "", soOn: false, dots: "", fitted: null };
  const refreshText = () => {
    const id = list[index]!;
    const t = TEXT[id];
    badge.textContent = String(host.numberOf(id));
    if (shownText.headline !== t.headline) headline.textContent = shownText.headline = t.headline;
    const tagText = t.tag?.text ?? "";
    if (shownText.tag !== tagText) tag.textContent = shownText.tag = tagText;
    const capText = said.get(id)?.caption?.text ?? t.caption.text;
    const soText = said.get(id)?.so?.text ?? t.so.text;
    let changed = false;
    if (shownText.caption !== capText) {
      caption.textContent = shownText.caption = capText;
      changed = true;
    }
    if (shownText.so !== soText) {
      so.textContent = shownText.so = soText;
      changed = true;
    }
    if (changed || shownText.fitted !== layout) {
      shownText.fitted = layout;
      fitAll();
    }
    const on = earned.has(id);
    // Set every time: placing the text rewrites its style, and the line starts hidden.
    so.style.visibility = on ? "visible" : "hidden";
    // Under an open fold the text hides, so no letter shows past the fold's rounded corner.
    const covered = mathsOpen && overlaps(layout.fold, layout.text);
    caption.style.visibility = covered ? "hidden" : "visible";
    so.style.color = covered
      ? "transparent"
      : on && awayFrom.has(id)
        ? withAlpha(COLOR.accent, 0.4)
        : COLOR.accent;
    // The date tag is the reward after the answer: the headline leads straight into the picture.
    tag.style.opacity = on ? "1" : "0";
    if (on !== shownText.soOn) {
      shownText.soOn = on;
      so.className = on ? "hc-anim-fade-in" : "";
    }
    if (layout.nav) {
      const key = `${index}/${list.length}`;
      if (shownText.dots !== key) {
        shownText.dots = key;
        const u = frame.unit;
        dots.replaceChildren(
          ...list.map((_, i) => {
            const d = document.createElement("span");
            const s = i === index ? 30 : 20;
            d.style.cssText =
              `width:${px(s, u)};height:${px(s, u)};border-radius:50%;` +
              `background:${i === index ? COLOR.accent : withAlpha(COLOR.ink, 0.3)};`;
            return d;
          }),
        );
      }
    }
  };

  // ---- Chapters ----------------------------------------------------------------------------

  const envFor = (id: ChapterId): ChapterEnv => ({
    id,
    kind: host.kind,
    config: host.config,
    rng: host.rng(`xrd:${id}`),
    engine: host.engine,
    layer3d: host.layer3d,
    maps: host.maps,
    link,
    earn() {
      if (warming || earned.has(id)) return;
      earned.add(id);
      refreshText();
    },
    mathsOpen: () => mathsOpen,
    away(a) {
      if (a === awayFrom.has(id)) return;
      if (a) awayFrom.add(id);
      else awayFrom.delete(id);
      if (list[index] === id) refreshText();
    },
    say(lines) {
      const now = { caption: lines.caption ?? undefined, so: lines.so ?? undefined };
      const before = said.get(id);
      if (before?.caption === now.caption && before?.so === now.so) return;
      if (!now.caption && !now.so) said.delete(id);
      else said.set(id, now);
      if (list[index] === id) refreshText();
    },
    now: () => performance.now(),
  });

  const instance = (id: ChapterId): Chapter => {
    let c = instances.get(id);
    if (!c) {
      c = host.defs[id].create(envFor(id));
      c.layout(splitFor(id));
      instances.set(id, c);
    }
    return c;
  };

  const rebuildFold = () => {
    fold?.dispose();
    fold = null;
    if (!mathsAllowed) return;
    const id = list[index]!;
    fold = createFold(
      wrap,
      TEXT[id].maths,
      host.defs[id].parts,
      layout.fold,
      frame.unit,
      layout.type,
    );
    fold.show(mathsOpen);
  };

  // ---- The shell's own controls --------------------------------------------------------------

  let shell: Control[] = [];
  let mathsButton: Button | null = null;
  let tabs: Button[] = [];
  const buildShell = () => {
    shell = [];
    tabs = [];
    mathsButton = null;
    if (mathsAllowed && layout.maths) {
      mathsButton = button({
        id: "maths",
        rect: layout.maths,
        band: "adult",
        label: COMMON.maths,
        color: COLOR.accent,
        on: mathsOpen,
        size: layout.type.label,
        onPress: () => setMaths(!mathsOpen),
      });
      shell.push(mathsButton);
    }
    if (layout.tabs.length > 0) {
      tabs = layout.tabs.slice(0, list.length).map((r, i) =>
        button({
          id: `tab:${list[i]}`,
          rect: r,
          band: "child",
          label: String(host.numberOf(list[i]!)),
          icon: TAB_ICON[list[i]!],
          tight: true,
          color: COLOR.ink,
          on: i === index,
          size: Math.min(r.height * 0.44, 56),
          onPress: () => showIndex(i),
        }),
      );
      shell.push(...tabs);
    }
    if (layout.nav && list.length > 1) {
      shell.push(
        button({
          id: "back",
          rect: layout.nav.back,
          band: "child",
          label: COMMON.back,
          icon: ICON.back,
          color: COLOR.ink,
          size: layout.type.label,
          onPress: () => step(-1),
        }),
        button({
          id: "next",
          rect: layout.nav.next,
          band: "child",
          label: COMMON.next,
          icon: ICON.next,
          color: COLOR.ink,
          size: layout.type.label,
          onPress: () => step(1),
        }),
      );
    }
  };

  const setMaths = (open: boolean) => {
    if (!mathsAllowed) return;
    mathsOpen = open;
    if (mathsButton) mathsButton.on = open;
    fold?.show(open);
    if (!open) link.reset();
    refreshText();
  };

  const showIndex = (i: number) => {
    const next = Math.max(0, Math.min(list.length - 1, i));
    if (next === index && instances.has(list[next]!)) return;
    instances.get(list[index]!)?.show(false);
    for (const [, c] of captured) if (c.kind === "control") c.c.release();
    captured.clear();
    index = next;
    layout = splitFor(list[index]!);
    placeDom();
    instance(list[index]!).show(true);
    tabs.forEach((t, k) => {
      t.on = k === index;
    });
    link.reset();
    rebuildFold();
    refreshText();
  };

  const step = (by: 1 | -1) => showIndex((index + by + list.length) % list.length);

  placeDom();
  buildShell();
  instance(list[index]!).show(true);
  rebuildFold();
  refreshText();

  // The card's other chapters are made one at a time soon after mount and run once out of sight,
  // so a first visit shows at once (3D scenes compile in the background meanwhile) and the
  // frame's memory settles in seconds, not on each chapter's first turn.
  const scratch = document.createElement("canvas");
  scratch.width = 1;
  scratch.height = 1;
  const sg = scratch.getContext("2d")!;
  let warmTimer = 0;
  let lastWarm: ChapterId | null = null;
  const runHidden = (id: ChapterId) => {
    const c = instance(id);
    const t = performance.now();
    c.show(true);
    warming = true;
    try {
      c.update(1 / 30, t);
      sg.save();
      try {
        c.draw(sg, t);
      } finally {
        sg.restore();
      }
    } catch (err) {
      console.error("[xrd] chapter warm-up failed", err);
    }
    warming = false;
    c.show(false);
  };
  const warm = () => {
    warmTimer = 0;
    if (disposed) return;
    // The previous chapter again, now its pictures are back, then the next.
    if (lastWarm && lastWarm !== list[index]) runHidden(lastWarm);
    const id = list.find((c) => !instances.has(c)) ?? null;
    lastWarm = id;
    if (!id) return;
    runHidden(id);
    warmTimer = window.setTimeout(warm, WARM_GAP_MS);
  };
  warmTimer = window.setTimeout(warm, WARM_START_MS);

  const current = () => instance(list[index]!);

  // ---- Touch -----------------------------------------------------------------------------------

  const pick = (t: Touch): Capture | null => {
    if (fold && mathsOpen) {
      // Formula parts can be a single letter, so each answers within a target-sized box round its
      // middle; the nearest wins.
      let best: string | null = null;
      let bestD = Number.POSITIVE_INFINITY;
      const half = layout.target / 2;
      for (const p of fold.parts()) {
        const cx = p.rect.x + p.rect.width / 2;
        const cy = p.rect.y + p.rect.height / 2;
        const hw = Math.max(half, p.rect.width / 2);
        const hh = Math.max(half, p.rect.height / 2);
        if (Math.abs(t.x - cx) > hw || Math.abs(t.y - cy) > hh) continue;
        const d = Math.hypot(t.x - cx, t.y - cy);
        if (d < bestD) {
          bestD = d;
          best = p.part;
        }
      }
      if (best) {
        link.touch(best, t.time);
        return { kind: "part" };
      }
      if (inRect(layout.fold, t.x, t.y)) return { kind: "swallow" };
    }
    for (const c of shell) if (c.hit(t.x, t.y)) return { kind: "control", c };
    const cs = current().controls;
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i]!;
      if (c.hit(t.x, t.y)) return { kind: "control", c };
    }
    const part = current().partAt?.(t.x, t.y) ?? null;
    if (part) {
      link.touch(part, t.time);
      return { kind: "part" };
    }
    return null;
  };

  const down = (t: Touch): boolean => {
    if (!inRect(layout.rect, t.x, t.y)) return false;
    if (!inRect(layout.safe, t.x, t.y)) return true;
    if (!t.synthetic) {
      lastPerson = t.time;
      card.mode = "people";
      card.resting = false;
    }
    const cap = pick(t);
    if (!cap) return true;
    // The latest finger on a control wins it.
    if (cap.kind === "control") {
      for (const [id, c] of captured)
        if (c.kind === "control" && c.c === cap.c) captured.delete(id);
      cap.c.begin(t);
    }
    captured.set(t.id, cap);
    return true;
  };

  const move = (t: Touch) => {
    const cap = captured.get(t.id);
    if (!cap) return;
    if (!t.synthetic) lastPerson = t.time;
    if (cap.kind === "control") cap.c.move(t);
  };

  const up = (t: Touch, cancelled: boolean) => {
    const cap = captured.get(t.id);
    if (!cap) return;
    captured.delete(t.id);
    if (cap.kind === "control") cap.c.end(t, cancelled);
  };

  // ---- Drawing ---------------------------------------------------------------------------------

  const drawShell = () => {
    const r = layout.rect;
    const f = layout.figure;
    // The beam enters at the card's left edge and leaves at its right, through the figure. On the
    // kiosk it starts past the watch view, which may be a 3D view under this canvas.
    const w = layout.watch;
    const crossesWatch =
      layout.shape === "landscape" && layout.beamY > w.y && layout.beamY < w.y + w.height;
    beam(g, crossesWatch ? w.x + w.width : r.x, layout.beamY, f.x, layout.beamY, { alpha: 0.9 });
    beam(g, f.x + f.width, layout.beamY, r.x + r.width, layout.beamY, { alpha: 0.9 });
    if (card.pulse && card.pulse.strength > 0.01) {
      const x = card.pulse.x;
      if (x >= r.x - 60 && x <= r.x + r.width + 60) {
        glow(g, x, layout.beamY, 90, COLOR.beam, card.pulse.strength);
        disc(g, x, layout.beamY, 12, "#ffffff", card.pulse.strength);
      }
    }
  };

  const render = (now: number) => {
    if (disposed) return;
    renderTick++;
    // Untouched cards redraw at half rate.
    if (captured.size === 0 && ghosts.length === 0 && renderTick % 2 === 1) return;
    const k = frame.unit * frame.pixelRatio;
    const r = layout.rect;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
    drawShell();
    const c = current();
    g.save();
    try {
      c.draw(g, now);
    } catch (err) {
      console.error("[xrd] chapter draw failed", err);
    }
    g.restore();
    for (const ctl of c.controls) ctl.draw(g, now);
    for (const ctl of shell) ctl.draw(g, now);
    fold?.setNumbers(c.numbers());
    fold?.update(link, now);
  };

  const card: Card = {
    get layout() {
      return layout;
    },
    chapters: list,
    get chapter() {
      return list[index]!;
    },
    get current() {
      return current();
    },
    get mathsOpen() {
      return mathsOpen;
    },
    get lastPerson() {
      return lastPerson;
    },
    mode: "attract",
    resting: false,
    pulse: null,
    setLayout(l) {
      base = l;
      layout = splitFor(list[index]!);
      frame = host.frame();
      for (const [, c] of captured) if (c.kind === "control") c.c.release();
      captured.clear();
      placeDom();
      buildShell();
      for (const [id, c] of instances) c.layout(splitFor(id));
      hand.dispose();
      hand = createHand(wrap, frame.unit, layout.target * 1.15, layout.type.label);
      shownText.dots = "";
      rebuildFold();
      refreshText();
    },
    show(id) {
      const i = list.indexOf(id);
      if (i >= 0) showIndex(i);
    },
    step,
    down,
    move,
    up,
    controls() {
      return [...shell, ...current().controls].filter((c) => c.visible && c.enabled);
    },
    control(id) {
      return shell.find((c) => c.id === id) ?? current().controls.find((c) => c.id === id);
    },
    setMaths,
    partRect(part) {
      return fold?.parts().find((p) => p.part === part)?.rect ?? null;
    },
    earned: (id) => earned.has(id),
    soShown: () => so.style.visibility === "visible",
    linked: () => link.active(performance.now()),
    snapshot() {
      const c = current();
      let touchedAt = Number.NEGATIVE_INFINITY;
      let person = false;
      let held = false;
      for (const ctl of c.controls) {
        if (ctl.touchedAt > touchedAt) {
          touchedAt = ctl.touchedAt;
          person = ctl.byPerson;
        }
        held ||= ctl.held;
      }
      return { chapter: list[index]!, state: c.state(), touchedAt, person, held };
    },
    touches: () => captured.size,
    setGhost(points, demo = false) {
      ghosts = points;
      ghostDemo = demo;
    },
    update(dt, now) {
      if (disposed) return;
      try {
        current().update(dt, now);
      } catch (err) {
        console.error("[xrd] chapter update failed", err);
      }
      const finger = ghosts[ghosts.length - 1];
      const verb = TEXT[list[index]!].verb;
      const hint = current().hint();
      // The verb sits on the side of the hand nearer the card's middle, and only while the hand is
      // on the main control (where the hint points), which is the move the verb names.
      const side = (x: number) => (x > layout.rect.x + layout.rect.width / 2 ? "left" : "right");
      const floor = (layout.bottom?.y ?? layout.rect.y + layout.rect.height) - 8;
      const main = hint ? current().controls.find((c) => c.visible && c.hit(hint.x, hint.y)) : null;
      const onMain = (p: { x: number; y: number }) =>
        main ? main.hit(p.x, p.y) || inRect(main.rect, p.x, p.y) : false;
      if (finger)
        hand.set(
          finger,
          false,
          true,
          ghostDemo && onMain(finger) ? { text: verb, side: side(finger.x), floor } : null,
        );
      else if (card.mode === "attract" && card.resting)
        hand.set(hint, true, false, hint ? { text: verb, side: side(hint.x), floor } : null);
      else hand.set(null, false, false, null);
    },
    render,
    status() {
      return {
        chapter: list[index]!,
        maths: mathsOpen,
        touches: captured.size,
        so: earned.has(list[index]!),
        ...current().status(),
      };
    },
    reset() {
      for (const [, c] of captured) if (c.kind === "control") c.c.release();
      captured.clear();
      earned.clear();
      said.clear();
      awayFrom.clear();
      link.reset();
      for (const c of instances.values()) c.reset();
      mathsOpen = host.config.maths === "open";
      if (mathsButton) mathsButton.on = mathsOpen;
      card.mode = "attract";
      card.resting = false;
      lastPerson = Number.NEGATIVE_INFINITY;
      if (index !== startIndex) showIndex(startIndex);
      fold?.show(mathsOpen);
      refreshText();
    },
    dispose() {
      disposed = true;
      window.clearTimeout(warmTimer);
      for (const c of instances.values()) c.dispose();
      instances.clear();
      fold?.dispose();
      hand.dispose();
      canvas.remove();
      wrap.remove();
    },
  };
  return card;
};
