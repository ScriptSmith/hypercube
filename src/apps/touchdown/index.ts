/**
 * Touchdown. Wires the pieces together:
 *
 * - layout.ts   where pads, lanes and the ground go on this frame
 * - terrain.ts  seeded terrain with landing pads
 * - craft.ts    the rigid body, its engines, the assist and touchdown rules
 * - crew.ts     one crew's runs: autopilot, helper, fuel, ghosts, landings and bumps
 * - pilot.ts    the autopilot, for attract and bots
 * - render.ts   drawing; padview.ts the pads; bots.ts injected touches
 *
 * In a bank each touch frame plays exactly as it does alone and also sends its craft to the
 * screen above (link.ts, wire.ts); the screen draws every frame's craft (screen.ts).
 */
import { hashSeed } from "../../core/rng";
import type { AppContext, AppInstance, FrameInfo, Pointer } from "../../core/types";
import { createBots, type Bots, botPads } from "./bots";
import { readConfig, seedLabel } from "./config";
import { createCrew, type Crew, type CrewEvent } from "./crew";
import { layoutFor, type LayoutInput, nearPad, padAt, type PadSpec } from "./layout";
import { createUplink, type ShipMeta, type Uplink } from "./link";
import { createPadView, type PadLook, type PadView } from "./padview";
import { createRenderer } from "./render";
import { mountScreen } from "./screen";

const HZ = 120;
const UI_MS = 1000 / 30;
/** A pad nobody has touched for this long pulses to invite a touch. */
const INVITE_MS = 5000;

