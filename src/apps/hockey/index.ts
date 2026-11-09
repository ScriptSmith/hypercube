/**
 * Table Hockey. Wires the pieces together:
 *
 * - layout.ts   where tables, lanes, stations and scores go on this frame
 * - physics.ts  pucks, mallets and paddles in lane coordinates (sub-stepped, deterministic)
 * - table.ts    one table's game: serves, goals, respawns, bots; match, defence or deck rules
 * - waves.ts    defence targets and waves
 * - bot.ts      bot players
 * - seats.ts    player stations: who is playing, bots for empty seats, the lobby flow, fitting
 *               the table into the players' bands
 * - control.ts  fingers to mallet targets
 * - versus.ts   handoffs and scores between two frames, or a phantom far end
 * - probe.ts    versus test hook (debug only)
 * - bank.ts     a bank frame's link to the screen above; view.ts its messages
 * - screen.ts   the screen above a bank: spectator view, or the defence deck
 * - render.ts   drawing a touch frame; paint.ts pieces shared with the screen
 */
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import { createBankLink, type BankLink } from "./bank";
import { readConfig, type Side } from "./config";
import { homeSpot } from "./home";
import { createControls, type Steering } from "./control";
import { apply, type Band, type Layout, layoutFor } from "./layout";
import { scoreOf } from "./match";
import { hueOf } from "./paint";
import { createProbe } from "./probe";
import { createRenderer, type Scene } from "./render";
import { mountScreen } from "./screen";
import { countdownMs, createLobby, type Lobby } from "./seats";
import { createTable, type Table } from "./table";
import { createVersusLink, type VersusLink } from "./versus";

/** Simulation rate. Sub-steps inside each step handle the fastest pucks. */
const HZ = 120;
/** How often the test hook on the root element is refreshed. */
const REPORT_MS = 500;
/** Steps fall at most this far behind the clock (a stall); beyond it they start again from now. */
const MAX_BEHIND_MS = 300;

/** The game itself: kept across resizes that only change the scale. */
interface Game {
  /** Layout with no bands fitted: where stations go. */
  layout: Layout;
  tables: Table[];
  link: VersusLink | null;
  bank: BankLink | null;
  /** The bands each lane is fitted to, by lane id. */
  bands: Record<string, Band>;
  /** Each table's last fit, so a fit that changes nothing is skipped. */
  fits: Map<Table, string>;
  dispose(): void;
}

/** Stations and steering, rebuilt whenever the stage size changes. */
interface Seating {
  lobbies: Lobby[];
  steering: Steering[];
  dispose(): void;
}

/** Same layout in venue px, give or take rounding of the stage size. */
const sameLayout = (a: Layout, b: Layout) =>
  a.kind === b.kind &&
  Math.abs(a.width - b.width) < 2 &&
  Math.abs(a.height - b.height) < 2 &&
  a.tables.length === b.tables.length &&
  a.tables.every((t, i) => {
    const r = t.lanes[0]?.rect;
    const s = b.tables[i]?.lanes[0]?.rect;
    return !!r && !!s && Math.abs(r.y - s.y) < 2 && Math.abs(r.height - s.height) < 2;
  });

