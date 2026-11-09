/**
 * One frame of Sun, Earth and Moon: a touch frame, a wall, a kiosk or a screen. It keeps the
 * shared state (keeper.ts), draws the space view and the ground views with one three.js renderer
 * into scissored rectangles, and the labels and hand-drawn controls on a 2D canvas over them.
 *
 * Standalone it decides everything itself. In a bank the leader decides and the others follow;
 * each touch frame shows the ground at its own latitude, and the screen the space view with a
 * marker for every frame's latitude.
 */
import type { Camera, Scene } from "three";
import { bankFraction } from "../../core/layout";
import { createRenderer3D } from "../../core/renderer3d";
import type {
  AppContext,
  AppInstance,
  FrameInfo,
  OptionValue,
  PeerInfo,
  Pointer,
  Rect,
} from "../../core/types";
import { dayLength, MOON_INCL, PHASE_NAMES } from "./astro";
import { bankLatitude, isBrisbane } from "./bank";
import { type Bot, createBot } from "./bots";
import { contextCaption } from "./captions";
import {
  BACKGROUND,
  BRISBANE,
  BRISBANE_COLOUR,
  COMPARE,
  COMPARE_COLOUR,
  DEFAULT_MOON_SPEED,
  frameColour,
  HZ,
  INK,
  MOON_SPEEDS,
  type Place,
  readConfig,
  rgba,
  SUN,
  TIMING,
} from "./config";
import { createControls } from "./controls";
import { createGroundView, type GroundView } from "./ground";
import { createKeeper, type KnobId } from "./keeper";
import { hitAt, type Layout, layoutFor } from "./layout";
import { createLink, type Link, type LocalClaim } from "./link";
import { drawOverlay, type Look, type PlaceLook } from "./overlay";
import { addHours, dateText, globalOf, latText, localOf, type Sky } from "./sky";
import { createSpaceView, type Marker, type SpaceView } from "./space";

/** Turning the space view: limits about its usual angle, and the return home. */
const ORBIT = { az: 55, elLo: -14, elHi: 40, span: 1400, turn: 200, back: 20_000, ease: 0.6 };
/** A follower shows its own released value this long while the leader catches up. */
const OVERRIDE_MS = 1000;

const svg = (body: string) => `<svg viewBox="0 0 100 100" width="100%" height="100%">${body}</svg>`;
const ICON = {
  spin: svg(
    '<path d="M78 50A28 28 0 1 1 64 25.8" fill="none" stroke="currentColor" stroke-width="11" stroke-linecap="round"/><path d="M58 10L76 24L56 36Z" fill="currentColor"/>',
  ),
  pause: svg(
    '<rect x="26" y="20" width="16" height="60" rx="4" fill="currentColor"/><rect x="58" y="20" width="16" height="60" rx="4" fill="currentColor"/>',
  ),
  play: svg('<path d="M32 18L80 50L32 82Z" fill="currentColor"/>'),
  fast: svg('<path d="M14 22L50 50L14 78Z M50 22L86 50L50 78Z" fill="currentColor"/>'),
};

interface PlaceState extends Place {
  colour: string;
  /** The named place it starts at; its name shows while it stays there. */
  home: Place | null;
}

