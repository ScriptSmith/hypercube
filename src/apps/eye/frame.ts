/**
 * A touch frame: its own eye, simulated view(s), caption card and controls. Solo frames stand
 * alone. Bank frames do too, and also send their eye state to the screen while they hear its
 * beacon; with the screen there, the view moves up to it and the eye takes its space.
 *
 * Untouched, the frame runs the tour (tour.ts); in a bank the tour follows the shared clock from
 * the frame's own starting condition. A person's touch ends the tour until the runtime's idle
 * reset brings it back. With bots requested, bots drive the controls instead of the tour.
 */
import { createRenderer3D } from "../../core/renderer3d";
import type { AppContext, AppInstance, FrameInfo, OptionValue, Pointer } from "../../core/types";
import { type Bot, createBot } from "./bots";
import { type ConditionId, conditionCaption, PART_IDS, type PartId, partCaption } from "./captions";
import { BACKGROUND, HZ, readConfig } from "./config";
import { hitAt, type Shown, sliderValue, sliderX } from "./controls";
import { effectsFor, kernelKey, kernelsFor } from "./effects";
import { createEyeView, type Look } from "./eye3d";
import { ICONS } from "./icons";
import { type ButtonId, type Layout, layoutFor, type SliderId, slidersFor } from "./layout";
import { createWatch, sendEye, type Watch } from "./link";
import {
  bankStart,
  CONDITION_ORDER,
  type Correction,
  correctionsFor,
  type Derived,
  defaultState,
  derive,
  type EyeState,
  lensText,
  RANGE,
  togglesFor,
} from "./model";
import { createOrbit, ORBIT } from "./orbit";
import { createSight, type ViewDraw } from "./sight";
import { pages, viewLine, viewTag } from "./text";
import { bankTour, soloTour, type TourFrame } from "./tour";
import { createUi, type SliderLook, type ToggleLook, type Ui, type UiLook } from "./ui";
import { amdExample } from "./effects";
import { encodeEye, FLAG, sameEye, type EyeMsg } from "./wire";

const SEND_GAP_MS = 100;
/** The realistic eye, whole: seen from the front and a little to the side, like a real eye. */
const FRONT = { azimuth: -68, elevation: 10 };
/** Parts seen from outside: the realistic eye stays whole for these. */
const OUTSIDE: ReadonlySet<PartId> = new Set([
  "whole",
  "cornea",
  "tearFilm",
  "conjunctiva",
  "sclera",
  "iris",
  "pupil",
  "muscles",
]);
/** Conditions that show from outside, or not in the eyeball at all. */
const WHOLE_OK: ReadonlySet<ConditionId> = new Set(["typical", "keratoconus", "cvd"]);

/**
 * Whether the realistic eye opens into the cut-away: when a part inside is inspected, the rays
 * matter (a correction, or a focus that misses the retina), or the condition is inside.
 */
export const needsOpen = (s: EyeState, d: Derived, part: PartId | null): boolean => {
  if (part) return !OUTSIDE.has(part);
  if (s.correction !== "none") return true;
  if (!WHOLE_OK.has(s.condition)) return true;
  if (s.condition === "typical") {
    return Math.abs(d.se) >= 0.5 || Math.abs(d.refraction.h - d.refraction.v) >= 0.5;
  }
  return false;
};
const SEND_IDLE_MS = 1000;
const PERSON_MS = 30_000;
/** The screen must be heard (or gone) this long before the layout changes. */
const SCREEN_SETTLE_MS = 1500;

const CORRECTION_LABEL: Record<Correction, string> = {
  none: "",
  glasses: "Glasses",
  contact: "Contact lens",
  reading: "Reading glasses",
  newLens: "New lens",
  hardLens: "Hard lens",
};

const STRENGTH_LABEL: Partial<Record<ConditionId, string>> = {
  astigmatism: "Astigmatism",
  cataract: "Cloudiness",
  glaucoma: "Stage",
  amd: "Stage",
  diabetic: "Stage",
  keratoconus: "Cone",
  cvd: "Strength",
};

export const SLIDER_LABEL: Record<Exclude<SliderId, "strength">, string> = {
  length: "Eye length",
  radius: "Cornea curve",
  age: "Age",
  light: "Light",
};

