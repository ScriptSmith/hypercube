/**
 * A touch frame: its cards (one on a panel or kiosk, two on a pair, six on a wall under the
 * machine's banner), the shared engine and 3D layer, touches, attract, bots and, in a bank, the
 * states it sends the screen.
 *
 * Attract: solo cards tour their chapters (or stay on the `chapter` option), each demo followed
 * by a rest; the wall's columns and a bank's frames play a relay, one chapter's demo after
 * another along the poster, with a pulse of light running along the beam; a bank's relay follows
 * the shared clock so the frames agree. A person's touch ends a card's attract until the
 * runtime's idle reset. With bots requested, bots drive every card instead.
 */
import type {
  AppContext,
  AppInstance,
  FrameInfo,
  FrameKind,
  OptionValue,
  Pointer,
} from "../../core/types";
import { createBanner } from "./banner";
import type { Driver } from "./drive";
import { type Card, createCard, type CardHost } from "./card";
import { CHAPTERS } from "./chapters";
import { BACKGROUND, HZ, readConfig } from "./config";
import { Choice, type Touch } from "./controls";
import { createEngine, type Engine } from "./engine/client";
import { CHAPTER_COUNT, CHAPTER_IDS, chapterIndex, chapterNumbering } from "./ids";
import { createLayer3D, type Layer3D } from "./layer3d";
import { type CardSpec, layoutFrame } from "./layout";
import { createWatch, SEND_BUSY_MS, SEND_IDLE_MS, sendState, type Watch } from "./link";
import { type Bot, createBot, createPerformer, type Performer } from "./perform";
import { createMapStore, MAP_IDS } from "./maps";
import { pulseAt, relayTurn, tourAt } from "./relay";
import { frameChapters, slotOf, slotsIn } from "./shares";
import { ageOf, type CardMsg } from "./wire";

type TouchKind = Exclude<FrameKind, "screen">;

