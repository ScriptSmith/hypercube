/**
 * The screen above a bank. It builds the bank's chain of puzzles itself, hangs a big crystal on
 * each frame's beam, and traces the light the frames send up through their top edges. A frame it
 * hasn't heard from for two seconds shows its intended beam faintly instead, so the screen is
 * never dark. When every crystal glows from real light it plays a finale and tells the bank.
 */
import type { AppContext, AppInstance, FrameInfo, OptionValue, PeerInfo } from "../../core/types";
import { bankBench, bankChain, bankRamp } from "./chain";
import { BEAM_EXPIRE_MS, type Config, FINALE_MS, ROUND_SETTLE_MS } from "./config";
import { drawBeams, drawCrystal, drawPiece, drawProgress } from "./draw";
import { startIndex } from "./puzzle";
import { type Rounds, createRounds } from "./rounds";
import { type SkyScene, buildSky, screenScale, skySceneOf } from "./sky";
import { type Glow, type Source, type TraceResult, glowOf, trace } from "./trace";
import { TOPIC, type SkyBeam, decodeSky } from "./wire";

const sideOf = (p: PeerInfo) => p.side ?? 0;
const MAX_STARS = 220;

export const mountScreen = (ctx: AppContext, cfg: Config): AppInstance => {
  let frame: FrameInfo = ctx.frame;
  const W = frame.venueWidth;
  const H = frame.venueHeight;
  const count = Math.max(1, ctx.setup.count);
  const ramp = bankRamp(cfg.colour);
  const start = Math.min(ramp.length - 1, startIndex(cfg.start));
  const now = () => performance.now();
  let disposed = false;

  const make = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;z-index:${z};`;
    ctx.root.append(c);
    return c;
  };
  const bgC = make(0);
  const beamC = make(1);
  const fgC = make(2);
  const bg = bgC.getContext("2d")!;
  const beams = beamC.getContext("2d")!;
  const fg = fgC.getContext("2d")!;
  let scale = 1;
  const resize = (f: FrameInfo) => {
    frame = f;
    scale = f.unit * f.pixelRatio;
    for (const c of [bgC, beamC, fgC]) {
      c.style.width = `${f.width}px`;
      c.style.height = `${f.height}px`;
      c.width = Math.max(1, Math.round(f.width * f.pixelRatio));
      c.height = Math.max(1, Math.round(f.height * f.pixelRatio));
    }
    bgDirty = true;
    beamDirty = true;
  };

  // ---- The bank's touch frames, and the sky built from their puzzles --------------------------

  const touchKind = () => {
    const p = ctx.net.peers().find((x) => x.role !== "screen" && sideOf(x) === ctx.setup.side);
    return p?.kind === "pair"
      ? { kind: "pair" as const, span: Math.max(2, p.span ?? 2) }
      : { kind: "panel" as const, span: 1 };
  };
  let kindKey = "";
  let sky: SkyScene = { W, H, crystals: [], owners: [], mirrors: [], intended: [] };
  let round = { serial: 0, level: start };
  let arrived = now();

  const rebuild = () => {
    const tk = touchKind();
    kindKey = `${tk.kind}:${tk.span}`;
    const bench = bankBench(tk.kind, tk.span);
    const chain = bankChain(
      {
        seed: ctx.seed,
        bench,
        serial: round.serial,
        level: ramp[round.level] ?? "m1",
        colour: cfg.colour,
        count,
      },
      count - 1,
    );
    sky = buildSky(
      chain,
      bench.box.width,
      count,
      { width: W, height: H },
      `optics:${ctx.seed}:sky:${round.serial}:${round.level}`,
    );
    shown = sky.crystals.map(() => 0);
    glows = sky.crystals.map(() => 0 as Glow);
    arrived = now();
    heard.clear();
    bgDirty = true;
    retraceDue = true;
  };

  // ---- Light from the frames ------------------------------------------------------------------

  const heard = new Map<number, { beams: SkyBeam[]; at: number }>();
  const offSky = ctx.net.on(TOPIC.sky, (data, from) => {
    const p = ctx.net.peers().find((x) => x.frame === from);
    if (!p || p.role === "screen" || sideOf(p) !== ctx.setup.side) return;
    const m = decodeSky(data);
    // Light from a frame still on the last round would light this round's crystals.
    if (!m || m.pos !== p.pos || m.pos >= count || m.serial !== round.serial) return;
    const prev = heard.get(m.pos);
    const changed = !prev || JSON.stringify(prev.beams) !== JSON.stringify(m.beams);
    heard.set(m.pos, { beams: m.beams, at: now() });
    if (changed) retraceDue = true;
  });

  let result: TraceResult = {
    segs: [],
    real: [],
    guide: [],
    hits: [],
    exits: [],
    truncated: false,
  };
  let glows: Glow[] = [];
  let shown: number[] = [];
  let retraceDue = true;
  let liveKey = "";
  let bgDirty = true;
  let beamDirty = true;

  const sources = (): Source[] => {
    const out: Source[] = [];
    const t = now();
    for (let pos = 0; pos < count; pos++) {
      const h = heard.get(pos);
      if (h && t - h.at <= BEAM_EXPIRE_MS) {
        for (const b of h.beams) {
          out.push({
            x: b.x * W,
            y: H - 0.5,
            dx: Math.cos(b.a),
            dy: Math.sin(b.a),
            bits: b.bits,
            level: b.level,
            guide: b.guide,
            hops: 0,
          });
        }
      } else {
        out.push(...(sky.intended[pos] ?? []));
      }
    }
    return out;
  };

  const retrace = () => {
    const scene = skySceneOf(sky);
    const src = sources();
    result = trace(scene, src);
    // A frame whose crystal stays dark shows its intended beam faintly, as a hint.
    const hints: Source[] = [];
    sky.crystals.forEach((c, i) => {
      // Free play has no intended path to hint at.
      if (cfg.sandbox) return;
      if (glowOf(c, result.real[i] ?? 0, result.guide[i] ?? 0) > 0) return;
      const pos = sky.owners[i]!;
      const h = heard.get(pos);
      if (h && now() - h.at <= BEAM_EXPIRE_MS) hints.push(...(sky.intended[pos] ?? []));
    });
    if (hints.length > 0) result = trace(scene, [...src, ...hints]);
    glows = sky.crystals.map((c, i) => glowOf(c, result.real[i] ?? 0, result.guide[i] ?? 0));
    beamDirty = true;
  };

  // ---- Rounds: the screen leads the bank ---------------------------------------------------------

  let finaleAt = -Infinity;
  let warm: { serial: number; level: number; k: number } | null = null;
  let easing = false;
  let drawnAt = -Infinity;
  let finaleSerial = -1;
  const rounds: Rounds = createRounds({
    net: ctx.net,
    now,
    side: ctx.setup.side,
    count,
    rampLength: ramp.length,
    start,
    pos: -1,
    own: () => null,
    onRound: (r) => {
      round = { ...r };
      rebuild();
    },
    onCheer: () => {
      finaleAt = now();
      // Build the next round's puzzles a little at a time during the finale.
      const level = round.level + 1 >= ramp.length ? start : round.level + 1;
      warm = { serial: round.serial + 1, level, k: 0 };
    },
  });

  // ---- Drawing ----------------------------------------------------------------------------------

  const stars = Array.from({ length: MAX_STARS }, (_, i) => {
    const rng = ctx.rng(`optics:stars:${i}`);
    return {
      x: rng.next() * W,
      y: rng.next() * H * 0.9,
      r: 1.5 + rng.next() * 3.5,
      p: rng.next() * 6,
    };
  });

  const drawBg = () => {
    const g = bg;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#02030a");
    grad.addColorStop(0.7, "#060b1c");
    grad.addColorStop(1, "#0c1430");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    for (const s of stars) {
      g.fillStyle = `rgba(200,215,255,${0.15 + 0.25 * ((s.p * 7) % 1)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }
    // Where each touch frame's top edge meets the screen.
    g.strokeStyle = "rgba(120,150,210,0.18)";
    g.lineWidth = 6;
    for (let i = 1; i < count; i++) {
      const x = (i * W) / count;
      g.beginPath();
      g.moveTo(x, H - 60);
      g.lineTo(x, H);
      g.stroke();
    }
    for (const m of sky.mirrors) drawPiece(g, "mirror", m.x, m.y, m.turn, m.half / 0.86);
  };

  const drawLight = () => {
    const g = beams;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, beamC.width, beamC.height);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    drawBeams(g, result.segs, 12 * screenScale(W, H));
  };

  const loop = ctx.loop({
    hz: 30,
    update(dt) {
      if (disposed) return;
      const t = now();
      const tk = touchKind();
      if (`${tk.kind}:${tk.span}` !== kindKey) rebuild();
      // Light from a frame that went quiet expires.
      const live = [...heard.entries()]
        .filter(([, h]) => t - h.at <= BEAM_EXPIRE_MS)
        .map(([p]) => p)
        .join(",");
      if (live !== liveKey) {
        liveKey = live;
        retraceDue = true;
      }
      for (const [p, h] of heard) if (t - h.at > BEAM_EXPIRE_MS * 10) heard.delete(p);
      if (retraceDue) {
        retraceDue = false;
        retrace();
      }
      rounds.tick();
      if (warm) {
        const tk = touchKind();
        bankChain(
          {
            seed: ctx.seed,
            bench: bankBench(tk.kind, tk.span),
            serial: warm.serial,
            level: ramp[warm.level] ?? "m1",
            colour: cfg.colour,
            count,
          },
          warm.k,
        );
        warm.k++;
        if (warm.k >= count) warm = null;
      }
      if (
        sky.crystals.length > 0 &&
        glows.every((g) => g === 2) &&
        finaleSerial !== round.serial &&
        t - arrived > ROUND_SETTLE_MS
      ) {
        finaleSerial = round.serial;
        finaleAt = t;
        rounds.finale();
      }
      const step = (dt * 1000) / 300;
      easing = false;
      for (let i = 0; i < shown.length; i++) {
        const target = glows[i] === 2 ? 1 : glows[i] === 1 ? 0.42 : 0;
        const cur = shown[i]!;
        if (cur !== target) easing = true;
        shown[i] = cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step);
      }
    },
    render() {
      if (disposed) return;
      const t = now();
      if (bgDirty) {
        bgDirty = false;
        drawBg();
      }
      if (beamDirty) {
        beamDirty = false;
        drawLight();
      }
      // Full rate for the finale and fades; the slow shimmer needs far less.
      const lively = easing || t - finaleAt < FINALE_MS || t - arrived < 1200;
      if (!lively && t - drawnAt < 50) return;
      drawnAt = t;
      const g = fg;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, fgC.width, fgC.height);
      g.setTransform(scale, 0, 0, scale, 0, 0);
      const fin = t - finaleAt;
      const finale = fin >= 0 && fin < FINALE_MS;
      const k = finale ? Math.sin((Math.PI * fin) / FINALE_MS) : 0;
      const fade = Math.min(1, (t - arrived) / 900);
      g.globalAlpha = fade;
      sky.crystals.forEach((c, i) => drawCrystal(g, c, shown[i] ?? 0, t, 1 + 0.4 * k));
      g.globalAlpha = 1;
      if (finale) {
        // Rays from every crystal, turning slowly.
        g.save();
        g.globalCompositeOperation = "lighter";
        for (const c of sky.crystals) {
          for (let n = 0; n < 12; n++) {
            const a = (n * Math.PI) / 6 + fin / 2400;
            const len = c.r * (3 + 5 * k);
            g.strokeStyle = `rgba(255,240,200,${0.35 * k})`;
            g.lineWidth = c.r * 0.12;
            g.beginPath();
            g.moveTo(c.x + Math.cos(a) * c.r, c.y + Math.sin(a) * c.r);
            g.lineTo(c.x + Math.cos(a) * len, c.y + Math.sin(a) * len);
            g.stroke();
          }
        }
        g.restore();
      }
      const lampBox = { x: W * 0.3, y: H * 0.03, width: W * 0.4, height: H * 0.035 };
      drawProgress(
        g,
        lampBox,
        count,
        (i) => ((rounds.realMask >> i) & 1 ? 1 : (rounds.solvedMask >> i) & 1 ? 0.45 : 0),
        -1,
        t,
      );
      publish(t);
    },
  });

  let publishedAt = -Infinity;
  const publish = (t: number) => {
    if (t - publishedAt < 400) return;
    publishedAt = t;
    ctx.root.dataset.optics = JSON.stringify({
      screen: {
        serial: round.serial,
        level: round.level,
        crystals: sky.crystals.length,
        mirrors: sky.mirrors.length,
        lit: glows.filter((g) => g > 0).length,
        bright: glows.filter((g) => g === 2).length,
        heard: [...heard.keys()].filter(
          (p) => t - (heard.get(p)?.at ?? -Infinity) <= BEAM_EXPIRE_MS,
        ).length,
        segs: result.segs.length,
        finale: finaleSerial === round.serial,
        leading: rounds.leading,
      },
    });
  };

  resize(frame);
  rebuild();
  loop.start();
  const offResize = ctx.onResize((f) => resize(f));

  return {
    reset() {
      // The screen mirrors the frames below; going idle doesn't change what they show.
      retraceDue = true;
    },
    status() {
      const st: Record<string, OptionValue> = {
        puzzle: round.serial + 1,
        level: ramp[round.level] ?? "m1",
        crystals: sky.crystals.length,
        lit: glows.filter((g) => g === 2).length,
        segments: result.segs.length,
        leader: rounds.leading,
      };
      return st;
    },
    command(name) {
      if (name === "next") rounds.skip();
    },
    dispose() {
      disposed = true;
      loop.stop();
      offResize();
      offSky();
      rounds.dispose();
      heard.clear();
      for (const c of [bgC, beamC, fgC]) {
        c.width = 1;
        c.height = 1;
        c.remove();
      }
      delete ctx.root.dataset.optics;
    },
  };
};