const signed = (v: number, digits = 2) =>
  `${v > 0.004 ? "+" : v < -0.004 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

/** Slider value (0 to 1) for the state. */
export const sliderOf = (s: EyeState, id: SliderId): number => {
  const span = (v: number, r: readonly [number, number]) => (v - r[0]) / (r[1] - r[0]);
  switch (id) {
    case "length":
      return span(s.length, RANGE.length);
    case "radius":
      return span(s.radius, RANGE.radius);
    case "age":
      return span(s.age, RANGE.age);
    case "light":
      return s.light;
    default:
      return s.strength;
  }
};

/** The state with slider `id` at value v (0 to 1). */
export const withSlider = (s: EyeState, id: SliderId, v: number): EyeState => {
  const k = Math.min(1, Math.max(0, v));
  const at = (r: readonly [number, number]) => r[0] + k * (r[1] - r[0]);
  switch (id) {
    case "length":
      return { ...s, length: Math.round(at(RANGE.length) * 100) / 100 };
    case "radius":
      return { ...s, radius: Math.round(at(RANGE.radius) * 100) / 100 };
    case "age":
      return { ...s, age: Math.round(at(RANGE.age)) };
    case "light":
      return { ...s, light: Math.round(k * 100) / 100 };
    default:
      return { ...s, strength: Math.round(k * 100) / 100 };
  }
};

export const mountFrame = (ctx: AppContext): AppInstance => {
  const config = readConfig(ctx.options);
  const look: Look = ctx.variant === "diagram" ? "diagram" : "real";
  const setup = ctx.setup;
  const inBank = setup.name === "bank" && (ctx.frame.kind === "panel" || ctx.frame.kind === "pair");
  const pos = Math.max(0, setup.pos);
  const side = setup.side ?? 0;
  const startCondition: ConditionId = inBank ? bankStart(pos) : "typical";
  let frame: FrameInfo = ctx.frame;
  ctx.root.style.background = BACKGROUND;

  const r3d = createRenderer3D(ctx.root, frame, { alpha: true });
  const renderer = r3d.renderer;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const now = () => performance.now();

  let state: EyeState = defaultState(startCondition, config.light);
  let derived: Derived = derive(state);
  let derivedKey = JSON.stringify(state);
  let part: PartId | null = null;
  let page = 0;
  /** "Only this part": everything but the chosen part hidden. */
  let isolate = false;
  let mode: "tour" | "people" = "tour";
  let tourStart = now();
  let tour: TourFrame | null = null;
  let lastPerson = Number.NEGATIVE_INFINITY;
  let disposed = false;

  const eye = createEyeView(r3d, state.length, look);
  const sight = createSight(r3d, { fov: config.fov });
  r3d.onRestore(() => sight.invalidate());
  const orbit = createOrbit();

  const watch: Watch | null = inBank ? createWatch(ctx.net, side, now) : null;
  let screenUp = false;
  let screenSeen: boolean | null = null;
  let screenSince = now();

  const layoutOf = (f: FrameInfo): Layout =>
    layoutFor({
      kind: f.kind === "screen" ? "panel" : f.kind,
      width: f.width / f.unit,
      height: f.height / f.unit,
      reachTop: { adult: f.reachTop.adult / f.unit, child: f.reachTop.child / f.unit },
      screenUp,
    });
  let layout = layoutOf(frame);
  let ui: Ui = createUi(ctx.root, layout, frame.unit);
  const toCss = (r: { x: number; y: number; width: number; height: number }) => {
    const u = frame.unit;
    return { x: r.x * u, y: r.y * u, width: r.width * u, height: r.height * u };
  };
  const applyLayout = () => {
    layout = layoutOf(frame);
    ui.dispose();
    ui = createUi(ctx.root, layout, frame.unit);
    eye.setViewport(toCss(layout.eye));
  };
  eye.setViewport(toCss(layout.eye));

  const ensureDerived = () => {
    const key = JSON.stringify(state);
    if (key !== derivedKey) {
      derivedKey = key;
      derived = derive(state);
    }
  };
  const sliderIds = (): SliderId[] => slidersFor(state.condition, layout.sliderSlots.length);
  const pageList = () =>
    pages(state, derived, { part, extras: config.extras, paired: layout.views.length > 1 });

  const correctionButtons = (): [ToggleLook | null, ToggleLook | null] => {
    const toggles = togglesFor(state.condition);
    if (toggles) {
      return [
        { label: toggles[0], on: state.toggle === 0 },
        { label: toggles[1], on: state.toggle === 1 },
      ];
    }
    const fixes = correctionsFor(state.condition);
    const look = (c: Correction | undefined): ToggleLook | null =>
      c
        ? {
            label: CORRECTION_LABEL[c],
            on: state.correction === c,
            icon:
              c === "contact" || c === "hardLens"
                ? ICONS.contact
                : c === "newLens"
                  ? ICONS.lens
                  : ICONS.glasses,
          }
        : null;
    return [look(fixes[0]), look(fixes[1])];
  };

  const shown = (): Shown => {
    const [a, b] = correctionButtons();
    const buttons = new Set<ButtonId>(Object.keys(layout.buttons) as ButtonId[]);
    if (!a) buttons.delete("corrA");
    if (!b) buttons.delete("corrB");
    if (!part) buttons.delete("only");
    return { sliders: sliderIds().length, buttons, more: pageList().length > 1 };
  };

  // ---- Acting on the eye ---------------------------------------------------------------------

  const takeOver = (person: boolean) => {
    const t = now();
    if (person) lastPerson = t;
    if (mode === "tour") {
      mode = "people";
      tour = null;
    }
  };
  const setState = (s: EyeState) => {
    state = s;
    ensureDerived();
  };
  const chooseCondition = (c: ConditionId) => {
    setState({ ...defaultState(c, state.light) });
    part = null;
    page = 0;
    isolate = false;
  };
  const choosePart = (p: PartId | null) => {
    part = p;
    page = 0;
    if (!p) isolate = false;
  };
  const press = (id: ButtonId) => {
    switch (id) {
      case "near":
        setState({ ...state, looking: "near" });
        break;
      case "far":
        setState({ ...state, looking: "far" });
        break;
      case "only":
        isolate = !isolate && part !== null;
        break;
      case "next":
      case "prev": {
        const i = part ? PART_IDS.indexOf(part) : -1;
        const n = PART_IDS.length;
        choosePart(PART_IDS[(i + (id === "next" ? 1 : n - 1 + (i < 0 ? 1 : 0)) + n) % n] ?? null);
        break;
      }
      default: {
        const toggles = togglesFor(state.condition);
        const which = id === "corrA" ? 0 : 1;
        if (toggles) {
          setState({ ...state, toggle: which });
          break;
        }
        const fix = correctionsFor(state.condition)[which];
        if (!fix) break;
        setState({ ...state, correction: state.correction === fix ? "none" : fix });
        part = null;
        page = 0;
      }
    }
  };

  // ---- Input ---------------------------------------------------------------------------------

  const venue = (p: Pointer) => ({ x: p.x / frame.unit, y: p.y / frame.unit });
  const drags = new Map<number, number>();
  let lastTap: { x: number; y: number; at: number } | null = null;
  const onEye = new Set<number>();
  const offs = [
    ctx.input.on("down", (p) => {
      const v = venue(p);
      const hit = hitAt(layout, v.x, v.y, shown());
      if (!hit) return;
      takeOver(!p.synthetic);
      switch (hit.kind) {
        case "slider": {
          drags.set(p.id, hit.slot);
          const id = sliderIds()[hit.slot];
          const slot = layout.sliderSlots[hit.slot];
          if (id && slot) setState(withSlider(state, id, sliderValue(slot, v.x)));
          break;
        }
        case "tile":
          chooseCondition(CONDITION_ORDER[hit.index] ?? "typical");
          break;
        case "button":
          press(hit.id);
          break;
        case "more":
          page = (page + 1) % Math.max(1, pageList().length);
          break;
        case "chip": {
          const id = PART_IDS[hit.index] ?? null;
          choosePart(id === part ? null : id);
          break;
        }
        case "eye":
          onEye.add(p.id);
          orbit.begin(p.id, v.x, v.y, now());
          break;
      }
    }),
    ctx.input.on("move", (p) => {
      const v = venue(p);
      const slot = drags.get(p.id);
      if (slot !== undefined) {
        const id = sliderIds()[slot];
        const r = layout.sliderSlots[slot];
        if (id && r) setState(withSlider(state, id, sliderValue(r, v.x)));
        if (!p.synthetic) lastPerson = now();
        return;
      }
      if (onEye.has(p.id)) {
        orbit.move(p.id, v.x, v.y, now());
        if (!p.synthetic) lastPerson = now();
      }
    }),
    ctx.input.on("up", (p) => lift(p, true)),
    ctx.input.on("cancel", (p) => lift(p, false)),
  ];
  function lift(p: Pointer, up: boolean) {
    drags.delete(p.id);
    if (!onEye.delete(p.id)) return;
    const tap = orbit.end(p.id, now());
    if (!tap || !up) return;
    // A second tap at the same spot looks one layer deeper (through the clear cornea, say).
    const list = eye.pickList(p.x, p.y);
    const t = now();
    const again =
      lastTap !== null &&
      t - lastTap.at < 5000 &&
      Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40 * frame.unit &&
      part !== null &&
      list.includes(part);
    lastTap = { x: p.x, y: p.y, at: t };
    choosePart(again ? (list[(list.indexOf(part!) + 1) % list.length] ?? null) : (list[0] ?? null));
  }

  // ---- Bots ----------------------------------------------------------------------------------

  const bots: Bot[] =
    ctx.bots > 0
      ? [
          createBot(ctx.input, ctx.rng().fork(`eye-bot:${pos}`), {
            layout: () => layout,
            unit: () => frame.unit,
            sliders: () => sliderIds().length,
            buttons: () => shown().buttons,
            more: () => pageList().length > 1,
            partAt: (pt) => {
              const w = eye.where(pt);
              return w ? { x: w.x / frame.unit, y: w.y / frame.unit } : null;
            },
            lastPerson: () => lastPerson,
          }),
        ]
      : [];
  if (bots.length > 0) mode = "people";

  // ---- The bank's screen ---------------------------------------------------------------------

  let sentAt = Number.NEGATIVE_INFINITY;
  let sentMsg: EyeMsg | null = null;
  let sends = 0;
  const sendDue = (t: number) => {
    const to = watch?.screen();
    if (!to) return;
    const flags =
      (t - lastPerson < PERSON_MS ? FLAG.person : 0) |
      (drags.size + onEye.size > 0 ? FLAG.held : 0);
    const m = encodeEye(state, pos, flags);
    const changed = !sentMsg || !sameEye(m, sentMsg) || m.f !== sentMsg.f;
    if (changed ? t - sentAt < SEND_GAP_MS : t - sentAt < SEND_IDLE_MS) return;
    if (sendEye(ctx.net, to, m)) {
      sentAt = t;
      sentMsg = m;
      sends++;
    }
  };
  const watchScreen = (t: number) => {
    if (!watch) return;
    const seen = watch.screen() !== null;
    if (seen !== screenSeen) {
      screenSeen = seen;
      screenSince = t;
    }
    if (seen !== screenUp && t - screenSince >= SCREEN_SETTLE_MS) {
      screenUp = seen;
      applyLayout();
    }
  };

  // ---- Tour ----------------------------------------------------------------------------------

  const handAt = (f: TourFrame): UiLook["hand"] => {
    if (!f.hand) return null;
    const h = f.hand.target;
    const c = (r: { x: number; y: number; width: number; height: number } | undefined) =>
      r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    let at: { x: number; y: number } | null = null;
    if (h.kind === "slider") {
      const i = sliderIds().indexOf(h.id);
      const r = layout.sliderSlots[i];
      if (r) at = { x: sliderX(r, sliderOf(state, h.id)), y: r.y + r.height * 0.68 };
    } else if (h.kind === "button") at = c(layout.buttons[h.id]);
    else if (h.kind === "tile") at = c(layout.tiles[CONDITION_ORDER.indexOf(h.condition)]);
    else if (h.kind === "more") at = c(layout.more);
    else {
      const chip = layout.chips[PART_IDS.indexOf(h.part)];
      if (chip) at = c(chip);
      else {
        const w = eye.where(h.part);
        at = w ? { x: w.x / frame.unit, y: w.y / frame.unit } : null;
      }
    }
    return at ? { ...at, press: f.hand.press } : null;
  };

  // ---- Loop ----------------------------------------------------------------------------------

  let time = 0;
  const views = (t: number): ViewDraw[] => {
    const out: ViewDraw[] = [];
    layout.views.forEach((v, i) => {
      const css = toCss(v.rect);
      const s = v.typical
        ? { ...defaultState("typical", state.light), age: state.age, looking: state.looking }
        : state;
      const d = v.typical ? derive(s) : derived;
      const w = css.width * frame.pixelRatio;
      const kernels = kernelsFor(d, w, config.fov);
      const floaters =
        state.condition === "diabetic" &&
        pageList()[page]?.line === conditionCaption("diabetic").view?.more[0];
      out.push({
        slot: i,
        rect: css,
        kernels,
        key: kernelKey(kernels, w, config.fov),
        night: d.night,
        fix: sight.fixFor(css.width, css.height, d.night, s.looking),
        effects: effectsFor(s, t, { floaters, typical: v.typical }),
        time: t,
      });
    });
    return out;
  };

  const loop = ctx.loop({
    hz: HZ,
    update(dt) {
      if (disposed) return;
      const t = now();
      time += dt;
      watchScreen(t);
      if (mode === "tour") {
        tour = inBank
          ? bankTour(ctx.clock.now() / 1000, pos, config.light)
          : soloTour((t - tourStart) / 1000, config.light);
        setState(tour.state);
        part = tour.part;
        page = tour.page;
        isolate = false;
      }
      const n = pageList().length;
      if (page >= n) page = 0;
      orbit.step(dt, t);
      // Ease from the front pose (whole) to the cut-away pose (open); a drag turns either.
      const k = eye.openness;
      const baseAz = FRONT.azimuth + (ORBIT.azimuth - FRONT.azimuth) * k;
      const baseEl = FRONT.elevation + (ORBIT.elevation - FRONT.elevation) * k;
      const spin = mode === "tour" && tour ? tour.spin : 0;
      eye.setOrbit(
        baseAz + (orbit.azimuth - ORBIT.azimuth) + spin,
        Math.min(85, Math.max(4, baseEl + (orbit.elevation - ORBIT.elevation))),
      );
      for (const b of bots) b.update(t);
      sendDue(t);
    },
    render() {
      if (disposed) return;
      ensureDerived();
      const exaggerate = state.condition === "keratoconus" || state.condition === "glaucoma";
      eye.update(
        { state, derived, part, exaggerate, open: needsOpen(state, derived, part), isolate },
        time,
      );
      if (r3d.ready) {
        renderer.setRenderTarget(null);
        renderer.setScissorTest(false);
        renderer.clear();
        renderer.setScissorTest(true);
        sight.draw(views(time), frame.height);
        eye.draw(frame.height);
        renderer.setScissorTest(false);
      }
      ui.update(uiLook());
    },
  });
  loop.start();

  const uiLook = (): UiLook => {
    const list = pageList();
    const pg = list[Math.min(page, list.length - 1)];
    const ids = sliderIds();
    const sliders: SliderLook[] = ids.map((id) => ({
      id,
      label: id === "strength" ? (STRENGTH_LABEL[state.condition] ?? "Strength") : SLIDER_LABEL[id],
      value: sliderOf(state, id),
      text: config.numbers ? sliderText(id) : null,
      held: [...drags.values()].some((slot) => ids[slot] === id),
    }));
    const [corrA, corrB] = correctionButtons();
    const line = viewLine(state, derived);
    const tags = layout.views.map((v) =>
      v.typical ? null : viewTag(state, derived, amdExample(time)),
    );
    const insetMode =
      part === "disc"
        ? "disc"
        : part === "fovea" || part === "macula"
          ? "fovea"
          : part === "retina" || part === "photoreceptors"
            ? "retina"
            : state.condition === "cvd" && part === null
              ? "fovea"
              : null;
    const exaggerated =
      state.condition === "keratoconus"
        ? "Cone shown larger than real"
        : state.condition === "glaucoma"
          ? "Optic disc shown larger than real"
          : null;
    return {
      condition: state.condition,
      sliders,
      looking: state.looking,
      corrA,
      corrB,
      card: {
        title: pg?.title ?? partCaption("whole").name,
        text: pg?.line.text ?? "",
        page: Math.min(page, Math.max(0, list.length - 1)),
        pages: list.length,
      },
      viewCaption: line?.text ?? null,
      viewTags: tags,
      part,
      isolate,
      inset: insetMode
        ? {
            mode: insetMode,
            title: insetMode === "disc" ? "Optic disc, magnified" : "Rods and cones, magnified",
            cvd:
              state.condition === "cvd"
                ? { type: state.toggle === 1 ? "protan" : "deutan", strength: state.strength }
                : null,
          }
        : null,
      readout: readoutText(),
      exaggerated,
      hand: mode === "tour" && tour ? handAt(tour) : null,
    };
  };

  const sliderText = (id: SliderId): string | null => {
    switch (id) {
      case "length":
        return `${state.length.toFixed(1)} mm`;
      case "radius":
        return `${state.radius.toFixed(2)} mm`;
      case "age":
        return `${Math.round(state.age)}`;
      case "light":
        return `Pupil ${derived.pupil.toFixed(1)} mm`;
      default: {
        const cyl = Math.abs(derived.refraction.h - derived.refraction.v);
        return state.condition === "astigmatism" || state.condition === "keratoconus"
          ? `${cyl.toFixed(2)} D`
          : null;
      }
    }
  };

  const readoutText = (): string | null => {
    if (!config.numbers) return null;
    const r = derived.refraction;
    const refr =
      Math.abs(r.h - r.v) < 0.01 ? `${signed(r.h)} D` : `${signed(r.h)} / ${signed(r.v)} D`;
    const lens = derived.lens
      ? `   ${CORRECTION_LABEL[derived.lens.kind]} ${lensText(derived.lens.power)}`
      : "";
    return `Refraction ${refr}${lens}`;
  };

  let resizeTimer = 0;
  const offResize = ctx.onResize((f) => {
    frame = f;
    r3d.resize(f);
    drags.clear();
    onEye.clear();
    for (const b of bots) b.release();
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!disposed) applyLayout();
    }, 150);
  });

  const resetAll = () => {
    mode = bots.length > 0 ? "people" : "tour";
    tourStart = now();
    tour = null;
    setState(defaultState(startCondition, config.light));
    part = null;
    page = 0;
    isolate = false;
    drags.clear();
    onEye.clear();
    orbit.home();
    for (const b of bots) b.release();
  };

  const debugKey = "__eye";
  if (ctx.debug) {
    Object.defineProperty(window, debugKey, {
      configurable: true,
      value: {
        state: () => {
          ensureDerived();
          const list = pageList();
          const v = layout.views[0];
          const w = v ? toCss(v.rect).width * frame.pixelRatio : 1;
          const ks = kernelsFor(derived, w, config.fov);
          return {
            screen: false,
            kind: layout.kind,
            unit: frame.unit,
            bank: inBank,
            pos,
            mode,
            look,
            openness: eye.openness,
            ready: r3d.ready,
            eye: { ...state },
            refraction: { ...derived.refraction },
            accommodation: derived.accommodation,
            pupil: derived.pupil,
            lens: derived.lens
              ? { kind: derived.lens.kind, power: { ...derived.lens.power } }
              : null,
            part,
            page,
            isolate,
            card: list[Math.min(page, list.length - 1)] ?? null,
            pages: list.map((p) => p.line.text),
            viewCaption: viewLine(state, derived)?.text ?? null,
            blurPx: ks.map((k) => (Math.max(k.rx, k.ry) * 2 * w) / config.fov),
            blurs: sight.blurs,
            sliders: sliderIds(),
            hearsScreen: watch?.screen() != null,
            screenUp,
            sends,
            layout,
            orbit: { azimuth: orbit.azimuth, elevation: orbit.elevation },
            bots: bots.map((b) => b.actions),
          };
        },
        hits: (x: number, y: number) => eye.hits(x, y),
        /** Where a part shows, stage CSS px. */
        where: (p: PartId) => eye.where(p),
        /** Choose a condition as its tile does, press a button, or show a page, for tests. */
        condition: (c: ConditionId) => {
          takeOver(false);
          chooseCondition(c);
        },
        press: (id: ButtonId) => {
          takeOver(false);
          press(id);
        },
        page: (n: number) => {
          page = n;
        },
        /** Set the eye (and stop the tour), for tests. */
        pose: (over: Partial<EyeState>, p: PartId | null = null) => {
          takeOver(false);
          setState({ ...state, ...over });
          part = p;
          page = 0;
        },
      },
    });
  }

  return {
    reset: resetAll,
    attract() {},
    status(): Record<string, OptionValue> {
      ensureDerived();
      return {
        condition: state.condition,
        refraction: Math.round(derived.se * 100) / 100,
        age: Math.round(state.age),
        part: part ?? "none",
        touches: drags.size + onEye.size,
        mode,
        ...(inBank ? { screen: watch?.screen() != null } : {}),
      };
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
      watch?.dispose();
      clearTimeout(resizeTimer);
      offResize();
      for (const off of offs) off();
      for (const b of bots) b.dispose();
      ui.dispose();
      sight.dispose();
      eye.dispose();
      r3d.dispose();
      ctx.root.style.background = "";
      if (ctx.debug) Reflect.deleteProperty(window, debugKey);
    },
  };
};
