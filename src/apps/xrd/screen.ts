/**
 * The screen: above a bank, or alone.
 *
 * Upper part: the poster's title and the big detector picture, from the chapter being touched
 * (redrawn from its state with the same engine at 512), with that chapter's headline, caption
 * and, once that frame has earned it, its "So" line; untouched, a simulated map and each
 * chapter's watch view in turn. A chapter stays up at least 8 s, and the one touched longest wins.
 *
 * Lower part: the machine (band.ts), each part hanging over the frames whose chapters explain it,
 * a leader line from each part to a bracket over those frames at the screen's bottom edge, which
 * is the top edge of the bank. Touching a chapter drives its part (drive.ts): the latest person's
 * touch wins, held 15 s, then the machine runs itself.
 *
 * A screen that hears no frames runs as a lone screen: the machine runs itself, without leader
 * lines, and the big picture cycles. Frames never depend on the screen.
 */
import type { AppContext, AppInstance, OptionValue } from "../../core/types";
import { FONT } from "../../core/ui/style";
import { activeVenue } from "../../core/venue";
import { type Band, createBand } from "./band";
import { COMMON, TEXT } from "./captions";
import { CHAPTERS } from "./chapters";
import { BACKGROUND, COLOR, readConfig } from "./config";
import { compose, type Driver, type MachineLook, ownRun } from "./drive";
import { cornerTag, well } from "./draw";
import { createEngine, type Engine } from "./engine/client";
import { CHAPTER_IDS, type ChapterId } from "./ids";
import { createLayer3D, type Layer3D } from "./layer3d";
import type { Rect } from "./layout";
import { BEACON_MS, createInbox, type Heard, type Inbox, sendBeacon } from "./link";
import { bankParts, type PartSpot } from "./parts";
import { createPicker } from "./pick";
import { createMapStore, placeMap } from "./maps";
import { createWatchHost } from "./watchlook";

/** Each picture of the lone screen's run, ms. */
export const SHOW_MS = 9000;
/** Watch views are warmed from this long after mount, ms. */
const WARM_START_MS = 1000;
/** One warm-up drawing every this long, ms. */
const WARM_GAP_MS = 120;
/** The moments of each chapter's screen run, s, that warm-up draws. */
const WARM_AT_S = [0, 8, 16];

export interface ScreenLayout {
  /** The big picture: most of the upper part. */
  picture: Rect;
  /** The column beside it: the title, then the headline of what the picture shows. */
  side: Rect;
  title: number;
  headline: number;
  band: Rect;
  /** Type size for the band's names and numbers. */
  label: number;
  /** Type size for the shown chapter's caption. */
  caption: number;
}

export const screenLayout = (W: number, H: number): ScreenLayout => {
  const bandH = H * 0.4;
  const bandY = H - bandH;
  const m = Math.min(W, H) * 0.03;
  const picW = W * 0.66;
  return {
    picture: { x: m, y: m, width: picW - m, height: bandY - 2 * m },
    side: { x: picW + m, y: m * 1.5, width: W - picW - 2 * m, height: bandY - 3 * m },
    title: H * 0.03,
    headline: H * 0.042,
    band: { x: 0, y: bandY, width: W, height: bandH },
    label: H * 0.018,
    caption: H * 0.026,
  };
};

const numberOf = (id: ChapterId) => TEXT[id].number;

/** Every heard slot as a driver of the machine. */
export const driversFrom = (heard: ReadonlyMap<number, Heard>): Driver[] => {
  const out: Driver[] = [];
  for (const h of heard.values()) {
    const id = CHAPTER_IDS[h.card.k];
    if (!id) continue;
    const drive = CHAPTERS[id].drive?.(h.card.v);
    if (!drive) continue;
    out.push({
      chapter: id,
      drive,
      touchedAt: h.touchedAt,
      person: h.card.h === 1,
      held: h.card.d === 1,
    });
  }
  return out;
};

