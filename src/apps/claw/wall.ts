/**
 * Claw Machine on a wall: a row of the sphere's cabinets standing on the floor, each with left
 * and right arrows and a drop button low enough for a child. Cabinets nobody is using play
 * themselves; a press takes one over, and it plays itself again once its player has gone.
 *
 * - walllayout.ts  where the cabinets, buttons and hatches go, from the wall's size and reach
 * - wallarcade.ts  the machines, who has each one's controls, and the hatches' prizes (tray.ts)
 * - wallinput.ts   touches to presses; visitors.ts bots that press the buttons like people
 * - wallscene.ts   the picture; front.ts each cabinet's panel and hatch
 */
import type { AppContext, AppInstance, FrameInfo } from "../../core/types";
import type { Luck } from "./arcade";
import { createVisitors, type Visitors } from "./visitors";
import { createWallArcade, type WallArcade, WALL_PLAY_S } from "./wallarcade";
import { createWallInput } from "./wallinput";
import { BUTTONS, type Button, layoutWall, type WallLayout } from "./walllayout";
import { createWallScene, type WallScene } from "./wallscene";

const DEBUG_KEY = "__claw";

const venueSize = (f: FrameInfo) => ({
  width: f.width / Math.max(1e-6, f.unit),
  height: f.height / Math.max(1e-6, f.unit),
});