export const mount = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.variant, ctx.options);
  const moonMode = config.variant === "moon";
  const isScreen = ctx.frame.kind === "screen" || ctx.setup.role === "screen";
  const inBank = ctx.setup.name === "bank";
  const bankFrame =
    inBank && !isScreen && (ctx.frame.kind === "panel" || ctx.frame.kind === "pair");
  const side = ctx.setup.side ?? 0;
  const pos = Math.max(0, ctx.setup.pos);
  const count = Math.max(1, ctx.setup.count, pos + 1);
  const compare = ctx.frame.kind === "wall" && config.compare !== "none";
  let frame: FrameInfo = ctx.frame;
  const layoutOf = (f: FrameInfo): Layout =>
    layoutFor({
      kind: isScreen ? "screen" : f.kind,
      width: f.width / f.unit,
      height: f.height / f.unit,
      variant: config.variant,
      bank: inBank,
      compare,
    });
  let layout = layoutOf(frame);
  ctx.root.style.background = BACKGROUND;
  const now = () => performance.now();
  const clock = () => ctx.clock.now();

  // ---- Places ---------------------------------------------------------------------------------

  const ownLat = bankFrame ? bankLatitude(pos, count) : BRISBANE.lat;
  const ownColour = bankFrame ? frameColour(pos, count) : BRISBANE_COLOUR;
  const initialPlaces = (): PlaceState[] => {
    const out: PlaceState[] = [
      {
        name: BRISBANE.name,
        lat: ownLat,
        lon: BRISBANE.lon,
        colour: ownColour,
        home: isBrisbane(ownLat) ? BRISBANE : null,
      },
    ];
    if (compare && config.compare !== "none") {
      const c = COMPARE[config.compare];
      out.push({ ...c, colour: COMPARE_COLOUR, home: c });
    }
    return out;
  };
  let places = initialPlaces();
  const placeName = (p: PlaceState) =>
    p.home && Math.abs(p.lat - p.home.lat) < 0.05 ? p.home.name : null;

  // ---- Drawing surfaces -------------------------------------------------------------------------

  const r3 = createRenderer3D(ctx.root, frame, { antialias: true });
  const overlay = document.createElement("canvas");
  overlay.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;";
  ctx.root.append(overlay);
  const g2 = overlay.getContext("2d");
  let k2 = 1;
  const sizeOverlay = () => {
    const ratio = Math.min(frame.pixelRatio, frame.kind === "wall" || isScreen ? 1 : 1.5);
    overlay.width = Math.max(1, Math.round(frame.width * ratio));
    overlay.height = Math.max(1, Math.round(frame.height * ratio));
    k2 = frame.unit * ratio;
  };
  sizeOverlay();

  const space: SpaceView | null = layout.space
    ? createSpaceView(config.variant, ctx.rng("orrery:stars"))
    : null;
  const groundCount = isScreen ? 0 : Math.max(1, layout.grounds.length);
  const grounds: GroundView[] = Array.from({ length: groundCount }, (_, i) =>
    createGroundView(ctx.rng(`orrery:ground:${i}`), moonMode),
  );
  if (space) r3.prepare(space.scene, space.camera);
  for (const gv of grounds) r3.prepare(gv.scene, gv.camera);

  // ---- State ----------------------------------------------------------------------------------

  const keeper = createKeeper({
    variant: config.variant,
    tilt: config.tilt,
    speed: DEFAULT_MOON_SPEED,
  });
  let lastPerson = Number.NEGATIVE_INFINITY;
  let botPressAt = Number.NEGATIVE_INFINITY;
  const botPressed = () => now() - botPressAt < 500;
  const overrides = new Map<KnobId, { a: number; b: number; held: boolean; at: number }>();

  const link: Link | null = inBank
    ? createLink(ctx.net, {
        now,
        clock,
        rate: (s) => (moonMode ? (MOON_SPEEDS[s.sky.speed] ?? 0) : 0),
        onState: (s) => keeper.adopt(s, now()),
        onClaim: (c) => {
          keeper.hear({ ...c, at: now() });
          // People on other frames keep the leader from going idle and resetting them.
          if (c.human) ctx.idle.poke();
        },
      })
    : null;
  let known = new Set(ctx.net.peers().map((p) => p.frame));
  const offPeers = ctx.net.onPeers((peers) => {
    const here = new Set(peers.map((p) => p.frame));
    for (const f of known) if (!here.has(f)) keeper.forget(f);
    known = here;
  });

  const deciding = () => (link ? link.deciding(now()) : true);

  const emit = (c: LocalClaim) => {
    const t = now();
    if (!c.bot) lastPerson = t;
    if (deciding()) keeper.hear({ from: ctx.net.self, ...c, at: t, human: !c.bot });
    if (link?.leader()) link.claim(c);
    overrides.set(c.knob, { a: c.a, b: c.b, held: c.held, at: t });
  };

  /** The state as this frame shows it. */
  const shown = (): Sky => {
    const s = { ...keeper.sky(clock()) };
    if (deciding()) {
      overrides.clear();
      return s;
    }
    const t = now();
    for (const [knob, o] of overrides) {
      if (!o.held && t - o.at > OVERRIDE_MS) {
        overrides.delete(knob);
        continue;
      }
      if (knob === "time") {
        s.day = o.a;
        s.hour = o.b;
      } else if (knob === "tilt") s.tilt = o.a;
      else if (knob === "flat") s.flat = o.a >= 0.5;
      else s.speed = o.a;
    }
    return s;
  };

  const controls = createControls({
    layout: () => layout,
    variant: config.variant,
    sky: shown,
    clock,
    baseTilt: config.tilt,
    emit,
    onPlace: (i, lat) => {
      const p = places[i];
      if (p) p.lat = lat;
    },
    placeMarks: (i) => {
      const h = initialPlaces()[i]?.home;
      return h ? [h.lat] : [];
    },
    onTouch: (person) => {
      if (person) lastPerson = now();
    },
  });

  // ---- Buttons --------------------------------------------------------------------------------

  let buttons: HTMLElement[] = [];
  let flatEl: HTMLElement | null = null;
  let speedEls: HTMLElement[] = [];
  const toStage = (r: Rect): Rect => {
    const u = frame.unit;
    return { x: r.x * u, y: r.y * u, width: r.width * u, height: r.height * u };
  };
  const pressedBy = () => {
    const person = !botPressed();
    if (person) lastPerson = now();
    return person;
  };
  const styleToggle = (el: HTMLElement, on: boolean, colour: string) => {
    const u = frame.unit;
    el.style.background = on ? colour : "rgba(5,7,13,0.8)";
    el.style.color = on ? "#05070d" : colour;
    el.style.border = `${Math.max(2, 5 * u)}px solid ${rgba(colour, on ? 1 : 0.6)}`;
    el.style.boxShadow = on ? `0 0 ${Math.round(30 * u)}px ${rgba(colour, 0.4)}` : "none";
    el.setAttribute("aria-pressed", on ? "true" : "false");
  };
  let styled = { flat: false, speed: -1 };
  const restyle = (s: Sky) => {
    if (flatEl && s.flat !== styled.flat) styleToggle(flatEl, s.flat, "#ffcc33");
    if (s.speed !== styled.speed) speedEls.forEach((el, i) => styleToggle(el, i === s.speed, INK));
    styled = { flat: s.flat, speed: s.speed };
  };
  const buildButtons = () => {
    for (const b of buttons) b.remove();
    buttons = [];
    speedEls = [];
    flatEl = null;
    styled = { flat: !shown().flat, speed: -1 };
    if (layout.spin) {
      const el = ctx.ui.button({
        icon: ICON.spin,
        rect: toStage(layout.spin),
        color: SUN,
        onPress: () => controls.spin(now(), pressedBy()),
      });
      el.setAttribute("aria-label", "Spin");
      buttons.push(el);
    }
    if (layout.resetTilt) {
      const el = ctx.ui.button({
        label: "Reset",
        rect: toStage(layout.resetTilt),
        look: "ghost",
        color: "#7fd6ff",
        onPress: () => controls.resetTilt(now(), pressedBy()),
      });
      buttons.push(el);
    }
    if (layout.flat) {
      flatEl = ctx.ui.button({
        label: "Flat orbit",
        rect: toStage(layout.flat),
        color: "#ffcc33",
        onPress: () => {
          const person = pressedBy();
          emit({
            knob: "flat",
            a: shown().flat ? 0 : 1,
            b: 0,
            held: false,
            since: clock(),
            bot: !person,
          });
        },
      });
      buttons.push(flatEl);
    }
    layout.speeds.forEach((r, i) => {
      const el = ctx.ui.button({
        icon: [ICON.pause, ICON.play, ICON.fast][i],
        rect: toStage(r),
        color: INK,
        onPress: () => {
          const person = pressedBy();
          emit({ knob: "speed", a: i, b: 0, held: false, since: clock(), bot: !person });
        },
      });
      el.setAttribute("aria-label", ["Stop", "Slow", "Fast"][i] ?? "Speed");
      speedEls.push(el);
      buttons.push(el);
    });
    restyle(shown());
  };
  if (layout.touch) buildButtons();

  // ---- The space view's camera ----------------------------------------------------------------

  let orbitAz = 0;
  let orbitEl = 0;
  let orbitAt = Number.NEGATIVE_INFINITY;
  const orbiting = new Map<number, { x: number; y: number }>();
  let spaceShown = !!space;

  // ---- Input ----------------------------------------------------------------------------------

  const venue = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venue(p);
      if (controls.down(p.id, v.x, v.y, now(), !p.synthetic)) return;
      if (p.synthetic) return;
      const h = hitAt(layout, v.x, v.y, spaceShown);
      if (h?.kind === "space") {
        orbiting.set(p.id, v);
        orbitAt = now();
        lastPerson = now();
      }
    }),
    ctx.input.on("move", (p) => {
      const v = venue(p);
      const o = orbiting.get(p.id);
      if (o) {
        const rate = ORBIT.turn / ORBIT.span;
        orbitAz = Math.max(-ORBIT.az, Math.min(ORBIT.az, orbitAz - (v.x - o.x) * rate));
        orbitEl = Math.max(ORBIT.elLo, Math.min(ORBIT.elHi, orbitEl + (v.y - o.y) * rate));
        orbiting.set(p.id, v);
        orbitAt = now();
        return;
      }
      controls.move(p.id, v.x, v.y, now());
    }),
    ctx.input.on("up", (p) => {
      orbiting.delete(p.id);
      controls.up(p.id, now());
    }),
    ctx.input.on("cancel", (p) => {
      orbiting.delete(p.id);
      controls.cancel(p.id, now());
    }),
  ];

  // ---- Bots -----------------------------------------------------------------------------------

  const bots: Bot[] =
    ctx.bots > 0 && layout.touch
      ? [
          createBot({
            input: ctx.input,
            layout: () => layout,
            unit: () => frame.unit,
            rng: ctx.rng().fork(`orrery-bot:${pos}`),
            reachTop: () => frame.reachTop.adult / frame.unit,
            lastPerson: () => lastPerson,
            tilt: () => shown().tilt,
            baseTilt: config.tilt,
            placeLat: (i) => places[i]?.lat ?? 0,
            markPress: () => {
              botPressAt = now();
            },
          }),
        ]
      : [];

  // ---- Loop -----------------------------------------------------------------------------------

  let incl = MOON_INCL;
  let handAlpha = 0;
  let captionText: string | null = null;
  let captionAlpha = 0;
  let lastRender = now();
  let disposed = false;
  let framed = { space: "", grounds: [] as string[] };
  let lastSky: Sky = shown();
  let lastGlobal = globalOf(lastSky);
  const screenOnSide = (): boolean =>
    ctx.net
      .peers()
      .some((p) => p.role === "screen" && (p.side ?? 0) === side && p.frame !== ctx.net.self);
  const touchFrames = (): PeerInfo[] =>
    ctx.net
      .peers()
      .filter((p) => p.role !== "screen" && (p.side ?? 0) === side)
      .sort((a, b) => a.pos - b.pos);
  const bankCount = (frames: PeerInfo[]) =>
    Math.max(ctx.setup.count, ...frames.map((p) => p.pos + 1), 1);

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      const c = clock();
      controls.step(t, dt);
      for (const b of bots) b.update(dt, t);
      keeper.step(t, c, dt);
      link?.tick(t, c, keeper);
      // The space view drifts home a while after it was last turned.
      if (orbiting.size === 0 && t - orbitAt > ORBIT.back && (orbitAz !== 0 || orbitEl !== 0)) {
        const kk = 1 - Math.exp(-dt / ORBIT.ease);
        orbitAz = Math.abs(orbitAz) < 0.05 ? 0 : orbitAz * (1 - kk);
        orbitEl = Math.abs(orbitEl) < 0.05 ? 0 : orbitEl * (1 - kk);
      }
    },
    render() {
      if (disposed || !g2) return;
      const t = now();
      const dt = Math.min(0.1, (t - lastRender) / 1000);
      lastRender = t;
      const c = clock();
      const sky = shown();
      lastSky = sky;
      // The Moon's orbit eases flat and back.
      const inclTarget = sky.flat ? 0 : MOON_INCL;
      const step = (MOON_INCL * dt * 1000) / TIMING.flatten;
      incl =
        Math.abs(inclTarget - incl) <= step
          ? inclTarget
          : incl + Math.sign(inclTarget - incl) * step;
      const g = globalOf(sky, incl);
      lastGlobal = g;
      const locals = places.map((p) => localOf(sky, g, p));
      const u = frame.unit;
      // A panel under its screen gives the space view's room to the ground; a pair keeps both,
      // one in each half.
      const screenHere = bankFrame && !!layout.groundTall && screenOnSide();
      spaceShown = !!space && !!layout.space && !screenHere;
      const groundRects: { rect: Rect; place: number }[] =
        screenHere && layout.groundTall
          ? [{ rect: layout.groundTall, place: 0 }]
          : layout.grounds.map((x) => ({ rect: x.rect, place: x.place }));

      // Space view markers: the places here, or every bank frame's latitude on the screen.
      let markers: Marker[];
      let strip: Look["bankStrip"] = null;
      if (isScreen && inBank) {
        const frames = touchFrames();
        const n = bankCount(frames);
        markers = frames.slice(0, 12).map((p) => {
          const lat = bankLatitude(p.pos, n);
          return { lat, lon: BRISBANE.lon, colour: frameColour(p.pos, n), circle: isBrisbane(lat) };
        });
        if (markers.length === 0)
          markers = [
            { lat: BRISBANE.lat, lon: BRISBANE.lon, colour: BRISBANE_COLOUR, circle: true },
          ];
        strip = frames.map((p) => {
          const lat = bankLatitude(p.pos, n);
          return {
            u: bankFraction(p.pos, 0.5, n),
            colour: frameColour(p.pos, n),
            lat,
            hours: dayLength(lat, g.dec),
          };
        });
      } else if (isScreen) {
        markers = [{ lat: BRISBANE.lat, lon: BRISBANE.lon, colour: BRISBANE_COLOUR, circle: true }];
      } else {
        markers = places.map((p) => ({ lat: p.lat, lon: p.lon, colour: p.colour, circle: true }));
      }

      if (space && layout.space) {
        const r = layout.space.rect;
        const f = layout.space.focus;
        const key = `${r.x},${r.y},${r.width},${r.height},${f.x},${f.y},${u}`;
        if (key !== framed.space) {
          framed.space = key;
          space.frame(
            { width: r.width * u, height: r.height * u },
            { x: (f.x - r.x) * u, y: (f.y - r.y) * u, width: f.width * u, height: f.height * u },
          );
        }
        space.orbit(orbitAz, orbitEl);
        space.update(g, sky.tilt, incl, markers);
      }
      groundRects.forEach((gr, i) => {
        const gv = grounds[i];
        const local = locals[gr.place];
        if (!gv || !local) return;
        const key = `${gr.rect.width},${gr.rect.height},${u}`;
        if (framed.grounds[i] !== key) {
          framed.grounds[i] = key;
          gv.frame({ width: gr.rect.width * u, height: gr.rect.height * u });
        }
        gv.update(local, g.dec, {
          lit: g.moon.lit,
          show: true,
          eclipse: g.moon.eclipse === "lunar",
        });
      });

      // 3D.
      if (r3.ready) {
        const R = r3.renderer;
        R.setScissorTest(false);
        R.setClearColor("#05070f", 1);
        R.clear();
        R.setScissorTest(true);
        const draw = (r: Rect, scene: Scene, cam: Camera) => {
          const x = r.x * u;
          const y = frame.height - (r.y + r.height) * u;
          R.setViewport(x, y, r.width * u, r.height * u);
          R.setScissor(x, y, r.width * u, r.height * u);
          R.render(scene, cam);
        };
        if (spaceShown && space && layout.space) draw(layout.space.rect, space.scene, space.camera);
        groundRects.forEach((gr, i) => {
          const gv = grounds[i];
          if (gv) draw(gr.rect, gv.scene, gv.camera);
        });
        R.setScissorTest(false);
      }

      // Captions: the tour's, or the fact the state shows.
      const tourFrame = keeper.tour(c);
      const want =
        tourFrame?.caption ??
        (keeper.mode === "ease"
          ? null
          : contextCaption(config.variant, sky, g, places[0]?.lat ?? BRISBANE.lat, incl));
      if (want !== captionText) {
        captionAlpha -= dt * 4;
        if (captionAlpha <= 0) {
          captionText = want;
          captionAlpha = 0;
        }
      } else captionAlpha = Math.min(1, captionAlpha + dt * 3);
      const handKind = bots.length === 0 && layout.touch ? (tourFrame?.hand ?? null) : null;
      handAlpha += ((handKind ? 1 : 0) - handAlpha) * Math.min(1, dt * 3);
      if (layout.touch) restyle(sky);

      // 2D.
      g2.setTransform(1, 0, 0, 1, 0, 0);
      g2.clearRect(0, 0, overlay.width, overlay.height);
      g2.setTransform(k2, 0, 0, k2, 0, 0);
      const look: Look = {
        layout,
        labels: config.labels,
        caption: captionText,
        captionAlpha,
        day: g.t,
        hour: sky.hour,
        tilt: sky.tilt,
        baseTilt: config.tilt,
        distanceKm: g.distanceKm,
        moon: moonMode
          ? { elong: g.moon.elong, lit: g.moon.lit, eclipse: g.moon.eclipse === "lunar" }
          : null,
        space: null,
        grounds: [],
        places: places.map((p, i) => placeLook(p, locals[i]!)),
        marks: places.map((p) =>
          p.home ? [{ lat: p.home.lat, colour: p.colour, name: p.home.name }] : [],
        ),
        active: {
          wheel: controls.leads("wheel") || controls.coasting,
          dial: controls.leads("dial") || controls.spinning,
          tilt: controls.leads("tilt"),
          places: places.map((_, i) => controls.leads(`place${i}` as "place")),
        },
        hand: handKind && handAlpha > 0.01 ? { kind: handKind, alpha: handAlpha } : null,
        strip: bankFrame ? ownColour : null,
        bankStrip: strip,
        time: t / 1000,
      };
      if (spaceShown && space && layout.space) {
        const r = layout.space.rect;
        const lab = space.labels({ width: r.width * u, height: r.height * u });
        const toVenue = (p: { x: number; y: number }) => ({ x: r.x + p.x / u, y: r.y + p.y / u });
        look.space = {
          rect: r,
          months: lab.months.map((m) => ({ text: m.text, ...toVenue(m) })),
          north: lab.north ? toVenue(lab.north) : null,
          shadow: lab.shadow ? toVenue(lab.shadow) : null,
        };
      }
      look.grounds = groundRects.flatMap((gr, i) => {
        const gv = grounds[i];
        const p = places[gr.place];
        const local = locals[gr.place];
        if (!gv || !p || !local) return [];
        const lab = gv.labels({ width: gr.rect.width * u, height: gr.rect.height * u });
        return [
          {
            rect: gr.rect,
            place: placeLook(p, local),
            compass: lab.compass.map((m) => ({ text: m.text, x: m.x / u, y: m.y / u })),
          },
        ];
      });
      drawOverlay(g2, look);
    },
  });
  const placeLook = (p: PlaceState, local: ReturnType<typeof localOf>): PlaceLook => ({
    name: placeName(p),
    lat: p.lat,
    colour: p.colour,
    local,
  });
  loop.start();

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    layout = layoutOf(f);
    r3.resize(f);
    sizeOverlay();
    framed = { space: "", grounds: [] };
    controls.clear(now());
    orbiting.clear();
    for (const b of bots) b.release();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed && layout.touch) buildButtons();
    }, 150);
  });

  const resetAll = () => {
    const t = now();
    controls.clear(t);
    for (const b of bots) b.release();
    overrides.clear();
    orbiting.clear();
    orbitAt = Number.NEGATIVE_INFINITY;
    places = initialPlaces();
    // A follower leaves the shared state to its leader.
    if (deciding()) keeper.reset(t, clock());
  };

  const debugKey = "__orrery";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          const s = lastSky;
          const g = lastGlobal;
          return {
            variant: config.variant,
            kind: layout.kind,
            screen: isScreen,
            bank: inBank,
            pos,
            unit: frame.unit,
            ready: r3.ready,
            mode: keeper.mode,
            deciding: deciding(),
            leader: link?.leader() ?? null,
            spaceShown,
            sky: { ...s },
            date: dateText(g.t),
            lambda: g.lambda,
            dec: g.dec,
            places: places.map((p) => {
              const l = localOf(s, g, p);
              return {
                lat: p.lat,
                name: placeName(p),
                dayLength: l.dayLength,
                noonAlt: l.noonAlt,
                sun: l.sun,
                season: l.season,
                moon: l.moon,
              };
            }),
            moon: { ...g.moon, phaseName: PHASE_NAMES[g.moon.phase] },
            eclipsed: space?.eclipsed ?? null,
            bodies: space?.bodies() ?? null,
            caption: captionText,
            markers: isScreen && inBank ? touchFrames().map((p) => p.pos) : [],
            counts: link ? { ...link.counts } : null,
            touches: controls.count,
            layout: {
              space: layout.space,
              grounds: layout.grounds,
              wheel: layout.wheel,
              dial: layout.dial,
              tilt: layout.tilt,
              places: layout.places,
              spin: layout.spin,
              resetTilt: layout.resetTilt,
              flat: layout.flat,
              speeds: layout.speeds,
            },
            bots: bots.map((b) => ({ ...b.moves })),
          };
        },
        /** Move a knob as a person's control would, and let go. */
        claim: (knob: KnobId, a: number, b = 0) => {
          emit({ knob, a, b, held: false, since: clock(), bot: false });
        },
        hours: (h: number) => {
          const n = addHours(shown(), h);
          emit({ knob: "time", a: n.day, b: n.hour, held: false, since: clock(), bot: false });
        },
      },
    });
  }

  return {
    reset() {
      resetAll();
    },
    attract() {},
    status(): Record<string, OptionValue> {
      const s = lastSky;
      return {
        date: dateText(lastGlobal.t),
        time: `${Math.floor(s.hour)}:${String(Math.floor((s.hour % 1) * 60)).padStart(2, "0")}`,
        tilt: Math.round(s.tilt * 10) / 10,
        place: latText(places[0]?.lat ?? BRISBANE.lat),
        mode: keeper.mode,
        touches: controls.count,
        ...(link ? { leader: link.leader() === null ? "self" : "other" } : {}),
        ...(moonMode ? { phase: PHASE_NAMES[lastGlobal.moon.phase] } : {}),
      };
    },
    command(name) {
      if (name === "reset") resetAll();
    },
    homeSpot(size) {
      const u = frame.unit;
      return {
        x: Math.max(0, Math.min(frame.width - size, layout.home.x * u)),
        y: Math.max(0, Math.min(frame.height - size, layout.home.y * u)),
      };
    },
    dispose() {
      disposed = true;
      loop.stop();
      link?.dispose();
      offPeers();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      controls.clear(now());
      for (const b of buttons) b.remove();
      space?.dispose();
      for (const gv of grounds) gv.dispose();
      r3.dispose();
      overlay.remove();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
