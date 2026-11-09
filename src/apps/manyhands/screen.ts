/**
 * The screen above a bank. It runs the build: takes the parts the touch frames below send, flies
 * each in from the bottom edge right above the frame that made it, hands out orders, and keeps
 * the bank up to date with `build`. Columns it hasn't heard from for a while are left to the
 * helpers. With nobody below it keeps building with slow helpers, so it is never still.
 */
import { bankFraction } from "../../core/layout";
import type { AppContext, AppInstance, FrameInfo, OptionValue, PeerInfo } from "../../core/types";
import { drawIcon } from "./art";
import { madeCount, filledCount } from "./build";
import {
  COLUMN_GONE_MS,
  type Config,
  EXIT_SPEED,
  FLY_MS,
  type ThemeId,
  WORKING_MS,
} from "./config";
import { type Cover, createForeman } from "./foreman";
import { EXIT_SIZE } from "./frameview";
import type { Box } from "./layout";
import { createDownlink } from "./link";
import {
  createConfetti,
  drawBuild,
  drawIdleHelpers,
  drawIncoming,
  drawScene,
  drawSun,
  drawTrophies,
  type Fit,
  fitBuild,
} from "./scene";
import { circle } from "./tasks/common";
import { THEMES } from "./themes";
import { createSeen, MAX_COLUMNS, MAX_STATIONS, type PartMsg } from "./wire";

/** Venue width of one panel, for the bank's scale. */
const PANEL_W = 1080;
const MAX_FRAMES = 64;
const MAX_ARRIVALS = 64;

interface FrameRec {
  pos: number;
  span: number;
  heard: number;
  active: number;
  /** Last part or beat saying each workstation was worked, local ms. */
  work: number[];
}