export const mount = (ctx: AppContext): AppInstance => {
  const cfg = readConfig(ctx.variant, ctx.options);
  if (ctx.setup.role === "screen" || ctx.frame.kind === "screen") return mountScreen(ctx, cfg);
  const palette = ctx.ui.palette;
  const versusSide: Side | null =
    ctx.setup.name === "versus" ? (ctx.setup.side === 1 ? 1 : 0) : null;
  const banked = ctx.setup.name === "bank";
  const fxRng = ctx.rng("hockey:fx");
  const renderer = createRenderer(ctx.root, palette, () => fxRng.next());
  const probe =
    ctx.debug && versusSide !== null ? createProbe(ctx.net, ctx.clock, versusSide) : null;
  let game: Game | null = null;
  let seating: Seating | null = null;
  let matches = 0;

  const layoutOf = (
    frame: FrameInfo,
    bands?: Readonly<Record<string, Band>>,
    deck = false,
  ): Layout => {
    const u = frame.unit;
    return layoutFor({
      kind: frame.kind,
      width: frame.width / u,
      height: frame.height / u,
      reachTop: { adult: frame.reachTop.adult / u, child: frame.reachTop.child / u },
      seams: frame.seams.map((s) => s / u),
      versus: versusSide !== null,
      side: versusSide ?? 0,
      childLane: cfg.childLane,
      variant: cfg.variant,
      speed: cfg.speed,
      wall: cfg.wall,
      players: cfg.players,
      bands,
      deck,
    });
  };

  const redraw = (g: Game) => renderer.board(g.tables.map((t) => t.spec));

  /**
   * Fit one table's lanes to its players' bands (or back to full reach), and in a bank open
   * a defence rink's top onto the screen while a round is on.
   */
  const fitTable = (g: Game, table: Table, bands: Readonly<Record<string, Band>> | null) => {
    const deck = banked && table.match.phase !== "attract" && (g.bank?.screen() ?? false);
    const key = JSON.stringify([bands, deck]);
    if (g.fits.get(table) === key) return;
    g.fits.set(table, key);
    for (const lane of table.spec.lanes) delete g.bands[lane.id];
    if (bands) Object.assign(g.bands, bands);
    const next = layoutOf(ctx.frame, g.bands, deck).tables.find((t) => t.id === table.spec.id);
    if (next) table.refit(next);
    redraw(g);
  };

  const buildGame = (layout: Layout): Game => {
    const tables = layout.tables.map((spec) =>
      createTable(
        spec,
        cfg,
        ctx.rng(`hockey:${spec.id}:${versusSide ?? ""}:${banked ? ctx.setup.pos : ""}`),
        {
          ...(versusSide === null ? {} : { versus: { side: versusSide } }),
          rules: cfg.variant === "defence" ? "defence" : "match",
        },
      ),
    );
    const offs = tables.map((t) =>
      t.on((e) => {
        renderer.event(e, t);
        probe?.event(e);
      }),
    );
    const table = tables[0];
    const link =
      versusSide !== null && table && cfg.variant !== "defence"
        ? createVersusLink({
            net: probe?.net ?? ctx.net,
            table,
            side: versusSide,
            clock: ctx.clock,
            rng: ctx.rng(`hockey:link:${versusSide}`),
            keeps: () => seating?.lobbies[0]?.keeps() ?? false,
            onEnded: (now) => seating?.lobbies[0]?.reset(now),
            poke: () => ctx.idle.poke(),
          })
        : null;
    const bank =
      banked && table
        ? createBankLink({
            net: ctx.net,
            clock: ctx.clock,
            table,
            frame: () => ({
              width: ctx.frame.width / ctx.frame.unit,
              height: ctx.frame.height / ctx.frame.unit,
              kind: ctx.frame.kind,
            }),
            pos: ctx.setup.pos,
            count: ctx.setup.count,
          })
        : null;
    const now = ctx.clock.now();
    for (const t of tables) t.attract(now);
    return {
      layout,
      tables,
      link,
      bank,
      bands: {},
      fits: new Map(),
      dispose() {
        for (const off of offs) off();
        link?.dispose();
        bank?.dispose();
      },
    };
  };

  const buildSeating = (g: Game, frame: FrameInfo): Seating => {
    // Test bots fill whole tables in order, so `bots=2` gives one complete bot match.
    let testBots = ctx.bots;
    const lobbies = g.tables.map((table) => {
      for (const p of table.players) {
        table.setHuman(p, false);
        table.setManned(p, false);
      }
      const seats = table.players.filter((p) => p.spec.station !== null).length;
      const mine = Math.min(testBots, seats);
      testBots -= mine;
      return createLobby({
        table,
        stations: ctx.stations,
        unit: frame.unit,
        colorOf: (hue) => hueOf(palette, hue),
        testBots: mine,
        newMatch: (now, botsOnly) =>
          g.link?.newMatch(now, botsOnly) ?? {
            id: `${table.spec.id}-${++matches}`,
            startAt: now + countdownMs(botsOnly),
          },
        remoteKeeps: () => g.link?.remoteKeeps() ?? false,
        // Versus pucks can be on the other wall for a while; the lobby judges idleness itself.
        ...(versusSide === null ? {} : { playTimeout: 0 }),
        fill: cfg.variant !== "defence",
        fit: (bands) => fitTable(g, table, bands),
      });
    });
    const steering = lobbies.flatMap((l, i) =>
      l.seats.map((seat) => ({
        seat,
        table: g.tables[i]!,
        get toVenue() {
          return seat.player.lane.spec.toVenue;
        },
      })),
    );
    return {
      lobbies,
      steering,
      dispose() {
        for (const l of lobbies) l.dispose();
      },
    };
  };

  const controls = createControls(
    ctx.input,
    () => seating?.steering ?? [],
    () => ctx.frame.unit,
  );

  const scene: Scene = {
    frame: ctx.frame,
    tables: [],
    steering: [],
    controls,
    target: cfg.target,
    linked: null,
  };

  const arrange = (frame: FrameInfo) => {
    const layout = layoutOf(frame);
    seating?.dispose();
    if (!game || !sameLayout(game.layout, layout)) {
      game?.dispose();
      game = buildGame(layout);
    } else {
      // Same game at a new scale: lanes go back to full reach until the next match starts.
      game.bands = {};
      game.fits.clear();
      for (const t of game.tables) {
        const next = layout.tables.find((s) => s.id === t.spec.id);
        if (next) t.refit(next);
      }
    }
    seating = buildSeating(game, frame);
    renderer.setup(frame);
    redraw(game);
    scene.frame = frame;
    scene.tables = game.tables;
    scene.steering = seating.steering;
  };

  arrange(ctx.frame);
  const offResize = ctx.onResize(arrange);

  let lastReport = -Infinity;
  const report = (local: number) => {
    if (!game || !seating || local - lastReport < REPORT_MS) return;
    lastReport = local;
    const lobbies = seating.lobbies;
    // Read by tests: phase, score, seats, mallets and lane of each table.
    ctx.root.dataset.hockey = JSON.stringify({
      linked: game.link?.connected() ?? game.bank?.screen() ?? null,
      tables: game.tables.map((t, i) => ({
        id: t.spec.id,
        phase: t.match.phase,
        match: t.match.id,
        score: scoreOf(t.match),
        waves: t.waves?.cleared ?? null,
        pucks: t.lanes.reduce((n, l) => n + l.pucks.filter((p) => p.live).length, 0),
        incoming: t.lanes.reduce((n, l) => n + l.arrivals.length, 0),
        seats: lobbies[i]!.seats.map((s) => `${s.station.state}${s.station.bot ? "*" : ""}`),
        mallets: t.players.map((p) => {
          const v = apply(p.lane.spec.toVenue, p.mallet.x, p.mallet.y);
          return [Math.round(v.x), Math.round(v.y)];
        }),
        lanes: t.spec.lanes.map((l) => [
          Math.round(l.rect.x),
          Math.round(l.rect.y),
          Math.round(l.rect.width),
          Math.round(l.rect.height),
        ]),
      })),
    });
  };

  /**
   * A bank's screen can appear (or go) after a round has begun: look again now and then, so a
   * defence rink opens onto the deck as soon as there is one.
   */
  let lastDeckCheck = -Infinity;
  const checkDeck = (local: number) => {
    if (!game || !banked || cfg.variant !== "defence" || local - lastDeckCheck < 1000) return;
    lastDeckCheck = local;
    for (const t of game.tables) {
      if (t.match.phase !== "countdown" && t.match.phase !== "play") continue;
      const own = t.spec.lanes.flatMap((l) =>
        game!.bands[l.id] ? [[l.id, game!.bands[l.id]!] as const] : [],
      );
      fitTable(game, t, own.length > 0 ? Object.fromEntries(own) : null);
    }
  };

  let lastDraw = performance.now();
  /**
   * Shared clock ms of the step being run. The loop runs steps in batches to catch up with the
   * clock, and each gets its own time, so a puck handed to the other frame is stamped when it
   * crossed rather than when its batch ran.
   */
  let stepAt = ctx.clock.now();
  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      const clockNow = ctx.clock.now();
      stepAt += dt * 1000;
      if (stepAt > clockNow || stepAt < clockNow - MAX_BEHIND_MS) stepAt = clockNow;
      if (!game || !seating) return;
      const now = stepAt;
      const local = performance.now();
      for (const t of game.tables) t.step(dt, now);
      for (const l of seating.lobbies) l.tick(now, local);
      game.link?.tick(now);
      game.bank?.tick(now, local);
      checkDeck(local);
      report(local);
    },
    render(alpha) {
      const local = performance.now();
      const dt = Math.min(0.1, (local - lastDraw) / 1000);
      lastDraw = local;
      scene.linked = game?.bank && cfg.variant === "defence" ? game.bank.screen() : null;
      // Pucks are drawn between the last two steps: draw everything as of that moment.
      renderer.draw(scene, alpha, stepAt + ((alpha - 1) * 1000) / HZ, dt);
    },
  });
  loop.start();

  return {
    reset() {
      const now = ctx.clock.now();
      for (const l of seating?.lobbies ?? []) l.reset(now);
    },
    homeSpot(size) {
      if (!game) return null;
      const f = ctx.frame;
      const u = f.unit;
      const spot = homeSpot(
        game.layout,
        f.reachTop.adult / u,
        f.seams.map((s) => s / u),
        size / u,
      );
      return { x: spot.x * u, y: spot.y * u };
    },
    status() {
      const tables = game?.tables ?? [];
      return {
        phase: tables.map((t) => t.match.phase).join(" "),
        score: tables.map((t) => scoreOf(t.match).join("-")).join(" "),
        people: (seating?.lobbies ?? []).reduce((n, l) => n + l.humans(), 0),
        ...(game?.link ? { linked: game.link.connected() } : {}),
      };
    },
    dispose() {
      loop.stop();
      offResize();
      controls.dispose();
      seating?.dispose();
      game?.dispose();
      probe?.dispose();
      seating = null;
      game = null;
      renderer.dispose();
    },
  };
};