export const mountScreen = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.options);
  let frame = ctx.frame;
  const side = ctx.setup.side ?? 0;
  const inBank = ctx.setup.name === "bank";
  ctx.root.style.background = BACKGROUND;
  const now = () => performance.now();
  let disposed = false;
  const start = now();

  const maps = createMapStore();
  let engine: Engine | null = null;
  const getEngine = () => (engine ??= createEngine());
  const watches = createWatchHost(getEngine, 512, maps, config);
  const inbox: Inbox | null = inBank
    ? createInbox(ctx.net, { side, frame: ctx.net.self }, now)
    : null;
  const layer: Layer3D = createLayer3D(ctx.root, frame);
  const band: Band = createBand(layer);

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:1;";
  const text = document.createElement("div");
  text.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:2;font-family:${FONT};color:${COLOR.ink};`;
  const title = document.createElement("div");
  const subtitle = document.createElement("div");
  const headline = document.createElement("div");
  const caption = document.createElement("div");
  const so = document.createElement("div");
  text.append(title, subtitle, headline, caption, so);
  ctx.root.append(canvas, text);
  const g = canvas.getContext("2d")!;
  title.textContent = COMMON.title;
  subtitle.textContent = COMMON.subtitle;

  let L = screenLayout(frame.width / frame.unit, frame.height / frame.unit);
  let slots = 0;
  let withLeaders = false;
  let spots: PartSpot[] = [];

  /** Slots below the screen: its frames, or each pair's two halves. */
  const slotsNow = (): number => {
    if (!inBank) return 0;
    const peers = ctx.net.peers().filter((p) => p.role !== "screen" && (p.side ?? 0) === side);
    if (peers.length === 0) return 0;
    const count = Math.max(ctx.setup.count, ...peers.map((p) => p.pos + 1));
    const pairs = peers.some((p) => p.kind === "pair");
    return count * (pairs ? 2 : 1);
  };

  const placeBand = () => {
    const n = slotsNow();
    const heard = (inbox?.fresh().size ?? 0) > 0;
    const leaders = n > 0 && heard;
    if (n === slots && leaders === withLeaders && spots.length > 0) return;
    slots = n;
    withLeaders = leaders;
    // A lone screen lays its parts out over a bank of the venue's usual size.
    spots = bankParts(n > 0 ? n : activeVenue().bankCount, numberOf);
    band.place(L.band, spots, leaders);
  };

  /** What the side column shows now: the picture's headline, caption and "So" line. */
  let shownText = "";
  const picker = createPicker();
  let picked: Heard | null = null;
  /** Fit the caption and "So" line under the headline, shrinking them to the column's foot. */
  const placeText = () => {
    const u = frame.unit;
    const sd = L.side;
    const bottom = (sd.y + sd.height) * u;
    const gap = L.caption * 0.6 * u;
    caption.style.top = `${headline.offsetTop + headline.offsetHeight + gap}px`;
    let size = L.caption;
    for (let i = 0; i < 10; i++) {
      caption.style.fontSize = `${size * u}px`;
      so.style.fontSize = `${size * 0.94 * u}px`;
      so.style.top = `${caption.offsetTop + caption.offsetHeight + gap * 0.8}px`;
      const end = so.textContent
        ? so.offsetTop + so.offsetHeight
        : caption.offsetTop + caption.offsetHeight;
      if (end <= bottom || size < L.caption * 0.6) break;
      size *= 0.9;
    }
  };
  const badge = document.createElement("div");
  text.append(badge);
  const place = () => {
    const u = frame.unit;
    canvas.width = Math.max(1, Math.round(frame.width * frame.pixelRatio));
    canvas.height = Math.max(1, Math.round(frame.height * frame.pixelRatio));
    L = screenLayout(frame.width / u, frame.height / u);
    const sd = L.side;
    title.style.cssText =
      `position:absolute;left:${sd.x * u}px;top:${sd.y * u}px;width:${sd.width * u}px;` +
      `font:900 ${L.title * u}px ${FONT};line-height:1.05;`;
    subtitle.style.cssText =
      `position:absolute;left:${sd.x * u}px;top:${(sd.y + L.title * 1.25) * u}px;width:${sd.width * u}px;` +
      `font:600 ${L.title * 0.5 * u}px ${FONT};line-height:1.2;color:${COLOR.muted};`;
    const top = sd.y + sd.height * 0.24;
    badge.style.cssText =
      `position:absolute;left:${sd.x * u}px;top:${top * u}px;` +
      `width:${L.headline * 1.5 * u}px;height:${L.headline * 1.5 * u}px;border-radius:50%;` +
      `background:${COLOR.accent};color:${COLOR.background};display:flex;align-items:center;` +
      `justify-content:center;font:900 ${L.headline * 0.9 * u}px ${FONT};`;
    // Headline, caption and "So" line in one column under the badge; the caption and "So" line
    // follow however many lines the headline takes (placeText).
    headline.style.cssText =
      `position:absolute;left:${sd.x * u}px;top:${(top + L.headline * 1.9) * u}px;` +
      `width:${sd.width * u}px;font:800 ${L.headline * u}px ${FONT};line-height:1.12;text-wrap:balance;`;
    caption.style.cssText =
      `position:absolute;left:${sd.x * u}px;width:${sd.width * u}px;` +
      `font:600 ${L.caption * u}px ${FONT};line-height:1.2;text-wrap:pretty;color:${COLOR.ink};`;
    so.style.cssText =
      `position:absolute;left:${sd.x * u}px;width:${sd.width * u}px;` +
      `font:800 ${L.caption * 0.94 * u}px ${FONT};line-height:1.2;text-wrap:pretty;color:${COLOR.accent};`;
    shownText = "";
    slots = -1;
    placeBand();
  };
  place();

  let showing: { kind: "chapter"; id: ChapterId; slot: number | null } | { kind: "map" } = {
    kind: "map",
  };
  let beaconAt = Number.NEGATIVE_INFINITY;
  let placedAt = 0;
  let tick = 0;
  let look: MachineLook = ownRun(0);
  /** For tests and checks: show this chapter's watch view whatever else happens. */
  let forced: ChapterId | null = null;

  // While the map shows after mount, each chapter's watch view is drawn out of sight at a
  // few moments of its run, into the same views the big picture uses, so the run never waits on
  // a first picture and memory settles in seconds, not over several runs.
  const scratch = document.createElement("canvas");
  scratch.width = 1;
  scratch.height = 1;
  const sg = scratch.getContext("2d")!;
  const warmQueue = CHAPTER_IDS.flatMap((id) => WARM_AT_S.map((s) => ({ id, s })));
  let warmTimer = 0;
  const warm = () => {
    warmTimer = 0;
    if (disposed) return;
    // Spectrum, first in a run without the map, uses no views, so nothing shows wrongly.
    if ((showing.kind === "map" || !config.maps) && !forced) {
      const next = warmQueue.shift();
      if (!next) return;
      const def = CHAPTERS[next.id];
      try {
        def.watch(sg, L.picture, def.play?.(next.s) ?? def.start, watches.look("big", now()));
      } catch (err) {
        console.error("[xrd] watch warm-up failed", err);
      }
    }
    warmTimer = window.setTimeout(warm, WARM_GAP_MS);
  };
  warmTimer = window.setTimeout(warm, WARM_START_MS);

  const ownShow = (t: number) => {
    const extra = config.maps ? 1 : 0;
    const k = Math.floor((t - start) / SHOW_MS) % (CHAPTER_IDS.length + extra);
    return k < extra
      ? ({ kind: "map" } as const)
      : ({ kind: "chapter", id: CHAPTER_IDS[k - extra]!, slot: null } as const);
  };

  const loop = ctx.loop({
    hz: 30,
    update() {
      if (disposed) return;
      const t = now();
      if (inBank && t - beaconAt >= BEACON_MS) {
        if (sendBeacon(ctx.net, side)) beaconAt = t;
      }
      if (t - placedAt > 1000) {
        placedAt = t;
        placeBand();
      }
      const heard = inbox?.fresh() ?? new Map<number, Heard>();
      const pick = picker.pick(heard, t);
      picked = pick;
      showing = forced
        ? { kind: "chapter", id: forced, slot: null }
        : pick
          ? { kind: "chapter", id: CHAPTER_IDS[pick.card.k]!, slot: pick.card.s }
          : ownShow(t);
      look = compose(ownRun((t - start) / 1000), driversFrom(heard), t);
      band.update(look, t);
    },
    render() {
      if (disposed) return;
      layer.render();
      if (tick++ % 2 === 1) return;
      const t = now();
      // Set with the picture, so the headline never names a chapter the picture hasn't reached.
      const h = showing.kind === "chapter" ? TEXT[showing.id].headline : COMMON.mapHeadline;
      const cap = showing.kind === "chapter" ? TEXT[showing.id].caption.text : "";
      // The "So" line once the frame showing the chapter has earned it.
      const soText =
        showing.kind === "chapter" && picked?.card.e === 1 && showing.slot === picked.card.s
          ? TEXT[showing.id].so.text
          : "";
      const key = `${h}|${cap}|${soText}`;
      if (key !== shownText) {
        shownText = key;
        headline.textContent = h;
        caption.textContent = cap;
        so.textContent = soText;
        const n = showing.kind === "chapter" ? String(TEXT[showing.id].number) : "";
        badge.textContent = n;
        badge.style.visibility = n ? "visible" : "hidden";
        placeText();
      }
      const k = frame.pixelRatio * frame.unit;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k, 0, 0, k, 0, 0);
      const pic = L.picture;
      if (showing.kind === "map") {
        // The map edge to edge in its own box; the headline beside it says what it shows, and the
        // tag in the empty corner above the rings' left end says it is simulated.
        const p = placeMap("corundum", pic);
        well(
          g,
          {
            x: p.rect.x - 20,
            y: p.rect.y - 20,
            width: p.rect.width + 40,
            height: p.rect.height + 40,
          },
          { radius: 40 },
        );
        maps.draw(g, "corundum", pic);
        cornerTag(g, p.rect, COMMON.simulated, { size: L.caption * 0.85, corner: "tl" });
      } else {
        const def = CHAPTERS[showing.id];
        const heard = showing.slot !== null ? inbox?.fresh().get(showing.slot) : undefined;
        const state = heard ? heard.card.v : (def.play?.((t - start) / 1000) ?? def.start);
        try {
          def.watch(g, pic, state, watches.look("big", t));
        } catch (err) {
          console.error("[xrd] watch draw failed", err);
        }
      }
      // With visible light nothing flashes: the spectrum chapter's own line says why.
      if (look.dark) {
        const b = L.band;
        cornerTag(
          g,
          { x: b.x, y: b.y, width: b.width, height: b.height * 0.2 },
          TEXT.spectrum.so.text,
          {
            size: L.label,
            corner: "tr",
            color: COLOR.ink,
          },
        );
      }
      band.drawOverlay(g, { size: L.label, active: look.active });
    },
  });
  loop.start();

  const offPeers = ctx.net.onPeers(() => {
    placedAt = 0;
  });
  const offResize = ctx.onResize((f) => {
    frame = f;
    layer.resize(f);
    place();
  });

  Object.defineProperty(window, "__xrd", {
    configurable: true,
    value: {
      state: () => ({
        screen: true,
        bank: inBank,
        showing,
        slots,
        leaders: band.leaders(),
        parts: spots,
        look: { state: look.state, sample: look.sample, dark: look.dark, active: look.active },
        heard: [...(inbox?.fresh().values() ?? [])].map((h) => ({
          slot: h.card.s,
          chapter: h.card.k,
          v: h.card.v,
        })),
        engine: engine?.stats() ?? null,
        flashes: band.machine.flashes,
        arm: band.machine.arm,
        layer: { ready: layer.ready },
        layout: L,
        unit: frame.unit,
      }),
      show: (id: string | null) => {
        forced = id && (CHAPTER_IDS as readonly string[]).includes(id) ? (id as ChapterId) : null;
      },
    },
  });

  return {
    reset() {},
    attract() {},
    status(): Record<string, OptionValue> {
      return {
        showing: showing.kind === "map" ? "map" : showing.id,
        heard: inbox?.fresh().size ?? 0,
        driven: Object.keys(look.active).join(",") || "none",
      };
    },
    dispose() {
      disposed = true;
      window.clearTimeout(warmTimer);
      loop.stop();
      offResize();
      offPeers();
      inbox?.dispose();
      watches.dispose();
      band.dispose();
      layer.dispose();
      engine?.dispose();
      maps.dispose();
      canvas.remove();
      text.remove();
      ctx.root.style.background = "";
      Reflect.deleteProperty(window, "__xrd");
    },
  };
};
