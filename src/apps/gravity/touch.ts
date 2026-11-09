/**
 * A touch frame: slingshots with their body pickers low, the black-hole launcher, the time
 * control and the scene button above them, and the universe.
 *
 * - Solo (panel, pair, wall, kiosk): its own universe fills the frame.
 * - In a bank with its screen: the frame's space is the strip under the screen. A thrown body
 *   climbs it in a snapshot of the screen's heaviest bodies (from its `sky`), bounces off the
 *   strip's sides and leaves through the top; at release the frame tells the screen the body's
 *   place, velocity, step and snapshot, and the screen climbs it the same way, so it comes over
 *   the bezel without a jump. The time control and scene button ask the screen.
 * - A bank frame that hasn't heard its screen for 3 s plays solo until the screen is back.
 */
import { createRng } from "../../core/rng";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { activeVenue } from "../../core/venue";
import { launchFromPull, type Shot, shotVelocity } from "./aim";
import type { Pick } from "./bodies";
import { createBots } from "./bots";
import { createLayers } from "./canvas";
import { type Chooser, createChooser } from "./chooser";
import { readConfig } from "./config";
import {
  type Controls,
  createControls,
  drawClimber,
  drawHand,
  drawLauncher,
  drawPad,
  drawPicker,
  drawSceneButton,
  drawSizesButton,
  drawTime,
} from "./controls";
import { type Cosmos, createCosmos, FACTORS, NORMAL_TIME } from "./cosmos";
import { drawArrows, drawCosmos, drawRibbon, type Scene, type Transform } from "./draw";
import { createGhost } from "./ghost";
import {
  type Layout,
  layoutFor,
  screenSize,
  screenSky,
  stationLayout,
  type TouchKind,
} from "./layout";
import { AIM_MS, createUplink, SKY_GRACE_MS, type Uplink } from "./link";
import { createPads, type Pads } from "./pads";
import { type Launch, STEP_MS } from "./physics";
import { createPrediction, predict, type Prediction, scoreLaunch } from "./predict";
import { SCENES } from "./scenes";
import { createSprites, rgbOf } from "./sprites";
import {
  type ClimbStart,
  type Climber,
  climberDone,
  createClimber,
  predictStrip,
  type Snapshot,
  stepClimber,
} from "./strip";
import { pickIndex, q16, type SkyMsg, snapshotOf } from "./wire";

/** The ghost starts this long after the last person's touch. */
const GHOST_AFTER_MS = 8000;
/** A bank frame back from solo waits this long hearing its screen before rejoining it. */
const REJOIN_MS = 500;
const MAX_CROSSINGS = 24;
const MAX_CLIMBERS = 24;
const MAX_WATCHED = 64;
/** Unattended, the scene moves on after this long, or sooner once it has burnt out. */
export const ATTRACT_SCENE_MS = 150_000;
export const QUIET_MS = 30_000;
const BURNT_MS = 20_000;
/** Ribbons are worked out within this much time a frame (ms), the stalest first. */
const RIBBON_BUDGET_MS = 6;
const EMPTY: Snapshot = { k: 0, b: [], z: 0 };

