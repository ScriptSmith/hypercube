/**
 * Drawing. The parts that change only with the question (text, buttons, glass, pipes, screen
 * labels) are DOM and SVG, rebuilt on a new question or a resize; balls, flaps, puffs and wait
 * rings go on one canvas between the back layer (pipe insides, tube backs) and the front layer
 * (glass, pipe shine, collars and nozzles). Nothing here takes pointer events: the app hit-tests
 * touches itself, so bots and fingers take the same path.
 */
import { FONT, PALETTE, withAlpha } from "../../core/ui";
import type { Chart } from "./chart";
import { packedRects, type PackRect } from "./lattice";
import type { Block, Box, PipeDef } from "./layout";
import { pictureSvg, tickSvg } from "./pictures";
import { svgPath } from "./pipes";
import type { Question } from "./questions";
import { cornerRadius } from "./shape";
import { createSprites, type Sprites } from "./sprites";
import { type Ball, placeAt } from "./transit";

export interface ViewBlock {
  block: Block;
  question: Question;
  chart: Chart;
}

export interface Ring {
  x: number;
  y: number;
  /** Local ms it appeared, and how long the wait is. */
  t0: number;
  wait: number;
  /** Radius, venue px. */
  r: number;
}

export const COLORS: readonly string[] = PALETTE.players.slice(0, 6);
const INK = "#121624";
const BG = "#0a0e1c";
const NEUTRAL = "#8892b8";
/** A bot's ball: see-through, so nobody mistakes it for a vote. */
const GHOST_ALPHA = 0.3;

const STYLE_ID = "bp-styles";
const CSS = `
.bp-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.bp-layer *{pointer-events:none}
.bp-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.bp-text{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;
  text-align:center;color:${PALETTE.foreground};font-weight:700;line-height:1.08;white-space:nowrap}
.bp-btn{position:absolute;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;
  justify-content:center;transition:transform .12s ease-out,filter .2s}
.bp-btn.bp-press{transform:scale(.94);filter:brightness(1.15)}
.bp-btn.bp-pulse{animation:bp-pulse 1s ease-in-out}
.bp-pic{flex:none}
.bp-bounce{animation:bp-bounce .75s ease-in-out infinite}
.bp-lbl{font-weight:800;white-space:nowrap;line-height:1}
.bp-tick{position:absolute;opacity:0;transform:scale(.3);transition:opacity .3s,transform .35s cubic-bezier(.2,.9,.3,1.5)}
.bp-tick.bp-on{opacity:1;transform:scale(1)}
.bp-tube{position:absolute;box-sizing:border-box;transition:box-shadow .4s}
.bp-yest{position:absolute;opacity:0;transition:top .6s,opacity .4s}
.bp-yest.bp-on{opacity:.75}
.bp-label{position:absolute;display:flex;flex-direction:column;align-items:center}
@keyframes bp-pulse{0%,100%{transform:scale(1)}40%{transform:scale(1.07);filter:brightness(1.2)}}
@keyframes bp-bounce{0%,100%{transform:translateY(0) scale(1)}40%{transform:translateY(-16%) scale(1.06)}
  70%{transform:translateY(2%) scale(.98)}}
`;

const ensureCss = () => {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.append(el);
};

let measurer: CanvasRenderingContext2D | null = null;

/** Greedy line breaks for `text` at `size`, measured with the page's font. */
const wrap = (text: string, size: number, maxW: number): string[] => {
  measurer ??= document.createElement("canvas").getContext("2d");
  const g = measurer;
  if (!g) return [text];
  g.font = `700 ${size}px ${FONT}`;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && g.measureText(next).width > maxW) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

/** The largest size up to `max` at which `text` fits `box` in at most two lines. */
export const fitText = (text: string, box: Box, max: number): { size: number; lines: string[] } => {
  let size = max;
  for (let i = 0; i < 24; i++) {
    const lines = wrap(text, size, box.w);
    const m = measurer;
    if (!m) return { size, lines };
    if (lines.length <= 2 && lines.length * size * 1.1 <= box.h) {
      m.font = `700 ${size}px ${FONT}`;
      if (lines.every((l) => m.measureText(l).width <= box.w)) return { size, lines };
    }
    size *= 0.93;
  }
  return { size, lines: wrap(text, size, box.w) };
};

