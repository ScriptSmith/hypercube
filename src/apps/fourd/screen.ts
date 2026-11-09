/**
 * The screen above a bank: the bank's shared shape, large and turning, as its shadow, with every
 * frame's slice inside it at its place in that frame's colour; and along the bottom edge the
 * same slices at their true size, each above its own frame, so the row reads as a flip-book of
 * the shape. The screen is the bank's leader while it is there (link.ts). With no frames, a lone
 * slice sweeps through the shadow with the show's captions.
 */
import { Color } from "three";
import type {
  AppContext,
  AppInstance,
  FrameInfo,
  OptionValue,
  PeerInfo,
  Rect,
} from "../../core/types";
import {
  BACKGROUND,
  familyAt,
  frameColor,
  HZ,
  NEAR_COLOR,
  readConfig,
  SLICE_COLOR,
} from "./config";
import { defaultLever } from "./frame";
import { createCutInbox, createShared } from "./link";
import { autoAzimuth } from "./orbit";
import { createPanel, type Panel, type StageLook } from "./panel";
import { identity } from "./rot";
import { MANY_STYLE, type SliceSlot } from "./scenes";
import { type Dim, FAMILIES, shapeOf } from "./shapes";
import { showAt } from "./show";
import { cutOf, extent, HIDDEN } from "./slice";
import { createPainter, type Port } from "./view";
import { type Layout, screenScale, type StageLayout } from "./layout";

const MAX_FRAMES = 16;

export interface ScreenLayout {
  main: { lane: Rect; focus: Rect };
  /** One cell per frame position, left to right. */
  cells: { lane: Rect; focus: Rect }[];
  caption: { x: number; y: number; width: number; size: number };
  legend: { x: number; y: number; size: number };
}