export const mountFrame = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.options);
  const kind = (ctx.frame.kind === "screen" ? "panel" : ctx.frame.kind) as TouchKind;
  const inBank = ctx.setup.name === "bank" && (kind === "panel" || kind === "pair");
  const pos = Math.max(0, ctx.setup.pos);
  const count = Math.max(1, ctx.setup.count, pos + 1);
  const side = ctx.setup.side ?? 0;
  let frame: FrameInfo = ctx.frame;
  ctx.root.style.background = BACKGROUND;
  const now = () => performance.now();
  let disposed = false;

  const maps = createMapStore();
  let engine: Engine | null = null;
  let layer: Layer3D | null = null;
  const getEngine = () => (engine ??= createEngine());
  const getLayer = () => (layer ??= createLayer3D(ctx.root, frame));

  const groups = frameChapters({ kind, bank: inBank, pos, count, set: config.set });
  const numberOf = chapterNumbering(kind, groups);
  const specs = (): CardSpec[] =>
    groups.map((chs) =>
      kind === "wall"
        ? { bottom: "none" }
        : inBank
          ? { bottom: chs.length > 1 ? "nav" : "none", reserve: "nav" }
          : { bottom: "tabs", tabs: chs.length },
    );
  const layoutOf = (f: FrameInfo) =>
    layoutFrame({
      kind,
      width: f.width / f.unit,
      height: f.height / f.unit,
      reachTop: { adult: f.reachTop.adult / f.unit, child: f.reachTop.child / f.unit },
      cards: specs(),
      maths: config.maths !== "off",
    });
  let fl = layoutOf(frame);

  const host: CardHost = {
    root: ctx.root,
    frame: () => frame,
    kind,
    config,
    defs: CHAPTERS,
    engine: getEngine,
    layer3d: getLayer,
    maps,
    rng: (label) => ctx.rng(label),
    numberOf,
  };
  const startAt = inBank || kind === "wall" ? null : config.chapter;
  const cards: Card[] = groups.map((chs, i) => createCard(host, fl.cards[i]!, chs, startAt));
  const banner = fl.banner
    ? createBanner(ctx.root, fl.banner, groups, numberOf, getLayer, () => frame)
    : null;
  /** The cards as drivers of the wall's machine. */
  const drivers = (): Driver[] => {
    const out: Driver[] = [];
    for (const c of cards) {
      const s = c.snapshot();
      const drive = CHAPTERS[s.chapter].drive?.(s.state);
      if (drive)
        out.push({
          chapter: s.chapter,
          drive,
          touchedAt: s.touchedAt,
          person: s.person,
          held: s.held,
        });
    }
    return out;
  };
  const performers: Performer[] = cards.map(() => createPerformer(ctx.input, () => frame.unit));

  // ---- Touch -----------------------------------------------------------------------------------

  const owner = new Map<number, number>();
  const touchOf = (p: Pointer): Touch => ({
    id: p.id,
    x: p.x / frame.unit,
    y: p.y / frame.unit,
    synthetic: p.synthetic,
    time: now(),
  });
  const offs = [
    ctx.input.on("down", (p) => {
      const t = touchOf(p);
      for (let i = 0; i < cards.length; i++) {
        if (cards[i]!.down(t)) {
          owner.set(p.id, i);
          if (!t.synthetic) performers[i]!.stop();
          break;
        }
      }
    }),
    ctx.input.on("move", (p) => {
      const i = owner.get(p.id);
      if (i !== undefined) cards[i]?.move(touchOf(p));
    }),
    ctx.input.on("up", (p) => {
      const i = owner.get(p.id);
      owner.delete(p.id);
      if (i !== undefined) cards[i]?.up(touchOf(p), false);
    }),
    ctx.input.on("cancel", (p) => {
      const i = owner.get(p.id);
      owner.delete(p.id);
      if (i !== undefined) cards[i]?.up(touchOf(p), true);
    }),
  ];

  // ---- Bots and attract ------------------------------------------------------------------------

  const bots: Bot[] =
    ctx.bots > 0
      ? cards.map((_, i) => {
          const r = ctx.rng(`xrd-bot:${pos}:${i}`);
          return createBot(
            () => cards[i]!,
            performers[i]!,
            () => r.next(),
            { tabs: !inBank && kind !== "wall" },
          );
        })
      : [];

  let tourStart = now();
  const played = cards.map(() => -1);

  /** Fractions along the poster of each chapter's card centre, for the beam's pulse. */
  const centres = (): number[] => {
    if (kind === "wall") return groups.map((_, i) => (i + 0.5) / groups.length);
    if (!inBank) return [];
    const slots = slotsIn(kind, count);
    const out: number[] = Array.from({ length: CHAPTER_COUNT }, () => 0);
    // Every frame computes the whole bank's shares, so the pulse agrees across frames.
    const all = frameChaptersAll();
    all.forEach((chs, s) => {
      for (const id of chs) out[chapterIndex(id)] = (s + 0.5) / slots;
    });
    return out;
  };
  const frameChaptersAll = () => {
    const out: (typeof groups)[number][] = [];
    for (let p = 0; p < count; p++) {
      const g = frameChapters({ kind, bank: true, pos: p, count, set: config.set });
      out.push(...g);
    }
    return out;
  };
  const pulseCentres = centres();

  /** Frame venue x of a fraction along the poster. */
  const posterX = (f: number): number => {
    const W = frame.width / frame.unit;
    if (kind === "wall" || !inBank) return f * W;
    return (f * count - pos) * W;
  };

  const startDemo = (i: number) => {
    const card = cards[i]!;
    card.current.reset();
    card.resting = false;
    void performers[i]!.play(card, card.current.demo());
  };

  const attract = (t: number) => {
    if (bots.length > 0) {
      for (const b of bots) b.update(t);
      return;
    }
    if (inBank || kind === "wall") {
      const turn = inBank
        ? relayTurn(ctx.clock.now(), CHAPTER_COUNT, true)
        : relayTurn(t - tourStart, cards.length, false);
      const p = pulseAt(turn, pulseCentres);
      cards.forEach((card, i) => {
        card.pulse = p ? { x: posterX(p.f), strength: p.strength } : null;
        if (card.mode !== "attract") return;
        const id = inBank
          ? turn.index >= 0
            ? CHAPTER_IDS[turn.index]!
            : null
          : turn.index === i
            ? card.chapter
            : null;
        if (id && card.chapters.includes(id) && played[i] !== turn.serial && turn.at < 2000) {
          played[i] = turn.serial;
          card.show(id);
          startDemo(i);
        }
        // Between turns, only the card whose turn is next shows the resting hand.
        const n = inBank ? CHAPTER_COUNT : cards.length;
        const next = turn.index < 0 ? 0 : (turn.index + 1) % n;
        const nextHere = inBank ? card.chapters.includes(CHAPTER_IDS[next]!) : next === i;
        card.resting = nextHere && !performers[i]!.playing;
      });
      return;
    }
    cards.forEach((card, i) => {
      if (card.mode !== "attract") return;
      // Pair halves start a little apart, so their demos don't run together.
      const n = config.chapter ? 1 : card.chapters.length;
      const stop = tourAt(t - tourStart - i * 6000, n);
      if (t - tourStart - i * 6000 < 0) {
        card.resting = true;
        return;
      }
      if (played[i] !== stop.serial) {
        played[i] = stop.serial;
        if (!config.chapter) card.show(card.chapters[stop.index]!);
        startDemo(i);
      }
      card.resting = stop.phase === "rest" || !performers[i]!.playing;
    });
  };

  // ---- The bank's screen -----------------------------------------------------------------------

  const watch: Watch | null = inBank ? createWatch(ctx.net, side, now) : null;
  let sentAt = Number.NEGATIVE_INFINITY;
  let sentKey = "";
  let sends = 0;
  const sendDue = (t: number) => {
    const to = watch?.screen();
    if (!to) return;
    const msgs: CardMsg[] = cards.map((c, i) => {
      const s = c.snapshot();
      return {
        s: slotOf(kind, pos, i),
        k: chapterIndex(s.chapter),
        v: [...s.state],
        a: Number.isFinite(s.touchedAt) ? ageOf(t - s.touchedAt) : -1,
        h: s.person ? 1 : 0,
        d: s.held ? 1 : 0,
        e: c.earned(s.chapter) ? 1 : 0,
      };
    });
    const key = JSON.stringify(msgs.map((m) => [m.s, m.k, m.v, m.h, m.d, m.e, m.a < 0]));
    const busy = msgs.some((m) => m.d === 1 || (m.a >= 0 && m.a < 2000));
    const gap = key !== sentKey || busy ? SEND_BUSY_MS : SEND_IDLE_MS;
    if (t - sentAt < gap) return;
    if (sendState(ctx.net, to, pos, msgs)) {
      sentAt = t;
      sentKey = key;
      sends++;
    }
  };

  // ---- Loop ------------------------------------------------------------------------------------

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      attract(t);
      cards.forEach((c, i) => {
        c.setGhost(performers[i]!.fingers(), bots.length === 0);
        c.update(dt, t);
      });
      sendDue(t);
      banner?.update(drivers(), t);
    },
    render() {
      if (disposed) return;
      const t = now();
      for (const c of cards) c.render(t);
      banner?.render();
      layer?.render();
    },
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    layer?.resize(f);
    for (const p of performers) p.stop();
    owner.clear();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (disposed) return;
      fl = layoutOf(frame);
      cards.forEach((c, i) => c.setLayout(fl.cards[i]!));
      if (fl.banner) banner?.setRect(fl.banner);
    }, 120);
  });

  const reset = () => {
    for (const p of performers) p.stop();
    owner.clear();
    for (const c of cards) c.reset();
    tourStart = now();
    played.fill(-1);
  };

  // Always there: e2e tests read it, and it holds nothing secret.
  const debugKey = "__xrd";
  {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => ({
          screen: false,
          kind,
          unit: frame.unit,
          bank: inBank,
          pos,
          count,
          hearsScreen: watch?.screen() != null,
          sends,
          engine: engine?.stats() ?? null,
          layer: layer ? { ready: layer.ready } : null,
          banner: fl.banner,
          leaders: banner?.leaders() ?? [],
          arm: banner?.arm() ?? null,
          cards: cards.map((c) => ({
            chapter: c.chapter,
            chapters: [...c.chapters],
            mode: c.mode,
            maths: c.mathsOpen,
            linked: c.linked(),
            so: c.earned(c.chapter),
            soShown: c.soShown(),
            status: c.status(),
            state: [...c.current.state()],
            numbers: [...c.current.numbers()],
            layout: c.layout,
            controls: c.controls().map((k) => ({
              id: k.id,
              kind: k.kind,
              rect: k.rect,
              held: k.held,
              label: k.label,
              visible: k.visible,
              options: k instanceof Choice ? k.options.map((o) => o.label) : null,
            })),
          })),
          bots: bots.map((b) => b.moves),
          maps: MAP_IDS.filter((id) => maps.ready(id)),
        }),
        show: (card: number, id: string) => {
          const c = cards[card];
          if (c && (CHAPTER_IDS as readonly string[]).includes(id)) c.show(id as never);
        },
        /** Where a formula part sits on card `card`'s open fold, venue px. */
        part: (card: number, part: string) => cards[card]?.partRect(part) ?? null,
        /** Play a gesture on card `card`'s control as a bot's finger would; resolves when done. */
        gesture: (card: number, control: string, to?: number, ms?: number) => {
          const c = cards[card];
          const p = performers[card];
          if (!c || !p) return Promise.resolve();
          return p.play(c, [{ control, to, ms }]);
        },
        /** Card `card` back to its start, quiet: no demo, no "So" lines, first chapter. */
        resetCard: (card: number) => {
          const c = cards[card];
          if (!c) return;
          performers[card]!.stop();
          c.reset();
          c.mode = "people";
          c.resting = false;
        },
        stopAttract: () => {
          for (const p of performers) p.stop();
          for (const c of cards) {
            c.mode = "people";
            c.resting = false;
          }
        },
      },
    });
  }

  return {
    reset,
    attract() {},
    status(): Record<string, OptionValue> {
      const first = cards[0]!.status();
      return {
        ...first,
        chapter: cards.map((c) => c.chapter).join(","),
        maths: cards.some((c) => c.mathsOpen),
        touches: cards.reduce((s, c) => s + c.touches(), 0),
        mode: cards.some((c) => c.mode === "people") ? "people" : "attract",
        ...(inBank ? { screen: watch?.screen() != null } : {}),
      };
    },
    homeSpot(size) {
      const c = cards[0]!.layout;
      const u = frame.unit;
      return {
        x: Math.max(0, Math.min(frame.width - size, (c.rect.x + c.rect.width - 24) * u - size)),
        y: Math.max(0, (c.rect.y + 24) * u),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      for (const p of performers) p.dispose();
      watch?.dispose();
      for (const c of cards) c.dispose();
      banner?.dispose();
      layer?.dispose();
      engine?.dispose();
      maps.dispose();
      ctx.root.style.background = "";
      Reflect.deleteProperty(window, debugKey);
    },
  };
};
