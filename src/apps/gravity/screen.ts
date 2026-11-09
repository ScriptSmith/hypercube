/**
 * The screen above a bank: the universe itself, in bank px (y from -H at the top to 0 at the
 * frames' top edge). The screen is authoritative. Four times a second it sends a snapshot of its
 * heaviest bodies in `sky`, and keeps the last few. A frame's `go` names the snapshot its body
 * climbed in and the step it left; the screen climbs the body in that snapshot from that step, at
 * the clock's own rate, and lets it into the universe the moment it crosses the bezel, exactly
 * when and where it leaves the frame. A `go` so late that the body would already have crossed
 * brings it in from the bottom edge, late, never part way up the screen.
 *
 * While a slingshot below is drawn, the screen carries its ribbon on from the frame's aim,
 * through the moving universe. With no touch frames it throws its own bodies every few seconds.
 */
import { activeVenue } from "../../core/venue";
import { createRng } from "../../core/rng";
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { type Shot, shotVelocity } from "./aim";
import { PICKS, type Pick } from "./bodies";
import { createLayers } from "./canvas";
import { type Chooser, createChooser } from "./chooser";
import { readConfig } from "./config";
import { drawClimber } from "./controls";
import { createCosmos, type Cosmos, FACTORS, NORMAL_TIME } from "./cosmos";
import { drawArrows, drawCosmos, drawRibbon, type Scene, type Transform } from "./draw";
import {
  padSpeeds,
  type PadSpot,
  screenScale,
  screenSize,
  screenSky,
  stationLayout,
} from "./layout";
import { AIM_STALE_MS, createDownlink, type Sender, touchFrameWidth } from "./link";
import { type Body, cloneUniverse, launch, type Launch, step } from "./physics";
import { createPrediction, type Prediction, recorder, scoreLaunch, stopOf } from "./predict";
import { SCENES, type Sky } from "./scenes";
import { createSprites, rgbOf } from "./sprites";
import {
  type ClimbStart,
  type Climber,
  createClimber,
  type Snapshot,
  stepClimber,
  takeOver,
} from "./strip";
import { type AimMsg, encodeSky, type GoMsg, MAX_SNAP, type SkyMsg } from "./wire";

/** With no touch frames below for this long, the screen plays by itself. */
const ALONE_MS = 6000;
const MAX_AIMS = 24;
const MAX_CLIMBERS = 64;
const MAX_CROSSINGS = 32;
const MAX_SNAPSHOTS = 24;
const AIM_PREDICT_MS = 60;
const RIBBON_BUDGET_MS = 7;
/** Bodies grow from their strip size to their own over this long after crossing. */
const GROW_MS = 700;
const QUIET_MS = 30_000;
const ATTRACT_SCENE_MS = 150_000;
const BURNT_MS = 20_000;
const QUARTERS = [1, 2, 4, 8, 16];

interface Aim {
  start: ClimbStart;
  snap: Snapshot;
  at: number;
  predAt: number;
  pred: Prediction;
}

/**
 * The ribbon above the bezel: the body climbs its strip in the snapshot, clock step by clock
 * step, while a copy of the universe runs at the time factor; the moment it crosses it joins the
 * copy, as the real one will.
 */
export const predictClimb = (
  c: Cosmos,
  s: ClimbStart,
  snap: Snapshot,
  strip: { x0: number; x1: number },
  steps: number,
  every: number,
  out: Prediction,
  holeMass: number,
): Prediction => {
  const w = cloneUniverse(c.u);
  const climber = createClimber({ ...s, k: c.clockK }, snap, strip);
  const rec = recorder(out, every);
  rec.put(climber.x, climber.y);
  let q = c.quarters;
  const Q = QUARTERS[c.timeIndex]!;
  let body: Body | null = null;
  let done = 0;
  for (let clockSteps = 0; clockSteps < 720 && done < steps; clockSteps++) {
    q += Q;
    while (q >= 4) {
      q -= 4;
      step(w);
      if (body) {
        const st = stopOf(w.events, body.id);
        w.events.length = 0;
        if (st) {
          rec.end(st.stop, st.x, st.y);
          return out;
        }
        rec.tick(body.x, body.y);
        done++;
      } else {
        w.events.length = 0;
      }
    }
    if (body) continue;
    stepClimber(climber);
    if (climber.lost) return out;
    rec.tick(climber.x, climber.y);
    if (climber.crossed >= 0) body = launch(w, launchOf(climber, holeMass));
  }
  return out;
};