export const mountTouch = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.options);
  const kind = ctx.frame.kind as TouchKind;
  const inBank = ctx.setup.name === "bank" && (kind === "panel" || kind === "pair");
  const pos = inBank ? ctx.setup.pos : 0;
  const count = Math.max(1, ctx.setup.count);
  const vw = ctx.frame.venueWidth;
  const vh = ctx.frame.venueHeight;
  const offX = pos * vw;
  const padsPerFrame = kind === "wall" ? cfg.pads : kind === "panel" ? 1 : 2;
  const colorBase = inBank ? pos * padsPerFrame : 0;
  const self = ctx.net.self;
  const ui = () => performance.now();
  const clock = () => ctx.clock.now();
  const kNow = () => Math.floor(clock() / STEP_MS);
  const base = ctx.rng().fork(inBank ? `gravity:${pos}` : "gravity");
  const rand = createRng(`${ctx.seed}:${inBank ? pos : "solo"}:fx`).next;

  let frame: FrameInfo = ctx.frame;
  const layers = createLayers(ctx.root, frame, base.int(2 ** 31));
  const sprites = createSprites();

  let mode: "solo" | "strip" = inBank ? "strip" : "solo";
  let layout: Layout;
  let cosmos: Cosmos | null = null;
  let pads!: Pads;
  let controls!: Controls;
  let sky: SkyMsg | null = null;
  let snap: Snapshot = EMPTY;
  let skyKey = "";
  let modeAt = ui();
  let heardSince = Infinity;
  let lag = 0;
  let lastHuman = -Infinity;
  let burntSince = Infinity;
  let launches = 0;
  let sceneIndex = cfg.scene;
  const lagTimers = new Set<number>();
  const climbers: Climber[] = [];
  const crossings: { id: number; k: number; x: number; y: number }[] = [];
  const ribbons = new Map<number, Prediction>();
  const ribbonAt = new Map<number, number>();
  const aimAt = new Map<number, number>();
  const watched = new Map<number, { pad: number; swept: number; last: number }>();

  const later = (fn: () => void) => {
    if (lag <= 0) return fn();
    const id = window.setTimeout(() => {
      lagTimers.delete(id);
      fn();
    }, lag);
    lagTimers.add(id);
  };

  const uplink: Uplink | null = inBank ? createUplink(ctx.net, ctx.setup.side, ui) : null;
  const strip = { x0: offX, x1: offX + vw };

  const human = () => {
    lastHuman = ui();
    ctx.idle.poke();
  };

  const buildControls = () => {
    pads?.release();
    pads = createPads(
      layout.pads,
      cfg.blackhole ? layout.launchers : [],
      {
        launch: (l) => onLaunch(l.pad.spot.index, l.vx, l.vy, l.human),
        hole: (l, h) => onHole(l.spot.index, h),
      },
      ui(),
    );
    const picks = controls ? [...controls.picks] : [];
    controls = createControls(layout, {
      pick: (_pad, _pick, h) => {
        if (h) human();
      },
      time: (d, h) => {
        if (h) human();
        if (mode === "solo" && cosmos) cosmos.setTime(cosmos.timeIndex + d);
        else later(() => uplink?.ctl({ t: d, sc: 0, z: 0, h: h ? 1 : 0 }));
      },
      sizes: (h) => {
        if (h) human();
        if (mode === "solo" && cosmos) cosmos.setSizes(!cosmos.trueSizes, ui());
        else later(() => uplink?.ctl({ t: 0, sc: 0, z: 1, h: h ? 1 : 0 }));
      },
      scene: (h) => {
        if (h) human();
        if (mode === "solo" && cosmos) nextScene();
        else later(() => uplink?.ctl({ t: 0, sc: 1, z: 0, h: h ? 1 : 0 }));
      },
    });
    picks.forEach((p, i) => controls.setPick(i, p));
    ribbons.clear();
    ribbonAt.clear();
  };

  const nextScene = () => {
    if (!cosmos) return;
    sceneIndex = (cosmos.sceneIndex + 1) % SCENES.length;
    cosmos.setScene(sceneIndex, clock(), ui());
    burntSince = Infinity;
    watched.clear();
  };

  const enterSolo = () => {
    mode = "solo";
    modeAt = ui();
    layout = layoutFor(kind, vw, vh, { pads: cfg.pads, colorBase });
    cosmos = createCosmos({
      sky: layout.sky,
      maxBodies: layout.maxBodies,
      dustCap: layout.dustCap,
      seed: base.fork(`cosmos:${modeAt}`).int(2 ** 31),
      scene: sceneIndex,
      clockMs: clock(),
      dot: layout.dot,
      // Back from a screen, keep its sizes; otherwise the operator's choice.
      trueSizes: sky ? sky.z === 1 : cfg.trueSizes,
    });
    climbers.length = 0;
    buildControls();
  };

  const bankSky = () => {
    const W = sky?.w ?? count * vw;
    const screen = activeVenue().screen;
    const H = sky?.h ?? screenSize(W, screen.width, screen.height).H;
    return screenSky(W, H);
  };

  const enterStrip = () => {
    mode = "strip";
    modeAt = ui();
    cosmos = null;
    watched.clear();
    layout = stationLayout(kind as "panel" | "pair", vw, vh, colorBase, bankSky(), offX);
    skyKey = sky ? `${sky.w}:${sky.h}` : "";
    buildControls();
  };

  const speedScale = () => (mode === "solo" ? (cosmos?.speed ?? 1) : (sky?.vs ?? 100) / 100);

  function onLaunch(padIndex: number, vx: number, vy: number, isHuman: boolean) {
    const s = layout.pads[padIndex]!;
    const pick = controls.picks[padIndex] ?? "planet";
    const k = speedScale();
    launches++;
    if (isHuman) human();
    if (mode === "solo" && cosmos) {
      const b = cosmos.launch({
        kind: pick,
        x: s.x,
        y: s.y,
        vx: vx * k,
        vy: vy * k,
        owner: self,
        pad: padIndex,
        color: s.color,
        human: isHuman,
      });
      watch(b.id, padIndex, b.x, b.y);
    } else {
      const start: ClimbStart = {
        kind: pick,
        x: q16(s.x + offX),
        y: q16(s.y),
        vx: q16(vx * k),
        vy: q16(vy * k),
        k: kNow(),
        owner: self,
        pad: padIndex,
        color: s.color,
        human: isHuman,
      };
      addClimber(start);
      const msg = {
        k: 0,
        p: padIndex,
        c: s.color,
        b: pickIndex(pick),
        x: start.x,
        y: start.y,
        vx: start.vx,
        vy: start.vy,
        s: start.k,
        sn: snap.k,
        h: isHuman ? 1 : 0,
      };
      later(() => uplink?.go(msg));
      const off = { p: padIndex, c: s.color, b: 0, x: 0, y: 0, vx: 0, vy: 0, sn: 0, off: 1 };
      later(() => uplink?.aim(off));
    }
    ribbons.delete(padIndex);
    ribbonAt.delete(padIndex);
  }

  function onHole(index: number, isHuman: boolean): boolean {
    if (!cfg.blackhole) return false;
    const s = layout.launchers[index]!;
    const k = speedScale();
    if (isHuman) human();
    if (mode === "solo" && cosmos) {
      cosmos.launch({
        kind: "hole",
        x: s.x,
        y: s.y,
        vx: s.vx * k,
        vy: s.vy * k,
        owner: self,
        pad: -1,
        color: -1,
        human: isHuman,
        m: cosmos.holeMass(),
      });
      return true;
    }
    const start: ClimbStart = {
      kind: "hole",
      x: q16(s.x + offX),
      y: q16(s.y),
      vx: q16(s.vx * k),
      vy: q16(s.vy * k),
      k: kNow(),
      owner: self,
      pad: index,
      color: -1,
      human: isHuman,
    };
    addClimber(start);
    const msg = {
      k: 1,
      p: index,
      c: 0,
      b: 0,
      x: start.x,
      y: start.y,
      vx: start.vx,
      vy: start.vy,
      s: start.k,
      sn: snap.k,
      h: isHuman ? 1 : 0,
    };
    later(() => uplink?.go(msg));
    return true;
  }

  const addClimber = (s: ClimbStart) => {
    if (climbers.length >= MAX_CLIMBERS) climbers.shift();
    climbers.push(createClimber(s, snap, strip));
  };

  if (mode === "solo") enterSolo();
  else enterStrip();

  // ---- Bodies going round, for a glow on their pad ----------------------------------------

  const watch = (id: number, pad: number, x: number, y: number) => {
    if (watched.size >= MAX_WATCHED) {
      const first = watched.keys().next().value;
      if (first !== undefined) watched.delete(first);
    }
    const c = cosmos?.u.cm;
    watched.set(id, { pad, swept: 0, last: c ? Math.atan2(y - c.y, x - c.x) : 0 });
  };

  const watchOrbits = (now: number) => {
    if (!cosmos || watched.size === 0) return;
    const u = cosmos.u;
    for (const [id, w] of watched) {
      const b = u.bodies.find((q) => q.id === id);
      if (!b) {
        watched.delete(id);
        continue;
      }
      // Round the body pulling it hardest.
      let best = 0;
      let cx = u.cm.x;
      let cy = u.cm.y;
      for (const q of u.bodies) {
        if (q === b || q.gm < b.gm) continue;
        const d2 = (q.x - b.x) ** 2 + (q.y - b.y) ** 2;
        const f = q.gm / Math.max(1, d2);
        if (f > best) {
          best = f;
          cx = q.x;
          cy = q.y;
        }
      }
      const a = Math.atan2(b.y - cy, b.x - cx);
      let d = a - w.last;
      d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
      w.swept += d;
      w.last = a;
      if (Math.abs(w.swept) >= Math.PI * 2) {
        w.swept = 0;
        const p = pads.pads[w.pad];
        if (p) p.glowAt = now;
      }
    }
  };

  // ---- Shots for bots and the ghost --------------------------------------------------------

  const launchOf = (i: number, shot: Shot, pick: Pick): Launch | null => {
    const s = layout.pads[i]!;
    const v = shotVelocity(s, shot);
    if (!v) return null;
    const k = speedScale();
    return {
      kind: pick,
      x: s.x,
      y: s.y,
      vx: v.vx * k,
      vy: v.vy * k,
      owner: self,
      pad: i,
      color: s.color,
      human: false,
    };
  };

  const plan = (i: number, error: { angle: number; pull: number }): Chooser => {
    const spot = layout.pads[i]!;
    return createChooser({
      spread: spot.spread,
      rng: base.fork(`plan:${launches}:${i}`),
      error,
      score: (shot) => {
        const pick = controls.picks[i] ?? "planet";
        if (mode === "solo" && cosmos) {
          const l = launchOf(i, shot, pick);
          return l ? scoreLaunch(cosmos.u, l, 420, layout.sky.view) : null;
        }
        return scoreStrip(i, shot, pick);
      },
    });
  };

  /** Under a screen: how long a throw would stay in the screen's view, in the snapshot's pull. */
  const scoreStrip = (i: number, shot: Shot, pick: Pick): number | null => {
    const s = layout.pads[i]!;
    const v = shotVelocity(s, shot);
    if (!v) return null;
    const k = speedScale();
    const c = createClimber(
      {
        kind: pick,
        x: s.x + offX,
        y: s.y,
        vx: v.vx * k,
        vy: v.vy * k,
        k: 0,
        owner: "",
        pad: i,
        color: 0,
        human: false,
      },
      snap,
      strip,
    );
    const view = bankSky().view;
    let seen = 0;
    for (let n = 0; n < 420; n++) {
      stepClimber(c);
      if (c.lost) return -420;
      for (const [bx, by, , r] of snap.b) {
        if (Math.hypot(bx - c.x, by - c.y) < r) return seen - 300;
      }
      if (c.x > view.x0 && c.x < view.x1 && c.y > view.y0 && c.y < view.y1) seen++;
    }
    let e = 0.5 * (c.vx * c.vx + c.vy * c.vy);
    for (const [bx, by, gm] of snap.b) e -= gm / Math.max(1, Math.hypot(bx - c.x, by - c.y));
    return seen + (e < 0 ? 200 : -100);
  };

  const prepare = (): Pick => {
    // Mostly planets and rocks, now and then a gas giant or a star: unattended, a scene should
    // last rather than be smashed.
    const r = rand();
    return r < 0.46 ? "planet" : r < 0.9 ? "rock" : r < 0.97 ? "giant" : "star";
  };

  const pace = () => {
    if (mode === "strip") return (4000 + count * 900) * (0.7 + rand() * 0.6);
    return kind === "wall" ? 1800 + rand() * 2200 : 3500 + rand() * 2500;
  };

  const ghost = createGhost({
    pads: () => pads,
    plan: (i) => plan(i, { angle: 0.01, pull: 0.02 }),
    prepare: (i) => controls.setPick(i, prepare()),
    allowed: (now) => ctx.bots === 0 && now - Math.max(pads.lastHuman, lastHuman) > GHOST_AFTER_MS,
    gap: pace,
    rand,
  });
  const bots = createBots({
    input: ctx.input,
    count: ctx.bots,
    pads: () => pads,
    unit: () => frame.unit,
    plan: (i) => plan(i, { angle: 0.03, pull: 0.05 }),
    gap: () => (mode === "strip" ? 2500 + rand() * 3000 : 1600 + rand() * 2400),
    rand,
    prepare: (i) => {
      if (rand() > 0.35) return null;
      const want = prepare();
      const b = layout.pickers[i]?.find((x) => x.pick === want);
      return b ? { x: b.x, y: b.y } : null;
    },
    chore: () => {
      // Drift the time a step away from normal and back.
      const t = mode === "solo" ? (cosmos?.timeIndex ?? NORMAL_TIME) : (sky?.f ?? NORMAL_TIME);
      const up = t < NORMAL_TIME ? true : t > NORMAL_TIME ? false : rand() < 0.5;
      if (rand() > 0.5) return null;
      const b = up ? layout.faster : layout.slower;
      return { x: b.x, y: b.y };
    },
  });

  // ---- Input --------------------------------------------------------------------------------

  const venue = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venue(p);
      const t = ui();
      if (controls.down(p.id, v.x, v.y, p.synthetic, t)) return;
      if (pads.down(p.id, v.x, v.y, p.synthetic, t) && !p.synthetic) lastHuman = t;
    }),
    ctx.input.on("move", (p) => {
      const v = venue(p);
      pads.move(p.id, v.x, v.y);
    }),
    ctx.input.on("up", (p) => {
      const v = venue(p);
      controls.up(p.id);
      pads.up(p.id, v.x, v.y, ui());
    }),
    ctx.input.on("cancel", (p) => {
      controls.cancel(p.id);
      pads.cancel(p.id);
    }),
  ];

  // ---- Bank: following the screen ----------------------------------------------------------

  const watchScreen = () => {
    if (!uplink) return;
    const t = ui();
    const screen = uplink.screen();
    const s = uplink.sky();
    if (s) {
      sky = s;
      if (s.k !== snap.k) snap = snapshotOf(s);
    }
    if (mode === "strip") {
      if (screen === null && t - modeAt > SKY_GRACE_MS) {
        sceneIndex = sky?.sc ?? sceneIndex;
        enterSolo();
        return;
      }
      if (s && `${s.w}:${s.h}` !== skyKey) enterStrip();
    } else if (screen !== null) {
      if (heardSince === Infinity) heardSince = t;
      if (t - heardSince >= REJOIN_MS) {
        heardSince = Infinity;
        enterStrip();
      }
    } else {
      heardSince = Infinity;
    }
  };

  // ---- Scenes when nobody is about --------------------------------------------------------

  const tendScenes = (now: number) => {
    if (mode !== "solo" || !cosmos) return;
    if (cosmos.burnt()) {
      if (burntSince === Infinity) burntSince = now;
    } else {
      burntSince = Infinity;
    }
    const age = clock() - cosmos.sceneAt;
    const quiet = now - lastHuman > QUIET_MS;
    if (now - burntSince > BURNT_MS || (quiet && age > ATTRACT_SCENE_MS)) nextScene();
  };

  // ---- Ribbons -------------------------------------------------------------------------------

  const updateRibbons = () => {
    const t = ui();
    const start = performance.now();
    const due = [...ribbonAt.entries()].sort((a, b) => a[1] - b[1]).map(([i]) => i);
    for (let i = 0; i < pads.pads.length; i++) {
      const p = pads.pads[i]!;
      const l = p.holder !== null ? launchFromPull(p.spot, p.dx, p.dy) : null;
      if (!l) {
        if (ribbons.has(i) && mode === "strip") {
          const s = p.spot;
          const off = { p: i, c: s.color, b: 0, x: 0, y: 0, vx: 0, vy: 0, sn: 0, off: 1 };
          later(() => uplink?.aim(off));
        }
        ribbons.delete(i);
        ribbonAt.delete(i);
        continue;
      }
      if (!ribbons.has(i)) {
        ribbons.set(i, createPrediction(cfg.ribbonSteps, 3));
        ribbonAt.set(i, -Infinity);
        due.unshift(i);
      }
    }
    // Each ribbon is a run of the whole universe ahead: the stalest first, within a time budget.
    let first = true;
    for (const i of due) {
      if (!ribbons.has(i)) continue;
      if (!first && performance.now() - start > RIBBON_BUDGET_MS) break;
      first = false;
      const p = pads.pads[i]!;
      const l = launchFromPull(p.spot, p.dx, p.dy);
      if (!l) continue;
      const pick = controls.picks[i] ?? "planet";
      const k = speedScale();
      const pred = ribbons.get(i)!;
      if (mode === "solo" && cosmos) {
        predict(
          cosmos.u,
          {
            kind: pick,
            x: p.spot.x,
            y: p.spot.y,
            vx: l.vx * k,
            vy: l.vy * k,
            owner: self,
            pad: i,
            color: p.spot.color,
            human: false,
          },
          { steps: cfg.ribbonSteps, every: 3 },
          pred,
        );
      } else {
        const s = {
          kind: pick,
          x: q16(p.spot.x + offX),
          y: q16(p.spot.y),
          vx: q16(l.vx * k),
          vy: q16(l.vy * k),
          k: 0,
          owner: self,
          pad: i,
          color: p.spot.color,
          human: false,
        };
        predictStrip(s, snap, strip, 360, 3, pred);
        pred.stop = "end";
        if (t - (aimAt.get(i) ?? -Infinity) >= AIM_MS) {
          aimAt.set(i, t);
          const m = {
            p: i,
            c: p.spot.color,
            b: pickIndex(pick),
            x: s.x,
            y: s.y,
            vx: s.vx,
            vy: s.vy,
            sn: snap.k,
            off: 0,
          };
          later(() => uplink?.aim(m));
        }
      }
      ribbonAt.set(i, t);
    }
  };

  // ---- Drawing -----------------------------------------------------------------------------

  const transforms = (): { venue: Transform; world: Transform } => {
    const s = frame.unit * layers.ratio;
    return {
      venue: { s, ox: 0, oy: 0 },
      world: mode === "strip" ? { s, ox: -offX * s, oy: 0 } : { s, ox: 0, oy: 0 },
    };
  };

  const drawStripTop = (g: CanvasRenderingContext2D, tr: Transform) => {
    // The universe carries on above: a soft glow along the top edge.
    const h = vh * 0.3 * tr.s;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "rgba(150,140,255,0.2)");
    grad.addColorStop(1, "rgba(150,140,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, layers.width, h);
  };

  const render = () => {
    const now = ui();
    const c = clock();
    const K = Math.floor(c / STEP_MS);
    if (cosmos) cosmos.advance(c, now);
    for (const cl of climbers) {
      if (K - cl.k > 120) cl.k = K - 120;
      while (cl.k < K) {
        const was = cl.crossed;
        stepClimber(cl);
        if (was < 0 && cl.crossed >= 0 && cl.owner === self) {
          crossings.push({ id: cl.id, k: cl.crossed, x: cl.ex, y: cl.ey });
          if (crossings.length > MAX_CROSSINGS) crossings.shift();
        }
      }
    }
    for (let i = climbers.length - 1; i >= 0; i--)
      if (climberDone(climbers[i]!)) climbers.splice(i, 1);
    watchOrbits(now);
    updateRibbons();
    layers.clear();
    const { venue: vt, world: wt } = transforms();
    const a = cosmos ? cosmos.alpha(c) : Math.max(0, Math.min(1, c / STEP_MS - K));
    const sc: Scene = {
      g: layers.g,
      tr: wt,
      sprites,
      now,
      alpha: a,
      dustAlpha: cosmos ? cosmos.dustAlpha(c) : a,
    };
    if (cosmos) {
      const cz = cosmos;
      drawCosmos(sc, cz, {
        radius: (b) => cz.drawnRadius(b, now),
        mark: cz.sizeBlend(now),
        markR: layout.dot * 5.5,
      });
      drawArrows(sc, cosmos.u.bodies, layout.sky.view, 26);
      const fade = 1 - (now - cosmos.sceneShownAt) / 900;
      if (fade > 0) {
        layers.g.fillStyle = `rgba(2,3,9,${Math.min(1, fade)})`;
        layers.g.fillRect(0, 0, layers.width, layers.height);
      }
    } else {
      drawStripTop(layers.g, vt);
    }
    for (const cl of climbers) drawClimber(sc, cl);
    for (const [i, pred] of ribbons) {
      const s = layout.pads[i];
      if (!s) continue;
      drawRibbon(sc, pred, {
        rgb: rgbOf(s.color),
        dot: mode === "strip" ? 7 : Math.max(5, layout.sky.L * 0.012),
        clip: mode === "strip" ? { y: 0, keep: "below" } : undefined,
        fadeOver: mode === "strip" ? Math.ceil(cfg.ribbonSteps / 3) + 1 : undefined,
      });
    }
    const vs: Scene = { ...sc, tr: vt };
    for (let i = 0; i < pads.pads.length; i++) {
      drawPicker(vs, layout.pickers[i]!, controls.picks[i] ?? "planet", layout.pads[i]!.color);
      drawPad(vs, pads.pads[i]!, controls.picks[i] ?? "planet", now);
    }
    for (const l of pads.launchers) drawLauncher(vs, l, pads.charge(l, now), now);
    const timeIndex =
      mode === "solo" ? (cosmos?.timeIndex ?? NORMAL_TIME) : (sky?.f ?? NORMAL_TIME);
    drawTime(vs, layout, timeIndex, controls.pressed, now);
    const sizes = mode === "solo" ? (cosmos?.sizeBlend(now) ?? 0) : (sky?.z ?? 0);
    drawSizesButton(vs, layout.sizes, sizes, controls.pressed.sizes, now);
    const current = mode === "solo" ? (cosmos?.sceneIndex ?? 0) : (sky?.sc ?? 0);
    drawSceneButton(
      vs,
      layout.scene,
      SCENES[(current + 1) % SCENES.length]!,
      controls.hold(now),
      now,
      controls.pressed.scene,
    );
    const hand = ghost.hand();
    if (hand) drawHand(vs, hand.x, hand.y, layout.pads[0]!.grab * 0.7, hand.alpha * 0.85);
  };

  const loop = ctx.loop({
    hz: 30,
    update() {
      const now = ui();
      watchScreen();
      controls.update(now);
      ghost.update(now);
      bots.update(now);
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
          role: "touch",
          mode,
          kind,
          unit: frame.unit,
          venue: { w: vw, h: vh },
          pos,
          offX,
          step: cosmos ? cosmos.u.k : kNow(),
          clock: clock(),
          screen: uplink?.screen() ?? null,
          sky: sky ? { scene: sky.sc, time: sky.f, snap: sky.k, bodies: sky.b.length } : null,
          scene: mode === "solo" ? (cosmos?.sceneId ?? null) : SCENES[sky?.sc ?? 0],
          time: FACTORS[mode === "solo" ? (cosmos?.timeIndex ?? 2) : (sky?.f ?? 2)],
          sizes: mode === "solo" ? (cosmos?.trueSizes ?? false) : sky?.z === 1,
          sizesButton: layout.sizes,
          pads: pads.pads.map((p, i) => ({
            x: p.spot.x,
            y: p.spot.y,
            grab: p.spot.grab,
            pull: p.spot.pull,
            minPull: p.spot.minPull,
            holder: p.holder,
            ready: ui() >= p.readyAt,
            pick: controls.picks[i],
          })),
          pickers: layout.pickers.map((g) =>
            g.map((b) => ({ pick: b.pick, x: b.x, y: b.y, r: b.r })),
          ),
          slower: layout.slower,
          faster: layout.faster,
          sceneButton: layout.scene,
          launchers: pads.launchers.map((l) => ({
            x: l.spot.x,
            y: l.spot.y,
            r: l.spot.r,
            charge: pads.charge(l, ui()),
          })),
          ribbons: [...ribbons].map(([pad, r]) => ({
            pad,
            n: r.n,
            stop: r.stop,
            steps: r.steps,
            pts: Array.from(r.pts.subarray(0, Math.min(r.n, 400) * 2)),
          })),
          bodies: cosmos
            ? cosmos.u.bodies.map((b) => ({
                id: b.id,
                kind: b.kind,
                x: b.x,
                y: b.y,
                vx: b.vx,
                vy: b.vy,
                m: b.m,
                r: b.r,
                re: b.re,
                rt: b.rt,
                owner: b.owner,
                pad: b.pad,
              }))
            : [],
          dust: cosmos?.dust.live ?? 0,
          climbers: climbers.map((cl) => ({
            id: cl.id,
            kind: cl.kind,
            x: cl.x,
            y: cl.y,
            crossed: cl.crossed,
          })),
          crossings: [...crossings],
          launches,
          ghostShots: ghost.shots,
          botShots: bots.shots,
          lag,
        }),
        setLag: (ms: number) => {
          lag = Math.max(0, Math.min(2000, ms));
        },
        /** Throw a body straight into the universe, for tests and reviews. */
        throw: (l: {
          kind: Pick | "hole";
          x: number;
          y: number;
          vx: number;
          vy: number;
          m?: number;
        }) => cosmos?.launch({ ...l, owner: self, pad: -1, color: -1, human: false })?.id ?? -1,
      },
    });
  }

  const status = () => {
    const now = ui();
    const charge = pads.launchers.length
      ? Math.min(...pads.launchers.map((l) => pads.charge(l, now)))
      : 0;
    return {
      mode,
      scene: mode === "solo" ? (cosmos?.sceneId ?? "") : (SCENES[sky?.sc ?? 0] ?? ""),
      bodies: cosmos ? cosmos.u.bodies.length : climbers.length,
      dust: cosmos?.dust.live ?? 0,
      time: FACTORS[mode === "solo" ? (cosmos?.timeIndex ?? 2) : (sky?.f ?? 2)] ?? 1,
      sizes: (mode === "solo" ? cosmos?.trueSizes : sky?.z === 1) ? "true" : "drawn",
      launches,
      hole: Math.round(charge * 100),
    };
  };

  return {
    reset() {
      const now = ui();
      bots.release();
      ghost.stop();
      pads.reset(now);
      controls.reset();
      ribbons.clear();
      ribbonAt.clear();
      climbers.length = 0;
      if (cosmos) {
        cosmos.setTime(NORMAL_TIME);
        cosmos.setSizes(cfg.trueSizes, now);
        nextScene();
      }
    },
    attract() {},
    status,
    homeSpot() {
      return { x: layout.home.x * frame.unit, y: layout.home.y * frame.unit };
    },
    command(name, args) {
      if (!cosmos) return;
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
        cosmos.setSizes(typeof args === "boolean" ? args : !cosmos.trueSizes, ui());
      }
    },
    dispose() {
      loop.stop();
      offResize();
      for (const off of offs) off();
      for (const id of lagTimers) clearTimeout(id);
      lagTimers.clear();
      bots.dispose();
      ghost.stop();
      pads.release();
      uplink?.dispose();
      cosmos?.clearEffects();
      sprites.clear();
      layers.dispose();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
