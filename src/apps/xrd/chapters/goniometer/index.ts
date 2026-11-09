/**
 * Chapter 5, how the machine aims: a 3D diffractometer close up, the tube and its beam, the
 * sample on a stage that turns (ω), tilts (χ) and spins (φ), and the detector on an arm (2θ) at a
 * distance. Each axis lights while its dial turns, and spots flash on the detector's face as the
 * crystal passes Bragg angles, staying faintly lit for a moment so a turn leaves a trail.
 *
 * - Watch view: the detector's face, flat and as big as the view allows, each new flash a large
 *   glow fading into a trail; a small side sketch of the machine in a corner; after a flash, the
 *   turn and the angle the flash came out at, so a visitor can see one is twice the other.
 * - Figure: the machine in 3D, in reach, its tube, sample and detector named, where a drag turns
 *   the view. With the Maths open it also shows the reciprocal lattice and the Ewald sphere,
 *   points lighting up as they touch it.
 * - Children: the big wheel turns the crystal (ω). Adults: dials for tilt, spin, the arm and its
 *   distance; the detector (Curved strip or Flat plate, each loading its preset's settings);
 *   the X-ray tube (three choices, or one Next tube button on a pair's narrow lane).
 * - The machine model is machine.ts and machine3d.ts, the same one the screen and wall draw.
 */
import { withAlpha } from "../../../../core/ui/palette";
import { TEXT } from "../../captions";
import type { Chapter, ChapterDef, ChapterEnv, DemoStep, MachineDrive } from "../../chapter";
import { COMMON } from "../../captions";
import { COLOR, TUBE_IDS, TUBES } from "../../config";
import {
  button,
  type Button,
  Choice,
  choice,
  type Control,
  font,
  pad,
  type Pad,
  roundRect,
  rotary,
  type Rotary,
} from "../../controls";
import { clipTo, ICON, label, well } from "../../draw";
import type { View3D } from "../../layer3d";
import { type CardLayout, centre, inset, type Rect, splitColumn } from "../../layout";
import {
  DIAL_RANGE,
  detectorFor,
  detectorPoint,
  type DetectorKind,
  type MachineState,
} from "../../machine";
import { createMachine3D, type Glow, type Machine3D, spotLevel } from "../../machine3d";
import { drawFace, drawSide } from "./face";
import { createOrbit } from "./orbit";
import { decode, encode, litAt, presetFor, SAMPLE, START, STATE_RANGES, tubeNear } from "./state";

const T = TEXT.goniometer;
const L = T.labels;

export const PARTS = { G: COLOR.recip, in: COLOR.beam, out: COLOR.scattered } as const;

type DialId = "chi" | "phi" | "arm" | "distance";
const DIALS: readonly DialId[] = ["chi", "phi", "arm", "distance"];
const LETTER: Record<DialId | "omega", string> = {
  omega: "ω",
  chi: "χ",
  phi: "φ",
  arm: "2θ",
  distance: "D",
};
/** A dial lights its axis for this long after it last moved, ms. */
const GLOW_MS = 900;
/** The angles that made the latest flash show this long, ms (the trail's length). */
const READOUT_MS = 4500;

/** A choice whose options stack top to bottom, for the figure's narrow outer column. */
class StackChoice extends Choice {
  override cells(): Rect[] {
    return splitColumn(
      this.rect,
      this.options.map(() => 1),
      12,
    );
  }
}

/**
 * Where the watch view puts the side sketch, the face and the readout. Wide views keep the sketch
 * in a column at the left and give the face the rest; tall ones put the sketch top-left, the
 * readout top-right and the face below across the whole width.
 */
export const watchParts = (
  w: Rect,
  kind: DetectorKind,
  /** Type size of the readout, which a wide view keeps above the face. */
  type = 38,
): { side: Rect; face: Rect; readout: { x: number; y: number; align: "left" | "right" } } => {
  if (w.width > w.height * 1.6) {
    const sw = Math.min(w.width * 0.3, w.height * 1.3);
    const side = { x: w.x, y: w.y, width: sw, height: w.height };
    if (kind === "plate") {
      // The plate stands tall in the middle; the readout sits right of it.
      const face = { x: w.x + sw, y: w.y, width: (w.width - sw) * 0.6, height: w.height };
      return { side, face, readout: { x: w.x + w.width - 24, y: w.y + 20, align: "right" } };
    }
    const top = Math.min(w.height * 0.4, type * 2.6);
    const face = { x: w.x + sw, y: w.y + top, width: w.width - sw, height: w.height - top };
    return { side, face, readout: { x: w.x + w.width - 24, y: w.y + 16, align: "right" } };
  }
  const side = { x: w.x, y: w.y, width: w.width * 0.46, height: w.height * 0.4 };
  if (kind === "plate") {
    // A tall plate beside the sketch, the readout under the sketch.
    const face = { x: w.x + w.width * 0.42, y: w.y, width: w.width * 0.58, height: w.height };
    return { side, face, readout: { x: w.x + 24, y: w.y + w.height * 0.44, align: "left" } };
  }
  const face = { x: w.x, y: w.y + w.height * 0.4, width: w.width, height: w.height * 0.6 };
  return { side, face, readout: { x: w.x + w.width - 24, y: w.y + 24, align: "right" } };
};

