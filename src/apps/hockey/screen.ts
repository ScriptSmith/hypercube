/**
 * The screen above a bank. It never plays a game of its own.
 *
 * - Hockey and paddles: a spectator view. Each touch frame streams a small view of its table;
 *   the screen shows a live mini-table directly above that frame (the screen spans the bank
 *   exactly, so `bankFraction` places it), with its score, time left and highlights: a beam
 *   of light for a goal, a counter for a long rally, a star for the winner. Positions are
 *   drawn a little in the past and interpolated between views, so motion is smooth although
 *   views arrive only about 12 times a second.
 * - Defence: the deck. The upper part of every frame's rink, with the team targets. Pucks come
 *   up from the frames below, strike targets and splitters, and drop back down. Its wave count
 *   goes back to the frames.
 */
import { venueSize } from "../../core/frame";
import { bankFraction, fromBankFraction } from "../../core/layout";
import type { AppContext, AppInstance, FrameInfo, FrameKind, Palette } from "../../core/types";
import { withAlpha } from "../../core/ui";
import type { GameConfig } from "./config";
import { apply, deckLayout, type Layout } from "./layout";
import {
  BOARD,
  clamp,
  digits,
  drawLaneBoard,
  ease,
  glow,
  hueOf,
  type Ink,
  inLane,
  malletBody,
  puckBody,
  rounded,
  splitterBody,
  star,
  targetBody,
  venue,
} from "./paint";
import { createParticles } from "./particles";
import { createSprites } from "./sprites";
import { createTable, SPLITTER_ID, type Table } from "./table";
import {
  decodeHandoff,
  decodeView,
  encodeHandoff,
  TOPIC_DECK,
  TOPIC_DOWN,
  TOPIC_UP,
  TOPIC_VIEW,
  type View,
} from "./view";
import { litMs, resetWaves, type Target } from "./waves";

/** Views are drawn this far in the past, so there is always a newer one to move towards. */
const DELAY_MS = 120;
/** A frame not heard from for this long is shown as absent. */
const STALE_MS = 3000;
/** A rally this long gets a counter above its table. */
const RALLY_SHOW = 8;
/** The longest rally on the bank, this long or more, gets the spotlight at the top. */
const RALLY_SPOT = 12;
/** The deck forgets its waves once no frame has played for this long. */
const DECK_IDLE_MS = 20_000;
const DECK_HZ = 120;
/** Pucks the deck receives appear this long after they leave a frame. */
const RISE_MS = 120;
const MAX_COLUMNS = 64;

interface Column {
  prev: View | null;
  cur: View | null;
  prevAt: number;
  curAt: number;
  /** Local ms of each side's last goal, for the beam and the pop. */
  goalAt: [number, number];
  /** Longest rally seen in the current match. */
  best: number;
}

const KINDS: readonly string[] = ["panel", "pair", "wall", "screen", "kiosk", "sphere"];

const kindAspect = (kind: string) => {
  const v = venueSize(KINDS.includes(kind) ? (kind as FrameKind) : "panel");
  return v.width / v.height;
};

