/**
 * The screen. Above a bank it shows the scene through every frame's eye, one column above each
 * frame, with that frame's condition name and view caption under it, so the row compares eyes
 * at a glance; a large view at the top features the frame someone touched last (or each in
 * turn). A column it can't hear shows what an untouched frame would: the bank's tour on the
 * shared clock. A screen on its own shows a gallery of conditions, changing as a slow tour.
 *
 * Three.js only for the views (sight.ts); names and captions are DOM.
 */
import { bankFraction } from "../../core/layout";
import { createRenderer3D } from "../../core/renderer3d";
import { FONT } from "../../core/ui";
import type { AppContext, AppInstance, FrameInfo, OptionValue, PeerInfo } from "../../core/types";
import { conditionCaption } from "./captions";
import { ACCENT, BACKGROUND, EDGE, HZ, INK, MUTED, readConfig } from "./config";
import { amdExample, effectsFor, kernelKey, kernelsFor } from "./effects";
import { fitElement } from "./fit";
import type { Rect } from "./layout";
import { BEACON_MS, createInbox, sendBeacon } from "./link";
import { type Derived, derive, type EyeState } from "./model";
import { createSight, type ViewDraw } from "./sight";
import { viewLine, viewTag } from "./text";
import { bankTour, CYCLE_S, cycleAt } from "./tour";
import { FLAG, MAX_POS, stateOf } from "./wire";

/** A person's touch keeps their frame featured this long. */
const FEATURE_MS = 20_000;
/** With nobody touching, the featured view moves on this often. */
const ROTATE_MS = 12_000;
const MAX_COLUMNS = 10;
const GALLERY: readonly EyeState["condition"][] = [
  "myopia",
  "hyperopia",
  "astigmatism",
  "presbyopia",
  "cataract",
  "glaucoma",
  "amd",
  "diabetic",
  "keratoconus",
  "cvd",
];