export const mountWall = (ctx: AppContext): AppInstance => {
  const wanted = Number(ctx.options.cabinets ?? 3);
  const count = Number.isFinite(wanted) ? Math.max(2, Math.min(4, Math.round(wanted))) : 3;
  const luck: Luck = ctx.options.luck === "generous" ? "generous" : "fair";
  const rng = ctx.rng().fork("claw-wall");
  let frame = ctx.frame;
  let layout: WallLayout = layoutWall(venueSize(frame), frame.reach, count);
  let rebuilds = 0;
  let arcade: WallArcade = createWallArcade({ layout, rng: rng.fork("arcade"), luck });

  const canvas = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};`;
    ctx.root.append(c);
    return c;
  };
  const back = canvas(0);
  const live = canvas(1);
  let scene: WallScene | null = null;

  const build = (f: FrameInfo) => {
    const w = Math.max(1, Math.round(f.width * f.pixelRatio));
    const h = Math.max(1, Math.round(f.height * f.pixelRatio));
    for (const c of [back, live]) {
      c.width = w;
      c.height = h;
    }
    scene?.dispose();
    scene = createWallScene({
      arcade,
      back,
      live,
      px: f.unit * f.pixelRatio,
      rng: rng.fork("scene"),
      pressed: (cabinet, button) => arcade.pressed(cabinet, button),
    });
  };
  build(frame);

  const router = createWallInput({
    arcade: () => arcade,
    layout: () => layout,
    unit: () => frame.unit,
  });
  const offs = [
    ctx.input.on("down", (p) => router.down(p)),
    ctx.input.on("move", (p) => router.move(p)),
    ctx.input.on("up", (p) => router.up(p.id)),
    ctx.input.on("cancel", (p) => router.up(p.id)),
  ];

  let visitors: Visitors | null = null;
  const makeVisitors = () => {
    visitors?.dispose();
    visitors =
      ctx.bots > 0
        ? createVisitors({
            input: ctx.input,
            arcade: () => arcade,
            unit: () => frame.unit,
            rng: rng.fork(`visitors-${rebuilds}`),
            count: Math.min(ctx.bots, layout.cabinets.length),
          })
        : null;
  };
  makeVisitors();

  let frames = 0;
  let physicsMs = 0;
  let drawMs = 0;
  const smooth = (v: number, x: number) => v + (x - v) * 0.05;

  const loop = ctx.loop({
    hz: 60,
    update() {
      const t0 = performance.now();
      visitors?.update();
      arcade.step();
      physicsMs = smooth(physicsMs, performance.now() - t0);
    },
    render() {
      const t0 = performance.now();
      scene?.draw(arcade.time);
      drawMs = smooth(drawMs, performance.now() - t0);
      frames++;
    },
  });
  loop.start();

  ctx.onResize((f) => {
    frame = f;
    const next = layoutWall(venueSize(f), f.reach, count);
    const same =
      next.play.width === layout.play.width && next.cabinets.length === layout.cabinets.length;
    layout = next;
    if (!same) {
      // A different wall: new cabinets carrying on from the same moment.
      const start = arcade.time;
      arcade.dispose();
      router.clear();
      arcade = createWallArcade({
        layout,
        rng: rng.fork(`arcade-${++rebuilds}`),
        luck,
        start,
      });
      makeVisitors();
    } else {
      arcade.relayout(layout);
    }
    build(f);
  });

  /** Stage px to the page's client px, for tests that press buttons with the mouse. */
  const client = (x: number, y: number) => {
    const r = ctx.root.getBoundingClientRect();
    const sx = r.width / Math.max(1, frame.width);
    const sy = r.height / Math.max(1, frame.height);
    return { x: r.left + x * sx, y: r.top + y * sy };
  };

  const state = () => ({
    kind: "wall" as const,
    t: arcade.time,
    ready: true,
    frames,
    wins: arcade.wins,
    luck,
    layout: {
      count: layout.cabinets.length,
      play: layout.play,
      k: layout.k,
      button: layout.button,
      childTop: layout.childTop,
      adultTop: layout.adultTop,
    },
    machines: arcade.seats.map((s) => ({
      phase: s.machine.phase,
      round: s.machine.round,
      wins: s.machine.wins,
      prizes: s.machine.world.prizes.length,
      stock: s.machine.stock,
      x: s.machine.world.trolleyX(),
      timeLeft: s.machine.timeLeft,
      rounds: s.machine.rounds.length,
      bodies: s.machine.world.world.getBodyCount(),
      player: s.player,
      queued: s.queued,
      waiting: s.waiting,
      stick: s.stick,
      tray: s.tray.items.length,
      landed: s.tray.landed,
      personRounds: s.personRounds,
      personWins: s.personWins,
      botRounds: s.botRounds,
      botWins: s.botWins,
    })),
    visitors: visitors?.list.map((v) => ({ ...v })) ?? [],
    canvas: { width: live.width, height: live.height },
    physicsMs,
    drawMs,
  });

  if (ctx.debug) {
    Object.defineProperty(window, DEBUG_KEY, {
      configurable: true,
      value: {
        state,
        skip(seconds: number) {
          const n = Math.max(0, Math.round(seconds * 60));
          for (let i = 0; i < n; i++) {
            visitors?.update();
            arcade.step();
          }
        },
        win: (i: number) => arcade.forceWin(i),
        strong(i: number) {
          arcade.machines[i]?.forceStrong();
        },
        /** Where cabinet `i`'s button `b` is, in the page's client px. */
        button(i: number, b: Button) {
          const p = layout.cabinets[i]?.buttons[b];
          if (!p || !BUTTONS.includes(b)) return null;
          return { ...client(p.x * frame.unit, p.y * frame.unit), r: p.r * frame.unit };
        },
        /** Where on the page cabinet `i`'s hatch and glass are, client px. */
        hatch(i: number) {
          const h = layout.cabinets[i]?.hatch;
          if (!h) return null;
          return client((h.x + h.width / 2) * frame.unit, (h.y + h.height / 2) * frame.unit);
        },
        glass(i: number) {
          const c = layout.cabinets[i];
          if (!c) return null;
          const y = c.y + (layout.rows.glass[0] + layout.rows.glass[1]) / 2;
          return client((c.x + layout.bodyW / 2) * frame.unit, y * frame.unit);
        },
        playSeconds: WALL_PLAY_S,
        /** Draw `n` frames back to back and wait for the GPU: ms a frame, for measuring. */
        bench(n: number) {
          const g = live.getContext("2d");
          const t0 = performance.now();
          for (let i = 0; i < n; i++) scene?.draw(arcade.time + i / 60);
          g?.getImageData(0, 0, 1, 1);
          return (performance.now() - t0) / Math.max(1, n);
        },
      },
    });
  }

  return {
    reset() {
      router.clear();
      arcade.reset();
      visitors?.reset();
    },
    attract() {},
    status: () => {
      let rounds = 0;
      let won = 0;
      for (const s of arcade.seats) {
        rounds += s.personRounds;
        won += s.personWins;
      }
      return {
        machines: arcade.machines.length,
        luck,
        wins: arcade.wins,
        playing: arcade.seats.filter((s) => s.player === "person").length,
        rounds,
        won,
      };
    },
    homeSpot(size) {
      // In the free wall at the right end, at the top of adult reach.
      const u = frame.unit;
      if (layout.margin * u < size + 8 * u) return null;
      const x = (layout.width - layout.margin / 2) * u - size / 2;
      const y = layout.adultTop * u + 20 * u;
      return { x, y: Math.max(0, Math.min(y, frame.height - size)) };
    },
    dispose() {
      loop.stop();
      for (const off of offs) off();
      if (ctx.debug) delete (window as unknown as Record<string, unknown>)[DEBUG_KEY];
      visitors?.dispose();
      visitors = null;
      scene?.dispose();
      scene = null;
      arcade.dispose();
      for (const c of [back, live]) {
        c.width = c.height = 0;
        c.remove();
      }
    },
  };
};
