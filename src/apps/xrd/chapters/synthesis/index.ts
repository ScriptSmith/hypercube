/**
 * Chapter 9, turning spots back into atoms. Each spot is one ripple of density across the
 * crystal: tap spots to add their ripples, or add them all, lowest first, and blurs sharpen into
 * atoms; the detail slider drops the far spots again. Then the swap: one picture's brightnesses
 * with the other's ripple positions looks like the second picture, which is why the positions
 * the detector never records matter so much.
 *
 * - Watch view: the density rebuilt from the kept ripples, and the last ripple on its own with a
 *   crest marked and its stripes named as layers (a spot, its ripple and a set of layers are one
 *   thing); after the swap, the swapped picture. Empty, it says what to do.
 * - Figure: the spots as a map, one per ripple and its mirror, sized by strength; after the swap,
 *   the two pictures and which gave what.
 * - Children: Add one, Add all, Swap. Adults: the detail slider, and tapping spots.
 * - Linked formula ρ = Σ |F| cos(2π(hx + ky) − φ): ρ the rebuilt picture, |F| the spots' sizes
 *   (and the brightness picture), φ the crest of the last ripple (and the positions picture).
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TEXT } from "../../captions";
import type { Chapter, ChapterDef, ChapterEnv, DemoStep, MachineDrive } from "../../chapter";
import { COLOR } from "../../config";
import {
  button,
  type Button,
  type Control,
  font,
  type Gesture,
  pad,
  type Pad,
  slider,
  type Slider,
} from "../../controls";
import { beam, clipTo, disc, glow, label, well } from "../../draw";
import { lutFor, type PatternView } from "../../engine/client";
import { emphasis, presence } from "../../formula";
import { type CardLayout, centre, inset, type Rect, splitRow, square } from "../../layout";
import {
  A,
  ALL,
  COUNT,
  decode,
  donors,
  encode,
  enough,
  F_MAX,
  has,
  kept,
  nextRipple,
  playAt,
  rhoJob,
  rhoKey,
  RIPPLES,
  rippleJob,
  rippleOf,
  S_MAX,
  S_MIN,
  SPAN,
  START,
  STATE_RANGES,
  swapJob,
  type SynthesisState,
  toggle,
} from "./model";
import { picture, type PictureId } from "./pictures";

const T = TEXT.synthesis;
const L = T.labels;

export const PARTS = { rho: COLOR.real, F: COLOR.recip, phi: COLOR.angle } as const;

/** One ripple added every this many ms while adding them all. */
const ADD_MS = 150;

const pictureName = (id: PictureId) => (id === "lorikeet" ? L.lorikeet! : L.turtle!);

interface WatchRects {
  main: Rect;
  inset: Rect | null;
}

/** The rebuilt picture's square, and the single ripple's beside it, or over its corner. */
const watchRects = (r: Rect, k = 1): WatchRects => {
  const main = square(inset(r, 12 * k));
  const side = r.x + r.width - (main.x + main.width) - 24 * k;
  if (side >= main.width * 0.38) {
    const s = Math.min(side, main.height * 0.55);
    return {
      main,
      inset: {
        x: main.x + main.width + 24 * k,
        // Room above it for its "Layers" label.
        y: main.y + Math.max(main.height * 0.12, 56 * k),
        width: s,
        height: s,
      },
    };
  }
  const s = main.width * 0.3;
  return {
    main,
    inset: { x: main.x + main.width - s - 14 * k, y: main.y + 14 * k, width: s, height: s },
  };
};

