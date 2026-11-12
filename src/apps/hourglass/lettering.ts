/**
 * The rings' lettering: each ring has a small canvas holding one copy of its line and the gap
 * to the next, which the ball's shader wraps round its latitude. A canvas is drawn again only
 * when its line changes.
 */
import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  Vector4,
} from "three";
import type { SphereInfo } from "../../core/types";
import { EM_OVER_BAND, layoutRings, type RingPlace, type RingRole } from "./rings";
import { fitRing, type RingFit } from "./text";
import type { Ink } from "./time";

const ROLES: readonly RingRole[] = ["collar", "message", "pole"];
const TAU = Math.PI * 2;
const INK = "#fff1d4";
const FONT = 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
/** Space between copies of a line, in letter sizes. */
const GAP_EM = 2.4;
/** Canvas pixels for each feed pixel the lettering covers at its ring's middle. */
const OVERSAMPLE = 1.2;
/** Widest canvas, px; a longer line is drawn a little softer. */
const WIDEST = 8192;
const MEASURE_PX = 100;

interface Slot {
  role: RingRole;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D | null;
  texture: CanvasTexture;
  place: RingPlace | null;
  text: string;
  template: string;
  fit: RingFit | null;
}

export interface RingState {
  role: RingRole;
  text: string;
  lat: number;
  repeats: number;
  crawl: boolean;
  seam: boolean;
  width: number;
  height: number;
  opacity: number;
}

export interface Lettering {
  readonly uniforms: {
    uTex0: { value: CanvasTexture };
    uTex1: { value: CanvasTexture };
    uTex2: { value: CanvasTexture };
    uRing: { value: Vector4[] };
    uInk: { value: Vector3[] };
  };
  /** Put the rings on a ball whose feed has `rows` pixels for each radian of latitude. */
  place(sphere: SphereInfo, rows: number): void;
  /**
   * Set a ring's line. `template` is the widest the line gets while it keeps its form, so the
   * ring's layout holds still as digits change.
   */
  say(role: RingRole, text: string, template?: string): void;
  /** Move the crawling rings to where they are at `seconds`, and set how strongly each shows. */
  update(seconds: number, ink: Ink): void;
  state(): RingState[];
  dispose(): void;
}

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";

/** A line as runs of digits, each set in a cell of one width, and the text between them. */
const runs = (text: string): { text: string; digits: boolean }[] => {
  const out: { text: string; digits: boolean }[] = [];
  for (const ch of text) {
    const digits = isDigit(ch);
    const last = out.at(-1);
    if (last && last.digits === digits) last.text += ch;
    else out.push({ text: ch, digits });
  }
  return out;
};