const rgbOf = (hex: string): [number, number, number] => {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** `a` mixed `f` of the way towards `b`. */
const mix = (a: string, b: string, f: number) => {
  const p = rgbOf(a);
  const q = rgbOf(b);
  return `rgb(${p.map((v, i) => Math.round(v + (q[i]! - v) * f)).join(",")})`;
};

interface BlockEls {
  buttons: HTMLElement[];
  pics: HTMLElement[];
  ticks: HTMLElement[];
  fronts: HTMLElement[];
  yest: HTMLElement[];
  labels: HTMLElement[];
}

interface Flap {
  key: string;
  /** Hinge at the outlet's left inside edge, and the flap's length and thickness. */
  x: number;
  y: number;
  len: number;
  th: number;
  color: string;
}

interface Puff {
  active: boolean;
  x: number;
  y: number;
  size: number;
  t0: number;
  color: string;
}

export interface View {
  build(blocks: readonly ViewBlock[], pipes: readonly PipeDef[]): void;
  /** New pipes only (a screen's bank changed), keeping everything else. */
  setPipes(pipes: readonly PipeDef[]): void;
  /** Reveal: tubes glow, `leaders` bounce, and the right answer of a quiz gets a tick. */
  reveal(block: number, on: boolean, leaders: readonly number[], correct: number | null): void;
  /** Attract: one button grows for a moment. */
  pulse(block: number, answer: number): void;
  press(block: number, answer: number): void;
  /** Yesterday's mark per tube, as venue y, or null to hide it. */
  yesterday(block: number, ys: readonly (number | null)[]): void;
  /** A ball left the outlet over `answer`'s tube: its flap swings and air puffs out. */
  outlet(block: number, answer: number, ghost: boolean, now: number): void;
  draw(
    blocks: readonly ViewBlock[],
    balls: readonly Ball[],
    rings: readonly Ring[],
    now: number,
  ): void;
  /** Flaps or puffs are still moving. */
  busy(now: number): boolean;
  resize(): void;
  dispose(): void;
}

export interface ViewDeps {
  root: HTMLElement;
  /** Stage px per venue px, and the canvas backing ratio. */
  unit(): number;
  pixelRatio(): number;
  size(): { width: number; height: number };
  /** Venue size, for the pipes' SVG. */
  venue(): { W: number; H: number };
}

const SVG = "http://www.w3.org/2000/svg";
const MAX_PUFFS = 24;
const PUFF_MS = 300;
const FLAP_MS = 520;
/** A flap starts to open this long before its ball gets there. */
const FLAP_LEAD_MS = 70;
const FLAP_OPEN = 1.25;

export const createView = (d: ViewDeps): View => {
  ensureCss();
  const back = document.createElement("div");
  back.className = "bp-layer";
  back.style.background = `linear-gradient(180deg,#05070d 0%,${BG} 60%,#0d1224 100%)`;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  const front = document.createElement("div");
  front.className = "bp-layer";
  d.root.append(back, canvas, front);
  const g = canvas.getContext("2d");

  let els: BlockEls[] = [];
  let sprites: Sprites | null = null;
  let spriteR = 0;
  let patterns: (CanvasPattern | null)[] = [];
  let pipeBack: SVGSVGElement | null = null;
  let pipeFront: SVGSVGElement | null = null;
  let flaps: Flap[] = [];
  const flapIndex = new Map<string, number>();
  const opened = new Map<string, number>();
  const puffs: Puff[] = Array.from({ length: MAX_PUFFS }, () => ({
    active: false,
    x: 0,
    y: 0,
    size: 0,
    t0: 0,
    color: "#ffffff",
  }));
  const rects: PackRect[] = [];
  const pt = { x: 0, y: 0 };
  const pt2 = { x: 0, y: 0 };
  const timers = new Set<number>();

  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const px = (v: number) => `${(v * d.unit()).toFixed(2)}px`;

  /** Words in at most two lines, as large as fits `w` by `h` up to `max`, all venue px. */
  const wordsEl = (text: string, w: number, h: number, max: number, color: string) => {
    const fit = fitText(text, { x: 0, y: 0, w, h }, max);
    const el = document.createElement("div");
    el.className = "bp-lbl bp-words";
    Object.assign(el.style, {
      fontSize: px(fit.size),
      fontFamily: FONT,
      fontWeight: "700",
      color,
      textAlign: "center",
      lineHeight: "1.08",
    });
    for (const line of fit.lines) {
      const l = document.createElement("div");
      l.textContent = line;
      el.append(l);
    }
    return el;
  };

  const ensureSprites = (r: number) => {
    const want = Math.max(4, Math.min(96, Math.ceil(r * d.unit() * d.pixelRatio())));
    if (sprites && want <= spriteR && want > spriteR * 0.5) return;
    sprites?.dispose();
    sprites = createSprites(COLORS, want);
    spriteR = want;
    patterns = COLORS.map((_, i) => (g ? g.createPattern(sprites!.tile(i), "repeat") : null));
  };

  const resize = () => {
    const s = d.size();
    canvas.width = Math.max(1, Math.round(s.width * d.pixelRatio()));
    canvas.height = Math.max(1, Math.round(s.height * d.pixelRatio()));
  };
  resize();

  const svgEl = (): SVGSVGElement => {
    const { W, H } = d.venue();
    const el = document.createElementNS(SVG, "svg");
    el.setAttribute("class", "bp-svg");
    el.setAttribute("viewBox", `0 0 ${W} ${H}`);
    el.setAttribute("preserveAspectRatio", "none");
    return el;
  };

  const stroke = (
    parent: SVGElement,
    dPath: string,
    color: string,
    width: number,
    cap: "butt" | "round" = "butt",
  ) => {
    if (!dPath) return;
    const p = document.createElementNS(SVG, "path");
    p.setAttribute("d", dPath);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", width.toFixed(2));
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", cap);
    parent.append(p);
  };

  const hueOf = (p: PipeDef) => (p.color >= 0 ? COLORS[p.color % COLORS.length]! : NEUTRAL);

  /**
   * Walls first, then every inside over them, so pipes that meet join into one: where a stub
   * meets a riser, the riser's inside covers the stub's wall and the two open into each other.
   */
  const buildPipes = (pipes: readonly PipeDef[]) => {
    pipeBack?.remove();
    pipeFront?.remove();
    pipeBack = svgEl();
    pipeFront = svgEl();
    const paths = pipes.map((p) => svgPath(p.path));
    for (const [i, p] of pipes.entries())
      stroke(
        pipeBack,
        paths[i]!,
        mix(hueOf(p), BG, p.color < 0 ? 0.15 : 0.35),
        p.inner + 2 * p.wall,
      );
    for (const [i, p] of pipes.entries())
      stroke(pipeBack, paths[i]!, mix(hueOf(p), BG, p.color < 0 ? 0.8 : 0.86), p.inner);
    for (const p of pipes) {
      const L = p.path.length;
      stroke(
        pipeFront,
        svgPath(p.path, p.inner * 0.3),
        "rgba(255,255,255,0.2)",
        p.inner * 0.1,
        "round",
      );
      const outer = p.inner + 2 * p.wall;
      const band = Math.max(p.wall * 2.5, outer * 0.22);
      if (p.intake) stroke(pipeFront, svgPath(p.path, 0, 0, band), hueOf(p), outer + 1.6 * p.wall);
      if (p.outlet) {
        stroke(pipeFront, svgPath(p.path, 0, L - band * 1.3, L), hueOf(p), outer + 2.2 * p.wall);
        stroke(
          pipeFront,
          svgPath(p.path, 0, L - band * 0.35, L),
          mix(hueOf(p), "#ffffff", 0.4),
          outer + 2.6 * p.wall,
        );
      }
    }
    back.prepend(pipeBack);
    // Pipes sit behind the buttons and labels but in front of the backdrop.
    front.append(pipeFront);
  };

  const buildBlock = (vb: ViewBlock, bi: number): BlockEls => {
    const { block, question } = vb;
    const out: BlockEls = { buttons: [], pics: [], ticks: [], fronts: [], yest: [], labels: [] };

    if (block.text.w > 0 && block.text.h > 0 && question.text) {
      const fit = fitText(question.text, block.text, block.textSize);
      const text = document.createElement("div");
      text.className = "bp-text";
      Object.assign(text.style, {
        left: px(block.text.x),
        top: px(block.text.y),
        width: px(block.text.w),
        height: px(block.text.h),
        fontSize: px(fit.size),
        fontFamily: FONT,
      });
      for (const line of fit.lines) {
        const l = document.createElement("div");
        l.textContent = line;
        text.append(l);
      }
      back.append(text);
    }

    for (const [k, t] of block.tubes.entries()) {
      const color = COLORS[t.answer % COLORS.length]!;
      const w = t.x1 - t.x0;
      const gl = block.glass;
      const rad = cornerRadius(w);
      const backEl = document.createElement("div");
      backEl.className = "bp-tube";
      Object.assign(backEl.style, {
        left: px(t.x0),
        top: px(t.top),
        width: px(w),
        height: px(t.bottom - t.top),
        borderRadius: `0 0 ${px(rad)} ${px(rad)}`,
        background: `linear-gradient(90deg,${withAlpha(color, 0.1)},${withAlpha(color, 0.04)} 60%,${withAlpha(color, 0.1)})`,
      });
      back.append(backEl);

      const f = document.createElement("div");
      f.className = "bp-tube";
      Object.assign(f.style, {
        left: px(t.x0 - gl),
        top: px(t.top),
        width: px(w + 2 * gl),
        height: px(t.bottom - t.top + gl),
        borderRadius: `0 0 ${px(rad + gl)} ${px(rad + gl)}`,
        border: `${px(gl)} solid ${withAlpha(color, 0.6)}`,
        borderTop: "none",
        boxShadow: "none",
      });
      const shine = document.createElement("div");
      Object.assign(shine.style, {
        position: "absolute",
        left: px(w * 0.1),
        top: px(w * 0.15),
        width: px(Math.max(2, w * 0.07)),
        bottom: px(rad),
        borderRadius: px(w),
        background: "linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0.05))",
      });
      const lip = document.createElement("div");
      Object.assign(lip.style, {
        position: "absolute",
        left: px(-gl * 1.6),
        right: px(-gl * 1.6),
        top: px(-gl),
        height: px(gl * 1.6),
        borderRadius: px(gl),
        background: withAlpha(color, 0.85),
      });
      const yest = document.createElement("div");
      yest.className = "bp-yest";
      Object.assign(yest.style, {
        left: px(-gl * 2.5),
        right: px(-gl * 2.5),
        height: "0",
        borderTop: `${px(Math.max(2, gl * 0.7))} dashed rgba(255,255,255,0.85)`,
      });
      f.append(shine, lip, yest);
      front.append(f);
      out.fronts.push(f);
      out.yest.push(yest);

      const s = block.spouts[k];
      if (s) {
        const key = `${bi}.${s.answer}`;
        flapIndex.set(key, flaps.length);
        flaps.push({
          key,
          x: s.cx - s.inner / 2 - s.wall * 0.5,
          y: s.yOut,
          len: s.inner + s.wall,
          th: Math.max(2, s.wall * 1.3),
          color: mix(color, "#ffffff", 0.25),
        });
      }
    }

    for (const b of block.buttons) {
      const color = COLORS[b.answer % COLORS.length]!;
      const answer = question.answers[b.answer]!;
      const btn = document.createElement("div");
      btn.className = "bp-btn";
      const rad = Math.min(b.w, b.h) * 0.14;
      Object.assign(btn.style, {
        left: px(b.x),
        top: px(b.y),
        width: px(b.w),
        height: px(b.h),
        borderRadius: px(rad),
        background: `linear-gradient(180deg,${withAlpha("#ffffff", 0)} 0%,rgba(0,0,0,0.1) 100%),${color}`,
        boxShadow: `inset 0 ${px(-b.h * 0.035)} 0 rgba(0,0,0,0.22),0 0 ${px(b.h * 0.12)} ${withAlpha(color, 0.25)}`,
      });
      btn.style.setProperty("--bp-ink", INK);
      btn.style.setProperty("--bp-paper", "#ffffff");
      btn.style.setProperty("--bp-tint", "rgba(255,255,255,0.55)");
      btn.style.setProperty("--bp-bg", color);
      const tick = document.createElement("div");
      tick.className = "bp-tick";
      const ts = Math.min(b.w, b.h, 360) * 0.34;
      Object.assign(tick.style, {
        width: px(ts),
        height: px(ts),
        right: px(-ts * 0.18),
        top: px(-ts * 0.22),
      });
      tick.innerHTML = tickSvg();
      if (!answer.pic) {
        // An operator's answer with no picture: its words, as big as the button allows. Without
        // its words too (a custom question set on another frame), the button is its colour alone.
        const words = answer.label
          ? wordsEl(answer.label, b.w * 0.86, b.h * 0.74, Math.min(b.h * 0.3, 190), INK)
          : document.createElement("div");
        btn.append(words, tick);
        back.append(btn);
        out.buttons[b.answer] = btn;
        out.pics[b.answer] = words;
        out.ticks[b.answer] = tick;
        continue;
      }
      const pic = Math.min(b.w * 0.66, b.h * 0.64, 520);
      const picEl = document.createElement("div");
      picEl.className = "bp-pic";
      Object.assign(picEl.style, { width: px(pic), height: px(pic) });
      picEl.innerHTML = pictureSvg(answer.pic);
      const label = document.createElement("div");
      label.className = "bp-lbl";
      const lblSize = Math.min(
        b.h * 0.15,
        pic * 0.3,
        (b.w * 0.92) / Math.max(4, answer.label.length * 0.56),
      );
      Object.assign(label.style, {
        fontSize: px(lblSize),
        fontFamily: FONT,
        color: INK,
        marginTop: px(b.h * 0.02),
      });
      label.textContent = answer.label;
      if (answer.label) btn.append(picEl, label, tick);
      else btn.append(picEl, tick);
      back.append(btn);
      out.buttons[b.answer] = btn;
      out.pics[b.answer] = picEl;
      out.ticks[b.answer] = tick;
    }

    for (const l of block.labels) {
      const color = COLORS[l.answer % COLORS.length]!;
      const answer = question.answers[l.answer]!;
      const wrapEl = document.createElement("div");
      wrapEl.className = "bp-label";
      Object.assign(wrapEl.style, {
        left: px(l.cx - l.size),
        width: px(l.size * 2),
        top: px(l.y),
      });
      const pic = answer.pic;
      // Words alone sit in a wider, lower badge.
      const bw = pic ? l.size : Math.min(l.w, l.size * 1.9);
      const bh = pic ? l.size : l.size * 0.62;
      const badge = document.createElement("div");
      Object.assign(badge.style, {
        position: "relative",
        width: px(bw),
        height: px(bh),
        borderRadius: px(l.size * 0.16),
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      });
      badge.style.setProperty("--bp-ink", INK);
      badge.style.setProperty("--bp-paper", "#ffffff");
      badge.style.setProperty("--bp-tint", "rgba(255,255,255,0.55)");
      badge.style.setProperty("--bp-bg", color);
      const picEl =
        pic || !answer.label
          ? document.createElement("div")
          : wordsEl(answer.label, bw * 0.88, bh * 0.82, l.size * 0.34, INK);
      if (pic) {
        Object.assign(picEl.style, { width: px(l.size * 0.84), height: px(l.size * 0.84) });
        picEl.innerHTML = pictureSvg(pic);
      }
      const tick = document.createElement("div");
      tick.className = "bp-tick";
      const ts = l.size * 0.38;
      Object.assign(tick.style, {
        width: px(ts),
        height: px(ts),
        right: px(-ts * 0.3),
        top: px(-ts * 0.3),
      });
      tick.innerHTML = tickSvg();
      badge.append(picEl, tick);
      const word = document.createElement("div");
      word.className = "bp-lbl";
      word.textContent = answer.label;
      Object.assign(word.style, {
        fontSize: px(Math.min(l.size * 0.3, l.w / Math.max(3, answer.label.length * 0.58))),
        fontFamily: FONT,
        color,
        marginTop: px(l.size * 0.06),
      });
      if (pic && answer.label) wrapEl.append(badge, word);
      else wrapEl.append(badge);
      back.append(wrapEl);
      out.labels[l.answer] = wrapEl;
      out.pics[l.answer] = badge;
      out.ticks[l.answer] = tick;
    }
    return out;
  };

  const clipTube = (
    c: CanvasRenderingContext2D,
    x0: number,
    top: number,
    w: number,
    bottom: number,
  ) => {
    const rad = cornerRadius(w);
    c.beginPath();
    c.moveTo(x0, top - w * 3);
    c.lineTo(x0 + w, top - w * 3);
    c.lineTo(x0 + w, bottom - rad);
    c.arcTo(x0 + w, bottom, x0 + w - rad, bottom, rad);
    c.lineTo(x0 + rad, bottom);
    c.arcTo(x0, bottom, x0, bottom - rad, rad);
    c.closePath();
    c.clip();
  };

  const drawTubes = (c: CanvasRenderingContext2D, sp: Sprites, vb: ViewBlock) => {
    const { chart } = vb;
    const lat = chart.lattice;
    const tile = sp.tile(0);
    const sx = lat.r / sp.radius;
    const sy = (2 * lat.rowH) / tile.height;
    for (const t of chart.tubes) {
      const gm = t.geom;
      const w = gm.x1 - gm.x0;
      const color = gm.answer % COLORS.length;
      c.save();
      clipTube(c, gm.x0, gm.top, w, gm.bottom);
      const off = t.drainOff;
      const pat = patterns[color];
      if (pat) {
        const k = packedRects(lat, t.shown, rects);
        c.fillStyle = pat;
        for (let i = 0; i < k; i++) {
          const rc = rects[i]!;
          const a = lat.anchor(rc.kind);
          pat.setTransform(
            new DOMMatrix([sx, 0, 0, sy, gm.x0 + a.x - lat.r, a.y + off - lat.rowH]),
          );
          c.fillRect(gm.x0 + rc.x, rc.y + off, rc.w, rc.h);
        }
      }
      const p = t.pile;
      const r = p.r;
      for (let b = 0; b < p.n; b++) {
        c.drawImage(sp.ball(color, p.tint[b]!), p.x[b]! - r, p.y[b]! - r, 2 * r, 2 * r);
      }
      c.restore();
    }
  };

  const drawBall = (
    c: CanvasRenderingContext2D,
    sp: Sprites,
    b: Ball,
    blocks: readonly ViewBlock[],
    now: number,
  ) => {
    const route = b.route;
    const age = now - b.start;
    if (age < -120) return;
    const tau = Math.max(0, age);
    let base = b.ghost ? GHOST_ALPHA : 1;
    if (age < 0) base *= (age + 120) / 120;
    placeAt(route, tau, pt);
    let r = route.r;
    const left = route.duration - tau;
    if (b.lands && left < 140) {
      const to = blocks[b.block]?.chart.r ?? r;
      const f = 1 - Math.max(0, left) / 140;
      r += (to - r) * f * f;
    }
    // A short whoosh behind a moving ball: a fading streak and fading copies.
    placeAt(route, Math.max(0, tau - 64), pt2);
    const moved = Math.hypot(pt.x - pt2.x, pt.y - pt2.y);
    if (moved > r * 0.8) {
      const streak = c.createLinearGradient(pt2.x, pt2.y, pt.x, pt.y);
      streak.addColorStop(0, "rgba(255,255,255,0)");
      streak.addColorStop(1, "rgba(255,255,255,0.55)");
      c.globalAlpha = base;
      c.strokeStyle = streak;
      c.lineCap = "round";
      c.lineWidth = r * 1.1;
      c.beginPath();
      c.moveTo(pt2.x, pt2.y);
      c.lineTo(pt.x, pt.y);
      c.stroke();
      for (let k = 1; k <= 3; k++) {
        placeAt(route, Math.max(0, tau - 16 * k), pt2);
        const rk = r * (1 - 0.14 * k);
        c.globalAlpha = base * (0.34 - 0.09 * k);
        c.drawImage(sp.ball(b.color, b.tint), pt2.x - rk, pt2.y - rk, 2 * rk, 2 * rk);
      }
    }
    if (!b.ghost) {
      c.globalAlpha = 1;
      c.drawImage(sp.glow(b.color), pt.x - 3 * r, pt.y - 3 * r, 6 * r, 6 * r);
    }
    c.globalAlpha = base;
    c.drawImage(sp.ball(b.color, b.tint), pt.x - r, pt.y - r, 2 * r, 2 * r);
    if (b.ghost) {
      c.globalAlpha = Math.min(1, base * 2.4);
      c.strokeStyle = "#ffffff";
      c.lineWidth = Math.max(1, r * 0.12);
      c.setLineDash([r * 0.45, r * 0.35]);
      c.beginPath();
      c.arc(pt.x, pt.y, r * 0.94, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    c.globalAlpha = 1;
  };

  /** How far open each flap is, 0 to 1: just before a ball arrives, and swinging shut after. */
  const flapOpen = (f: Flap, balls: readonly Ball[], now: number) => {
    let open = 0;
    const t = opened.get(f.key);
    if (t !== undefined) {
      const age = now - t;
      if (age < FLAP_MS) {
        const u = age / FLAP_MS;
        open = Math.max(0, Math.exp(-4 * u) * Math.cos(u * Math.PI * 1.6));
      }
    }
    for (const b of balls) {
      if (!b.active || !b.lands || `${b.block}.${b.answer}` !== f.key) continue;
      const left = b.route.duration - (now - b.start);
      if (left >= 0 && left < FLAP_LEAD_MS) open = Math.max(open, 1 - left / FLAP_LEAD_MS);
    }
    return open;
  };

  return {
    build(blocks, pipes) {
      back.textContent = "";
      front.textContent = "";
      flaps = [];
      flapIndex.clear();
      opened.clear();
      for (const p of puffs) p.active = false;
      els = blocks.map(buildBlock);
      buildPipes(pipes);
      let rMax = 4;
      for (const vb of blocks) {
        const t = vb.block.tubes[0];
        if (t) rMax = Math.max(rMax, (t.x1 - t.x0) / (2 * vb.block.n0));
        for (const w of vb.block.ways) if (w) rMax = Math.max(rMax, w.r);
      }
      ensureSprites(rMax);
    },
    setPipes(pipes) {
      buildPipes(pipes);
    },
    reveal(block, on, leaders, correct) {
      const e = els[block];
      if (!e) return;
      for (const [i, f] of e.fronts.entries()) {
        const color = COLORS[i % COLORS.length]!;
        f.style.boxShadow = on
          ? `0 0 ${px(60)} ${withAlpha(color, 0.75)}, inset 0 0 ${px(40)} ${withAlpha(color, 0.35)}`
          : "none";
      }
      for (const [i, pic] of e.pics.entries())
        pic?.classList.toggle("bp-bounce", on && leaders.includes(i));
      for (const [i, tick] of e.ticks.entries())
        tick?.classList.toggle("bp-on", on && correct === i);
    },
    pulse(block, answer) {
      const btn = els[block]?.buttons[answer];
      if (!btn) return;
      btn.classList.remove("bp-pulse");
      void btn.offsetWidth;
      btn.classList.add("bp-pulse");
      later(() => btn.classList.remove("bp-pulse"), 1050);
    },
    press(block, answer) {
      const btn = els[block]?.buttons[answer];
      if (!btn) return;
      btn.classList.add("bp-press");
      later(() => btn.classList.remove("bp-press"), 140);
    },
    yesterday(block, ys) {
      const e = els[block];
      if (!e) return;
      for (const [i, el] of e.yest.entries()) {
        const y = ys[i];
        const f = e.fronts[i];
        if (y === null || y === undefined || !f) {
          el.classList.remove("bp-on");
          continue;
        }
        const top = Number.parseFloat(f.style.top) / d.unit();
        el.style.top = px(Math.max(0, y - top));
        el.classList.add("bp-on");
      }
    },
    outlet(block, answer, ghost, now) {
      const key = `${block}.${answer}`;
      const i = flapIndex.get(key);
      const f = i === undefined ? undefined : flaps[i];
      if (!f) return;
      opened.set(key, now);
      const p = puffs.find((x) => !x.active) ?? puffs.reduce((a, b) => (a.t0 <= b.t0 ? a : b));
      p.active = true;
      p.x = f.x + f.len / 2;
      p.y = f.y;
      p.size = f.len * 0.55;
      p.t0 = now;
      p.color = ghost ? "#ffffff" : mix(COLORS[answer % COLORS.length]!, "#ffffff", 0.55);
    },
    draw(blocks, balls, rings, now) {
      if (!g) return;
      const S = d.unit() * d.pixelRatio();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(S, 0, 0, S, 0, 0);
      const sp = sprites;
      if (!sp) return;
      for (const vb of blocks) drawTubes(g, sp, vb);
      for (const b of balls) if (b.active) drawBall(g, sp, b, blocks, now);
      for (const f of flaps) {
        const open = flapOpen(f, balls, now);
        g.save();
        g.translate(f.x, f.y);
        g.rotate(open * FLAP_OPEN);
        g.fillStyle = f.color;
        g.beginPath();
        g.roundRect(0, -f.th / 2, f.len, f.th, f.th / 2);
        g.fill();
        g.restore();
      }
      for (const p of puffs) {
        if (!p.active) continue;
        const age = now - p.t0;
        if (age >= PUFF_MS || age < 0) {
          p.active = false;
          continue;
        }
        const u = age / PUFF_MS;
        const e = 1 - (1 - u) ** 2;
        g.fillStyle = p.color;
        g.globalAlpha = 0.9 * (1 - u) ** 2.4;
        for (let k = 0; k < 6; k++) {
          // Little clouds blown sideways out of the outlet's rim, either side of the ball.
          const side = k < 3 ? -1 : 1;
          const j = k % 3;
          const a = side < 0 ? Math.PI - 0.15 - j * 0.45 : 0.15 + j * 0.45;
          const dist = p.size * (0.55 + 2 * e) * (1 - j * 0.15);
          g.beginPath();
          g.arc(
            p.x + Math.cos(a) * dist,
            p.y + Math.sin(a) * dist * 0.6,
            p.size * (0.2 + 0.18 * e) * (1 - j * 0.2),
            0,
            Math.PI * 2,
          );
          g.fill();
        }
        g.globalAlpha = 1;
      }
      for (const ring of rings) {
        const age = now - ring.t0;
        const f = Math.min(1, age / Math.max(1, ring.wait));
        const rr = ring.r;
        g.lineWidth = rr * 0.2;
        g.strokeStyle = "rgba(255,255,255,0.25)";
        g.beginPath();
        g.arc(ring.x, ring.y, rr, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - Math.max(0, f - 0.85) / 0.15)).toFixed(3)})`;
        g.beginPath();
        g.arc(ring.x, ring.y, rr, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2);
        g.stroke();
      }
    },
    busy(now) {
      if (puffs.some((p) => p.active)) return true;
      for (const t of opened.values()) if (now - t < FLAP_MS) return true;
      return false;
    },
    resize,
    dispose() {
      for (const id of timers) clearTimeout(id);
      timers.clear();
      sprites?.dispose();
      sprites = null;
      opened.clear();
      flapIndex.clear();
      flaps = [];
      back.remove();
      canvas.remove();
      front.remove();
      canvas.width = canvas.height = 0;
    },
  };
};