/** The screen's views: the shadow above, and a row of cells each over its own frame. */
export const screenLayout = (W: number, H: number, count: number): ScreenLayout => {
  const n = Math.max(1, Math.min(MAX_FRAMES, count));
  const s = screenScale(W, H);
  const cw = W / n;
  const rowH = Math.min(cw * 1.05, H * 0.26);
  const top = 300 * s;
  const mainLane = { x: 0, y: 0, width: W, height: H - rowH };
  const mainFocus = { x: W * 0.12, y: top, width: W * 0.76, height: H - rowH - top - 60 * s };
  const cells = Array.from({ length: n }, (_, p) => {
    const lane = { x: p * cw, y: H - rowH, width: cw, height: rowH };
    const pad = Math.min(cw, rowH) * 0.1;
    return {
      lane,
      focus: { x: lane.x + pad, y: lane.y + pad, width: cw - 2 * pad, height: rowH - 2 * pad },
    };
  });
  return {
    main: { lane: mainLane, focus: mainFocus },
    cells,
    caption: { x: W / 2, y: 150 * s, width: W - 300 * s, size: 96 * s },
    legend: { x: 120 * s, y: mainLane.height - 120 * s, size: 60 * s },
  };
};

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const dim: Dim = config.variant === "flat" ? 3 : 4;
  const side = ctx.setup.side ?? 0;
  let frame: FrameInfo = ctx.frame;
  const countOf = () => {
    let n = Math.max(1, ctx.setup.count);
    for (const p of touchFrames()) n = Math.max(n, p.pos + 1);
    return Math.min(MAX_FRAMES, n);
  };
  const touchFrames = (): PeerInfo[] =>
    ctx.net.online
      ? ctx.net
          .peers()
          .filter(
            (p) =>
              p.role !== "screen" &&
              (p.side ?? 0) === side &&
              Number.isInteger(p.pos) &&
              p.pos >= 0 &&
              p.pos < MAX_FRAMES,
          )
      : [];
  let count = countOf();
  let sl = screenLayout(frame.width / frame.unit, frame.height / frame.unit, count);
  ctx.root.style.background = BACKGROUND;
  const now = () => performance.now();
  const clockNow = () => ctx.clock.now();
  const painter = createPainter(ctx.root, frame);
  const main: Port = painter.add(
    dim === 4 ? "stage4" : "stack3",
    MAX_FRAMES,
    sl.main.lane,
    sl.main.focus,
    MANY_STYLE,
  );
  const row: Port = painter.add(
    dim === 4 ? "slice4" : "slice3",
    MAX_FRAMES,
    sl.cells[0]!.lane,
    sl.cells[0]!.focus,
  );
  painter.prepare();
  const shared = createShared({ net: ctx.net, pos: -1, dim, clock: clockNow, now });
  const inbox = createCutInbox(ctx.net, now);
  const started = now();
  const rot = identity();
  const slots: SliceSlot[] = Array.from({ length: MAX_FRAMES }, (_, i) => ({
    cut: 0,
    color: new Color(frameColor(i)),
    on: false,
  }));
  const lone = new Color(SLICE_COLOR);

  /** A one-stage layout for the panel: captions and a legend, no controls. */
  const panelLayout = (): Layout => {
    const st: StageLayout = {
      index: 0,
      dim,
      views: [{ kind: "stage", lane: sl.main.lane, focus: sl.main.focus }],
      lever: null,
      dials: [],
      orients: [],
      shapes: [],
      reset: null,
      gauge: null,
      caption: sl.caption,
      legend: sl.legend,
      consoles: [],
    };
    return {
      kind: "screen",
      width: frame.width / frame.unit,
      height: frame.height / frame.unit,
      stages: [st],
      home: { x: 0, y: 0, size: 160 },
    };
  };
  const panelOf = () =>
    createPanel(ctx.root, panelLayout(), frame.unit, frame.pixelRatio, {
      axes: config.axes,
      legends: [
        [
          {
            x: sl.legend.x,
            y: sl.legend.y,
            items:
              dim === 4
                ? [
                    { label: "Shadow", color: NEAR_COLOR },
                    { label: "Slices", color: frameColor(0) },
                  ]
                : [{ label: "Slices", color: frameColor(0) }],
          },
        ],
      ],
    });
  let panel: Panel = panelOf();
  const look: StageLook = {
    dim,
    lever: 0,
    extent: null,
    leverHeld: false,
    dials: [],
    dialHeld: [],
    active: null,
    family: 0,
    caption: null,
    ghost: null,
    gauge: null,
    color: SLICE_COLOR,
  };
  let shownFrames: { pos: number; cut: number; heard: boolean }[] = [];
  let disposed = false;

  const loop = ctx.loop({
    hz: HZ,
    update() {
      if (disposed) return;
      shared.step();
    },
    render() {
      if (disposed) return;
      const n = countOf();
      if (n !== count) {
        count = n;
        sl = screenLayout(frame.width / frame.unit, frame.height / frame.unit, count);
        main.lane = sl.main.lane;
        main.focus = sl.main.focus;
      }
      const shape = shapeOf(familyAt(shared.family), dim);
      shared.orientation(rot);
      const peers = touchFrames();
      for (const s of slots) s.on = false;
      shownFrames = [];
      for (const p of peers) {
        const slot = slots[p.pos];
        if (!slot) continue;
        const heard = inbox.get(p.frame);
        const t = heard ? heard.t : defaultLever(shape, p.pos, count);
        slot.cut = cutOf(dim, t);
        slot.color.set(frameColor(p.pos));
        slot.on = true;
        shownFrames.push({ pos: p.pos, cut: slot.cut, heard: heard !== undefined });
      }
      shownFrames.sort((a, b) => a.pos - b.pos);
      look.caption = null;
      if (peers.length === 0) {
        // No frames: one slice sweeps through on the show's timing.
        const pose = showAt((now() - started) / 1000, dim, familyAt(shared.family));
        const slot = slots[0]!;
        slot.cut = cutOf(dim, pose.lever);
        slot.color.copy(lone);
        slot.on = true;
        look.caption = pose.at < 20 ? pose.caption : null;
      }
      const az = autoAzimuth(config.spin, clockNow() / 1000);
      main.azimuth = az;
      row.azimuth = az;
      main.elevation = 22;
      row.elevation = 22;
      painter.update(main, shape, rot, slots);
      painter.update(row, shape, rot, slots);
      const list: { port: Port; only?: number; lane?: Rect; focus?: Rect }[] = [
        { port: main, only: -1 },
      ];
      if (peers.length > 0) {
        for (const f of shownFrames) {
          const cell = sl.cells[f.pos];
          if (cell) list.push({ port: row, only: f.pos, lane: cell.lane, focus: cell.focus });
        }
      }
      painter.render(list);
      const ext = extent(shape, rot, HIDDEN[dim]);
      look.gauge = { lo: ext.lo, hi: ext.hi, cut: 0 };
      look.family = shared.family;
      panel.update([look]);
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    sl = screenLayout(f.width / f.unit, f.height / f.unit, count);
    main.lane = sl.main.lane;
    main.focus = sl.main.focus;
    painter.resize(f);
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      panel.dispose();
      panel = panelOf();
    }, 150);
  });

  const debugKey = "__fourd";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          ready: painter.ready,
          count,
          family: FAMILIES[shared.family],
          rot: Array.from(rot),
          link: {
            leading: shared.leading,
            following: shared.following,
            live: shared.live,
            stats: { ...shared.stats },
          },
          frames: shownFrames,
          slices: main.stage.last.sliceKind.slice(0, count),
          sizes: main.stage.last.sliceSize.slice(0, count),
          caption: look.caption,
        }),
      },
    });
  }

  return {
    reset() {
      shared.reset();
    },
    attract() {},
    status(): Record<string, OptionValue> {
      return {
        shape: FAMILIES[shared.family] ?? "cube",
        frames: shownFrames.length,
        heard: shownFrames.filter((f) => f.heard).length,
        leading: shared.leading,
        live: shared.live,
      };
    },
    command(name) {
      if (name === "reset") shared.reset();
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      shared.dispose();
      inbox.dispose();
      panel.dispose();
      painter.dispose();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