export const createLettering = (maxTexture: number): Lettering => {
  const widest = Math.max(256, Math.min(WIDEST, maxTexture));
  let rows = 1;
  const slots: Slot[] = ROLES.map((role) => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const texture = new CanvasTexture(canvas);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = SRGBColorSpace;
    return {
      role,
      canvas,
      g: canvas.getContext("2d"),
      texture,
      place: null,
      text: "",
      template: "",
      fit: null,
    };
  });
  const uniforms = {
    uTex0: { value: slots[0]!.texture },
    uTex1: { value: slots[1]!.texture },
    uTex2: { value: slots[2]!.texture },
    uRing: { value: slots.map(() => new Vector4(0, 0.1, 1, 0)) },
    uInk: { value: slots.map(() => new Vector3(0, 0, 0)) },
  };

  const ruler = document.createElement("canvas").getContext("2d");
  let digitEm = 0.6;
  let capEm = 0.72;
  if (ruler) {
    ruler.font = `600 ${MEASURE_PX}px ${FONT}`;
    digitEm = Math.max(...[..."0123456789"].map((d) => ruler.measureText(d).width)) / MEASURE_PX;
    const cap = ruler.measureText("H").actualBoundingBoxAscent;
    if (cap > 0) capEm = cap / MEASURE_PX;
  }
  /** A line's width in letter sizes, with every digit as wide as the widest. */
  const widthEm = (text: string): number => {
    if (!ruler) return text.length * 0.6;
    let w = 0;
    for (const run of runs(text)) {
      w += run.digits ? run.text.length * digitEm : ruler.measureText(run.text).width / MEASURE_PX;
    }
    return w;
  };

  const draw = (slot: Slot, index: number) => {
    const { place, text, canvas, g } = slot;
    const ring = uniforms.uRing.value[index]!;
    const ink = uniforms.uInk.value[index]!;
    if (place) ring.set(place.lat, place.half, ring.z, ring.w);
    if (!place || !text || !g) {
      slot.fit = null;
      return;
    }
    const around = TAU * Math.cos(place.lat);
    const band = 2 * place.half;
    const em = EM_OVER_BAND * band;
    const wide = Math.max(widthEm(text), widthEm(slot.template)) * em;
    const fit = fitRing(wide, around, GAP_EM * em, place.role === "collar");
    slot.fit = fit;
    let scale = rows * OVERSAMPLE;
    if (fit.period * scale > widest) scale = widest / fit.period;
    const w = Math.max(2, Math.round(fit.period * scale));
    const h = Math.max(2, Math.round(band * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      // The texture's storage is the old size.
      slot.texture.dispose();
    } else {
      g.clearRect(0, 0, w, h);
    }
    const px = em * scale;
    g.font = `600 ${px}px ${FONT}`;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    g.fillStyle = INK;
    const baseline = h / 2 + (capEm * px) / 2;
    const cell = digitEm * px;
    const paint = () => {
      let x = (w - widthEm(text) * px) / 2;
      for (const run of runs(text)) {
        if (!run.digits) {
          g.fillText(run.text, x, baseline);
          x += g.measureText(run.text).width;
          continue;
        }
        for (const d of run.text) {
          g.fillText(d, x + (cell - g.measureText(d).width) / 2, baseline);
          x += cell;
        }
      }
      // A stop between copies, half at each end so it closes round the ring.
      if (!fit.seam) {
        for (const at of [0, w]) {
          g.beginPath();
          g.arc(at, h / 2, px * 0.09, 0, TAU);
          g.fill();
        }
      }
    };
    // A dark halo first, so the letters read over sand as well as over glass.
    g.shadowColor = "rgba(0,0,0,0.9)";
    g.shadowBlur = px * 0.16;
    paint();
    paint();
    g.shadowColor = "transparent";
    g.shadowBlur = 0;
    paint();
    slot.texture.needsUpdate = true;
    ring.z = fit.period;
    ink.y = fit.seam ? 1 : 0;
  };

  return {
    uniforms,
    place(sphere, feedRows) {
      rows = Math.max(1, feedRows);
      const places = layoutRings(sphere);
      slots.forEach((slot, i) => {
        slot.place = places.find((p) => p.role === slot.role) ?? null;
        draw(slot, i);
      });
    },
    say(role, text, template = "") {
      const i = ROLES.indexOf(role);
      const slot = slots[i]!;
      if (slot.text === text && slot.template === template) return;
      slot.text = text;
      slot.template = template;
      draw(slot, i);
    },
    update(seconds, ink) {
      slots.forEach((slot, i) => {
        const look = uniforms.uInk.value[i]!;
        const { fit, place } = slot;
        if (!fit || !place) {
          look.x = 0;
          return;
        }
        look.x = slot.role === "message" ? ink.message : ink.time;
        const ring = uniforms.uRing.value[i]!;
        ring.w = fit.crawl ? (seconds * place.speed) % fit.period : 0;
      });
    },
    state: () =>
      slots.map((slot, i) => ({
        role: slot.role,
        text: slot.fit ? slot.text : "",
        lat: slot.place?.lat ?? 0,
        repeats: slot.fit?.repeats ?? 0,
        crawl: slot.fit?.crawl ?? false,
        seam: slot.fit?.seam ?? false,
        width: slot.canvas.width,
        height: slot.canvas.height,
        opacity: uniforms.uInk.value[i]!.x,
      })),
    dispose() {
      for (const slot of slots) {
        slot.texture.dispose();
        slot.canvas.width = slot.canvas.height = 0;
      }
    },
  };
};