export const mountScreen = (ctx: AppContext, config: Config): AppInstance => {
  const side = ctx.setup.side ?? 0;
  const players = ctx.ui.palette.players;
  let frame: FrameInfo = ctx.frame;
  const clock = () => ctx.clock.now();
  const seen = createSeen();
  const recs = new Map<string, FrameRec>();
  const arrivals: { id: number; frame: string; late: number; column: number; slot: number }[] = [];
  const confetti = createConfetti();
  let pokedAt = 0;
  let disposed = false;

  const present = (r: FrameRec, now: number) => now - r.heard < COLUMN_GONE_MS;
  const spanNow = () => {
    let s = 1;
    const now = performance.now();
    for (const r of recs.values()) if (present(r, now)) s = Math.max(s, r.span);
    return s;
  };
  const countNow = () => {
    let n = Math.max(1, ctx.setup.count);
    const now = performance.now();
    for (const r of recs.values()) if (present(r, now)) n = Math.max(n, r.pos + 1);
    return Math.min(n, MAX_COLUMNS);
  };
  const columnsNow = () => Math.min(MAX_COLUMNS, countNow() * spanNow());

  const cover = (): Cover => {
    const now = performance.now();
    const span = spanNow();
    const byPos = new Map<number, FrameRec>();
    let active = 0;
    for (const r of recs.values()) {
      if (!present(r, now)) continue;
      byPos.set(r.pos, r);
      active += r.active;
    }
    return {
      columns: columnsNow(),
      working: (c) => {
        const r = byPos.get(Math.floor(c / span));
        return !!r && now - (r.work[c % span] ?? Number.NEGATIVE_INFINITY) < WORKING_MS;
      },
      active,
    };
  };

  const foreman = createForeman({
    round: config.round,
    theme: config.theme,
    now: clock(),
    cover: cover(),
  });

  const recFor = (from: string, peer: PeerInfo, pos: number): FrameRec => {
    let r = recs.get(from);
    if (!r) {
      r = {
        pos,
        span: peer.kind === "pair" ? Math.max(2, peer.span ?? 2) : 1,
        heard: 0,
        active: 0,
        work: [],
      };
      recs.set(from, r);
      while (recs.size > MAX_FRAMES) {
        const first = recs.keys().next().value;
        if (first === undefined) break;
        recs.delete(first);
      }
    }
    r.pos = pos;
    r.heard = performance.now();
    return r;
  };

  const onPart = (m: PartMsg, from: string, peer: PeerInfo) => {
    if (disposed || !seen.fresh(from, m.i)) return;
    const now = performance.now();
    const r = recFor(from, peer, m.p);
    if (m.w >= r.span) return;
    r.work[m.w] = now;
    const span = spanNow();
    const count = countNow();
    const column = m.p * span + m.w;
    const b = foreman.build;
    const kinds = THEMES[b.theme].kinds.length;
    const kind = m.b === b.id && m.k < kinds ? m.k : (foreman.orders[column] ?? 0);
    const t = clock();
    const slot = foreman.deliver(
      {
        kind: Math.max(0, Math.min(kinds - 1, kind)),
        maker: m.c >= 0 ? "person" : "bot",
        color: Math.max(0, m.c),
        column,
        departAt: m.t,
        arriveAt: m.t + FLY_MS,
        sx: bankFraction(m.p, m.u, count),
        sy: 1,
      },
      t,
    );
    arrivals.push({ id: m.i, frame: from, late: t - m.t, column, slot });
    while (arrivals.length > MAX_ARRIVALS) arrivals.shift();
    if (m.c >= 0 && now - pokedAt > 1000) {
      pokedAt = now;
      ctx.idle.poke();
    }
    downlink.changed();
  };

  const downlink = createDownlink(ctx.net, side, () => performance.now(), {
    part: onPart,
    beat(m, from, peer) {
      if (disposed) return;
      const r = recFor(from, peer, m.p);
      r.span = Math.max(1, Math.min(MAX_STATIONS, m.s));
      r.active = m.a;
      const now = performance.now();
      for (let i = 0; i < r.span; i++)
        if (m.g & (1 << i)) r.work[i] = Math.max(r.work[i] ?? 0, now - 1);
    },
  });

  const buildMsg = () => {
    const b = foreman.build;
    return {
      id: b.id,
      theme: b.theme,
      total: b.slots.length,
      made: madeCount(b),
      start: b.startAt,
      end: b.endAt,
      phase: b.phase,
      orders: [...foreman.orders].slice(0, MAX_COLUMNS),
      trophies: foreman.trophies,
    };
  };

  // ---- Drawing ------------------------------------------------------------------------------

  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};pointer-events:none;`;
    ctx.root.append(c);
    return c;
  };
  const backCanvas = make(0);
  const frontCanvas = make(1);
  const back = backCanvas.getContext("2d");
  const g = frontCanvas.getContext("2d");
  let k = 1;
  let area: Box = { x: 0, y: 0, w: 1, h: 1 };
  let drawnTheme: ThemeId | null = null;

  const fitFor = (theme: ThemeId): Fit =>
    fitBuild(area, theme, { height: 0.72, bottom: 0.89, width: 0.8 });

  const sizeCanvases = () => {
    k = frame.unit * frame.pixelRatio;
    area = { x: 0, y: 0, w: frame.width / frame.unit, h: frame.height / frame.unit };
    const w = Math.max(1, Math.round(frame.width * frame.pixelRatio));
    const h = Math.max(1, Math.round(frame.height * frame.pixelRatio));
    for (const c of [backCanvas, frontCanvas]) {
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
    }
    drawnTheme = null;
  };

  const drawBack = (theme: ThemeId) => {
    if (!back) return;
    drawnTheme = theme;
    back.setTransform(1, 0, 0, 1, 0, 0);
    back.clearRect(0, 0, backCanvas.width, backCanvas.height);
    back.setTransform(k, 0, 0, k, 0, 0);
    drawScene(back, theme, area, fitFor(theme), String(ctx.seed));
  };

  /** The bottom edge above each column that is present: its order, in its colour. */
  const drawColumns = (gc: CanvasRenderingContext2D, now: number, time: number) => {
    const span = spanNow();
    const count = countNow();
    const columns = count * span;
    const size = Math.min((area.w / columns) * 0.5, area.h * 0.075);
    const y = area.h - size * 0.62;
    for (const r of recs.values()) {
      if (!present(r, now)) continue;
      for (let w = 0; w < Math.min(span, r.span); w++) {
        const c = r.pos * span + w;
        const order = foreman.orders[c] ?? -1;
        const x = bankFraction(r.pos, (w + 0.5) / span, count) * area.w;
        const color = players[c % players.length] ?? "#6fa4fc";
        gc.fillStyle = "rgba(8,12,24,0.7)";
        circle(gc, x, y, size * 0.55);
        gc.fill();
        gc.strokeStyle = color;
        gc.lineWidth = Math.max(4, size * 0.07);
        gc.stroke();
        if (order >= 0) drawIcon(gc, foreman.build.theme, order, x, y, size * 0.66, time);
      }
    }
  };

  const loop = ctx.loop({
    hz: 30,
    update() {
      if (disposed) return;
      foreman.update(clock(), cover());
      for (const e of foreman.takeEvents()) {
        if (e.type === "alive") confetti.start(area, e.early ? 160 : 70, e.id, performance.now());
        downlink.changed();
      }
      downlink.tick(buildMsg);
      // Forget frames long gone, so the map stays small.
      const now = performance.now();
      for (const [id, r] of recs) if (now - r.heard > COLUMN_GONE_MS * 12) recs.delete(id);
    },
    render() {
      if (disposed || !g) return;
      const now = performance.now();
      const t = clock();
      const time = now / 1000;
      const b = foreman.build;
      if (drawnTheme !== b.theme) drawBack(b.theme);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, frontCanvas.width, frontCanvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      const f = fitFor(b.theme);
      drawBuild(g, b, f, t, { colors: { players }, time });
      const trophy = Math.min(area.h * 0.06, area.w * 0.05);
      drawSun(
        g,
        b,
        { x: 0, y: trophy * 1.4, w: area.w, h: area.h * 0.3 },
        t,
        Math.min(area.h * 0.032, area.w * 0.03),
      );
      drawTrophies(g, foreman.trophies, area, trophy, "left");
      drawIdleHelpers(g, b, f, time, 3, Math.max(60, f.s * 0.06));
      drawColumns(g, now, time);
      const scale = area.w / (Math.max(1, countNow()) * PANEL_W * spanNow());
      drawIncoming(g, b, f, area, t, {
        colors: { players },
        time,
        startSize: EXIT_SIZE * 0.8 * scale,
        rise: EXIT_SPEED * scale,
        helper: Math.max(60, f.s * 0.07),
      });
      confetti.draw(g, now);
    },
  });
  sizeCanvases();
  loop.start();

  const offResize = ctx.onResize((fr) => {
    frame = fr;
    sizeCanvases();
  });

  const status = (): Record<string, OptionValue> => {
    const b = foreman.build;
    const now = performance.now();
    let frames = 0;
    for (const r of recs.values()) if (present(r, now)) frames++;
    return {
      theme: b.theme,
      filled: filledCount(b),
      total: b.slots.length,
      builds: foreman.totals.builds,
      early: foreman.totals.early,
      people: foreman.totals.person,
      bots: foreman.totals.bot,
      helpers: foreman.totals.helper,
      frames,
    };
  };

  const debugKey = "__manyhands";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const b = foreman.build;
          const f = fitFor(b.theme);
          const now = performance.now();
          return {
            screen: true,
            mode: "screen",
            width: area.w,
            height: area.h,
            count: countNow(),
            span: spanNow(),
            columns: columnsNow(),
            orders: [...foreman.orders],
            frames: [...recs.entries()]
              .filter(([, r]) => present(r, now))
              .map(([id, r]) => ({ id, pos: r.pos, span: r.span, active: r.active })),
            build: {
              id: b.id,
              theme: b.theme,
              phase: b.phase,
              total: b.slots.length,
              made: madeCount(b),
              filled: filledCount(b),
              people: b.slots.filter((s) => s.maker === "person").length,
              bots: b.slots.filter((s) => s.maker === "bot").length,
              trophies: foreman.trophies,
              start: b.startAt,
              end: b.endAt,
            },
            coming: b.slots
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => s.state === "coming" && s.maker !== "helper")
              .map(({ s, i }) => ({
                slot: i,
                column: s.column,
                maker: s.maker,
                color: s.color,
                startX: s.sx * area.w,
                departAt: s.departAt,
                arriveAt: s.arriveAt,
                end: { x: f.ox + (s.x + s.w / 2) * f.s, y: f.oy + (s.y + s.h / 2) * f.s },
              })),
            arrivals: [...arrivals],
            totals: { ...foreman.totals },
            received: downlink.received,
            dropped: downlink.dropped,
            clock: clock(),
            active: cover().active,
          };
        },
        command: (name: string) => {
          if (name === "next") foreman.finish(clock());
        },
      },
    });
  }

  return {
    reset() {
      foreman.clearTrophies();
    },
    attract() {},
    status,
    command(name) {
      if (name === "next") {
        foreman.finish(clock());
        downlink.changed();
      }
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      downlink.dispose();
      recs.clear();
      seen.clear();
      arrivals.length = 0;
      backCanvas.remove();
      frontCanvas.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