export const launchOf = (c: Climber, holeMass: number): Launch => ({
  kind: c.kind,
  x: c.ex,
  y: c.ey,
  vx: c.evx,
  vy: c.evy,
  owner: c.owner,
  pad: c.pad,
  color: c.color,
  human: c.human,
  m: c.kind === "hole" ? holeMass : undefined,
});

export const mountScreen = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.options);
  const inBank = ctx.setup.name === "bank";
  // A screen on its own shows a sky as wide as the venue's usual bank.
  const count = inBank ? Math.max(1, ctx.setup.count) : activeVenue().bankCount;
  const vw = ctx.frame.venueWidth;
  const vh = ctx.frame.venueHeight;
  const ui = () => performance.now();
  const clock = () => ctx.clock.now();
  const rng = ctx.rng().fork("gravity:screen");
  const rand = createRng(`${ctx.seed}:screen:fx`).next;

  let frame: FrameInfo = ctx.frame;
  const layers = createLayers(ctx.root, frame, rng.int(2 ** 31), 0.8);
  const sprites = createSprites();

  let fw = 1080;
  let W = 0;
  let H = 0;
  let sky!: Sky;
  let cosmos!: Cosmos;
  let sceneIndex = cfg.scene;
  let sizesOn = cfg.trueSizes;
  let lastHuman = -Infinity;
  let burntSince = Infinity;
  const climbers: Climber[] = [];
  const grow = new Map<number, { from: number; at: number }>();
  const snapshots: Snapshot[] = [];

  const build = () => {
    ({ W, H } = screenSize(count * fw, vw, vh));
    sky = screenSky(W, H);
    const s = screenScale(W);
    cosmos = createCosmos({
      sky,
      maxBodies: s.maxBodies,
      dustCap: s.dustCap,
      seed: rng.int(2 ** 31),
      scene: sceneIndex,
      clockMs: clock(),
      dot: s.dot,
      trueSizes: sizesOn,
    });
    climbers.length = 0;
    grow.clear();
    snapshots.length = 0;
  };
  build();

  const aims = new Map<string, Aim>();
  const crossings: { owner: string; pad: number; k: number; x: number; late: boolean }[] = [];
  let arrived = 0;
  let lastStation = -Infinity;
  let phantomAt = ui() + 2000;
  let phantom: { chooser: Chooser; column: number; pick: Pick } | null = null;

  const stripOf = (pos: number) => ({ x0: pos * fw, x1: (pos + 1) * fw });

  const snapshotFor = (sn: number): Snapshot => {
    let best: Snapshot | null = null;
    for (const s of snapshots) {
      if (s.k === sn) return s;
      if (!best || Math.abs(s.k - sn) < Math.abs(best.k - sn)) best = s;
    }
    return best ?? { k: 0, b: [], z: sizesOn ? 1 : 0 };
  };

  const enter = (c: Climber, late: boolean) => {
    const b = cosmos.launch(launchOf(c, cosmos.holeMass()));
    if (grow.size > 128) grow.clear();
    grow.set(b.id, { from: c.r, at: ui() });
    if (!c.owner) return;
    crossings.push({ owner: c.owner, pad: c.pad, k: c.crossed, x: c.ex, late });
    if (crossings.length > MAX_CROSSINGS) crossings.shift();
  };

  const human = () => {
    lastHuman = ui();
    ctx.idle.poke();
  };

  const take = (m: GoMsg, from: Sender) => {
    const st = stripOf(from.pos);
    if (m.x < st.x0 - 1 || m.x > st.x1 + 1) return;
    if (m.h) human();
    arrived++;
    const kind: Pick | "hole" = m.k === 1 ? "hole" : PICKS[m.b]!;
    const t = takeOver(
      {
        kind,
        x: m.x,
        y: m.y,
        vx: m.vx,
        vy: m.vy,
        k: m.s,
        owner: from.frame,
        pad: m.p,
        color: m.k === 1 ? -1 : m.c,
        human: m.h === 1,
      },
      snapshotFor(m.sn),
      st,
      cosmos.clockK,
    );
    aims.delete(`${from.frame}:${m.p}`);
    if (t.climber.lost) return;
    if (t.late) {
      enter(t.climber, true);
      return;
    }
    if (climbers.length >= MAX_CLIMBERS) climbers.shift();
    climbers.push(t.climber);
  };

  const aimAt = (m: AimMsg, from: Sender) => {
    const key = `${from.frame}:${m.p}`;
    if (m.off) {
      aims.delete(key);
      return;
    }
    const st = stripOf(from.pos);
    if (m.x < st.x0 - 1 || m.x > st.x1 + 1) return;
    const start: ClimbStart = {
      kind: PICKS[m.b]!,
      x: m.x,
      y: m.y,
      vx: m.vx,
      vy: m.vy,
      k: 0,
      owner: from.frame,
      pad: m.p,
      color: m.c,
      human: false,
    };
    const snap = snapshotFor(m.sn);
    const a = aims.get(key);
    if (a) {
      a.start = start;
      a.snap = snap;
      a.at = ui();
      return;
    }
    if (aims.size >= MAX_AIMS) {
      const first = aims.keys().next().value;
      if (first !== undefined) aims.delete(first);
    }
    aims.set(key, {
      start,
      snap,
      at: ui(),
      predAt: -Infinity,
      pred: createPrediction(cfg.ribbonSteps + 360, 3),
    });
  };

  const nextScene = () => {
    sceneIndex = (cosmos.sceneIndex + 1) % SCENES.length;
    cosmos.setScene(sceneIndex, clock(), ui());
    burntSince = Infinity;
    grow.clear();
  };

  const downlink = inBank
    ? createDownlink(
        ctx.net,
        { side: ctx.setup.side, count: () => count, step: () => cosmos.clockK, now: ui },
        {
          go: take,
          aim: aimAt,
          ctl: (m) => {
            if (m.h) human();
            if (m.t !== 0) cosmos.setTime(cosmos.timeIndex + m.t);
            if (m.z) setSizes(!sizesOn);
            if (m.sc) nextScene();
          },
        },
      )
    : null;

  const setSizes = (on: boolean) => {
    sizesOn = on;
    cosmos.setSizes(on, ui());
  };

  /** The heaviest bodies by their pull on the strips, quantised, kept for the frames' go. */
  const sky1 = (): SkyMsg => {
    const pulls = cosmos.u.bodies
      .map((b) => {
        const dx = Math.max(0, -b.x, b.x - W);
        const dy = Math.max(0, -b.y);
        const d = Math.max(b.r, Math.hypot(dx, dy));
        return { b, f: b.gm / (d * d) };
      })
      .sort((a, b) => b.f - a.f)
      .slice(0, MAX_SNAP);
    const msg = encodeSky({
      w: W,
      h: H,
      k: cosmos.clockK,
      b: pulls.map(({ b }) => [b.x, b.y, b.gm, b.r] as [number, number, number, number]),
      f: cosmos.timeIndex,
      sc: cosmos.sceneIndex,
      vs: cosmos.speed * 100,
      z: sizesOn ? 1 : 0,
    });
    snapshots.push({ k: msg.k, b: msg.b, z: msg.z });
    if (snapshots.length > MAX_SNAPSHOTS) snapshots.shift();
    return msg;
  };

  // ---- Playing alone -----------------------------------------------------------------------

  /** A slingshot's shape as on a panel, for throws the screen makes by itself. */
  const venue = activeVenue();
  const usual = screenSize(venue.bankCount * 1080, venue.screen.width, venue.screen.height);
  const panelPad: PadSpot = stationLayout("panel", 1080, 1920, 0, screenSky(usual.W, usual.H), 0)
    .pads[0]!;
  const playAlone = (now: number) => {
    if (phantom) {
      const shot = phantom.chooser.work() ?? phantom.chooser.work();
      if (!shot) return;
      const { column, pick } = phantom;
      phantom = null;
      const l = phantomLaunch(column, shot, pick);
      if (l) {
        const c = createClimber({ ...l, k: cosmos.clockK }, sky1Snap(), stripOf(column));
        climbers.push(c);
        if (climbers.length > MAX_CLIMBERS) climbers.shift();
      }
      phantomAt = now + 2600 + rand() * 2200;
      return;
    }
    if (now < phantomAt) return;
    const column = rng.int(count);
    const r = rand();
    const pick: Pick = r < 0.4 ? "planet" : r < 0.7 ? "rock" : r < 0.92 ? "giant" : "star";
    phantom = {
      column,
      pick,
      chooser: createChooser({
        spread: panelPad.spread,
        rng: rng.fork(`alone:${cosmos.u.k}`),
        tries: 6,
        refine: 3,
        error: { angle: 0.02, pull: 0.04 },
        score: (shot) => {
          const l = phantomLaunch(column, shot, pick);
          if (!l) return null;
          // Judged as if it had already crossed: close enough to choose a throw.
          return scoreLaunch(cosmos.u, { ...l, y: -1 }, 420, sky.view);
        },
      }),
    };
  };

  const sky1Snap = (): Snapshot =>
    snapshots[snapshots.length - 1] ?? { k: 0, b: [], z: sizesOn ? 1 : 0 };

  const phantomLaunch = (column: number, shot: Shot, pick: Pick): ClimbStart | null => {
    const x = column * fw + fw / 2;
    const v = shotVelocity({ ...panelPad, ...padSpeeds(sky, x, panelPad.y) }, shot);
    if (!v) return null;
    return {
      kind: pick,
      x,
      y: panelPad.y,
      vx: v.vx * cosmos.speed,
      vy: v.vy * cosmos.speed,
      k: 0,
      owner: "",
      pad: -1,
      color: column % 8,
      human: false,
    };
  };

  // ---- Drawing -----------------------------------------------------------------------------

  const transform = (): Transform => {
    const s = (frame.unit * layers.ratio * vw) / W;
    return { s, ox: 0, oy: H * s };
  };

  /** A body just over the bezel grows from its strip size to its own over GROW_MS. */
  const grown = (b: Body, target: number, now: number) => {
    const g = grow.get(b.id);
    if (!g) return target;
    const t = (now - g.at) / GROW_MS;
    if (t >= 1) {
      grow.delete(b.id);
      return target;
    }
    return g.from + (target - g.from) * t * t * (3 - 2 * t);
  };

  const ribbonDot = (_x: number, y: number) => {
    const t = Math.min(1, Math.max(0, -y / (H * 0.12)));
    return 7 + (sky.L * 0.012 - 7) * t;
  };

  const render = () => {
    const now = ui();
    const c = clock();
    cosmos.advance(c, now, (k) => {
      for (let i = climbers.length - 1; i >= 0; i--) {
        const cl = climbers[i]!;
        if (cl.k >= k) continue;
        stepClimber(cl);
        if (cl.lost) climbers.splice(i, 1);
        else if (cl.crossed >= 0) {
          climbers.splice(i, 1);
          enter(cl, false);
        }
      }
    });
    layers.clear();
    const tr = transform();
    const sc: Scene = {
      g: layers.g,
      tr,
      sprites,
      now,
      alpha: cosmos.alpha(c),
      dustAlpha: cosmos.dustAlpha(c),
    };
    const g = layers.g;
    const band = H * 0.05 * tr.s;
    const grad = g.createLinearGradient(0, layers.height - band, 0, layers.height);
    grad.addColorStop(0, "rgba(150,140,255,0)");
    grad.addColorStop(1, "rgba(150,140,255,0.16)");
    g.fillStyle = grad;
    g.fillRect(0, layers.height - band, layers.width, band);
    drawCosmos(sc, cosmos, {
      radius: (b) => grown(b, cosmos.drawnRadius(b, now), now),
      light: (b) => grown(b, b.re, now),
      mark: cosmos.sizeBlend(now),
      markR: screenScale(W).dot * 5.5,
    });
    for (const cl of climbers) drawClimber(sc, cl);
    drawArrows(sc, cosmos.u.bodies, sky.view, W * 0.006);
    // Ribbons from the frames' aims: the stalest first, within a time budget.
    const start = performance.now();
    const due = [...aims.values()]
      .filter((a) => now - a.at <= AIM_STALE_MS && now - a.predAt >= AIM_PREDICT_MS)
      .sort((a, b) => a.predAt - b.predAt);
    let first = true;
    for (const a of due) {
      if (!first && performance.now() - start > RIBBON_BUDGET_MS) break;
      first = false;
      a.predAt = now;
      const pos = Math.floor(a.start.x / fw);
      predictClimb(
        cosmos,
        a.start,
        a.snap,
        stripOf(pos),
        cfg.ribbonSteps,
        3,
        a.pred,
        cosmos.holeMass(),
      );
    }
    for (const [key, a] of aims) {
      if (now - a.at > AIM_STALE_MS) {
        aims.delete(key);
        continue;
      }
      if (a.pred.n < 2) continue;
      drawRibbon(sc, a.pred, {
        rgb: rgbOf(a.start.color),
        dot: 7,
        dotAt: ribbonDot,
        clip: { y: 0, keep: "above" },
        fadeOver: Math.ceil((cfg.ribbonSteps + 360) / 3) + 1,
      });
    }
    const fade = 1 - (now - cosmos.sceneShownAt) / 900;
    if (fade > 0) {
      g.fillStyle = `rgba(2,3,9,${Math.min(1, fade)})`;
      g.fillRect(0, 0, layers.width, layers.height);
    }
  };

  const tendScenes = (now: number) => {
    if (cosmos.burnt()) {
      if (burntSince === Infinity) burntSince = now;
    } else {
      burntSince = Infinity;
    }
    const age = clock() - cosmos.sceneAt;
    if (now - burntSince > BURNT_MS || (now - lastHuman > QUIET_MS && age > ATTRACT_SCENE_MS)) {
      nextScene();
    }
  };

  const loop = ctx.loop({
    hz: 30,
    update() {
      const now = ui();
      const stations = downlink?.stations() ?? [];
      if (stations.length > 0) {
        lastStation = now;
        const w = touchFrameWidth(stations);
        if (w !== fw) {
          fw = w;
          aims.clear();
          build();
        }
      }
      if (now - lastStation > ALONE_MS) playAlone(now);
      downlink?.tick(sky1);
      tendScenes(now);
    },
    render,
  });
  loop.start();

  const offResize = ctx.onResize((f) => {
    frame = f;
    layers.resize(f);
    sprites.clear();
  });

  const debugKey = "__gravity";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          role: "screen",
          W,
          H,
          fw,
          count,
          step: cosmos.u.k,
          clockK: cosmos.clockK,
          clock: clock(),
          stations: downlink?.stations().length ?? 0,
          alone: ui() - lastStation > ALONE_MS,
          scene: cosmos.sceneId,
          time: FACTORS[cosmos.timeIndex],
          sizes: sizesOn,
          bodies: cosmos.u.bodies.map((b) => ({
            id: b.id,
            kind: b.kind,
            x: b.x,
            y: b.y,
            m: b.m,
            owner: b.owner,
            pad: b.pad,
          })),
          dust: cosmos.dust.live,
          climbers: climbers.length,
          crossings: [...crossings],
          aims: [...aims].map(([key, a]) => ({ key, n: a.pred.n, stop: a.pred.stop })),
          arrived,
          received: downlink?.received ?? 0,
          snapshots: snapshots.length,
        }),
        scene: (i: number) => cosmos.setScene(i, clock(), ui()),
      },
    });
  }

  return {
    reset() {
      aims.clear();
      phantom = null;
      climbers.length = 0;
      cosmos.setTime(NORMAL_TIME);
      setSizes(cfg.trueSizes);
      nextScene();
    },
    attract() {},
    status() {
      return {
        mode: "screen",
        scene: cosmos.sceneId,
        bodies: cosmos.u.bodies.length,
        dust: cosmos.dust.live,
        time: FACTORS[cosmos.timeIndex] ?? 1,
        sizes: sizesOn ? "true" : "drawn",
        arrived,
        frames: downlink?.stations().length ?? 0,
      };
    },
    command(name, args) {
      if (name === "scene") {
        const want =
          typeof args === "string" ? SCENES.indexOf(args as (typeof SCENES)[number]) : -1;
        if (want >= 0) {
          sceneIndex = want;
          cosmos.setScene(want, clock(), ui());
        } else nextScene();
      } else if (name === "clear") {
        cosmos.setScene(cosmos.sceneIndex, clock(), ui());
      } else if (name === "sizes") {
        setSizes(typeof args === "boolean" ? args : !sizesOn);
      }
    },
    dispose() {
      loop.stop();
      offResize();
      downlink?.dispose();
      aims.clear();
      cosmos.clearEffects();
      sprites.clear();
      layers.dispose();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
