import { type BotTouch, createBotHand } from "../../core/input";
import { commonBand } from "../../core/stations";
import type { AppContext, AppInstance, Pointer, Station, StationSet } from "../../core/types";
import { withAlpha } from "../../core/ui";
import { demoStations } from "./layout";
import { newPuck, PUCK_VENUE_PX, stepPuck } from "./shared";

/** A bot takes back a station that has sat idle this long. */
const BOT_RECLAIM_MS = 8000;
const BALL_VENUE_PX = 70;
const LOBBY_SECONDS = 3;
/** Spring rate (1/s) pulling a ball towards the finger steering it. */
const FOLLOW = 14;

interface Toy {
  station: Station;
  x: number;
  y: number;
  vx: number;
  vy: number;
  steer: { id: number; x: number; y: number } | null;
  idleSince: number;
  botTouch: BotTouch | null;
  phase: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * A hidden tool for trying the station flow: each playing station gets a ball to steer, and
 * when both stations of a pair or kiosk are playing they share a puck inside their common band.
 */
export const mount = (ctx: AppContext): AppInstance => {
  const palette = ctx.ui.palette;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  ctx.root.append(canvas);
  const g = canvas.getContext("2d");
  const hand = createBotHand(ctx.input);
  const rng = ctx.rng("stationdemo");
  let frame = ctx.frame;
  let set: StationSet | null = null;
  let toys: Toy[] = [];
  let lobbyEnd = 0;
  let disposed = false;
  // After a station ends (often a person taking over a bot), bots hold back for a while.
  let botsWaitUntil = 0;
  let grid: CanvasPattern | null = null;
  const puck = newPuck();
  let shared: { top: number; bottom: number } | null = null;

  const size = () => {
    canvas.width = Math.max(1, Math.round(frame.width * frame.pixelRatio));
    canvas.height = Math.max(1, Math.round(frame.height * frame.pixelRatio));
    const cell = Math.max(8, Math.round(90 * frame.unit));
    const tile = document.createElement("canvas");
    tile.width = cell;
    tile.height = cell;
    const tg = tile.getContext("2d");
    if (tg && g) {
      tg.fillStyle = withAlpha(palette.muted, 0.22);
      const dot = Math.max(1, 3 * frame.unit);
      tg.fillRect(cell / 2 - dot / 2, cell / 2 - dot / 2, dot, dot);
      grid = g.createPattern(tile, "repeat");
    }
  };

  const bandOf = (t: Toy) =>
    t.station.band ?? {
      top: t.station.rect.y,
      bottom: t.station.rect.y + t.station.rect.height,
    };

  const toyFor = (s: Station) => toys.find((t) => t.station === s);

  // The first Start opens a short lobby and everyone who joins it begins together. Each
  // player sees the countdown in their own band, never across a seam.
  const lobby = (s: Station) => {
    const now = performance.now();
    const b = s.band ?? { top: s.rect.y, bottom: s.rect.y + s.rect.height };
    const rect = { x: s.rect.x, y: b.top, width: s.rect.width, height: b.bottom - b.top };
    if (now >= lobbyEnd) {
      lobbyEnd = now + LOBBY_SECONDS * 1000;
      void ctx.ui.countdown(LOBBY_SECONDS, { rect, color: s.color }).then(() => {
        if (!disposed) set?.startReady();
      });
      return;
    }
    // Join in step with the lobby's digits: wait for the next whole second, then count the rest.
    const remaining = lobbyEnd - now;
    const whole = Math.floor(remaining / 1000 + 1e-3);
    if (whole < 1) return;
    window.setTimeout(
      () => {
        if (!disposed) void ctx.ui.countdown(whole, { rect, color: s.color });
      },
      Math.max(0, remaining - whole * 1000),
    );
  };

  const define = () => {
    set?.dispose();
    for (const t of toys) t.botTouch?.up();
    const wallCount = typeof ctx.options.count === "number" ? ctx.options.count : 6;
    set = ctx.stations.define(demoStations(frame, wallCount));
    toys = set.list.map((station) => ({
      station,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      steer: null,
      idleSince: -Infinity,
      botTouch: null,
      phase: rng.range(0, Math.PI * 2),
    }));
    set.on("ready", lobby);
    set.on("start", (s) => {
      const t = toyFor(s);
      if (!t) return;
      const b = bandOf(t);
      t.x = s.rect.x + s.rect.width / 2;
      t.y = (b.top + b.bottom) / 2;
      t.vx = 0;
      t.vy = 0;
    });
    set.on("end", (s) => {
      const t = toyFor(s);
      if (!t) return;
      t.botTouch?.up();
      t.botTouch = null;
      t.steer = null;
      botsWaitUntil = performance.now() + BOT_RECLAIM_MS;
    });
  };

  const steer = (p: Pointer) => {
    for (const t of toys) {
      const r = t.station.rect;
      const inside = p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
      if (t.station.state === "playing" && inside) t.steer = { id: p.id, x: p.x, y: p.y };
      else if (t.steer?.id === p.id) t.steer = null;
    }
  };
  const lift = (p: Pointer) => {
    for (const t of toys) if (t.steer?.id === p.id) t.steer = null;
  };
  const offs = [
    ctx.input.on("down", steer),
    ctx.input.on("move", steer),
    ctx.input.on("up", lift),
    ctx.input.on("cancel", lift),
  ];

  const driveBots = (dt: number, now: number) => {
    let bots = 0;
    for (const t of toys) {
      if (t.station.state !== "idle") t.idleSince = now;
      if (t.station.bot && t.station.state !== "idle") bots++;
    }
    const wanted = Math.min(ctx.bots, toys.length);
    // Bots fill stations from the right, leaving the left free for people.
    for (let i = toys.length - 1; i >= 0 && bots < wanted && now >= botsWaitUntil; i--) {
      const t = toys[i];
      if (t && t.station.state === "idle" && now - t.idleSince > BOT_RECLAIM_MS) {
        t.station.claimForBot();
        bots++;
      }
    }
    for (const t of toys) {
      const s = t.station;
      if (!s.bot || s.state !== "playing") {
        if (t.botTouch) {
          t.botTouch.up();
          t.botTouch = null;
        }
        continue;
      }
      t.phase += dt;
      const b = bandOf(t);
      const x = s.rect.x + s.rect.width * (0.5 + 0.32 * Math.sin(t.phase * 0.9));
      const y = (b.top + b.bottom) / 2 + (b.bottom - b.top) * 0.3 * Math.sin(t.phase * 1.37 + 1);
      if (t.botTouch?.active) t.botTouch.move(x, y);
      else t.botTouch = hand.press(x, y);
    }
  };

  const step = (t: Toy, dt: number) => {
    const s = t.station;
    const b = bandOf(t);
    const rad = BALL_VENUE_PX * frame.unit;
    const minX = s.rect.x + rad;
    const maxX = s.rect.x + s.rect.width - rad;
    const minY = b.top + rad;
    const maxY = Math.max(minY, b.bottom - rad);
    if (t.steer) {
      const tx = clamp(t.steer.x, minX, maxX);
      const ty = clamp(t.steer.y, minY, maxY);
      t.vx += (FOLLOW * FOLLOW * (tx - t.x) - 2 * FOLLOW * t.vx) * dt;
      t.vy += (FOLLOW * FOLLOW * (ty - t.y) - 2 * FOLLOW * t.vy) * dt;
    } else {
      const drag = Math.exp(-0.8 * dt);
      t.vx *= drag;
      t.vy *= drag;
    }
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    if (t.x < minX || t.x > maxX) {
      t.x = clamp(t.x, minX, maxX);
      t.vx *= -0.8;
    }
    if (t.y < minY || t.y > maxY) {
      t.y = clamp(t.y, minY, maxY);
      t.vy *= -0.8;
    }
  };

  // Two stations share a toy only when both are playing.
  const stepShared = (dt: number) => {
    const both = toys.length === 2 && toys.every((t) => t.station.state === "playing");
    shared = both ? commonBand(toys.map((t) => t.station)) : null;
    if (!shared) {
      puck.live = false;
      return;
    }
    const r = BALL_VENUE_PX * frame.unit;
    const paddles = toys.map((t) => ({ x: t.x, y: t.y, vx: t.vx, vy: t.vy, r }));
    stepPuck(puck, shared, frame.width, frame.unit, paddles, dt, () => rng.next());
  };

  const drawShared = (u: number) => {
    if (!g || !shared || !puck.live) return;
    g.fillStyle = withAlpha(palette.foreground, 0.04);
    g.fillRect(0, shared.top, frame.width, shared.bottom - shared.top);
    g.strokeStyle = withAlpha(palette.foreground, 0.3);
    g.lineWidth = Math.max(1, 3 * u);
    g.setLineDash([10 * u, 14 * u]);
    g.beginPath();
    g.moveTo(0, shared.top);
    g.lineTo(frame.width, shared.top);
    g.moveTo(0, shared.bottom);
    g.lineTo(frame.width, shared.bottom);
    g.stroke();
    g.setLineDash([]);
    const r = PUCK_VENUE_PX * u;
    const halo = g.createRadialGradient(puck.x, puck.y, r * 0.5, puck.x, puck.y, r * 2.4);
    halo.addColorStop(0, withAlpha(palette.foreground, 0.4));
    halo.addColorStop(1, withAlpha(palette.foreground, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(puck.x, puck.y, r * 2.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = palette.foreground;
    g.beginPath();
    g.arc(puck.x, puck.y, r, 0, Math.PI * 2);
    g.fill();
  };

  const draw = () => {
    if (!g) return;
    const pr = frame.pixelRatio;
    const u = frame.unit;
    g.setTransform(pr, 0, 0, pr, 0, 0);
    g.fillStyle = palette.background;
    g.fillRect(0, 0, frame.width, frame.height);
    if (grid) {
      g.fillStyle = grid;
      g.fillRect(0, 0, frame.width, frame.height);
    }
    for (const seam of frame.seams) {
      g.fillStyle = withAlpha(palette.muted, 0.06);
      g.fillRect(seam - frame.width * 0.1, 0, frame.width * 0.2, frame.height);
      g.fillStyle = withAlpha(palette.muted, 0.3);
      g.fillRect(seam - u, 0, 2 * u, frame.height);
    }
    for (const t of toys) {
      const s = t.station;
      if (s.state !== "playing") continue;
      const b = bandOf(t);
      g.fillStyle = withAlpha(s.color, 0.07);
      g.fillRect(s.rect.x, b.top, s.rect.width, b.bottom - b.top);
      g.strokeStyle = withAlpha(s.color, 0.35);
      g.lineWidth = Math.max(1, 3 * u);
      g.setLineDash([24 * u, 18 * u]);
      g.beginPath();
      g.moveTo(s.rect.x, b.top);
      g.lineTo(s.rect.x + s.rect.width, b.top);
      g.moveTo(s.rect.x, b.bottom);
      g.lineTo(s.rect.x + s.rect.width, b.bottom);
      g.stroke();
      g.setLineDash([]);
      if (t.steer) {
        g.strokeStyle = withAlpha(s.color, 0.4);
        g.beginPath();
        g.moveTo(t.x, t.y);
        g.lineTo(t.steer.x, t.steer.y);
        g.stroke();
      }
      const rad = BALL_VENUE_PX * u;
      const halo = g.createRadialGradient(t.x, t.y, rad * 0.5, t.x, t.y, rad * 2.6);
      halo.addColorStop(0, withAlpha(s.color, 0.45));
      halo.addColorStop(1, withAlpha(s.color, 0));
      g.fillStyle = halo;
      g.beginPath();
      g.arc(t.x, t.y, rad * 2.6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(t.x, t.y, rad, 0, Math.PI * 2);
      g.fill();
    }
    drawShared(u);
  };

  size();
  define();
  const offResize = ctx.onResize((f) => {
    frame = f;
    size();
    define();
  });

  const loop = ctx.loop({
    hz: 60,
    update(dt) {
      driveBots(dt, performance.now());
      for (const t of toys) if (t.station.state === "playing") step(t, dt);
      stepShared(dt);
    },
    render: draw,
  });
  loop.start();

  return {
    reset() {
      hand.release();
      for (const t of toys) {
        t.station.end();
        t.botTouch = null;
        t.steer = null;
        t.idleSince = -Infinity;
      }
      botsWaitUntil = 0;
    },
    status() {
      return {
        playing: toys.filter((t) => t.station.state === "playing").length,
        bots: toys.filter((t) => t.station.bot).length,
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      for (const off of offs) off();
      hand.dispose();
      set?.dispose();
      canvas.remove();
    },
  };
};