/** The glow a fresh flash gets on a face drawn `width` px wide: never under 80 px. */
const flashGlow = (width: number) => Math.max(80, Math.min(150, width * 0.09));

const dialText = (id: DialId | "omega", s: MachineState): string => {
  switch (id) {
    case "omega":
      return `${s.omega.toFixed(1)}°`;
    case "chi":
      return `${s.chi.toFixed(1)}°`;
    case "phi":
      return `${s.phi.toFixed(0)}°`;
    case "arm":
      return `${s.armTwoTheta.toFixed(1)}°`;
    default:
      return `${Math.round(s.distance)} ${L.unit}`;
  }
};

/** Square rects for `n` dials across `r`, or null if they'd be smaller than `min`. */
const dialRow = (r: Rect, n: number, min: number, gap = 18): Rect[] | null => {
  if (n <= 0) return [];
  const side = Math.min(r.height, (r.width - gap * (n - 1)) / n);
  if (side < min) return null;
  const total = n * side + (n - 1) * gap;
  const x0 = r.x + (r.width - total) / 2;
  return Array.from({ length: n }, (_, i) => ({
    x: x0 + i * (side + gap),
    y: r.y + (r.height - side) / 2,
    width: side,
    height: side,
  }));
};

const def: ChapterDef = {
  id: "goniometer",
  state: STATE_RANGES,
  start: encode(START),
  play(t) {
    // The stage turning slowly through the strip's flashes.
    return encode({ ...START, omega: 10 + 30 * (0.5 - 0.5 * Math.cos(t * 0.3)) });
  },
  parts: PARTS,
  split: 0.6,
  watch(g, rect, state) {
    // The big picture: the machine from the side with every flash near now, and the detector's
    // face, flat, below it.
    const s = decode(state);
    const det = detectorFor(s.detector, s.distance);
    const lit = litAt(s, 4);
    well(g, rect);
    const size = Math.max(24, Math.min(rect.height * 0.035, rect.width * 0.03));
    const parts = watchParts(rect, det.kind);
    drawSide(g, inset(parts.side, size * 0.4), { det, arm: s.armTwoTheta, omega: s.omega, lit });
    const faceR = inset(parts.face, size * 0.7);
    drawFace(g, faceR, {
      det,
      arm: s.armTwoTheta,
      spots: lit
        .filter((l) => l.hit)
        .map((l) => ({
          fu: (l.hit as { fu: number }).fu,
          fv: (l.hit as { fv: number }).fv,
          level: l.strength,
        })),
      rings: [],
      size,
      glow: flashGlow(faceR.width),
    });
  },
  drive(state): MachineDrive {
    const s = decode(state);
    return {
      lambda: s.lambda,
      stage: { omega: s.omega, chi: s.chi, phi: s.phi },
      arm: s.armTwoTheta,
      distance: s.distance,
      detector: s.detector,
      sample: { crystal: SAMPLE, form: "single" },
    };
  },
  create(env: ChapterEnv): Chapter {
    let s: MachineState = { ...START };
    let card: CardLayout | null = null;
    let controls: Control[] = [];
    let wheel: Rotary | null = null;
    const dials = new Map<DialId, Rotary>();
    let detectorChoice: Choice | null = null;
    /** The tube: three choices, or on a narrow lane one button that steps through them. */
    let tubeChoice: Choice | null = null;
    let tubeBtn: Button | null = null;
    /** The latest flash: the turn it came at and the angle it came out at. */
    let lastFlash: { at: number; omega: number; twoTheta: number } | null = null;
    let view3d: Pad | null = null;
    /** Where the 3D machine shows: the figure, less any button column. */
    let stageArea: Rect | null = null;
    let machine: Machine3D | null = null;
    let view: View3D | null = null;
    let shown = true;
    const orbit = createOrbit();
    const movedAt: Record<DialId | "omega", number> = {
      omega: Number.NEGATIVE_INFINITY,
      chi: Number.NEGATIVE_INFINITY,
      phi: Number.NEGATIVE_INFINITY,
      arm: Number.NEGATIVE_INFINITY,
      distance: Number.NEGATIVE_INFINITY,
    };
    let lastSpots = 0;

    const set = (id: DialId | "omega", v: number) => {
      movedAt[id] = performance.now();
      if (id === "omega") s = { ...s, omega: v };
      else if (id === "chi") s = { ...s, chi: v };
      else if (id === "phi") s = { ...s, phi: v };
      else if (id === "arm") s = { ...s, armTwoTheta: v };
      else s = { ...s, distance: v };
    };

    /** Which tube's choice is lit: the one whose Kα line λ is, or is nearest. */
    const tubeIndex = () => {
      const t = tubeNear(s.lambda);
      return t ? TUBE_IDS.indexOf(t) : -1;
    };
    const setTube = (i: number) => {
      const t = TUBE_IDS[((i % TUBE_IDS.length) + TUBE_IDS.length) % TUBE_IDS.length]!;
      s = { ...s, lambda: TUBES[t].lambda };
      sync();
    };

    const sync = () => {
      if (wheel) wheel.value = s.omega;
      dials.get("chi")!.value = s.chi;
      dials.get("phi")!.value = s.phi;
      dials.get("arm")!.value = s.armTwoTheta;
      dials.get("distance")!.value = s.distance;
      if (detectorChoice) detectorChoice.value = s.detector === "strip" ? 0 : 1;
      if (tubeChoice) tubeChoice.value = tubeIndex();
    };

    const loadPreset = (kind: "strip" | "plate") => {
      s = presetFor(kind);
      machine?.clear();
      lastFlash = null;
      for (const k of Object.keys(movedAt) as (keyof typeof movedAt)[])
        movedAt[k] = performance.now();
      sync();
    };

    const make = (l: CardLayout) => {
      dials.clear();
      const T0 = l.target;
      const size = l.type.label;
      const outerRight = l.outer === "right";
      const c = l.child;
      const wheelSize = Math.min(c.height - 8, T0 * 2.4, c.width * 0.45);
      const wheelRect: Rect = {
        x: outerRight ? c.x + c.width - wheelSize : c.x,
        y: c.y + (c.height - wheelSize) / 2,
        width: wheelSize,
        height: wheelSize,
      };
      wheel = rotary({
        id: "wheel",
        rect: wheelRect,
        band: "child",
        min: DIAL_RANGE.omega[0],
        max: DIAL_RANGE.omega[1],
        value: s.omega,
        perTurn: 60,
        style: "wheel",
        color: COLOR.angle,
        hub: (g, b) => {
          const maths = env.mathsOpen?.() === true;
          label(
            g,
            maths ? `${L.omega} ${LETTER.omega}` : L.omega!,
            b.x + b.width / 2,
            b.y + b.height * 0.32,
            { size: size * 0.8 },
          );
          label(g, dialText("omega", s), b.x + b.width / 2, b.y + b.height * 0.78, {
            size: size * 0.7,
            color: COLOR.angle,
          });
        },
        onChange: (v) => set("omega", v),
      });
      const rest: Rect = {
        x: outerRight ? c.x : c.x + wheelSize + 24,
        y: c.y,
        width: c.width - wheelSize - 24,
        height: c.height,
      };
      // As many dials as fit with the adults, the rest beside the wheel.
      let inAdult = 0;
      let adultRects: Rect[] = [];
      for (let n = DIALS.length; n >= 1; n--) {
        const row = dialRow(l.adult, n, T0 + 6);
        if (row) {
          inAdult = n;
          adultRects = row;
          break;
        }
      }
      const leftover = DIALS.length - inAdult;
      let restRects: Rect[] = [];
      // The tube's three choices go beside the wheel when they fit there.
      const cellMin = Math.max(T0 * 1.25, 190);
      let tubeRow: Rect | null = null;
      if (leftover > 0) {
        restRects = dialRow(rest, leftover, T0 + 6, 16) ?? [];
      } else if (rest.width >= 3 * cellMin + 28) {
        const h = Math.max(T0, Math.min(rest.height - 8, T0 * 1.15));
        tubeRow = { x: rest.x, y: rest.y + (rest.height - h) / 2, width: rest.width, height: h };
      }
      const dialRects = [...adultRects, ...restRects];
      DIALS.forEach((id, i) => {
        const r = dialRects[i];
        if (!r) return;
        const range =
          id === "chi"
            ? DIAL_RANGE.chi
            : id === "phi"
              ? DIAL_RANGE.phi
              : id === "arm"
                ? DIAL_RANGE.armTwoTheta
                : DIAL_RANGE.distance;
        dials.set(
          id,
          rotary({
            id,
            rect: r,
            band: i < inAdult ? "adult" : "child",
            min: range[0],
            max: range[1],
            value:
              id === "chi"
                ? s.chi
                : id === "phi"
                  ? s.phi
                  : id === "arm"
                    ? s.armTwoTheta
                    : s.distance,
            perTurn: id === "distance" ? 240 : id === "phi" ? 360 : 180,
            wrap: id === "phi",
            style: "dial",
            color: id === "distance" || id === "arm" ? COLOR.real : COLOR.angle,
            hub: (g, b) => {
              const maths = env.mathsOpen?.() === true;
              const word = L[id] ?? id;
              label(
                g,
                maths ? `${word} ${LETTER[id]}` : word,
                b.x + b.width / 2,
                b.y + b.height * 0.28,
                { size: size * 0.62 },
              );
              label(g, dialText(id, s), b.x + b.width / 2, b.y + b.height * 0.78, {
                size: size * 0.56,
                color: COLOR.muted,
              });
            },
            onChange: (v) => set(id, v),
          }),
        );
      });
      // The figure's outer column: the detector's two choices stacked, and below them the tube's
      // Next button when its choices found no room beside the wheel.
      const f = l.figure;
      const safe = l.safe;
      const rows = tubeRow ? 2 : 3;
      const gap = 12;
      const rowH = Math.max(T0, Math.min(T0 * 1.1, (f.height - 16 - gap * (rows - 1)) / rows));
      const colW = Math.max(T0 * 2, Math.min(300, f.width * 0.3));
      const colX =
        outerRight || !l.outer
          ? Math.min(f.x + f.width, safe.x + safe.width) - colW - 10
          : Math.max(f.x, safe.x) + 10;
      const colY = f.y + (f.height - (rows * rowH + (rows - 1) * gap)) / 2;
      const stage3d: Rect =
        outerRight || !l.outer
          ? { ...f, width: colX - 14 - f.x }
          : { ...f, x: colX + colW + 14, width: f.x + f.width - (colX + colW + 14) };
      stageArea = stage3d;
      detectorChoice = new StackChoice({
        id: "detector",
        rect: { x: colX, y: colY, width: colW, height: 2 * rowH + gap },
        band: "adult",
        options: [{ label: L.strip! }, { label: L.plate! }],
        value: s.detector === "strip" ? 0 : 1,
        color: COLOR.real,
        size: size * 0.85,
        onChange: (i) => loadPreset(i === 0 ? "strip" : "plate"),
      });
      tubeChoice = null;
      tubeBtn = null;
      if (tubeRow)
        tubeChoice = choice({
          id: "tube",
          rect: tubeRow,
          band: "adult",
          options: TUBE_IDS.map((t) => ({ label: L[t] ?? t })),
          value: tubeIndex(),
          color: COLOR.beam,
          size: size * 0.85,
          onChange: (i) => setTube(i),
        });
      else
        tubeBtn = button({
          id: "tube",
          rect: { x: colX, y: colY + 2 * (rowH + gap), width: colW, height: rowH },
          band: "adult",
          label: L.nextTube!,
          icon: ICON.next,
          color: COLOR.beam,
          size: size * 0.85,
          onPress: () => setTube(tubeIndex() + 1),
        });
      // The machine sits in the figure, in reach: a drag on it turns the view.
      view3d = pad({
        id: "view",
        rect: stage3d,
        band: "adult",
        onDown: (t) => orbit.begin(t.x, t.y, t.time),
        onMove: (t) => orbit.move(t.x, t.y, t.time),
        botGesture: (rand) => {
          const r = inset(stage3d, stage3d.width * 0.2, stage3d.height * 0.2);
          const a = { x: r.x + rand() * r.width, y: r.y + rand() * r.height };
          const b = { x: r.x + rand() * r.width, y: a.y + (rand() - 0.5) * r.height * 0.4 };
          return {
            path: Array.from({ length: 10 }, (_, i) => ({
              x: a.x + ((b.x - a.x) * i) / 9,
              y: a.y + ((b.y - a.y) * i) / 9,
            })),
            ms: 1100,
          };
        },
      });
      controls = [view3d, wheel, ...dials.values(), detectorChoice, (tubeChoice ?? tubeBtn)!];
      if (view) view.rect = shown ? stage3d : null;
    };

    const ensure3D = () => {
      if (machine) return;
      machine = createMachine3D("close");
      view = env.layer3d().view(machine.scene, machine.camera);
      view.rect = shown ? stageArea : null;
    };

    const glow = (now: number): Glow => {
      const lvl = (id: keyof typeof movedAt) => {
        const held = id === "omega" ? wheel?.held : dials.get(id as DialId)?.held;
        if (held) return 1;
        const age = now - movedAt[id];
        return age < GLOW_MS ? 1 - age / GLOW_MS : 0;
      };
      return {
        omega: lvl("omega"),
        chi: lvl("chi"),
        phi: lvl("phi"),
        arm: lvl("arm"),
        distance: lvl("distance"),
      };
    };

    /** The 3D machine's parts named, over the figure, kept inside it. */
    const drawNames = (g: CanvasRenderingContext2D) => {
      if (!machine || !stageArea || !card) return;
      const r = stageArea;
      const n = machine.names();
      const size = card.type.small;
      g.save();
      g.font = font(800, size);
      g.textBaseline = "middle";
      g.textAlign = "center";
      const pad = size * 0.5;
      const th = size * 1.5;
      const placed: Rect[] = [];
      const clash = (q: Rect) =>
        placed.some(
          (o) =>
            q.x < o.x + o.width + 8 &&
            o.x < q.x + q.width + 8 &&
            q.y < o.y + o.height + 4 &&
            o.y < q.y + q.height + 4,
        );
      for (const [part, p] of Object.entries(n) as [keyof typeof n, { x: number; y: number }][]) {
        const text = COMMON.parts[part];
        const tw = g.measureText(text).width + 2 * pad;
        const x = Math.max(
          r.x + 10 + tw / 2,
          Math.min(r.x + r.width - 10 - tw / 2, r.x + p.x * r.width),
        );
        const y0 = r.y + p.y * r.height;
        // Where it belongs, or just above or below that when another name is in the way.
        let box: Rect | null = null;
        for (const dy of [0, -1.15 * th, 1.15 * th, -2.3 * th]) {
          const y = Math.max(r.y + 10 + th / 2, Math.min(r.y + r.height - 10 - th / 2, y0 + dy));
          const q = { x: x - tw / 2, y: y - th / 2, width: tw, height: th };
          if (!clash(q)) {
            box = q;
            break;
          }
        }
        if (!box) continue;
        placed.push(box);
        roundRect(g, box, th / 2);
        g.fillStyle = withAlpha(COLOR.background, 0.72);
        g.fill();
        g.fillStyle = COLOR.ink;
        g.fillText(text, box.x + tw / 2, box.y + th / 2 + 1);
      }
      g.restore();
    };

    return {
      layout(l) {
        card = l;
        make(l);
      },
      get controls() {
        return controls;
      },
      update(dt, now) {
        if (!card) return;
        orbit.step(dt, now);
        if (!shown) return;
        ensure3D();
        machine!.setOrbit(orbit.azimuth, orbit.elevation);
        machine!.update(
          {
            state: s,
            sample: { crystal: SAMPLE, form: "single", spread: 0 },
            dark: false,
            flash: 0,
            rebuilt: 0,
            active: {},
            glow: glow(now),
            maths: env.mathsOpen?.() === true,
          },
          now,
        );
        const n = machine!.flashes;
        if (n > lastSpots && machine!.spots.length > 0) env.earn();
        lastSpots = n;
        // A new spot on the face: keep the turn that made it and the angle it came out at.
        const last = machine!.spots[machine!.spots.length - 1];
        if (last && (!lastFlash || last.at > lastFlash.at)) {
          const d = detectorPoint(machine!.detector, s.armTwoTheta, last.fu, last.fv);
          const len = Math.hypot(d[0], d[1], d[2]) || 1;
          lastFlash = {
            at: last.at,
            omega: s.omega,
            twoTheta: (Math.acos(Math.max(-1, Math.min(1, d[0] / len))) * 180) / Math.PI,
          };
        }
      },
      draw(g, now) {
        if (!card) return;
        // The 3D machine shows through the figure: only its frame is drawn here.
        if (stageArea) {
          g.save();
          g.lineWidth = 3;
          g.strokeStyle = COLOR.edge;
          g.beginPath();
          g.roundRect(stageArea.x, stageArea.y, stageArea.width, stageArea.height, 28);
          g.stroke();
          g.restore();
        }
        if (!machine) return;
        drawNames(g);
        const w = card.watch;
        g.save();
        g.fillStyle = withAlpha(COLOR.well, 0.9);
        g.strokeStyle = COLOR.edge;
        g.lineWidth = 3;
        g.beginPath();
        g.roundRect(w.x, w.y, w.width, w.height, 28);
        g.fill();
        g.stroke();
        g.restore();
        clipTo(g, w, 28);
        // The detector's face takes most of the view, each flash a big glow fading into its trail;
        // the machine from the side is a small sketch in a corner.
        const parts = watchParts(w, machine.detector.kind, card.type.label);
        const sideR = inset(parts.side, 12);
        g.save();
        g.globalAlpha = 0.85;
        drawSide(g, sideR, {
          det: machine.detector,
          arm: s.armTwoTheta,
          omega: s.omega,
          lit: litAt(s, 4),
        });
        g.restore();
        const faceR = inset(parts.face, 20);
        drawFace(g, faceR, {
          det: machine.detector,
          arm: s.armTwoTheta,
          spots: machine.spots.map((p) => ({ fu: p.fu, fv: p.fv, level: spotLevel(now - p.at) })),
          rings: machine.rings,
          size: card.type.small,
          glow: flashGlow(faceR.width),
        });
        // The two angles that made the latest flash: the turn, and where the flash came out.
        if (lastFlash && now - lastFlash.at < READOUT_MS) {
          const a = Math.min(1, (READOUT_MS - (now - lastFlash.at)) / 1000);
          const t = card.type.label;
          const r = parts.readout;
          label(g, `${L.omega} ${lastFlash.omega.toFixed(1)}°`, r.x, r.y + t * 0.6, {
            size: t,
            align: r.align,
            color: COLOR.angle,
            weight: 800,
            alpha: a,
          });
          label(g, `${L.flashAt} ${lastFlash.twoTheta.toFixed(1)}°`, r.x, r.y + t * 1.8, {
            size: t,
            align: r.align,
            color: COLOR.recip,
            weight: 800,
            alpha: a,
          });
        }
        g.restore();
      },
      numbers() {
        const det = machine?.detector;
        const cols = det
          ? det.kind === "strip"
            ? `${det.columns} columns of ${det.thetaPixel.toFixed(3)}°, pixel ${det.pixel} mm`
            : `${det.columns} by ${det.rows} pixels of ${det.pixel} mm`
          : "";
        return [
          `ω ${s.omega.toFixed(2)}°   χ ${s.chi.toFixed(2)}°   φ ${s.phi.toFixed(2)}°`,
          `2θ ${s.armTwoTheta.toFixed(2)}°   D ${s.distance.toFixed(1)} mm   λ ${s.lambda.toFixed(4)} Å`,
          cols,
        ];
      },
      state: () => encode(s),
      demo(): DemoStep[] {
        // Through both of the flat layers' flashes, (1 1 1) and (2 2 2), from the start.
        return [
          { control: "wheel", to: Math.min(DIAL_RANGE.omega[1], s.omega + 35), ms: 4200 },
          { wait: 900 },
          { control: "chi", to: 20, ms: 1600 },
          { wait: 500 },
          { control: "wheel", to: Math.max(DIAL_RANGE.omega[0], s.omega), ms: 3000 },
        ];
      },
      botMove(rand) {
        // Mostly the wheel, as visitors would.
        if (rand() < 0.4 && wheel) {
          const g = wheel.gesture(undefined, rand);
          return { gesture: g };
        }
        return null;
      },
      hint() {
        return wheel ? centre(wheel.rect) : null;
      },
      status() {
        return {
          omega: Math.round(s.omega * 10) / 10,
          arm: Math.round(s.armTwoTheta * 10) / 10,
          detector: s.detector,
          flashes: machine?.flashes ?? 0,
        };
      },
      reset() {
        s = { ...START };
        lastFlash = null;
        machine?.clear();
        orbit.home();
        for (const k of Object.keys(movedAt) as (keyof typeof movedAt)[])
          movedAt[k] = Number.NEGATIVE_INFINITY;
        sync();
      },
      show(on) {
        shown = on;
        if (view) view.rect = on ? stageArea : null;
      },
      dispose() {
        view?.dispose();
        machine?.dispose();
        view = null;
        machine = null;
        controls = [];
      },
    };
  },
};

export default def;