/** Crew colours: the palette's first colours, which stay distinct for colour-blind viewers. */
const crewColors = (players: readonly string[], n: number) =>
  n === 1 ? [players[1] ?? "#f0e82a"] : players.slice(0, n);

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  if (ctx.frame.kind === "screen" || ctx.setup.role === "screen") return mountScreen(ctx, config);
  let frame: FrameInfo = ctx.frame;
  const inputOf = (f: FrameInfo): LayoutInput => {
    const u = f.unit;
    return {
      kind: f.kind,
      width: f.width / u,
      height: f.height / u,
      reachTop: { adult: f.reachTop.adult / u, child: f.reachTop.child / u },
      seams: f.seams.map((s) => s / u),
      variant: config.variant,
      crews: f.kind === "wall" ? config.crews : 1,
    };
  };
  let input = inputOf(frame);
  let layout = layoutFor(input);
  /** The layout input the crews were built from, which the screen rebuilds their terrain with. */
  let builtInput = input;
  // In a bank every frame gets its own terrain and colour, so the screen above shows them apart.
  const setup = ctx.setup;
  const inBank = setup.name === "bank" && (frame.kind === "panel" || frame.kind === "pair");
  const seed = inBank ? hashSeed(`${ctx.seed}:${setup.pos}`) : ctx.seed;
  const players = ctx.ui.palette.players;
  const colors = inBank
    ? [players[setup.pos % players.length] ?? "#f0e82a"]
    : crewColors(players, layout.crews.length);
  const colorOf = (i: number) => colors[i % colors.length] ?? "#f0e82a";
  const base = ctx.rng(seedLabel(seed));
  const events: CrewEvent[] = [];
  const renderer = createRenderer(ctx.root, colors, String(ctx.seed));
  let crews: Crew[] = [];
  let padView: PadView | null = null;
  let resetButtons: HTMLElement[] = [];
  let bots: Bots | null = null;
  let pads: PadSpec[] = [];
  /** Which pad each finger holds. */
  const holds = new Map<number, PadSpec>();
  /** When each pad was last touched, for the invite pulse. */
  let touchedAt: number[] = [];
  const drawn = new Map<number, number>();
  let disposed = false;
  const meta = (): ShipMeta => ({
    pos: setup.pos,
    count: Math.max(1, setup.count, setup.pos + 1),
    seed,
    geo: {
      kind: frame.kind === "pair" ? "pair" : "panel",
      span: frame.kind === "pair" ? Math.max(2, frame.span ?? 2) : 1,
      width: builtInput.width,
      height: builtInput.height,
      adult: builtInput.reachTop.adult,
      child: builtInput.reachTop.child,
      variant: config.variant,
    },
  });
  const uplink: Uplink | null = inBank ? createUplink(ctx.net, setup.side ?? 0, meta) : null;

  const syncHeld = () => {
    for (const c of crews) for (const p of c.spec.pads) c.setHeld(p.role, false);
    for (const p of holds.values()) crews[p.crew]?.setHeld(p.role, true);
  };

  const buildCrews = () => {
    events.length = 0;
    builtInput = input;
    crews = layout.crews.map((spec) =>
      createCrew({ spec, layout, config, rng: base.fork(`crew:${spec.index}`), events }),
    );
    pads = layout.crews.flatMap((c) => c.pads);
    touchedAt = pads.map(() => Number.NEGATIVE_INFINITY);
    holds.clear();
    drawn.clear();
  };

  const buildView = () => {
    padView?.dispose();
    for (const b of resetButtons) b.remove();
    bots?.dispose();
    renderer.setup(frame, layout);
    renderer.terrain(crews);
    for (const c of crews) drawn.set(c.spec.index, c.terrainVersion);
    padView = createPadView(ctx.root, layout, frame.unit, colorOf);
    const u = frame.unit;
    resetButtons = crews.map((c) => {
      const r = c.spec.reset;
      return ctx.ui.button({
        icon: "reset",
        rect: { x: (r.x - r.r) * u, y: (r.y - r.r) * u, width: 2 * r.r * u, height: 2 * r.r * u },
        hold: 1000,
        look: "ghost",
        color: "#c9d3ea",
        onPress: () => c.restart(performance.now()),
      });
    });
    const which = botPads(crews, ctx.bots, frame.kind === "wall");
    bots = which.length
      ? createBots({ input: ctx.input, crews, pads: which, unit: () => frame.unit })
      : null;
  };

  buildCrews();
  buildView();

  // ---- Input --------------------------------------------------------------------------------

  const venueOf = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const release = (id: number) => {
    const pad = holds.get(id);
    if (!pad) return;
    holds.delete(id);
    if (![...holds.values()].includes(pad)) crews[pad.crew]?.setHeld(pad.role, false);
  };
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venueOf(p);
      const pad = padAt(layout, v.x, v.y);
      if (!pad) return;
      const crew = crews[pad.crew];
      if (!crew) return;
      const now = performance.now();
      holds.set(p.id, pad);
      touchedAt[pad.id] = now;
      crew.touched(!p.synthetic, now);
      crew.setHeld(pad.role, true);
    }),
    ctx.input.on("move", (p) => {
      const pad = holds.get(p.id);
      if (!pad) return;
      const v = venueOf(p);
      // A finger that slides well off its pad lets go of it.
      if (!nearPad(pad, v.x, v.y)) release(p.id);
      else touchedAt[pad.id] = performance.now();
    }),
    ctx.input.on("up", (p) => release(p.id)),
    ctx.input.on("cancel", (p) => release(p.id)),
  ];

  // ---- Loop ---------------------------------------------------------------------------------

  const looks = (now: number): PadLook[] => {
    const held = new Set(holds.values());
    return pads.map((p) => {
      const c = crews[p.crew]!;
      const th = c.thrust;
      const flying = c.phase === "flying";
      const firing = flying && th.power > 0 && th[p.role];
      const helper = c.helping !== null && p.role === (c.helping === 0 ? "left" : "right");
      const quiet = now - (touchedAt[p.id] ?? Number.NEGATIVE_INFINITY) > INVITE_MS;
      return {
        held: held.has(p),
        firing,
        invite: !held.has(p) && !helper && (c.mode === "auto" || quiet),
        helper,
        fuel: config.fuel ? c.fuel : null,
        empty: flying && c.spent,
      };
    });
  };

  let lastRender = performance.now();
  let uiAt = 0;
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const now = performance.now();
      for (const c of crews) c.step(dt, now);
      bots?.update(now);
      const first = crews[0];
      if (uplink && first) uplink.tick(now, first);
    },
    render(alpha) {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - lastRender) / 1000);
      lastRender = now;
      let redraw = false;
      for (const c of crews) {
        if (drawn.get(c.spec.index) !== c.terrainVersion) {
          drawn.set(c.spec.index, c.terrainVersion);
          redraw = true;
        }
      }
      if (redraw) renderer.terrain(crews);
      for (const e of events) renderer.event(e, crews);
      events.length = 0;
      renderer.draw(crews, alpha, now / 1000, dt);
      if (padView && now - uiAt > UI_MS) {
        uiAt = now;
        padView.update(looks(now));
      }
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    input = inputOf(f);
    const next = layoutFor(input);
    const same =
      Math.abs(next.width - layout.width) < 2 && Math.abs(next.height - layout.height) < 2;
    layout = next;
    if (!same) {
      bots?.release();
      buildCrews();
    }
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) buildView();
    }, 150);
    renderer.setup(frame, layout);
    renderer.terrain(crews);
  });

  const command = (name: string) => {
    if (name === "terrain") for (const c of crews) c.newTerrain();
  };

  const debugKey = "__touchdown";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          unit: frame.unit,
          layout: {
            width: layout.width,
            height: layout.height,
            craft: layout.craft,
            ground: layout.ground,
            crews: layout.crews.map((c) => ({ lane: c.lane, reset: c.reset })),
          },
          pads: pads.map((p) => ({ id: p.id, crew: p.crew, role: p.role, rect: p.rect })),
          crews: crews.map((c) => ({
            mode: c.mode,
            phase: c.phase,
            run: c.run,
            runT: c.runT,
            x: c.craft.x,
            y: c.craft.y,
            vx: c.craft.vx,
            vy: c.craft.vy,
            a: c.craft.a,
            fuel: c.fuel,
            helping: c.helping,
            ghost: c.ghost !== null && c.ghostAlpha > 0,
            thrust: { ...c.thrust },
            terrain: c.terrainVersion,
            landingPads: c.terrain.pads.map((p) => ({ ...p })),
            outcome: c.outcome ? { kind: c.outcome.kind, stars: c.outcome.stars } : null,
            counts: { ...c.counts },
          })),
          particles: renderer.particles,
        }),
        command,
      },
    });
  }

  const totals = () =>
    crews.reduce(
      (t, c) => ({
        runs: t.runs + c.counts.runs,
        landings: t.landings + c.counts.landings,
        bumps: t.bumps + c.counts.bumps,
        stars: t.stars + c.counts.stars,
      }),
      { runs: 0, landings: 0, bumps: 0, stars: 0 },
    );

  return {
    reset() {
      bots?.release();
      for (const c of crews) c.reset();
      syncHeld();
      renderer.clear();
      events.length = 0;
    },
    attract() {},
    status() {
      const t = totals();
      const people = crews.filter((c) => c.mode === "people").length;
      return {
        crews: crews.length,
        playing: people,
        runs: t.runs,
        landings: t.landings,
        bumps: t.bumps,
        stars: t.stars,
      };
    },
    command(name) {
      command(name);
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      bots?.dispose();
      padView?.dispose();
      for (const b of resetButtons) b.remove();
      renderer.dispose();
      holds.clear();
      events.length = 0;
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
