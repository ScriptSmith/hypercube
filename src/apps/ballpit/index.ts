/**
 * Ball Pit Poll. Wires the pieces together:
 *
 * - questions.ts, pictures.ts  the curated questions and our own answer pictures; custom.ts the
 *   operator's own question, set through admin
 * - schedule.ts   which question is up, from the shared clock; plan.ts a bank following its leader
 * - tally.ts      today's votes, mergeable between frames; store.ts keeps them in local storage
 * - limiter.ts    one ball per button at a time, however many fingers touch it
 * - layout.ts     where text, tubes, buttons and pipes go; network.ts the screen's pipes
 * - chart.ts, pile.ts, lattice.ts, shape.ts  the columns of balls inside each tube's glass
 * - pipes.ts, transit.ts  the balls riding the pipes from the buttons to the tubes
 * - link.ts       a bank's messages; bots.ts injected touches; view.ts and sprites.ts drawing
 *
 * Frame modes: `solo` (standalone), `local` (a bank frame drawing its own tubes, because the bank
 * has no screen or its screen went quiet), `feeder` (a bank frame under a screen: buttons only,
 * and balls that ride a riser off the top) and `screen`.
 *
 * Bots press buttons through the same path as fingers, but a synthetic touch is never a vote: it
 * sends a faded ball through the pipe that puffs out of the outlet without landing, and nothing
 * is counted, stored or sent.
 */
import { bankFraction } from "../../core/layout";
import type {
  AppContext,
  AppInstance,
  FrameInfo,
  FrameKind,
  PeerInfo,
  Pointer,
} from "../../core/types";
import { createBots, type Bots } from "./bots";
import { createChart } from "./chart";
import { DRAIN_MS, MAX_LIVE, readConfig, SCREEN_GRACE_MS } from "./config";
import { buttonAt, type Layout, layoutFrame, metresPerPx, networkFor, type Way } from "./layout";
import { createLimiter } from "./limiter";
import { createLink, type Link, type TotalsMsg, type VoteMsg } from "./link";
import { FOLLOW_MS, followSlot, planOf, type PlanMsg, wordless } from "./plan";
import { type Question, questionById } from "./questions";
import { type Skip, type Slot, skipsFor, slotAt } from "./schedule";
import {
  addDays,
  browserKV,
  dayOf,
  loadDay,
  localOffset,
  memoryKV,
  prune,
  saveDay,
  scopeOf,
  storedSums,
} from "./store";
import { createTally, originOf, type TallySnapshot } from "./tally";
import { buildRoute, createTransit, type Profile, type Route } from "./transit";
import { COLORS, createView, type Ring, type ViewBlock } from "./view";

type Mode = "solo" | "local" | "feeder" | "screen";

/** Balls fall a little slower than real ones, so a fall reads from across the room. */
const gravityFor = (kind: FrameKind) => (9.8 / metresPerPx(kind)) * 0.7;

const LIVE_CAP: Record<FrameKind, number> = {
  wall: 64,
  screen: 64,
  panel: 40,
  pair: 40,
  kiosk: 40,
  sphere: 64,
};
/** Balls in the pipes at once. A vote beyond this still counts and falls in from the mouth. */
const TRANSIT_CAP: Record<FrameKind, number> = {
  wall: 48,
  screen: 96,
  panel: 32,
  pair: 48,
  kiosk: 32,
  sphere: 96,
};
/**
 * A ball leaving a touch frame for the screen reaches the top edge this long after the press at
 * the soonest. The vote message goes at once, so it gets to the screen before the ball is due.
 */