/** The crest of ripple `i` nearest the middle, as a line across `box` (the 15 Å picture). */
const crestLine = (i: number, box: Rect) => {
  const rp = RIPPLES[i]!;
  // Crests where h(x + A/2) + k(y + A/2) = A(φ/2π + m), x and y from the picture's middle: the
  // lattice's corners sit half a cell off the middle of a picture three cells wide.
  const base = (A * rp.phase) / (2 * Math.PI) - ((rp.h + rp.k) * A) / 2;
  const m = Math.round(-base / A);
  const c = base + m * A;
  const len = Math.hypot(rp.h, rp.k);
  const nx = rp.h / len;
  const ny = rp.k / len;
  const d = c / len;
  const k = box.width / SPAN;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const far = SPAN;
  const px = d * nx;
  const py = d * ny;
  return {
    x0: cx + (px - ny * far) * k,
    y0: cy - (py + nx * far) * k,
    x1: cx + (px + ny * far) * k,
    y1: cy - (py - nx * far) * k,
  };
};

const drawWatch = (
  g: CanvasRenderingContext2D,
  r: Rect,
  s: SynthesisState,
  views: { rho: PatternView; ripple: PatternView },
  n: number,
  o: { size: number; rhoLevel?: number; phiLevel?: number; phiAlpha?: number },
) => {
  well(g, r);
  // Strokes follow the type size, so the screen's big copy reads like a panel's.
  const k = o.size / 38;
  const w = watchRects(r, k);
  views.rho.want(rhoKey(s, n), () => (s.mode === "pictures" ? swapJob(s.role, n) : rhoJob(s, n)));
  clipTo(g, w.main, 20);
  g.fillStyle = "#06090f";
  g.fillRect(w.main.x, w.main.y, w.main.width, w.main.height);
  const empty = s.mode === "atoms" && kept(s).length === 0;
  if (empty) {
    // Nothing added: an even grey, the average density.
    g.fillStyle = withAlpha(COLOR.real, 0.16);
    g.fillRect(w.main.x, w.main.y, w.main.width, w.main.height);
  } else views.rho.draw(g, w.main, { stopArm: false });
  g.restore();
  // Until the first ripple arrives, the empty picture says what to do.
  if (empty) {
    const c = centre(w.main);
    label(g, T.verb, c.x, c.y, { size: o.size * 1.15, color: COLOR.ink, weight: 800, alpha: 0.8 });
  }
  const lvl = o.rhoLevel ?? 0;
  if (lvl > 0.01) {
    g.save();
    g.strokeStyle = COLOR.real;
    g.lineWidth = 6 * k * (1 + lvl);
    g.globalAlpha = lvl;
    g.beginPath();
    g.roundRect(w.main.x, w.main.y, w.main.width, w.main.height, 20);
    g.stroke();
    g.restore();
  }
  if (s.mode === "atoms" && s.last >= 0 && w.inset) {
    const box = w.inset;
    views.ripple.want(`${n}:${s.last}`, () => rippleJob(s.last, n));
    well(g, inset(box, -8 * k), { radius: 18 * k });
    clipTo(g, box, 14);
    views.ripple.draw(g, box, { stopArm: false });
    const c = crestLine(s.last, box);
    g.save();
    g.globalAlpha = (o.phiAlpha ?? 1) * 0.9;
    g.strokeStyle = COLOR.angle;
    g.lineWidth = 4 * k * (1 + (o.phiLevel ?? 0));
    g.setLineDash([12 * k, 9 * k]);
    g.beginPath();
    g.moveTo(c.x0, c.y0);
    g.lineTo(c.x1, c.y1);
    g.stroke();
    g.restore();
    g.restore();
    const rp = RIPPLES[s.last]!;
    label(g, `(${rp.h} ${rp.k})`, box.x + box.width / 2, box.y + box.height + o.size * 0.75, {
      size: o.size * 0.85,
      color: COLOR.recip,
    });
    // The ripple's stripes are the spot's set of layers.
    if (box.x < w.main.x + w.main.width) {
      // Over the picture's corner: on a dark pill.
      g.save();
      g.font = font(800, o.size * 0.85);
      const tw = g.measureText(L.layers!).width;
      g.restore();
      const bw = tw * 1.15 + 20 * k;
      const bh = o.size * 1.15;
      const by = Math.max(w.main.y + 4 * k, box.y - 10 * k - bh);
      g.save();
      g.fillStyle = withAlpha(COLOR.background, 0.85);
      g.beginPath();
      g.roundRect(box.x + box.width / 2 - bw / 2, by, bw, bh, bh / 2);
      g.fill();
      g.restore();
      label(g, L.layers!, box.x + box.width / 2, by + bh / 2, {
        size: o.size * 0.85,
        color: COLOR.real,
        weight: 800,
      });
    } else
      label(g, L.layers!, box.x + box.width / 2, box.y - 8 * k - o.size * 0.62, {
        size: o.size * 0.85,
        color: COLOR.real,
        weight: 800,
      });
  }
};