interface Cell {
  rect: Rect;
  name: HTMLElement;
  caption: HTMLElement;
  tag: HTMLElement;
  last: string;
}

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.options);
  const inBank = ctx.setup.name === "bank";
  const side = ctx.setup.side ?? 0;
  let frame: FrameInfo = ctx.frame;
  ctx.root.style.background = BACKGROUND;
  const r3d = createRenderer3D(ctx.root, frame, { alpha: true });
  const renderer = r3d.renderer;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  // The featured view is large; a few megapixels keep its sharp layers sharp.
  const sight = createSight(r3d, { fov: config.fov, maxPixels: 2.5e6 });
  r3d.onRestore(() => sight.invalidate());
  const now = () => performance.now();
  const inbox = inBank ? createInbox(ctx.net, { side, frame: ctx.net.self }, now) : null;

  const layer = document.createElement("div");
  layer.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:2;font-family:${FONT};color:${INK};`;
  ctx.root.append(layer);

  let cells: Cell[] = [];
  let count = 0;
  const W = () => frame.width / frame.unit;
  const H = () => frame.height / frame.unit;

  const makeCell = (rect: Rect, big: boolean, capHeight?: number): Cell => {
    const u = frame.unit;
    const px = (v: number) => `${v * u}px`;
    const nameSize = big ? 92 : rect.width > 600 ? 58 : 46;
    const capSize = big ? 60 : rect.width > 600 ? 40 : 32;
    const frameEl = document.createElement("div");
    frameEl.style.cssText =
      `position:absolute;left:${px(rect.x)};top:${px(rect.y)};width:${px(rect.width)};height:${px(rect.height)};` +
      `border:${Math.max(1, 4 * u)}px solid ${EDGE};border-radius:${px(14)};box-sizing:border-box;`;
    const name = document.createElement("div");
    name.style.cssText =
      `position:absolute;left:${px(rect.x)};top:${px(rect.y + rect.height + 16)};width:${px(rect.width)};` +
      `font-weight:800;font-size:${px(nameSize)};color:${ACCENT};line-height:1.1;`;
    const caption = document.createElement("div");
    const capTop = rect.y + rect.height + 16 + nameSize * 2.4;
    const capH = capHeight ?? (big ? 330 : H() - capTop - 40);
    caption.style.cssText =
      `position:absolute;left:${px(rect.x)};top:${px(capTop)};width:${px(rect.width)};height:${px(capH)};` +
      `font-weight:550;font-size:${px(capSize)};line-height:1.24;overflow:hidden;`;
    caption.dataset.max = String(capSize * u);
    const tag = document.createElement("div");
    tag.style.cssText =
      `position:absolute;left:${px(rect.x + 14)};top:${px(rect.y + 14)};padding:${px(6)} ${px(16)};` +
      `border-radius:${px(40)};background:rgba(8,12,22,0.72);font-weight:700;font-size:${px(big ? 44 : 28)};` +
      `display:none;white-space:nowrap;color:${MUTED};`;
    layer.append(frameEl, name, caption, tag);
    return { rect, name, caption, tag, last: "" };
  };

  /** The featured view on top and one column per frame under it; or the lone screen's grid. */
  const build = (n: number) => {
    layer.replaceChildren();
    count = n;
    const w = W();
    const h = H();
    const out: Cell[] = [];
    if (inBank) {
      out.push(
        makeCell({ x: 120, y: 90, width: w - 240, height: Math.min(1500, (w - 240) * 0.42) }, true),
      );
      for (let p = 0; p < n; p++) {
        const x0 = bankFraction(p, 0, n) * w;
        const x1 = bankFraction(p, 1, n) * w;
        const cw = x1 - x0 - 24;
        const ch = Math.min(cw * 1.6, h * 0.24);
        out.push(makeCell({ x: x0 + 12, y: h * 0.54, width: cw, height: ch }, false));
      }
    } else {
      const cols = 3;
      const rows = 2;
      const cw = (w - 160 - (cols - 1) * 80) / cols;
      const rowH = (h - 80) / rows;
      const ch = Math.min(cw * 0.9, rowH - 620);
      for (let i = 0; i < cols * rows; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        out.push(
          makeCell(
            { x: 80 + c * (cw + 80), y: 80 + r * (ch + 640), width: cw, height: ch },
            false,
            440,
          ),
        );
      }
    }
    cells = out;
  };

  const touchFrames = (): PeerInfo[] =>
    inBank
      ? ctx.net
          .peers()
          .filter(
            (p) => p.role !== "screen" && (p.side ?? 0) === side && p.pos >= 0 && p.pos <= MAX_POS,
          )
          .sort((a, b) => a.pos - b.pos)
      : [];
  const countNow = () =>
    Math.min(
      MAX_COLUMNS,
      Math.max(1, inBank ? ctx.setup.count : 1, ...touchFrames().map((p) => p.pos + 1)),
    );

  build(inBank ? countNow() : 6);

  const derivedCache = new Map<number, { key: string; d: Derived }>();
  const deriveFor = (slot: number, s: EyeState): Derived => {
    const key = JSON.stringify(s);
    const hit = derivedCache.get(slot);
    if (hit && hit.key === key) return hit.d;
    const d = derive(s);
    derivedCache.set(slot, { key, d });
    return d;
  };

  const personAt = new Map<number, number>();
  let featured = 0;
  let featuredSince = now();
  let beaconAt = Number.NEGATIVE_INFINITY;
  let time = 0;
  let disposed = false;
  let heardCount = 0;

  /** Each column's eye now: what its frame sent, or the bank tour it would be on. */
  const columns = (): { pos: number; state: EyeState; heard: boolean }[] => {
    const clock = ctx.clock.now() / 1000;
    const heard = new Map<number, EyeState>();
    if (inbox) {
      for (const h of inbox.fresh()) {
        heard.set(h.pos, stateOf(h.msg));
        if (h.msg.f & FLAG.person) personAt.set(h.pos, h.at);
      }
    }
    heardCount = heard.size;
    return Array.from({ length: count }, (_, p) => {
      const s = heard.get(p);
      return s
        ? { pos: p, state: s, heard: true }
        : { pos: p, state: bankTour(clock, p, config.light).state, heard: false };
    });
  };

  const galleryStates = (): EyeState[] => {
    const t = time;
    const n = Math.floor(t / CYCLE_S);
    return cells.map((_, i) => {
      const c = GALLERY[(i + n * cells.length) % GALLERY.length]!;
      return cycleAt(c, t - n * CYCLE_S + i * 1.3, config.light, n).state;
    });
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      time += dt;
      const t = now();
      if (inBank) {
        const n = countNow();
        if (n !== count) build(n);
        if (t - beaconAt >= BEACON_MS && ctx.net.online) {
          beaconAt = t;
          sendBeacon(ctx.net, side);
        }
      }
    },
    render() {
      if (disposed) return;
      const t = now();
      let states: { state: EyeState; heard: boolean; pos: number }[];
      if (inBank) {
        const cols = columns();
        // Feature the latest person, else take turns.
        let best: { pos: number; at: number } | null = null;
        for (const [p, at] of personAt) {
          if (t - at <= FEATURE_MS && p < count && (!best || at > best.at)) best = { pos: p, at };
        }
        if (best) featured = best.pos;
        else if (t - featuredSince > ROTATE_MS) {
          featured = (featured + 1) % Math.max(1, count);
          featuredSince = t;
        }
        const f = cols[Math.min(featured, cols.length - 1)]!;
        states = [{ ...f }, ...cols];
      } else {
        states = galleryStates().map((s, i) => ({ state: s, heard: false, pos: i }));
      }
      const draws: ViewDraw[] = [];
      cells.forEach((cell, i) => {
        const s = states[i]?.state;
        if (!s) return;
        const d = deriveFor(i, s);
        const u = frame.unit;
        const css = {
          x: cell.rect.x * u,
          y: cell.rect.y * u,
          width: cell.rect.width * u,
          height: cell.rect.height * u,
        };
        const w = css.width * frame.pixelRatio;
        const kernels = kernelsFor(d, w, config.fov);
        draws.push({
          slot: i,
          rect: css,
          kernels,
          key: kernelKey(kernels, w, config.fov),
          night: d.night,
          fix: sight.fixFor(css.width, css.height, d.night, s.looking),
          effects: effectsFor(s, time, { floaters: false }),
          time,
        });
        const line = viewLine(s, d);
        const name = conditionCaption(s.condition).name;
        const tag = viewTag(s, d, amdExample(time));
        const key = `${name}|${line?.text ?? ""}|${tag}`;
        if (key !== cell.last) {
          cell.last = key;
          cell.name.textContent = name;
          cell.caption.textContent = line?.text ?? "";
          fitElement(cell.caption, Number(cell.caption.dataset.max ?? 32), 18 * u);
          cell.tag.textContent = tag ?? "";
          cell.tag.style.display = tag ? "block" : "none";
        }
      });
      if (r3d.ready) {
        renderer.setRenderTarget(null);
        renderer.setScissorTest(false);
        renderer.clear();
        renderer.setScissorTest(true);
        sight.draw(draws, frame.height);
        renderer.setScissorTest(false);
      }
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    r3d.resize(f);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) build(count);
    }, 150);
  });

  const debugKey = "__eye";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          bank: inBank,
          ready: r3d.ready,
          count,
          featured: inBank ? featured : null,
          heard: heardCount,
          columns: inBank
            ? columns().map((c) => ({
                pos: c.pos,
                condition: c.state.condition,
                heard: c.heard,
                eye: c.state,
              }))
            : [],
          cells: cells.map((c) => ({
            rect: c.rect,
            name: c.name.textContent,
            caption: c.caption.textContent,
          })),
          blurs: sight.blurs,
        }),
      },
    });
  }

  return {
    reset() {
      personAt.clear();
      featured = 0;
      featuredSince = now();
    },
    attract() {},
    status(): Record<string, OptionValue> {
      return { columns: count, heard: heardCount, featured: inBank ? featured : -1 };
    },
    dispose() {
      disposed = true;
      loop.stop();
      inbox?.dispose();
      clearTimeout(resizeTimer);
      offResize();
      layer.remove();
      sight.dispose();
      r3d.dispose();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