export const FEEDER_MIN_MS = 520;
/** Longest a ball waits for room in a busy pipe before it goes without a ride. */
const WAIT_MS = { touch: 900, feeder: 700, screen: 1500 };
/** Speed of a ball crossing from a panel into the screen, m/s, the same on both sides. */
const HANDOFF_M_S = 1.5;
/** Cruising speed in the screen's network, venue px/s. */
const SCREEN_V = 3000;
const MAX_RINGS = 24;
const MAX_INLETS = 32;
const SAVE_MS = 2000;
const PULSE_MS = 900;

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.variant, ctx.options);
  const setup = ctx.setup;
  const kind = ctx.frame.kind;
  const isScreen = kind === "screen" || setup.role === "screen";
  const inBank = setup.name === "bank";
  const count = Math.max(1, setup.count);
  const local = () => performance.now();
  const clock = () => ctx.clock.now();
  const origin = originOf(ctx.net.self);
  const rng = ctx.rng(`ballpit:${ctx.seed}:${ctx.identity.frame ?? "local"}`);

  let frame: FrameInfo = ctx.frame;
  let disposed = false;
  const venue = () => ({ W: frame.width / frame.unit, H: frame.height / frame.unit });

  // ---- Totals and storage -------------------------------------------------------------------

  const persist = ctx.identity.mode === "show" && ctx.identity.frame !== null;
  const kv = persist ? browserKV() : memoryKV();
  const scope = scopeOf(ctx.identity.frame ?? "local", setup.group);
  const dayNow = () => dayOf(clock(), localOffset(Date.now()));
  let today = dayNow();
  prune(kv, today);
  const tally = createTally(today);
  tally.reset(today, loadDay(kv, scope, today));
  let savedVersion = tally.version;
  let saveAt = local();
  const save = () => {
    if (!persist || tally.version === savedVersion) return;
    saveDay(kv, scope, tally);
    savedVersion = tally.version;
  };
  const yesterdays = new Map<string, number[] | null>();
  const yesterdayOf = (q: Question): number[] | null => {
    if (!yesterdays.has(q.id)) {
      yesterdays.set(q.id, storedSums(kv, scope, addDays(today, -1), q.id, q.answers.length));
    }
    return yesterdays.get(q.id) ?? null;
  };
  const countsOf = (q: Question): number[] => tally.sums(q.id);

  // ---- Schedule, layout and charts ----------------------------------------------------------

  let skip: Skip | null = null;
  /** The leader's latest announcement, while this frame isn't the leader. */
  let heard: { msg: PlanMsg; from: string; at: number } | null = null;
  const following = (): PlanMsg | null =>
    heard &&
    heard.from !== ctx.net.self &&
    heard.from === ctx.net.leader() &&
    local() - heard.at < FOLLOW_MS
      ? heard.msg
      : null;
  /** This frame's own schedule, or its leader's questions when it has one. */
  const slotNow = (): Slot => {
    const own = slotAt(clock(), cfg, skip);
    const plan = following();
    return plan ? followSlot(own, plan, clock(), cfg.custom) : own;
  };
  let slot = slotNow();
  let shown: Question[] = slot.questions;
  let swapping = false;
  let swapAt = 0;
  let mode: Mode = isScreen ? "screen" : inBank ? "feeder" : "solo";
  let layout: Layout = { W: 1, H: 1, blocks: [], pipes: [], risers: [], network: null };
  let blocks: ViewBlock[] = [];
  let dirty = true;
  let attractOn = true;
  let modeAt = Date.now();
  let revealOn = false;
  let revealKey = "";

  const view = createView({
    root: ctx.root,
    unit: () => frame.unit,
    pixelRatio: () => frame.pixelRatio,
    size: () => ({ width: frame.width, height: frame.height }),
    venue,
  });
  const transit = createTransit(TRANSIT_CAP[kind], local);
  const routes = new Map<string, Route | null>();
  const rings: Ring[] = [];
  const limiter = createLimiter();
  // Bots keep their own, so a bot's tap never makes a person wait.
  const botLimiter = createLimiter();
  let ghostsSent = 0;

  // ---- Routes through the pipes -------------------------------------------------------------

  const touchProfile = (): Profile => {
    const v1 = 0.9 * venue().H;
    return { pause: 0, v0: 0, v1, accel: v1 / 0.12 };
  };
  const feederProfile = (): Profile => {
    const v1 = HANDOFF_M_S / metresPerPx("panel");
    return { pause: 0, v0: 0, v1, accel: v1 / 0.1 };
  };
  const screenProfile = (): Profile => {
    const v0 = HANDOFF_M_S / metresPerPx("screen");
    const net = layout.network;
    const climb = net ? Math.max(60, venue().H - net.lanes.down) : 150;
    return { pause: 0, v0, v1: SCREEN_V, accel: (SCREEN_V ** 2 - v0 ** 2) / (2 * climb * 0.9) };
  };

  const routeOf = (key: string, way: () => Way | null, profile: () => Profile): Route | null => {
    if (routes.has(key)) return routes.get(key) ?? null;
    const w = way();
    let route: Route | null = null;
    if (w) {
      const p = profile();
      route = buildRoute(w.path, p, w.r, w.nodes);
      // Off a touch frame the ball waits at the stub long enough that its vote gets there first.
      if (mode === "feeder" && route.duration < FEEDER_MIN_MS)
        route = buildRoute(w.path, { ...p, pause: FEEDER_MIN_MS - route.duration }, w.r, w.nodes);
    }
    routes.set(key, route);
    return route;
  };
  const buttonRoute = (bi: number, a: number) =>
    routeOf(
      `${mode}:${bi}.${a}`,
      () => layout.blocks[bi]?.ways[a] ?? null,
      mode === "feeder" ? feederProfile : touchProfile,
    );
  const networkRoute = (inlet: number, bi: number, a: number) =>
    routeOf(
      `n:${inlet}.${bi}.${a}`,
      () => layout.network?.way(inlet, bi, a) ?? null,
      screenProfile,
    );

  // ---- The screen's panels below ------------------------------------------------------------

  /** Where each touch panel's riser meets the screen: one per panel of every frame below. */
  const inletsNow = (): number[] => {
    const { W } = venue();
    const spans = new Map<number, number>();
    for (const p of ctx.net.peers()) {
      if (p.role === "screen" || p.kind === "screen") continue;
      spans.set(p.pos, Math.max(1, Math.min(4, Math.floor(p.span ?? 1))));
    }
    const usual = spans.size > 0 ? Math.max(...spans.values()) : 1;
    const out: number[] = [];
    for (let p = 0; p < count && out.length < MAX_INLETS; p++) {
      const span = spans.get(p) ?? usual;
      for (let c = 0; c < span; c++) out.push(bankFraction(p, (c + 0.5) / span, count) * W);
    }
    return out;
  };
  let inletKey = "";
  const watchInlets = () => {
    if (!isScreen) return;
    const inlets = inletsNow();
    const key = inlets.map((x) => Math.round(x)).join(",");
    if (key === inletKey) return;
    inletKey = key;
    const { W, H } = venue();
    const net = networkFor(W, H, layout.blocks, inlets);
    layout = { ...layout, network: net, pipes: net.pipes };
    for (const k of routes.keys()) if (k.startsWith("n:")) routes.delete(k);
    transit.forget();
    view.setPipes(net.pipes);
    dirty = true;
  };

  const updateYesterday = () => {
    for (const [i, vb] of blocks.entries()) {
      const y = cfg.yesterday ? yesterdayOf(vb.question) : null;
      view.yesterday(
        i,
        vb.block.tubes.map((t) => {
          if (!y) return null;
          const v = y[t.answer] ?? 0;
          if (v <= 0) return null;
          return Math.max(t.top - 6, t.bottom - vb.chart.heightFor(v));
        }),
      );
    }
  };

  const rebuild = () => {
    for (const vb of blocks) vb.chart.dispose();
    // Balls in the pipes belong to the old layout.
    transit.clear();
    routes.clear();
    const { W, H } = venue();
    const inlets = isScreen ? inletsNow() : undefined;
    inletKey = inlets ? inlets.map((x) => Math.round(x)).join(",") : "";
    layout = layoutFrame({
      kind,
      W,
      H,
      span: frame.span ?? 1,
      adultTop: frame.reachTop.adult / frame.unit,
      childTop: frame.reachTop.child / frame.unit,
      variant: cfg.variant,
      answers: shown.map((q) => q.answers.length),
      feeder: mode === "feeder",
      inlets,
    });
    const tubes = layout.blocks.reduce((nTubes, b) => nTubes + b.tubes.length, 0);
    const liveCap = Math.max(
      8,
      Math.min(LIVE_CAP[kind], Math.floor(MAX_LIVE / Math.max(1, tubes))),
    );
    blocks = layout.blocks.map((block) => ({
      block,
      question: shown[block.slot] ?? shown[0]!,
      chart: createChart({ tubes: block.tubes, n0: block.n0, liveCap, gravity: gravityFor(kind) }),
    }));
    view.build(blocks, layout.pipes);
    for (const vb of blocks) vb.chart.pour(countsOf(vb.question));
    revealKey = "";
    updateYesterday();
    dirty = true;
  };

  const refresh = (qid: string) => {
    for (const vb of blocks) if (vb.question.id === qid) vb.chart.setCounts(countsOf(vb.question));
    dirty = true;
  };

  // ---- Network ------------------------------------------------------------------------------

  let lag = 0;
  const lagTimers = new Set<number>();
  const arrivals: { q: string; a: number; lead: number }[] = [];
  const exits: { q: string; a: number; t: number }[] = [];
  let screenDemoAt = local();

  const totalsMsg = (): TotalsMsg => {
    const q: Record<string, TallySnapshot> = {};
    for (const s of shown) {
      const snap = tally.snapshot(s.id);
      if (snap) q[s.id] = snap;
    }
    const msg: TotalsMsg = { d: today, q };
    if (skip && skip.k === slot.k && skip.n > 0) msg.k = skip;
    return msg;
  };

  /** Send a ball through the screen's network, from the panel at (p, u) to answer `a`. */
  const ride = (bi: number, a: number, p: number, u: number, at: number, ghost: boolean) => {
    const net = layout.network;
    const vb = blocks[bi];
    if (!net || !vb || vb.chart.state === "drain") return false;
    const inlet = net.nearest(bankFraction(p, u, count) * venue().W);
    const route = networkRoute(inlet, bi, a);
    if (!route) return false;
    const start = transit.plan(route, at, WAIT_MS.screen);
    if (start === null) return false;
    const info = { block: bi, answer: a, color: a % COLORS.length, tint: rng.int(3), ghost };
    if (!transit.add(route, start, { ...info, lands: true })) return false;
    if (!ghost) vb.chart.flightOut(a);
    dirty = true;
    return true;
  };

  const onVotes = (votes: VoteMsg[], from: string) => {
    const changed = new Set<string>();
    for (const v of votes) {
      const q = questionById(v.q);
      if (!q) continue;
      const added = tally.apply(v.q, v.g, originOf(from), v.a, v.n);
      if (added <= 0) continue;
      if (isScreen) ctx.idle.poke();
      changed.add(v.q);
      const bi = blocks.findIndex((b) => b.question.id === q.id);
      if (mode === "screen" && bi >= 0) {
        const lead = v.t - clock();
        if (ctx.debug) {
          arrivals.push({ q: q.id, a: v.a, lead });
          if (arrivals.length > 32) arrivals.shift();
        }
        // A vote that comes late rides from the bottom edge now; one far off is dropped in.
        if (lead > -2000 && lead < 4000) {
          for (let i = 0; i < Math.min(added, 3); i++)
            ride(bi, v.a, v.p, v.u, local() + Math.max(0, lead), false);
        }
      }
    }
    for (const qid of changed) refresh(qid);
    if (changed.size > 0) link?.changed();
  };

  const onTotals = (msg: TotalsMsg): boolean => {
    let ahead = false;
    for (const [qid, snap] of Object.entries(msg.q)) {
      const res = tally.merge(qid, snap);
      if (res.changed) refresh(qid);
      if (tally.ahead(qid, snap)) ahead = true;
    }
    if (msg.k && msg.k.k === slot.k && msg.k.n > skipsFor(slot.k, skip)) skip = msg.k;
    return ahead;
  };

  const link: Link | null = inBank
    ? createLink({
        net: ctx.net,
        isScreen,
        now: local,
        day: () => today,
        totals: totalsMsg,
        onVotes,
        onTotals,
        plan: () => planOf(slotAt(clock(), cfg, skip)),
        onPlan(msg, from) {
          heard = { msg, from, at: local() };
        },
      })
    : null;

  const sendVote = (v: VoteMsg) => {
    if (!link) return;
    if (lag <= 0) {
      link.vote(v);
      return;
    }
    const id = window.setTimeout(() => {
      lagTimers.delete(id);
      if (!disposed) link.vote(v);
    }, lag);
    lagTimers.add(id);
  };

  // ---- Presses on this frame ----------------------------------------------------------------

  /** A press on answer `a` of block `bi`. A ghost (a bot's press) only shows a faded ball. */
  const press = (bi: number, a: number, ghost: boolean) => {
    const vb = blocks[bi];
    if (!vb) return;
    const q = vb.question;
    let g = 0;
    let n = 0;
    if (!ghost) {
      const r = tally.vote(q.id, origin, a);
      if (!r) return;
      g = r.g;
      n = r.n;
    } else ghostsSent++;
    const now = local();
    const route = buttonRoute(bi, a);
    const info = { block: bi, answer: a, color: a % COLORS.length, tint: rng.int(3), ghost };
    if (mode === "feeder") {
      let exitAt = now + FEEDER_MIN_MS;
      const start = route ? transit.plan(route, now, WAIT_MS.feeder) : null;
      if (route && start !== null && transit.add(route, start, { ...info, lands: false }))
        exitAt = start + route.duration;
      if (ghost) return;
      const t = clock() + (exitAt - now);
      if (ctx.debug) {
        exits.push({ q: q.id, a, t });
        if (exits.length > 32) exits.shift();
      }
      const rx = layout.risers[vb.block.cell] ?? venue().W / 2;
      sendVote({
        q: q.id,
        g,
        a,
        n,
        t: Math.round(t),
        u: Math.round((rx / venue().W) * 1000) / 1000,
        p: setup.pos,
      });
      return;
    }
    if (route && vb.chart.state !== "drain") {
      const start = transit.plan(route, now, WAIT_MS.touch);
      if (start !== null && transit.add(route, start, { ...info, lands: true })) {
        if (!ghost) vb.chart.flightOut(a);
      }
    }
    if (ghost) return;
    refresh(q.id);
    sendVote({ q: q.id, g, a, n, t: Math.round(clock()), u: 0.5, p: setup.pos });
  };

  // ---- Input --------------------------------------------------------------------------------

  let lastHuman = -Infinity;
  const onDown = (p: Pointer) => {
    if (isScreen || swapping) return;
    if (!p.synthetic) lastHuman = local();
    const x = p.x / frame.unit;
    const y = p.y / frame.unit;
    const hit = buttonAt(layout, x, y);
    if (!hit) return;
    const bi = layout.blocks.indexOf(hit.block);
    const a = hit.button.answer;
    const t = local();
    const offer = (p.synthetic ? botLimiter : limiter).offer(bi * 6 + a, t);
    if (!offer.ok) {
      rings.push({
        x,
        y,
        t0: t,
        wait: offer.wait,
        r: Math.min(hit.button.w, hit.button.h, 400) * 0.16,
      });
      if (rings.length > MAX_RINGS) rings.shift();
      dirty = true;
      return;
    }
    if (!p.synthetic) attractOn = false;
    view.press(bi, a);
    press(bi, a, p.synthetic);
  };
  const offs = isScreen ? [] : [ctx.input.on("down", onDown)];

  // ---- Bots ---------------------------------------------------------------------------------

  const bots: Bots | null =
    !isScreen && ctx.bots > 0
      ? createBots({
          input: ctx.input,
          count: ctx.bots,
          rng: ctx.rng(`ballpit-bots:${ctx.seed}:${ctx.identity.frame ?? "local"}`),
          now: local,
          unit: () => frame.unit,
          targets: () =>
            swapping
              ? []
              : blocks.map((vb) => ({ question: vb.question, buttons: vb.block.buttons })),
          lastHuman: () => lastHuman,
        })
      : null;

  const mountedAt = local();

  /** A screen with bots and nobody below it sends faded balls through its pipes. */
  const screenDemo = () => {
    if (!isScreen || ctx.bots <= 0 || swapping) return;
    const t = local();
    if (t < screenDemoAt) return;
    const burst = t - mountedAt < 6000;
    screenDemoAt = t + (burst ? rng.range(120, 300) : rng.range(500, 1600) / Math.min(4, ctx.bots));
    const below = ctx.net.peers().some((p: PeerInfo) => p.role !== "screen");
    if (below) return;
    const bi = rng.int(blocks.length);
    const vb = blocks[bi];
    if (!vb) return;
    const q = vb.question;
    let sum = 0;
    for (const ans of q.answers) sum += ans.bot;
    let pick = rng.next() * sum;
    let a = 0;
    for (; a < q.answers.length - 1; a++) {
      pick -= q.answers[a]!.bot;
      if (pick <= 0) break;
    }
    if (ride(bi, a, rng.int(count), rng.range(0.2, 0.8), t, true)) ghostsSent++;
  };

  // ---- Modes, schedule, attract -------------------------------------------------------------

  let screenSince = Infinity;
  const watchScreen = () => {
    if (!link || isScreen) return;
    const t = local();
    const s = link.screen();
    let want = mode;
    if (s) {
      if (screenSince === Infinity) screenSince = t;
      if (mode === "local" && t - screenSince >= 500) want = "feeder";
    } else {
      screenSince = Infinity;
      if (mode === "feeder" && t - mountedAt > SCREEN_GRACE_MS) want = "local";
    }
    if (want === mode) return;
    mode = want;
    modeAt = Date.now();
    if (!swapping) rebuild();
  };

  let pulseAt = 0;
  let pulseIndex = 0;
  const offIdle = ctx.idle.on((idle) => {
    if (!idle) attractOn = false;
  });

  const watchSchedule = () => {
    const now = local();
    slot = slotNow();
    const want = slot.questions.map((q) => q.id).join(",");
    const have = shown.map((q) => q.id).join(",");
    if (!swapping && want !== have) {
      swapping = true;
      swapAt = now;
      for (const vb of blocks) vb.chart.pour(vb.question.answers.map(() => 0));
      for (const [i] of blocks.entries()) view.reveal(i, false, [], null);
      revealOn = false;
    }
    if (swapping) {
      const drained = blocks.every((vb) => vb.chart.state !== "drain");
      if ((drained && now - swapAt > 200) || now - swapAt > DRAIN_MS * 2) {
        swapping = false;
        shown = slot.questions;
        rebuild();
      }
      return;
    }
    const key = slot.reveal
      ? blocks
          .map((vb) => {
            const c = countsOf(vb.question);
            const most = Math.max(...c);
            return most > 0
              ? c
                  .map((v, i) => (v === most ? i : -1))
                  .filter((i) => i >= 0)
                  .join(".")
              : "";
          })
          .join("|")
      : "";
    if (slot.reveal !== revealOn || key !== revealKey) {
      revealOn = slot.reveal;
      revealKey = key;
      const lists = key.split("|");
      for (const [i, vb] of blocks.entries()) {
        const leaders = revealOn && lists[i] ? lists[i]!.split(".").map(Number) : [];
        view.reveal(i, revealOn, leaders, revealOn ? (vb.question.correct ?? null) : null);
      }
    }
  };

  const watchDay = () => {
    const d = dayNow();
    if (d === today) return;
    save();
    today = d;
    prune(kv, today);
    tally.reset(today, loadDay(kv, scope, today));
    savedVersion = tally.version;
    yesterdays.clear();
    for (const vb of blocks) vb.chart.pour(countsOf(vb.question));
    updateYesterday();
  };

  rebuild();

  // ---- Loop ---------------------------------------------------------------------------------

  let scheduleAt = 0;
  let inletsAt = 0;
  let yesterdayK = -1;
  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      if (disposed) return;
      const now = local();
      if (now - scheduleAt >= 100) {
        scheduleAt = now;
        watchScreen();
        watchSchedule();
        screenDemo();
        if (now - inletsAt >= 1000 && !swapping) {
          inletsAt = now;
          watchInlets();
        }
        if (now - saveAt >= SAVE_MS) {
          saveAt = now;
          save();
          watchDay();
        }
      }
      transit.due(now, (b) => {
        dirty = true;
        if (!b.lands) return;
        const vb = blocks[b.block];
        if (vb && !b.ghost) {
          const end = b.route.path.end;
          const v = b.route.vEnd;
          vb.chart.land(b.answer, end.x, end.y, b.route.exit.dx * v, b.route.exit.dy * v);
        }
        view.outlet(b.block, b.answer, b.ghost, now);
      });
      for (const vb of blocks) vb.chart.step(dt);
      const kSum = blocks.reduce((s, vb) => s + vb.chart.k * 100 + vb.chart.m, 0);
      if (kSum !== yesterdayK) {
        yesterdayK = kSum;
        updateYesterday();
      }
      while (rings.length > 0 && now - rings[0]!.t0 > rings[0]!.wait + 200) rings.shift();
      link?.tick();
      bots?.update();
      if (attractOn && !isScreen && !swapping && now - pulseAt >= PULSE_MS) {
        pulseAt = now;
        const all = blocks.flatMap((vb, bi) =>
          vb.block.buttons.map((b) => [bi, b.answer] as const),
        );
        if (all.length > 0) {
          const [bi, a] = all[pulseIndex++ % all.length]!;
          view.pulse(bi, a);
        }
      }
    },
    render() {
      if (disposed) return;
      const now = local();
      const busy =
        dirty ||
        transit.count > 0 ||
        rings.length > 0 ||
        view.busy(now) ||
        blocks.some((vb) => vb.chart.busy);
      if (!busy) return;
      dirty = false;
      view.draw(blocks, transit.balls, rings, now);
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    view.resize();
    dirty = true;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) rebuild();
    }, 200);
  });

  const onHide = () => save();
  window.addEventListener("pagehide", onHide);

  const debugKey = "__ballpit";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          mode,
          modeAt,
          day: today,
          k: slot.k,
          questions: shown.map((q) => q.id),
          counts: shown.map((q) => countsOf(q)),
          tally: shown.map((q) => tally.sums(q.id)),
          blocks: blocks.map((vb) => ({
            slot: vb.block.slot,
            cell: vb.block.cell,
            question: vb.question.id,
            buttons: vb.block.buttons,
            tubes: vb.block.tubes,
            chart: {
              state: vb.chart.state,
              k: vb.chart.k,
              m: vb.chart.m,
              n: vb.chart.n,
              grown: vb.chart.grown,
              bodies: vb.chart.bodies,
              tubes: vb.chart.tubes.map((t) => ({
                packed: t.packed,
                live: t.pile.n,
                drops: t.drops,
                flights: t.flights,
                top: t.pile.top(),
              })),
            },
          })),
          bodies: blocks.reduce((s, vb) => s + vb.chart.bodies, 0),
          transit: transit.count,
          ghosts: transit.balls.filter((b) => b.active && b.ghost).length,
          ghostsSent,
          pipes: layout.pipes.length,
          inlets: layout.network?.inlets.length ?? 0,
          rings: rings.length,
          queued: link?.queued ?? 0,
          leader: ctx.net.leader(),
          follows: following() ? (heard?.from ?? null) : null,
          custom: cfg.custom?.id ?? null,
          wordless: shown.some(wordless),
          pics: shown.map((q) => q.answers.map((a) => a.pic)),
          customWhy: cfg.customWhy,
          texts: shown.map((q) => q.text),
          labels: shown.map((q) => q.answers.map((a) => a.label)),
          screen: link?.screen() ?? null,
          arrivals: [...arrivals],
          exits: [...exits],
          clock: clock(),
          unit: frame.unit,
          W: venue().W,
          H: venue().H,
          swapping,
          reveal: revealOn,
          persist,
          saved: savedVersion,
        }),
        setLag: (ms: number) => {
          lag = Math.max(0, Math.min(3000, ms));
        },
        command: (name: string) => instance.command?.(name, null),
        /** Real votes for slot `s`, as if touched here: `counts[a]` more for answer a. */
        addVotes: (s: number, counts: number[]) => {
          const q = shown[s];
          if (!q) return;
          for (const [a, k] of counts.entries()) {
            for (let i = 0; i < Math.min(k, 100_000); i++) tally.vote(q.id, origin, a);
          }
          refresh(q.id);
          link?.changed();
        },
      },
    });
  }

  const instance: AppInstance = {
    reset() {
      bots?.release();
      transit.clear();
      rings.length = 0;
      limiter.reset();
      botLimiter.reset();
      for (const vb of blocks) vb.chart.pour(countsOf(vb.question));
      dirty = true;
    },
    attract() {
      attractOn = true;
      pulseIndex = 0;
    },
    status() {
      return {
        mode,
        q: shown.map((q) => q.id).join(","),
        custom: shown.some(wordless)
          ? "custom text missing here: set the question for the whole group in admin"
          : cfg.question !== "custom"
            ? "off"
            : cfg.custom
              ? "on"
              : `incomplete (${cfg.customWhy ?? "?"}), showing the rotation`,
        follows: following() ? (heard?.from ?? "") : "",
        votes: shown.reduce((s, q) => s + tally.total(q.id), 0),
        bodies: blocks.reduce((s, vb) => s + vb.chart.bodies, 0),
        piped: transit.count,
        queued: link?.queued ?? 0,
      };
    },
    command(name) {
      if (name === "next") {
        skip = { k: slot.k, n: skipsFor(slot.k, skip) + 1 };
        link?.changed();
      } else if (name === "clear") {
        for (const q of shown) {
          tally.clear(q.id, clock());
          refresh(q.id);
        }
        save();
        link?.changed();
      }
    },
    dispose() {
      disposed = true;
      loop.stop();
      save();
      clearTimeout(resizeTimer);
      for (const id of lagTimers) clearTimeout(id);
      lagTimers.clear();
      window.removeEventListener("pagehide", onHide);
      offResize();
      offIdle();
      for (const off of offs) off();
      bots?.dispose();
      link?.dispose();
      for (const vb of blocks) vb.chart.dispose();
      blocks = [];
      transit.clear();
      routes.clear();
      view.dispose();
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
  return instance;
};