/** A picture as a small green canvas, made once. */
const pictureCanvas = (id: PictureId, cache: Map<PictureId, HTMLCanvasElement>) => {
  const hit = cache.get(id);
  if (hit) return hit;
  const n = 128;
  const d = picture(id, n);
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d");
  if (g) {
    const img = g.createImageData(n, n);
    const lut = lutFor("real");
    for (let i = 0; i < n * n; i++) {
      const k = Math.round(Math.max(0, Math.min(1, d[i]!)) * 255) * 4;
      img.data[i * 4] = lut[k]!;
      img.data[i * 4 + 1] = lut[k + 1]!;
      img.data[i * 4 + 2] = lut[k + 2]!;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  cache.set(id, c);
  return c;
};

interface MapGeo {
  cx: number;
  oy: number;
  sp: number;
}

const mapGeo = (hot: Rect): MapGeo => {
  const sp = Math.min(hot.width / 7.3, hot.height / 3.9);
  return { cx: hot.x + hot.width / 2, oy: hot.y + (hot.height + 3 * sp) / 2, sp };
};

const spotAt = (m: MapGeo, h: number, k: number) => ({ x: m.cx + h * m.sp, y: m.oy - k * m.sp });

const def: ChapterDef = {
  id: "synthesis",
  state: STATE_RANGES,
  start: encode(START),
  play: (t) => encode(playAt(t)),
  parts: PARTS,
  split: 0.56,
  watch(g, rect, state, look) {
    drawWatch(
      g,
      rect,
      decode(state),
      { rho: look.view("rho", "real"), ripple: look.view("ripple", "real") },
      look.size,
      { size: Math.max(24, Math.min(rect.height * 0.045, rect.width * 0.03, 90)) },
    );
  },
  drive(state): MachineDrive {
    const s = decode(state);
    return { rebuilt: s.mode === "pictures" ? 1 : kept(s).length / COUNT };
  },
  create(env: ChapterEnv): Chapter {
    let s: SynthesisState = { ...START };
    let swapped = false;
    let said: "none" | "caption" | "both" = "none";
    let card: CardLayout | null = null;
    let hot: Rect = { x: 0, y: 0, width: 1, height: 1 };
    let controls: Control[] = [];
    let addOne: Button | null = null;
    let addAll: Button | null = null;
    let swap: Button | null = null;
    let detail: Slider | null = null;
    let spots: Pad | null = null;
    let rho: PatternView | null = null;
    let ripple: PatternView | null = null;
    const pictures = new Map<PictureId, HTMLCanvasElement>();
    let adding = false;
    let addClock = 0;
    let parts: { part: string; x: number; y: number; r: number }[] = [];

    const add = (i: number) => {
      if (i < 0 || has(s.added, i)) return;
      s = { ...s, added: toggle(s.added, i), last: i };
    };

    const spotGesture = (rand: () => number): Gesture => {
      const m = mapGeo(hot);
      const rp = RIPPLES[Math.floor(rand() * COUNT)]!;
      return { path: [spotAt(m, rp.h, rp.k)], ms: 120 };
    };

    const make = (l: CardLayout) => {
      const f = l.figure;
      const sf = l.safe;
      const x0 = Math.max(f.x, sf.x);
      const x1 = Math.min(f.x + f.width, sf.x + sf.width);
      hot = inset({ x: x0, y: f.y, width: x1 - x0, height: f.height }, 12, 8);
      const c = l.child;
      const h = Math.min(c.height, l.target * 1.35);
      const [r1, r2, r3] = splitRow(
        { x: c.x, y: c.y + (c.height - h) / 2, width: c.width, height: h },
        [1, 1, 1],
        20,
      );
      addOne = button({
        id: "addOne",
        rect: r1!,
        band: "child",
        label: L.addOne!,
        look: "solid",
        color: COLOR.recip,
        size: l.type.label,
        onPress: () => {
          if (s.mode === "pictures") {
            s = { ...s, mode: "atoms" };
            return;
          }
          adding = false;
          add(nextRipple(s.added));
        },
      });
      addAll = button({
        id: "addAll",
        rect: r2!,
        band: "child",
        label: L.addAll!,
        color: COLOR.recip,
        size: l.type.label,
        onPress: () => {
          if (adding || s.added === ALL) {
            adding = false;
            s = { ...s, added: 0, last: -1 };
            return;
          }
          adding = true;
          addClock = ADD_MS;
        },
      });
      swap = button({
        id: "swap",
        rect: r3!,
        band: "child",
        label: L.swap!,
        color: COLOR.angle,
        size: l.type.label,
        onPress: () => {
          adding = false;
          s =
            s.mode === "pictures"
              ? { ...s, role: s.role === 0 ? 1 : 0 }
              : { ...s, mode: "pictures", role: 0 };
          swapped = true;
        },
      });
      detail = slider({
        id: "detail",
        rect: l.adult,
        band: "adult",
        label: L.detail!,
        min: S_MIN,
        max: S_MAX,
        step: 0.01,
        value: s.cutoff,
        color: COLOR.recip,
        size: l.type.label,
        format: (v) => `${(1 / v).toFixed(1)} Å`,
        onChange: (v) => {
          s = { ...s, cutoff: v };
        },
      });
      spots = pad({
        id: "spots",
        rect: hot,
        band: "adult",
        onDown: (t) => {
          if (s.mode !== "atoms") return;
          const m = mapGeo(hot);
          let best = -1;
          let bestD = m.sp * 0.95;
          for (let k = 0; k <= 3; k++)
            for (let hh = -3; hh <= 3; hh++) {
              if (k === 0 && hh === 0) continue;
              const p = spotAt(m, hh, k);
              const d = Math.hypot(t.x - p.x, t.y - p.y);
              if (d < bestD) {
                bestD = d;
                best = rippleOf(hh, k);
              }
            }
          if (best < 0) return;
          adding = false;
          if (has(s.added, best))
            s = { ...s, added: toggle(s.added, best), last: s.last === best ? -1 : s.last };
          else add(best);
        },
        botGesture: (rand) => spotGesture(rand),
      });
      controls = [spots, detail, addOne, addAll, swap];
    };

    const drawMap = (g: CanvasRenderingContext2D, now: number) => {
      const m = mapGeo(hot);
      const link = env.link;
      const fl = link.level("F", now);
      const fa = presence(link, "F", now);
      // The detail slider's reach, a half circle round the middle.
      const rr = s.cutoff * A * m.sp;
      g.save();
      g.strokeStyle = withAlpha(COLOR.ink, 0.35);
      g.lineWidth = 3;
      g.setLineDash([10, 10]);
      g.beginPath();
      g.arc(m.cx, m.oy, rr, Math.PI, 2 * Math.PI);
      g.stroke();
      g.restore();
      disc(g, m.cx, m.oy, m.sp * 0.14, "#1a2234");
      for (let k = 0; k <= 3; k++)
        for (let hh = -3; hh <= 3; hh++) {
          if (k === 0 && hh === 0) continue;
          const i = rippleOf(hh, k);
          const rp = RIPPLES[i]!;
          const p = spotAt(m, hh, k);
          const r = m.sp * (0.08 + 0.16 * Math.sqrt(rp.F / F_MAX)) * (1 + 0.25 * fl);
          const on = has(s.added, i);
          const inside = rp.S <= s.cutoff + 1e-9;
          g.save();
          g.globalAlpha = fa;
          if (on && inside) {
            glow(g, p.x, p.y, r * 1.8, COLOR.recip, 0.45);
            disc(g, p.x, p.y, r, COLOR.recip);
          } else {
            g.strokeStyle = withAlpha(COLOR.recip, on ? 0.55 : inside ? 0.5 : 0.22);
            g.lineWidth = 3;
            g.beginPath();
            g.arc(p.x, p.y, r, 0, Math.PI * 2);
            g.stroke();
          }
          if (i === s.last) {
            g.strokeStyle = COLOR.accent;
            g.lineWidth = 4;
            g.beginPath();
            g.arc(p.x, p.y, r + 10, 0, Math.PI * 2);
            g.stroke();
          }
          g.restore();
        }
    };

    const drawPictures = (g: CanvasRenderingContext2D, l: CardLayout, now: number) => {
      const inner = inset(l.figure, 20, 14);
      const badge = l.type.label * 1.25;
      const ps = Math.max(80, Math.min(inner.height - badge - 10, inner.width * 0.27));
      const d = donors(s.role);
      const link = env.link;
      const items: { id: PictureId; part: "F" | "phi"; text: string; color: string }[] = [
        { id: d.bright, part: "F", text: L.brightness!, color: COLOR.recip },
        { id: d.place, part: "phi", text: L.positions!, color: COLOR.angle },
      ];
      items.sort((a, b) => (a.id === "lorikeet" ? -1 : b.id === "lorikeet" ? 1 : 0));
      items.forEach((it, j) => {
        const x = inner.x + j * (ps + 24);
        const y = inner.y + badge + 10;
        g.save();
        g.imageSmoothingEnabled = true;
        g.drawImage(pictureCanvas(it.id, pictures), x, y, ps, ps);
        g.restore();
        g.save();
        g.globalAlpha = presence(link, it.part, now);
        g.strokeStyle = it.color;
        g.lineWidth = 4 * emphasis(link, it.part, now);
        g.strokeRect(x, y, ps, ps);
        g.restore();
        label(g, it.text, x + ps / 2, inner.y + badge * 0.45, {
          size: l.type.label * 0.9,
          color: it.color,
          alpha: presence(link, it.part, now),
        });
        parts.push({ part: it.part, x: x + ps / 2, y: inner.y + badge * 0.45, r: 80 });
      });
    };

    return {
      layout(l) {
        card = l;
        make(l);
      },
      get controls() {
        return controls;
      },
      update(dt) {
        // After the swap the shell shows the swap's caption, and its own "So" line once swapped.
        const want = s.mode === "pictures" ? (swapped ? "both" : "caption") : "none";
        if (want !== said) {
          said = want;
          env.say?.({
            caption: want === "none" ? null : T.more!.swap!,
            so: want === "both" ? T.more!.soSwap! : null,
          });
          if (want === "both") env.earn();
        }
        if (adding) {
          addClock += dt * 1000;
          while (adding && addClock >= ADD_MS) {
            addClock -= ADD_MS;
            const i = nextRipple(s.added);
            if (i < 0) adding = false;
            else add(i);
          }
        }
        const pics = s.mode === "pictures";
        if (addOne) addOne.label = pics ? L.atoms! : L.addOne!;
        if (addAll) {
          addAll.visible = !pics;
          addAll.label = adding || s.added === ALL ? L.clear! : L.addAll!;
        }
        if (detail) {
          detail.visible = !pics;
          if (!detail.held) detail.value = s.cutoff;
        }
        if (spots) spots.enabled = !pics;
        if (enough(s)) env.earn();
      },
      draw(g, now) {
        if (!card) return;
        rho ??= env.engine().view({ tint: "real" });
        ripple ??= env.engine().view({ tint: "real" });
        parts = [];
        const link = env.link;
        drawWatch(g, card.watch, s, { rho, ripple }, 256, {
          size: card.type.label,
          rhoLevel: link.level("rho", now),
          phiLevel: link.level("phi", now),
          phiAlpha: presence(link, "phi", now),
        });
        const w = watchRects(card.watch, card.type.label / 38);
        parts.push({ part: "rho", ...centre(w.main), r: w.main.width * 0.45 });
        if (w.inset && s.mode === "atoms" && s.last >= 0)
          parts.push({ part: "phi", ...centre(w.inset), r: w.inset.width * 0.5 });
        const f = card.figure;
        well(g, f, { fill: withAlpha(COLOR.well, 0.6) });
        clipTo(g, f, 28);
        beam(g, f.x, card.beamY, f.x + f.width, card.beamY, { alpha: 0.3 });
        g.restore();
        if (s.mode === "atoms") drawMap(g, now);
        else drawPictures(g, card, now);
      },
      partAt(x, y) {
        let best: string | null = null;
        let bestD = Number.POSITIVE_INFINITY;
        for (const p of parts) {
          const d = Math.hypot(x - p.x, y - p.y);
          if (d < p.r && d < bestD) {
            bestD = d;
            best = p.part;
          }
        }
        return best;
      },
      numbers() {
        if (s.mode === "pictures") {
          const d = donors(s.role);
          return [`|F|: ${pictureName(d.bright)}`, `φ: ${pictureName(d.place)}`];
        }
        const k = kept(s);
        const far = Math.max(0, ...k.map((i) => RIPPLES[i]!.S));
        const lines = [`${k.length} / ${COUNT}`];
        if (far > 0) lines.push(`d = 1 / ${far.toFixed(3)} Å⁻¹ = ${(1 / far).toFixed(2)} Å`);
        if (s.last >= 0) {
          const rp = RIPPLES[s.last]!;
          lines.push(
            `(${rp.h} ${rp.k})  |F| = ${rp.F.toFixed(1)}  φ = ${Math.round((rp.phase * 180) / Math.PI)}°`,
          );
        }
        return lines;
      },
      state: () => encode(s),
      demo(): DemoStep[] {
        return [
          { control: "addOne" },
          { wait: 900 },
          { control: "addOne" },
          { wait: 900 },
          { control: "addAll" },
          { wait: 4200 },
          { control: "detail", to: 0.32, ms: 1500 },
          { wait: 1500 },
          { control: "detail", to: S_MAX, ms: 1200 },
          { wait: 1000 },
          { control: "swap" },
          { wait: 2600 },
          { control: "swap" },
          { wait: 2400 },
        ];
      },
      botMove(rand) {
        // Now and then leave it to the shell, which also tries the tabs and the Maths.
        if (rand() < 0.2) return null;
        const r = rand();
        if (s.mode === "pictures") {
          return r < 0.5 ? { control: "swap" } : { control: "addOne" };
        }
        if (r < 0.35) return { gesture: spotGesture(rand) };
        if (r < 0.55) return { control: "addOne" };
        if (r < 0.65) return { control: "addAll" };
        if (r < 0.85) return { control: "detail", to: S_MIN + rand() * (S_MAX - S_MIN) };
        return { control: "swap" };
      },
      hint() {
        return addOne ? centre(addOne.rect) : null;
      },
      status() {
        return { view: s.mode, kept: kept(s).length, cutoff: s.cutoff, role: s.role, swapped };
      },
      reset() {
        s = { ...START };
        swapped = false;
        said = "none";
        // A demo resets the chapter alone, so put the usual lines back here too.
        env.say?.({ caption: null, so: null });
        adding = false;
        if (detail) detail.value = s.cutoff;
      },
      show() {},
      dispose() {
        rho?.release();
        ripple?.release();
        rho = null;
        ripple = null;
        pictures.clear();
        controls = [];
      },
    };
  },
};

export default def;
