/**
 * The race above a wall's lanes, where people stand back and watch: what the screen shows over a
 * bank, laid out for a wide wall.
 *
 * - Across the top, a pack view of the shared course with every glider in the race in its
 *   colour. It follows the pack (packcam.ts); gliders out of view show as arrows at its edges.
 *   It reads the lanes' flights directly, so it needs no delay or interpolation buffer. In a
 *   lobby it waits on the start line with the seconds to the next race; in a countdown it shows
 *   the count.
 * - Just above each lane, a progress strip: a bar that fills left to right as the lane's glider
 *   gets along the course, with a notch for each gate, a mark for each crash, a star at the
 *   finish and the lane's place at its left. Before a race a bobbing arrow over each free lane
 *   points down at it.
 */
import type { FrameInfo, Palette } from "../../core/types";
import type { Atlas } from "./art";
import { COURSE_H } from "./config";
import { distanceOf, type Mode } from "./flight";
import type { Game, GameLane } from "./game";
import { type Gfx, rgb, type Rgb, WHITE } from "./gl";
import type { Host } from "./host";
import type { LaneView } from "./lanes";
import type { WallLayout } from "./layout";
import { createLabel, createNumeral, type Label, type Numeral, placeColor } from "./numerals";
import { type PackCam, stepPackCam } from "./packcam";
import { angleFor, drawFlyer, drawWorld, poseFor, type Viewport } from "./scene";

const MAX_CRASHES = 12;
/** The lobby's ring of dots, as a fraction of the pack view's height. */
const LOBBY_RING = 0.16;
/** Gliders in the pack view are drawn larger than the course's scale, to read from afar. */
const PACK_FLYER = 1.35;

export interface WallColumn {
  game: Game;
  views: LaneView[];
}

export interface OverviewDeps {
  gfx: Gfx;
  hud: HTMLElement;
  atlas(): Atlas | null;
  frame(): FrameInfo;
  layout(): WallLayout;
  host: Host;
  columns: readonly WallColumn[];
  palette: Palette;
  /** Clock ms. */
  now(): number;
}

export interface Overview {
  /** Place the numerals for the current frame and layout. */
  resize(): void;
  update(): void;
  draw(alpha: number, local: number, dt: number): void;
  numerals(now: number): void;
  reset(): void;
  dispose(): void;
}

interface Track {
  lastMode: Mode;
  crashes: number[];
  /** Shown fill 0 to 1, eased. */
  fill: number;
}

interface Shown {
  l: GameLane;
  v: LaneView;
  game: Game;
  x: number;
  y: number;
  alpha: number;
}

/** A lane's strip in venue px: the row, the bar and where its place goes. */
export const stripOf = (layout: WallLayout, v: LaneView, rows: number) => {
  const { band } = layout;
  const rowH = (band.bottom - band.top) / Math.max(1, rows);
  // The adult lane of a `pads` column is the upper one, so its strip is too.
  const row = rows > 1 && !v.spec.adult ? 1 : 0;
  const top = band.top + row * rowH;
  const { x, width } = v.spec.rect;
  const mid = top + rowH * 0.56;
  const th = Math.min(44, rowH * 0.2);
  const numX = x + Math.min(width * 0.14, rowH * 0.62);
  const x0 = numX + Math.min(width * 0.12, rowH * 0.5);
  const x1 = x + width - Math.min(width * 0.1, rowH * 0.42);
  return { top, rowH, mid, th, numX, x0, x1 };
};