export const mountScreen = (ctx: AppContext, cfg: GameConfig): AppInstance => {
  const palette: Palette = ctx.ui.palette;
  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};`;
    ctx.root.append(c);
    return c;
  };
  const boardCanvas = make(0);
  const playCanvas = make(1);
  const boardCtx = boardCanvas.getContext("2d");
  const g = playCanvas.getContext("2d");
  const sprites = createSprites();
  const fx = ctx.rng("hockey:screen:fx");
  const particles = createParticles(() => fx.next());
  particles.colors = [hueOf(palette, 0), hueOf(palette, 1), palette.foreground, palette.accent];
  const columns = new Map<number, Column>();
  const deckMode = cfg.variant === "defence";
  let frame: FrameInfo = ctx.frame;
  let k = 1;
  let clock = 0;
  let count = Math.max(1, ctx.setup.count);
  let deck: { layout: Layout; table: Table } | null = null;
  let lastPlaying = -Infinity;
  let lastBeat = -Infinity;
  const ink = (): Ink | null => (g ? { g, k, sprites, palette } : null);
  const size = () => ({ w: frame.width / frame.unit, h: frame.height / frame.unit });

  const buildDeck = () => {
    if (!deckMode) return;
    const { w, h } = size();
    const layout = deckLayout({ width: w, height: h, count, speed: cfg.speed });
    const table = createTable(layout.tables[0]!, cfg, ctx.rng("hockey:deck"), { rules: "deck" });
    const now = ctx.clock.now();
    // The deck is always in play; it has no rounds of its own.
    table.countdown(now, "deck", now);
    table.play(now);
    table.on((e) => {
      if (e.type === "exit") dropDown(e.puck.y, e.puck.vx, e.puck.vy, e.slot);
      else if (e.type === "bump" || e.type === "split") {
        const at = apply(table.spec.lanes[0]!.toVenue, e.x, e.y);
        particles.burst(at.x, at.y, 12, e.type === "bump" ? 3 : 2, 900, 40);
      } else if (e.type === "wave") {
        const spot = table.spec.scores[0];
        if (spot) particles.confetti(spot.x, spot.y, 60, 3, spot.size * 2, spot.size * 0.08);
      }
    });
    deck = { layout, table };
  };

  const drawBoard = () => {
    if (!boardCtx) return;
    boardCtx.setTransform(1, 0, 0, 1, 0, 0);
    boardCtx.fillStyle = palette.background;
    boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);
    boardCtx.setTransform(k, 0, 0, k, 0, 0);
    const { w, h } = size();
    if (deck) {
      const lane = deck.table.spec.lanes[0]!;
      drawLaneBoard(boardCtx, k, lane, palette, () => palette.accent);
      return;
    }
    // Faint guides between the columns, one column over each frame below.
    const grad = boardCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, withAlpha("#0a1224", 0));
    grad.addColorStop(1, withAlpha("#0a1224", 0.8));
    boardCtx.fillStyle = grad;
    boardCtx.fillRect(0, 0, w, h);
    boardCtx.strokeStyle = withAlpha(palette.muted, 0.12);
    boardCtx.lineWidth = 4;
    for (let i = 1; i < count; i++) {
      const x = bankFraction(i, 0, count) * w;
      boardCtx.beginPath();
      boardCtx.moveTo(x, h * 0.08);
      boardCtx.lineTo(x, h);
      boardCtx.stroke();
    }
  };

  const resize = (f: FrameInfo) => {
    frame = f;
    k = f.unit * f.pixelRatio;
    for (const c of [boardCanvas, playCanvas]) {
      c.width = Math.max(1, Math.round(f.width * f.pixelRatio));
      c.height = Math.max(1, Math.round(f.height * f.pixelRatio));
    }
    sprites.clear();
    particles.clear();
    buildDeck();
    drawBoard();
  };

  // ---- Network -----------------------------------------------------------------------------

  const frameAt = (pos: number) =>
    ctx.net.peers().find((p) => p.role !== "screen" && p.pos === pos)?.frame ?? null;

  /** Deck: a puck leaving through the bottom drops into the frame below it. */
  const dropDown = (laneY: number, vx: number, vy: number, slot: number) => {
    if (!deck) return;
    const lane = deck.table.lanes[0]!;
    const params = lane.spec.params;
    const { w } = size();
    const f = (laneY + apply(lane.spec.toVenue, 0, 0).x) / w;
    const { pos, u } = fromBankFraction(f, count);
    const to = frameAt(slot) ?? frameAt(pos);
    const h = {
      pos: slot,
      u: slot === pos ? u : 0.5,
      vx: Math.abs(vx) / params.maxPuck,
      vy: vy / params.maxPuck,
    };
    if (to) {
      ctx.net.send(TOPIC_DOWN, encodeHandoff(h), to);
      return;
    }
    // Nobody below any more: back up it goes.
    const now = ctx.clock.now();
    deck.table.arrive(lane, {
      id: -1,
      end: 0,
      y: laneY,
      vx: Math.abs(vx),
      vy,
      spin: 0,
      sent: now,
      at: now,
    });
  };

  const offs = [
    ctx.net.on(TOPIC_VIEW, (data) => {
      const v = decodeView(data);
      if (!v) return;
      if (v.count !== count && v.count <= MAX_COLUMNS) {
        count = v.count;
        buildDeck();
        drawBoard();
      }
      let col = columns.get(v.pos);
      if (!col) {
        if (columns.size >= MAX_COLUMNS) return;
        col = {
          prev: null,
          cur: null,
          prevAt: 0,
          curAt: 0,
          goalAt: [-Infinity, -Infinity],
          best: 0,
        };
        columns.set(v.pos, col);
      }
      const local = performance.now();
      const old = col.cur;
      if (old) {
        for (const s of [0, 1] as const) {
          if (v.score[s] > old.score[s] && v.phase === "play") col.goalAt[s] = local;
        }
        if (old.phase !== "play" && v.phase === "play") col.best = 0;
      }
      col.best = Math.max(col.best, v.rally);
      col.prev = old;
      col.prevAt = col.curAt;
      col.cur = v;
      col.curAt = local;
    }),
    ctx.net.on(TOPIC_UP, (data) => {
      const h = decodeHandoff(data);
      if (!h || !deck || h.pos >= count) return;
      const lane = deck.table.lanes[0]!;
      const params = lane.spec.params;
      const { w } = size();
      const x0 = apply(lane.spec.toVenue, 0, 0).x;
      const y = bankFraction(h.pos, h.u, count) * w - x0;
      const now = ctx.clock.now();
      const ok = deck.table.arrive(lane, {
        id: -1,
        end: 0,
        y: clamp(y, params.puckR, params.width - params.puckR),
        vx: Math.max(0.15, h.vx) * params.maxPuck,
        vy: h.vy * params.maxPuck,
        spin: 0,
        sent: now,
        at: now + RISE_MS,
      });
      // A full deck sends the puck straight back.
      const to = frameAt(h.pos);
      if (!ok && to) ctx.net.send(TOPIC_DOWN, encodeHandoff(h), to);
    }),
  ];

  // ---- Spectator drawing -------------------------------------------------------------------

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  /** The mini frame for a column: the frame's shape, at the bottom of the column. */
  const miniRect = (pos: number, kind: string) => {
    const { w, h } = size();
    const x0 = bankFraction(pos, 0, count) * w;
    const x1 = bankFraction(pos, 1, count) * w;
    const colW = x1 - x0;
    const aspect = kindAspect(kind);
    let mw = colW * 0.86;
    let mh = mw / aspect;
    if (mh > h * 0.34) {
      mh = h * 0.34;
      mw = mh * aspect;
    }
    const margin = Math.min(colW * 0.07, h * 0.03);
    return { x: x0 + (colW - mw) / 2, y: h - margin - mh, width: mw, height: mh, colX: x0, colW };
  };

  const drawColumn = (ik: Ink, pos: number, col: Column | undefined, local: number) => {
    const { g: c } = ik;
    const v = col?.cur ?? null;
    const kind = v?.kind ?? (frame.kind === "screen" ? "panel" : frame.kind);
    const r = miniRect(pos, kind);
    const live = v !== null && local - (col?.curAt ?? 0) < STALE_MS;
    const playing = live && (v.phase === "play" || v.phase === "countdown" || v.phase === "over");
    const dim = !live ? 0.25 : playing ? 1 : 0.55;
    // The mini frame and its lanes.
    c.globalAlpha = 1;
    c.strokeStyle = withAlpha(palette.muted, 0.25 * dim + 0.1);
    c.lineWidth = Math.max(2, r.width * 0.008);
    rounded(c, r.x, r.y, r.width, r.height, r.width * 0.03);
    c.stroke();
    if (!v || !live) {
      drawCue(ik, r.x + r.width / 2, r.y - r.colW * 0.25, r.colW * 0.08, palette.muted, 0.5);
      return;
    }
    // Interpolate between the two latest views.
    const t =
      col?.prev && col.curAt > col.prevAt
        ? clamp((local - DELAY_MS - col.prevAt) / (col.curAt - col.prevAt), 0, 1)
        : 1;
    const prev = col?.prev ?? v;
    const X = (fxv: number) => r.x + fxv * r.width;
    const Y = (fyv: number) => r.y + fyv * r.height;
    v.lanes.forEach((lane, li) => {
      const [lx, ly, lw, lh] = lane.rect;
      const surface = c.createLinearGradient(0, Y(ly), 0, Y(ly + lh));
      surface.addColorStop(0, BOARD.surfaceEdge);
      surface.addColorStop(0.5, BOARD.surface);
      surface.addColorStop(1, BOARD.surfaceEdge);
      c.globalAlpha = dim;
      c.fillStyle = surface;
      rounded(
        c,
        X(lx),
        Y(ly),
        lw * r.width,
        lh * r.height,
        Math.min(lw * r.width, lh * r.height) * 0.12,
      );
      c.fill();
      c.strokeStyle = BOARD.rim;
      c.lineWidth = Math.max(2, r.width * 0.012);
      c.stroke();
      // Goals: a bright bar on the edge nearest each goal centre.
      for (const [gx, gy, gh] of lane.goals) {
        const color = hueOf(palette, gh);
        const vertical =
          Math.min(Math.abs(gx - lx), Math.abs(gx - lx - lw)) <
          Math.min(Math.abs(gy - ly), Math.abs(gy - ly - lh));
        const len = (vertical ? lh * r.height : lw * r.width) * 0.18;
        c.strokeStyle = color;
        c.lineWidth = Math.max(3, r.width * 0.02);
        c.lineCap = "round";
        c.beginPath();
        if (vertical) {
          c.moveTo(X(gx), Y(gy) - len);
          c.lineTo(X(gx), Y(gy) + len);
        } else {
          c.moveTo(X(gx) - len, Y(gy));
          c.lineTo(X(gx) + len, Y(gy));
        }
        c.stroke();
      }
      const before = prev.lanes[li];
      lane.mallets.forEach(([mx, my, hue, person], i) => {
        const b = before?.mallets[i];
        const x = b ? lerp(b[0], mx, t) : mx;
        const y = b ? lerp(b[1], my, t) : my;
        malletBody(
          ik,
          X(x),
          Y(y),
          Math.max(4, lane.malletR * r.width),
          hueOf(palette, hue),
          (person ? 1 : 0.8) * dim,
        );
      });
      const n = before?.pucks.length === lane.pucks.length ? lane.pucks.length : 0;
      lane.pucks.forEach(([px, py], i) => {
        const b = i < n ? before!.pucks[i] : undefined;
        const x = b ? lerp(b[0], px, t) : px;
        const y = b ? lerp(b[1], py, t) : py;
        puckBody(ik, X(x), Y(y), Math.max(3, lane.puckR * r.width), 0, dim);
      });
    });
    drawHighlights(ik, col!, v, r, local);
  };

  /** "Play here": chevrons pointing down at the frame below. */
  const drawCue = (ik: Ink, cx: number, cy: number, s: number, color: string, a: number) => {
    const { g: c } = ik;
    c.lineWidth = s * 0.3;
    c.lineCap = "round";
    c.lineJoin = "round";
    for (let i = 0; i < 3; i++) {
      const phase = (clock * 0.9 - i * 0.22) % 1;
      c.globalAlpha = 1;
      c.strokeStyle = withAlpha(color, Math.max(0, Math.sin(phase * Math.PI)) * a);
      const y = cy + i * s * 1.1;
      c.beginPath();
      c.moveTo(cx - s, y - s * 0.5);
      c.lineTo(cx, y + s * 0.5);
      c.lineTo(cx + s, y - s * 0.5);
      c.stroke();
    }
  };

  const drawHighlights = (
    ik: Ink,
    col: Column,
    v: View,
    r: ReturnType<typeof miniRect>,
    local: number,
  ) => {
    const { g: c } = ik;
    const { h } = size();
    const sizeD = Math.min(r.colW * 0.38, h * 0.1);
    const cx = r.colX + r.colW / 2;
    const scoreY = r.y - sizeD * 0.85;
    if (v.phase === "attract") {
      drawCue(ik, cx, r.y - r.colW * 0.25, r.colW * 0.08, palette.foreground, 0.45);
      return;
    }
    // A beam of the scorer's colour rising from the table after a goal.
    for (const s of [0, 1] as const) {
      const t = (local - col.goalAt[s]) / 1400;
      if (t < 0 || t >= 1) continue;
      const color = hueOf(palette, s);
      const grad = c.createLinearGradient(0, r.y, 0, 0);
      grad.addColorStop(0, withAlpha(color, 0.5 * (1 - t)));
      grad.addColorStop(1, withAlpha(color, 0));
      c.globalAlpha = 1;
      c.fillStyle = grad;
      const bw = r.colW * (0.3 + 0.5 * ease(t));
      c.fillRect(cx - bw / 2, 0, bw, r.y);
      if (t < 0.05) particles.burst(cx, r.y, 20, s, 1400, sizeD * 0.12);
    }
    // Scores, side 0 left, side 1 right, as on the table below.
    for (const s of [0, 1] as const) {
      const t = (local - col.goalAt[s]) / 450;
      const bump = t >= 0 && t < 1 ? 1 + 0.35 * (1 - ease(t)) : 1;
      const x = cx + (s === 0 ? -1 : 1) * r.colW * 0.22;
      const color = hueOf(palette, s);
      if (v.phase === "over" && (v.winner === s || v.winner === -1)) {
        const rr = sizeD * 0.85 * (1 + 0.05 * Math.sin(clock * 5));
        c.globalCompositeOperation = "lighter";
        glow(ik, color, x, scoreY, rr * 2.2, 0.6);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.fillStyle = withAlpha(color, 0.3);
        star(c, x, scoreY, rr);
        c.fill();
        if (fx.next() < 0.3)
          particles.confetti(x, scoreY - sizeD * 0.4, 1, s, sizeD * 1.2, sizeD * 0.06);
      }
      digits(ik, String(v.score[s]), color, x, scoreY, sizeD, 1, false, bump);
    }
    // Time left as a bar under the scores.
    if (v.phase === "play") {
      const total = cfg.matchMs / 1000;
      const f = clamp(v.left / total, 0, 1);
      const bw = r.colW * 0.5;
      const by = scoreY + sizeD * 0.7;
      c.globalAlpha = 1;
      c.fillStyle = withAlpha(palette.muted, 0.2);
      rounded(c, cx - bw / 2, by, bw, sizeD * 0.08, sizeD * 0.04);
      c.fill();
      c.fillStyle = withAlpha(v.left < 20 ? palette.accent : palette.foreground, 0.6);
      rounded(c, cx - (bw * f) / 2, by, bw * f, sizeD * 0.08, sizeD * 0.04);
      c.fill();
    }
    // A long rally: its count, glowing brighter the longer it runs.
    if (v.phase === "play" && v.rally >= RALLY_SHOW) {
      const heat = clamp((v.rally - RALLY_SHOW) / 14, 0, 1);
      const ry = scoreY - sizeD * (1.5 + 0.2 * heat);
      const rs = sizeD * (0.6 + 0.35 * heat) * (1 + 0.04 * Math.sin(clock * 8));
      c.globalCompositeOperation = "lighter";
      glow(ik, palette.accent, cx, ry, rs * 1.6, 0.25 + 0.4 * heat);
      c.globalCompositeOperation = "source-over";
      digits(ik, String(v.rally), palette.accent, cx, ry, rs, 0.95);
    }
  };

  /** The bank's longest rally right now: its count high up, and a spotlight down onto it. */
  const drawSpotlight = (ik: Ink, local: number) => {
    let best: { pos: number; rally: number } | null = null;
    for (const [pos, col] of columns) {
      const v = col.cur;
      if (!v || v.phase !== "play" || local - col.curAt > STALE_MS || v.rally < RALLY_SPOT)
        continue;
      if (!best || v.rally > best.rally) best = { pos, rally: v.rally };
    }
    if (!best) return;
    const { g: c } = ik;
    const { w, h } = size();
    const r = miniRect(best.pos, columns.get(best.pos)?.cur?.kind ?? "panel");
    const cx = r.colX + r.colW / 2;
    const top = { x: w / 2, y: h * 0.12 };
    const s = Math.min(h * 0.14, w * 0.12) * (1 + 0.03 * Math.sin(clock * 6));
    // A soft wedge of light from the counter down to the table holding the rally.
    const grad = c.createLinearGradient(0, top.y, 0, r.y);
    grad.addColorStop(0, withAlpha(palette.accent, 0.22));
    grad.addColorStop(1, withAlpha(palette.accent, 0.04));
    c.globalAlpha = 1;
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(top.x - s * 0.3, top.y);
    c.lineTo(top.x + s * 0.3, top.y);
    c.lineTo(cx + r.colW * 0.45, r.y);
    c.lineTo(cx - r.colW * 0.45, r.y);
    c.closePath();
    c.fill();
    c.globalCompositeOperation = "lighter";
    glow(ik, palette.accent, top.x, top.y, s * 1.6, 0.5);
    c.globalCompositeOperation = "source-over";
    digits(ik, String(best.rally), palette.accent, top.x, top.y, s, 1);
  };

  // ---- Deck drawing ------------------------------------------------------------------------

  const drawDeck = (ik: Ink, alpha: number, now: number) => {
    if (!deck) return;
    const { g: c } = ik;
    const table = deck.table;
    const lane = table.lanes[0]!;
    const p = lane.spec.params;
    const rim = clamp(p.width * 0.014, 6, 14);
    inLane(ik, lane.spec.toVenue);
    // Closed openings: nobody is playing in the frame below.
    for (const m of p.mouths[0]) {
      if (m.open) {
        c.globalCompositeOperation = "lighter";
        glow(
          ik,
          palette.accent,
          0,
          (m.y0 + m.y1) / 2,
          (m.y1 - m.y0) * 0.4,
          0.25 + 0.08 * Math.sin(clock * 2),
        );
        c.globalCompositeOperation = "source-over";
        continue;
      }
      c.globalAlpha = 1;
      c.strokeStyle = withAlpha(palette.muted, 0.45);
      c.lineWidth = rim * 1.6;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(rim, m.y0 + rim * 2);
      c.lineTo(rim, m.y1 - rim * 2);
      c.stroke();
    }
    const span =
      table.waves && table.spec.defence
        ? litMs(table.waves.cleared, table.spec.defence, table.waves.pace)
        : 1;
    for (const o of lane.obstacles) {
      if (o.id >= SPLITTER_ID) splitterBody(ik, o.x, o.y, o.r, clock);
      else targetBody(ik, o.x, o.y, o.r, clamp(((o as Target).litUntil - now) / span, 0, 1), clock);
    }
    for (const a of lane.arrivals) {
      c.globalCompositeOperation = "lighter";
      glow(ik, palette.accent, 0, a.y, p.puckR * 3, 0.5);
      c.globalCompositeOperation = "source-over";
    }
    for (const q of lane.pucks) {
      if (!q.live) continue;
      puckBody(ik, q.px + (q.x - q.px) * alpha, q.py + (q.y - q.py) * alpha, p.puckR, q.angle);
    }
    // The team's waves so far.
    venue(ik);
    const spot = table.spec.scores[0];
    if (spot) {
      const t = (now - (table.waves?.clearedAt ?? -Infinity)) / 600;
      const bump = t >= 0 && t < 1 ? 1 + 0.4 * (1 - ease(t)) : 1;
      digits(
        ik,
        String(table.waves?.cleared ?? 0),
        palette.accent,
        spot.x,
        spot.y,
        spot.size,
        1,
        false,
        bump,
      );
    }
  };

  const drawParticles = (ik: Ink) => {
    const { g: c } = ik;
    venue(ik);
    particles.each((x, y, s, a, ci, flat) => {
      const color = particles.colors[ci] ?? palette.foreground;
      if (flat) {
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = a;
        c.fillStyle = color;
        c.fillRect(x - s / 2, y - s * 0.3, s, s * 0.6);
      } else {
        c.globalCompositeOperation = "lighter";
        glow(ik, color, x, y, s, a);
      }
    });
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
  };

  resize(ctx.frame);
  const offResize = ctx.onResize(resize);

  let lastDraw = performance.now();
  const loop = ctx.loop({
    hz: deckMode ? DECK_HZ : 30,
    update(dt) {
      const now = ctx.clock.now();
      const local = performance.now();
      if (!deck) return;
      // Openings lead down only into frames that are playing a round.
      const open = new Set<number>();
      for (const [pos, col] of columns) {
        if (col.cur?.phase === "play" && local - col.curAt < STALE_MS) open.add(pos);
      }
      deck.table.setOpen(open);
      if (open.size > 0) lastPlaying = local;
      else if (local - lastPlaying > DECK_IDLE_MS && deck.table.waves?.cleared) {
        resetWaves(deck.table.waves, now);
      }
      deck.table.step(dt, now);
      if (local - lastBeat > 500) {
        lastBeat = local;
        ctx.net.send(TOPIC_DECK, { w: deck.table.waves?.cleared ?? 0 });
      }
    },
    render(alpha) {
      const ik = ink();
      if (!ik) return;
      const local = performance.now();
      const dt = Math.min(0.1, (local - lastDraw) / 1000);
      lastDraw = local;
      clock += dt;
      particles.step(dt);
      ik.g.setTransform(1, 0, 0, 1, 0, 0);
      ik.g.globalAlpha = 1;
      ik.g.globalCompositeOperation = "source-over";
      ik.g.clearRect(0, 0, playCanvas.width, playCanvas.height);
      if (deck) drawDeck(ik, alpha, ctx.clock.now());
      else {
        venue(ik);
        drawSpotlight(ik, local);
        for (let pos = 0; pos < count; pos++) drawColumn(ik, pos, columns.get(pos), local);
      }
      drawParticles(ik);
    },
  });
  loop.start();

  return {
    reset() {
      // The screen follows the frames; it has nothing of its own to reset.
    },
    status() {
      let playing = 0;
      for (const col of columns.values()) if (col.cur?.phase === "play") playing++;
      const out: Record<string, string | number> = { role: deck ? "deck" : "spectator", playing };
      if (deck) out.waves = deck.table.waves?.cleared ?? 0;
      else out.frames = columns.size;
      return out;
    },
    dispose() {
      loop.stop();
      offResize();
      for (const off of offs) off();
      columns.clear();
      sprites.clear();
      particles.clear();
      boardCanvas.remove();
      playCanvas.remove();
    },
  };
};
