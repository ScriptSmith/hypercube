/**
 * The screen above a bank: the time-space diagram of the whole ring, its x lined up with the
 * panels below, and a strip of road along its foot with every car on it. With the circle option
 * the ring is a circle above the diagram instead of the strip. It hosts the ring while it is
 * there (link.ts). A screen on its own runs a ring as long as the venue's usual bank.
 */
import type { AppContext, AppInstance, FrameKind } from "../../core/types";
import { FONT } from "../../core/ui";
import { activeVenue } from "../../core/venue";
import { bodyColor, drawCar, drawSign, paintCircleRoad, VERGE } from "./art";
import { type Config, GHOST_MAX_S, GHOST_MIN_S, type Settings, SPACING } from "./config";
import { BACKDROP, paintDue } from "./diagram";
import { startCount } from "./driver";
import { frameLayout, type LayoutInput, type Placement, stretchMetres } from "./layout";
import { createLagSend } from "./lag";
import { createLink } from "./link";
import { CAR_LENGTH, jams, LIMIT_SIGNS, meanSpeed } from "./model";
import { diagramFor } from "./touch";
import { FLAG, type WireCar } from "./wire";

const ATTRACT_AFTER_MS = 20_000;

export const mountScreen = (ctx: AppContext, cfg: Config): AppInstance => {
  const bank = ctx.setup.name === "bank";
  const count = bank ? Math.max(1, Math.min(32, ctx.setup.count)) : activeVenue().bankCount;
  const clock = () => ctx.clock.now();
  let frame = ctx.frame;

  const touchKind = (): FrameKind => {
    const peers = ctx.net.peers().filter((p) => p.role !== "screen" && p.kind !== "screen");
    const pairs = peers.filter((p) => p.kind === "pair").length;
    return pairs > peers.length / 2 ? "pair" : "panel";
  };
  const ringLength = () => stretchMetres(touchKind() === "pair" ? 2160 : 1080) * count;
  const baseCount = (length: number) => startCount(length, SPACING[cfg.density]);
  const defaults = (length: number): Settings => ({
    count: baseCount(length),
    limit: cfg.limit,
    smart: cfg.smart,
  });

  let lastPerson = Number.NEGATIVE_INFINITY;
  let brakes = 0;
  const lagged = createLagSend(ctx.net);
  const link = createLink({
    send: lagged.send,
    net: ctx.net,
    clock,
    isScreen: true,
    pos: ctx.setup.pos,
    config: cfg,
    seed: ctx.seed,
    ringLength,
    baseCount,
    defaults,
    eager: !bank,
    onActivity(person) {
      if (!person) return;
      lastPerson = performance.now();
      ctx.idle.poke();
    },
    onBrake(_car, person) {
      if (person) brakes++;
    },
  });

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;";
  ctx.root.append(canvas);
  const g = canvas.getContext("2d", { alpha: false });
  const inputFor = (): LayoutInput => ({
    kind: "screen",
    width: frame.width / frame.unit,
    height: frame.height / frame.unit,
    reachTop: { adult: 0, child: 0 },
    seams: [],
    bank: { pos: 0, count },
    versus: false,
    road: cfg.road,
  });
  let layout = frameLayout(inputFor());
  let diagram = diagramFor(layout);
  const rows = { at: performance.now() };
  let scale = 1;

  const setup = () => {
    canvas.width = Math.max(1, Math.round(frame.width * frame.pixelRatio));
    canvas.height = Math.max(1, Math.round(frame.height * frame.pixelRatio));
    canvas.style.width = `${frame.width}px`;
    canvas.style.height = `${frame.height}px`;
    scale = frame.unit * frame.pixelRatio;
    layout = frameLayout(inputFor());
    diagram.dispose();
    diagram = diagramFor(layout);
  };
  setup();
  const offResize = ctx.onResize((f) => {
    frame = f;
    setup();
  });

  // The ring follows the touch frames' kind (pairs hold twice the road of panels).
  const offPeers = ctx.net.onPeers(() => {
    const d = link.driver;
    if (d) d.resize(ringLength());
  });

  const ghostRng = ctx.rng("traffic:ghost");
  let ghostAt = performance.now() + 7000 + ghostRng.range(0, 3000);
  const ghost = (local: number) => {
    const d = link.driver;
    if (!d || local < ghostAt) return;
    const attract = local - lastPerson > ATTRACT_AFTER_MS;
    link.setAttract(attract);
    if (!attract) {
      ghostAt = local + 5000;
      return;
    }
    ghostAt = local + ghostRng.range(GHOST_MIN_S, GHOST_MAX_S) * 1000;
    let pick: { id: number; v: number } | null = null;
    for (const c of d.ring.cars) if (!pick || c.v > pick.v) pick = { id: c.id, v: c.v };
    if (pick) d.brake(pick.id, 1300, 2);
  };

  const cars: WireCar[] = [];
  const update = () => {
    link.tick();
    ghost(performance.now());
  };

  const drawStrip = (gg: CanvasRenderingContext2D, L: number) => {
    const r = layout.road;
    gg.fillStyle = "#141821";
    gg.fillRect(r.x, r.y, r.width, r.height);
    gg.fillStyle = "rgba(232,236,244,0.35)";
    gg.fillRect(r.x, r.y, r.width, 3);
    const k = r.width / L;
    const len = CAR_LENGTH * k;
    const wid = Math.min(r.height * 0.6, len * 0.5);
    for (const c of cars) {
      const x = (c.x + CAR_LENGTH / 2) * k;
      for (const xx of [x, x - r.width, x + r.width]) {
        if (xx < -len || xx > r.width + len) continue;
        gg.save();
        gg.translate(xx, r.y + r.height / 2);
        drawCar(
          gg,
          len,
          wid,
          bodyColor(c.id, (c.flags & FLAG.smart) !== 0),
          (c.flags & FLAG.smart) !== 0,
          (c.flags & FLAG.brake) !== 0,
        );
        gg.restore();
      }
    }
  };

  /** Cars drawn round the circle last frame, venue px (for tests). */
  const drawn: { id: number; x: number; y: number; angle: number }[] = [];
  const places: Placement[] = [];

  /** The whole ring as a circle, every car on it at the same moment as the panels'. */
  const drawCircle = (gg: CanvasRenderingContext2D, L: number) => {
    const c = layout.circle;
    const path = layout.path;
    drawn.length = 0;
    if (!c || !path) return;
    gg.fillStyle = VERGE;
    gg.beginPath();
    gg.arc(c.cx, c.cy, c.r + c.lane * 1.6, 0, Math.PI * 2);
    gg.fill();
    paintCircleRoad(gg, c);
    // Drawn a little longer than to scale so they read from across the room, but not so long
    // that cars stopped at the model's closest gap would touch.
    const len = CAR_LENGTH * path.pxPerM(L) * 1.12;
    const wid = Math.min(c.lane * 0.75, len * 0.5);
    for (const car of cars) {
      if (path.place(car.x, L, places) === 0) continue;
      const p = places[0]!;
      drawn.push({ id: car.id, x: p.x, y: p.y, angle: p.angle });
      const smart = (car.flags & FLAG.smart) !== 0;
      gg.save();
      gg.translate(p.x, p.y);
      gg.rotate(p.angle);
      drawCar(gg, len, wid, bodyColor(car.id, smart), smart, (car.flags & FLAG.brake) !== 0);
      gg.restore();
    }
  };

  /** Faint time marks up the left edge: every 30 s, labelled every minute. */
  const drawTimes = (gg: CanvasRenderingContext2D) => {
    const d = layout.diagram;
    const perS = d.height / layout.history;
    // Beside a circle the diagram is shorter; the labels keep the size they have without one.
    const size = layout.circle ? layout.height * 0.0164 : d.height * 0.017;
    const lift = layout.circle ? size * 0.9 : d.height * 0.015;
    gg.font = `600 ${Math.round(size)}px ${FONT}`;
    gg.textBaseline = "middle";
    gg.textAlign = "left";
    for (let s = 30; s < layout.history; s += 30) {
      const y = d.y + d.height - s * perS;
      gg.fillStyle = "rgba(200,210,235,0.18)";
      gg.fillRect(0, y, d.width, 2);
      if (s % 60 === 0) {
        gg.fillStyle = "rgba(200,210,235,0.5)";
        gg.fillText(`${s / 60} min ago`, 24, y - lift);
      }
    }
    gg.fillStyle = "rgba(200,210,235,0.6)";
    gg.fillText("now", 24, d.y + d.height - lift);
  };

  const render = () => {
    if (!g) return;
    const local = performance.now();
    const t = clock() - link.delay;
    const L = link.feed.latest?.length ?? 1;
    paintDue(diagram, rows, local, L, 0, 1, (ago, out) => link.feed.at(t - ago, out));
    const has = link.feed.at(t, cars);
    if (!has) cars.length = 0;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = BACKDROP;
    g.fillRect(0, 0, layout.width, layout.height);
    diagram.draw(g, layout.diagram, (local - rows.at) / diagram.rowMs);
    drawTimes(g);
    const s = link.settings();
    if (layout.circle) {
      drawCircle(g, L);
      // The speed limit in force, in the middle of the circle.
      const c = layout.circle;
      if (s) drawSign(g, c.cx, c.cy, c.r * 0.2, LIMIT_SIGNS[s.limit] ?? 50, 0.85);
      return;
    }
    drawStrip(g, L);
    // The speed limit in force, in the corner.
    if (s) {
      const r = layout.diagram.height * 0.045;
      drawSign(g, layout.width - r * 1.5, r * 1.5, r, LIMIT_SIGNS[s.limit] ?? 50, 0.85);
    }
  };

  const loop = ctx.loop({ hz: 60, update, render });
  loop.start();

  const debugKey = "__traffic";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: true,
          hosting: link.hosting,
          host: link.host,
          handovers: link.handovers,
          delay: link.delay,
          clock: clock(),
          settings: link.settings(),
          length: link.feed.latest?.length ?? 0,
          width: layout.width,
          height: layout.height,
          circle: layout.circle,
          diagram: layout.diagram,
          drawn: drawn.map((c) => ({ ...c })),
          painted: diagram.painted,
          ring: cars.map((c) => ({ ...c })),
          jams: link.driver ? jams(link.driver.ring) : null,
        }),
        /** The diagram's colour at fraction `f` across (of what it shows), `secs` ago. */
        peek(f: number, secs: number) {
          return diagram.peek(f, (secs * 1000) / diagram.rowMs);
        },
        setLag(ms: number) {
          lagged.setLag(ms);
        },
      },
    });
  }

  return {
    reset() {
      const d = link.driver;
      if (d) d.set(defaults(d.ring.length));
    },
    attract() {
      ghostAt = Math.min(ghostAt, performance.now() + 4000);
    },
    status() {
      const d = link.driver;
      const s = link.settings();
      return {
        cars: s?.count ?? 0,
        speed: Math.round((d ? meanSpeed(d.ring) : 0) * 3.6),
        jams: d ? jams(d.ring) : 0,
        flow: d ? d.flow() : 0,
        brakes,
        host: link.hosting ? "this frame" : (link.host ?? "none"),
      };
    },
    dispose() {
      loop.stop();
      offResize();
      offPeers();
      link.dispose();
      lagged.dispose();
      diagram.dispose();
      canvas.width = 1;
      canvas.height = 1;
      canvas.remove();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