export const createOverview = (deps: OverviewDeps): Overview => {
  const { gfx, hud, host, palette } = deps;
  const tracks = new Map<number, Track>();
  let cam: PackCam = { x: -400, zoom: 1 };
  let countdown: Numeral | null = null;
  let timer: Numeral | null = null;
  let lobbyLabel: Label | null = null;
  const places: Numeral[] = [];

  const plan = () => host.plan;
  const phase = () => host.phase;
  const over = () => phase() === "results" || phase() === "lobby";
  const bankRace = () => plan().play === "bank";
  /** Before a bank race, the pack view waits on the start line with the course ahead. */
  const atStart = () => bankRace() && (phase() === "lobby" || phase() === "countdown");

  const rowsOf = (c: WallColumn) => Math.max(1, c.views.length);

  const course = () => deps.columns[0]?.game.course ?? null;

  /** In the race the pack view shows: not idle in a bank race, not practising. */
  const inRace = (game: Game, l: GameLane) => game.shows(l) && !l.practice;

  const trackOf = (id: number): Track => {
    let t = tracks.get(id);
    if (!t) {
      t = { lastMode: "waiting", crashes: [], fill: 0 };
      tracks.set(id, t);
    }
    return t;
  };

  const resize = () => {
    const f = deps.frame();
    const u = f.unit;
    const L = deps.layout();
    const W = f.width / u;
    countdown?.dispose();
    timer?.dispose();
    lobbyLabel?.dispose();
    countdown = createNumeral(
      hud,
      { x: (W / 2) * u, y: (L.packH / 2) * u, size: L.packH * u * 0.42 },
      "count",
    );
    timer = createNumeral(
      hud,
      { x: (W / 2) * u, y: (L.packH / 2) * u, size: L.packH * u * 0.17 },
      "plain",
    );
    lobbyLabel = createLabel(hud, {
      x: (W / 2) * u,
      y: L.packH * u * (0.5 - LOBBY_RING - 0.08),
      size: L.packH * u * 0.065,
    });
    for (const n of places) n.dispose();
    places.length = 0;
    for (const c of deps.columns) {
      for (const v of c.views) {
        const s = stripOf(L, v, rowsOf(c));
        places.push(
          createNumeral(hud, { x: s.numX * u, y: s.mid * u, size: s.rowH * 0.62 * u }, "place"),
        );
      }
    }
  };

  /** Crash marks follow each lane's flight, and clear when it is back on the start line. */
  const update = () => {
    const seen = new Set<number>();
    for (const c of deps.columns) {
      for (const l of c.game.lanes) {
        seen.add(l.id);
        const t = trackOf(l.id);
        const m = l.flight.mode;
        if (m !== t.lastMode) {
          if ((m === "tumbling" || m === "out") && t.crashes.length < MAX_CRASHES)
            t.crashes.push(distanceOf(l.flight));
          if (m === "waiting") t.crashes.length = 0;
          t.lastMode = m;
        }
      }
    }
    for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id);
  };

  const shown = (alpha: number): Shown[] => {
    const out: Shown[] = [];
    for (const c of deps.columns) {
      for (const l of c.game.lanes) {
        const v = c.views.find((x) => x.spec.slot === l.slot);
        if (!v || !inRace(c.game, l)) continue;
        const f = l.flight;
        out.push({
          l,
          v,
          game: c.game,
          x: f.px + (f.x - f.px) * alpha,
          y: f.py + (f.y - f.py) * alpha,
          alpha: l.ctrl === "attract" ? 0.55 : 1,
        });
      }
    }
    return out;
  };

  const drawLobbyRing = (vp: Viewport, kpx: number) => {
    const atlas = deps.atlas();
    if (!atlas) return;
    const r = atlas.regions;
    const p = plan();
    const total = Math.max(1, p.next - p.from);
    const left = Math.max(0, Math.min(1, (p.next - deps.now()) / total));
    const dots = 16;
    const lit = Math.ceil(left * dots);
    const radius = vp.h * LOBBY_RING;
    const cx = vp.x + vp.w / 2;
    const cy = vp.y + vp.h / 2;
    for (let i = 0; i < dots; i++) {
      const a = -Math.PI / 2 + (i / dots) * Math.PI * 2;
      const on = i < lit;
      const size = (on ? 64 : 46) * kpx;
      gfx.sprite(
        r.dot,
        cx + Math.cos(a) * radius,
        cy + Math.sin(a) * radius,
        size,
        size,
        on ? [1, 0.8, 0.2] : WHITE,
        on ? 0.9 : 0.25,
      );
    }
  };

  const drawPack = (list: readonly Shown[], local: number, dt: number) => {
    const atlas = deps.atlas();
    if (!atlas) return;
    const r = atlas.regions;
    const f = deps.frame();
    const kpx = f.unit * f.pixelRatio;
    const L = deps.layout();
    const W = f.width / f.unit;
    const s1 = (L.packH / COURSE_H) * kpx;
    const gliders = list.map((g) => ({
      d: Math.max(0, g.x),
      weight: g.l.ctrl === "human" ? 3 : 1,
    }));
    stepPackCam(cam, gliders, (W * kpx) / s1, atStart(), dt);
    const s = s1 * cam.zoom;
    const vp: Viewport = {
      x: 0,
      y: 0,
      w: W * kpx,
      h: L.packH * kpx,
      s,
      camX: cam.x,
      top: L.packH * kpx - COURSE_H * s,
    };
    gfx.clip(vp.x, vp.y, vp.w, vp.h);
    const time = local / 1000;
    drawWorld(gfx, atlas, vp, course(), { time, start: over() && !atStart() ? 0 : 1 });
    const left = vp.camX;
    const right = vp.camX + vp.w / s;
    const arrows: Shown[] = [];
    // Gliders behind first, people on top.
    const order = [...list].sort((a, b) => a.alpha - b.alpha);
    for (const g of order) {
      if (g.x < left - 60 || g.x > right + 60) {
        // Before a race, last race's gliders out on the course have nothing to point at.
        if (!atStart()) arrows.push(g);
        continue;
      }
      const fl = g.l.flight;
      const tumbling = fl.mode === "tumbling" || fl.mode === "out";
      // Gliders on the start line all hover at one height: fan them out so each one shows.
      const fan = fl.mode === "waiting" ? ((g.v.index % 7) - 3) * 120 : 0;
      drawFlyer(gfx, atlas, vp, g.x, g.y + fan, {
        color: g.v.rgb,
        alpha: g.alpha,
        pose: tumbling ? 1 : poseFor(fl.flapAge, fl.vy),
        angle: tumbling ? fl.spin : angleFor(fl.vy),
        rings: g.v.rings,
        glow: g.alpha > 0.8 ? 0.5 : 0.2,
        size: (g.l.adult ? 1.05 : 1) * PACK_FLYER,
      });
    }
    for (const g of arrows) {
      const leftSide = g.x < left;
      const x = leftSide ? 80 * kpx : vp.w - 80 * kpx;
      const y = Math.min(vp.h - 90 * kpx, Math.max(90 * kpx, vp.top + g.y * s));
      gfx.sprite(r.glow, x, y, 190 * kpx, 190 * kpx, g.v.rgb, 0.5 * g.alpha, 0, 0.5, 0.5, true);
      gfx.sprite(r.arrow, x, y, 120 * kpx, 120 * kpx, g.v.rgb, g.alpha, leftSide ? Math.PI : 0);
    }
    // Time left in the race, as a thin bar along the top.
    const p = plan();
    if (phase() === "racing") {
      const frac = Math.max(0, 1 - host.raceT() / Math.max(1, p.end - p.start));
      gfx.sprite(r.white, vp.w / 2, 26 * kpx, vp.w * 0.5 * frac, 16 * kpx, [1, 0.8, 0.2], 0.75);
    }
    if (phase() === "lobby" && bankRace()) drawLobbyRing(vp, kpx);
    gfx.unclip();
  };

  const drawStrips = (local: number) => {
    const atlas = deps.atlas();
    const c0 = course();
    if (!atlas || !c0) return;
    const r = atlas.regions;
    const f = deps.frame();
    const kpx = f.unit * f.pixelRatio;
    const L = deps.layout();
    const W = f.width / f.unit;
    const { band } = L;
    // The ground band between the race above and the lanes, with a lit edge under the course.
    gfx.sprite(
      r.white,
      0,
      band.top * kpx,
      W * kpx,
      (band.bottom - band.top) * kpx,
      [0.03, 0.045, 0.1],
      1,
      0,
      0,
      0,
    );
    gfx.sprite(r.grad, 0, band.top * kpx, W * kpx, 90 * kpx, [0.2, 0.15, 0.32], 0.7, 0, 0, 0);
    const results = over();
    const before = atStart();
    const joined = host.board.joined();
    const final = host.board.places;
    const empty: Rgb = [0.11, 0.14, 0.24];
    const bob = Math.sin(local / 260) * 18;
    for (const c of deps.columns) {
      const rows = rowsOf(c);
      for (const v of c.views) {
        const l = c.game.lanes.find((x) => x.slot === v.spec.slot);
        if (!l) continue;
        const s = stripOf(L, v, rows);
        const t = trackOf(l.id);
        const racing = inRace(c.game, l);
        const fl = l.flight;
        const alpha = racing ? (l.ctrl === "attract" ? 0.55 : 1) : 0.25;
        const target = racing ? Math.min(1, distanceOf(fl) / c0.length) : 0;
        t.fill += (target - t.fill) * 0.2;
        if (target < t.fill - 0.3) t.fill = target;
        const x0 = s.x0 * kpx;
        const x1 = s.x1 * kpx;
        const y = s.mid * kpx;
        const th = s.th * kpx;
        const len = x1 - x0;
        const place = final?.get(l.id) ?? null;
        if (results && racing && place !== null && place <= 3) {
          const glow = rgb(placeColor(place, palette.foreground));
          const pulse = 0.55 + 0.25 * Math.sin(local / 300);
          gfx.sprite(
            r.glow,
            (x0 + x1) / 2,
            y,
            len * 1.3,
            s.rowH * 1.6 * kpx,
            glow,
            pulse * (place === 1 ? 0.8 : 0.5),
            0,
            0.5,
            0.5,
            true,
          );
        }
        // The track, tinted with the lane's colour so an empty strip still says whose it is.
        gfx.sprite(r.white, x0, y, len, th, empty, 0.95, 0, 0, 0.5);
        gfx.sprite(r.dot, x0, y, th, th, empty, 0.95);
        gfx.sprite(r.dot, x1, y, th, th, empty, 0.95);
        gfx.sprite(r.white, x0, y, len, th, v.rgb, 0.1 * Math.max(alpha, 0.5), 0, 0, 0.5);
        const out = fl.mode === "out";
        const fillW = len * t.fill;
        const fillA = alpha * (out ? 0.35 : 1);
        gfx.sprite(r.dot, x0, y, th * 0.8, th * 0.8, v.rgb, Math.max(fillA, 0.4));
        if (fillW > 0) gfx.sprite(r.white, x0, y, fillW, th * 0.8, v.rgb, fillA, 0, 0, 0.5);
        // A notch for every gate, lit once passed.
        const d = racing ? distanceOf(fl) : 0;
        for (const g of c0.gates) {
          const at = g.x + g.w / 2;
          const x = x0 + len * (at / c0.length);
          const lit = d > at;
          gfx.sprite(
            r.white,
            x,
            y,
            5 * kpx,
            th * (lit ? 1.25 : 0.9),
            lit ? WHITE : [0.5, 0.56, 0.75],
            lit ? 0.55 * alpha : 0.45,
          );
        }
        if (racing) {
          for (const cd of t.crashes) {
            const x = x0 + len * Math.min(1, cd / c0.length);
            gfx.sprite(r.white, x, y, 10 * kpx, th * 2.2, [1, 0.42, 0.33], 0.9 * alpha);
          }
        }
        // Finish: a star that lights when the glider crosses.
        const fin = racing && fl.fin !== null;
        const star = Math.min(s.rowH * 0.55, 150) * kpx;
        if (fin)
          gfx.sprite(r.glow, x1, y, star * 2.4, star * 2.4, [1, 0.8, 0.2], 0.6, 0, 0.5, 0.5, true);
        gfx.sprite(
          r.star,
          x1,
          y,
          star,
          star,
          fin ? [1, 0.82, 0.25] : [0.3, 0.33, 0.46],
          fin ? 1 : 0.8,
          fin ? local / 900 : 0,
        );
        if (racing) {
          // The glider riding the end of its fill.
          const size = Math.min(1.1, (s.rowH / 300) * 0.9);
          drawFlyer(
            gfx,
            atlas,
            { x: 0, y: 0, w: W * kpx, h: f.height * f.pixelRatio, s: kpx, camX: 0, top: 0 },
            s.x0 + (s.x1 - s.x0) * t.fill,
            s.mid - s.th * 0.6 - 60 * size,
            {
              color: v.rgb,
              alpha: out ? alpha * 0.5 : alpha,
              pose: out ? 2 : poseFor(fl.flapAge, 0),
              angle: out ? 2.6 : 0,
              size,
              rings: v.rings,
              glow: alpha > 0.8 ? 0.45 : 0.15,
            },
          );
        } else if (before && !joined.has(l.id)) {
          // Free before a race: an arrow points down at the lane.
          const size = Math.min(s.rowH * 0.7, 200) * kpx;
          const ax = ((s.x0 + s.x1) / 2) * kpx;
          const ay = (s.mid + bob * Math.min(1, s.rowH / 300)) * kpx;
          gfx.sprite(r.glow, ax, ay, size * 1.8, size * 1.8, v.rgb, 0.3, 0, 0.5, 0.5, true);
          gfx.sprite(r.arrow, ax, ay, size, size, v.rgb, 0.85, Math.PI / 2);
        }
      }
    }
  };

  const numerals = (now: number) => {
    const p = plan();
    const left = phase() === "countdown" ? Math.max(1, Math.ceil((p.start - now) / 1000)) : 0;
    countdown?.set(left > 0 ? String(left) : null, palette.foreground);
    const lobby = phase() === "lobby" && bankRace();
    const wait = Math.max(0, Math.ceil((p.next - now) / 1000));
    timer?.set(lobby ? String(wait) : null, palette.foreground, 0.95);
    lobbyLabel?.set(lobby ? "Next race" : null, palette.foreground, 0.85);
    const final = host.board.places;
    const results = over();
    let i = 0;
    for (const c of deps.columns) {
      for (const v of c.views) {
        const n = places[i++];
        if (!n) continue;
        const l = c.game.lanes.find((x) => x.slot === v.spec.slot);
        const known = l ? host.board.lanes.get(l.id) : undefined;
        const racing = l ? inRace(c.game, l) && l.flight.mode !== "waiting" : false;
        const place =
          !racing || !l
            ? null
            : (final?.get(l.id) ?? (known?.fin != null || results ? host.board.place(l.id) : null));
        // An attract lane's place is ambient: only the podium shows, faded.
        const attract = l?.ctrl === "attract";
        if (place !== null && (!attract || place <= 3))
          n.set(String(place), placeColor(place, palette.foreground), attract ? 0.55 : 1);
        else n.set(null, v.color);
      }
    }
  };

  return {
    resize,
    update,
    draw(alpha, local, dt) {
      drawPack(shown(alpha), local, dt);
      drawStrips(local);
    },
    numerals,
    reset() {
      cam = { x: -400, zoom: 1 };
    },
    dispose() {
      countdown?.dispose();
      timer?.dispose();
      lobbyLabel?.dispose();
      for (const n of places) n.dispose();
      places.length = 0;
      tracks.clear();
    },
  };
};
