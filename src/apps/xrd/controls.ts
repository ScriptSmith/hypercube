/**
 * The controls kit: buttons, choices, sliders, wheels, dials and pads, drawn on a card's canvas
 * and hit-tested by the card, so fingers, bots and demos take one path and a person's touch can
 * be told from a bot's. All geometry is in venue px, frame coordinates.
 *
 * Every control can say how a finger would make it show a value (`gesture`), which is what bots,
 * the attract demos and the ghost hand use. Values are read by the chapter (`value`), or passed
 * to `onChange`. A new finger on a control takes it over from an older one.
 */
import { FONT } from "../../core/ui/style";
import { withAlpha } from "../../core/ui/palette";
import { COLOR } from "./config";
import { inRect, type Rect, splitRow } from "./layout";

export type Band = "adult" | "child";

export interface Touch {
  id: number;
  x: number;
  y: number;
  synthetic: boolean;
  /** performance.now() ms. */
  time: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A finger's path to make a control show something: one point is a tap. */
export interface Gesture {
  path: Point[];
  ms: number;
}

export type ControlKind = "button" | "choice" | "slider" | "rotary" | "pad";

/** Draws a small picture in a box, in the given colour (button and choice icons). */
export type IconDraw = (g: CanvasRenderingContext2D, box: Rect, color: string) => void;

interface Common {
  id: string;
  rect: Rect;
  band: Band;
  label?: string;
  /** Hidden controls are neither drawn nor touched. Default true. */
  visible?: boolean;
  /** Dimmed and untouchable when false. Default true. */
  enabled?: boolean;
}

export interface Control {
  readonly id: string;
  readonly kind: ControlKind;
  rect: Rect;
  band: Band;
  label: string;
  visible: boolean;
  enabled: boolean;
  /** When a finger last moved it (ms), and whether that was a person. */
  readonly touchedAt: number;
  readonly byPerson: boolean;
  /** A finger is on it. */
  readonly held: boolean;
  hit(x: number, y: number): boolean;
  begin(t: Touch): void;
  move(t: Touch): void;
  end(t: Touch, cancelled: boolean): void;
  /** Lift any finger without acting. */
  release(): void;
  /** How a finger makes it show `to` (a value, or an option for a choice); random when absent. */
  gesture(to?: number, rand?: () => number): Gesture | null;
  draw(g: CanvasRenderingContext2D, now: number): void;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const font = (weight: number, size: number): string =>
  `${weight} ${Math.round(size)}px ${FONT}`;

export const roundRect = (g: CanvasRenderingContext2D, r: Rect, radius: number): void => {
  const k = Math.min(radius, r.width / 2, r.height / 2);
  g.beginPath();
  g.roundRect(r.x, r.y, r.width, r.height, k);
};

/** Text that fits a width: shrinks to `min` of its size, then stops. */
export const fitText = (
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size: number,
  weight = 700,
  min = 0.6,
): void => {
  let s = size;
  g.font = font(weight, s);
  const w = g.measureText(text).width;
  if (w > maxWidth && w > 0) {
    s = Math.max(size * min, (size * maxWidth) / w);
    g.font = font(weight, s);
  }
  g.fillText(text, x, y, maxWidth);
};

abstract class Base implements Control {
  abstract readonly kind: ControlKind;
  readonly id: string;
  rect: Rect;
  band: Band;
  label: string;
  visible: boolean;
  enabled: boolean;
  touchedAt = Number.NEGATIVE_INFINITY;
  byPerson = false;
  protected finger: number | null = null;
  constructor(c: Common) {
    this.id = c.id;
    this.rect = c.rect;
    this.band = c.band;
    this.label = c.label ?? "";
    this.visible = c.visible ?? true;
    this.enabled = c.enabled ?? true;
  }
  get held() {
    return this.finger !== null;
  }
  hit(x: number, y: number) {
    return this.visible && this.enabled && inRect(this.rect, x, y);
  }
  protected touch(t: Touch) {
    this.touchedAt = t.time;
    this.byPerson = !t.synthetic;
  }
  begin(t: Touch) {
    this.finger = t.id;
    this.touch(t);
  }
  move(t: Touch) {
    if (this.finger !== t.id) return;
    this.touch(t);
  }
  end(t: Touch, _cancelled: boolean) {
    if (this.finger === t.id) this.finger = null;
  }
  release() {
    this.finger = null;
  }
  abstract gesture(to?: number, rand?: () => number): Gesture | null;
  abstract draw(g: CanvasRenderingContext2D, now: number): void;
}

// ---- Button ----------------------------------------------------------------------------------

export interface ButtonSpec extends Common {
  icon?: IconDraw;
  color?: string;
  look?: "solid" | "ghost";
  /** Drawn lit, for a toggle that is on. */
  on?: boolean;
  /** Text size, venue px. Default from the button's height. */
  size?: number;
  /** A smaller icon and margins, for narrow buttons with a short label (the chapter tabs). */
  tight?: boolean;
  onPress(person: boolean): void;
}

export class Button extends Base {
  readonly kind = "button";
  icon?: IconDraw;
  color: string;
  look: "solid" | "ghost";
  on: boolean;
  size?: number;
  tight: boolean;
  private pressedAt = Number.NEGATIVE_INFINITY;
  private readonly onPress: (person: boolean) => void;
  constructor(s: ButtonSpec) {
    super(s);
    this.icon = s.icon;
    this.color = s.color ?? COLOR.accent;
    this.look = s.look ?? "ghost";
    this.on = s.on ?? false;
    this.size = s.size;
    this.tight = s.tight ?? false;
    this.onPress = s.onPress;
  }
  override begin(t: Touch) {
    super.begin(t);
    this.pressedAt = t.time;
    this.onPress(!t.synthetic);
  }
  gesture(): Gesture {
    return {
      path: [{ x: this.rect.x + this.rect.width / 2, y: this.rect.y + this.rect.height / 2 }],
      ms: 110,
    };
  }
  draw(g: CanvasRenderingContext2D, now: number) {
    if (!this.visible) return;
    drawButtonFace(g, this.rect, {
      label: this.label,
      icon: this.icon,
      color: this.color,
      solid: this.look === "solid" || this.on,
      pressed: this.held || now - this.pressedAt < 160,
      enabled: this.enabled,
      size: this.size,
      tight: this.tight,
    });
  }
}

export const drawButtonFace = (
  g: CanvasRenderingContext2D,
  r: Rect,
  o: {
    label: string;
    icon?: IconDraw;
    color: string;
    solid: boolean;
    pressed: boolean;
    enabled: boolean;
    size?: number;
    tight?: boolean;
  },
): void => {
  g.save();
  g.globalAlpha = o.enabled ? 1 : 0.35;
  const s = o.pressed ? 0.95 : 1;
  const cr: Rect = {
    x: r.x + (r.width * (1 - s)) / 2,
    y: r.y + (r.height * (1 - s)) / 2,
    width: r.width * s,
    height: r.height * s,
  };
  const radius = Math.min(cr.height / 2, 44);
  roundRect(g, cr, radius);
  if (o.solid) {
    g.fillStyle = o.color;
    g.shadowColor = withAlpha(o.color, 0.45);
    g.shadowBlur = 24;
    g.fill();
    g.shadowBlur = 0;
  } else {
    g.fillStyle = withAlpha(COLOR.background, 0.78);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = withAlpha(o.color, 0.7);
    g.stroke();
  }
  const ink = o.solid ? COLOR.background : o.color;
  const size = o.size ?? Math.min(cr.height * 0.36, 46);
  const ic = o.tight ? 0.5 : 0.6;
  const iconBox = o.icon
    ? o.label
      ? {
          x: cr.x + cr.height * (o.tight ? 0.12 : 0.18),
          y: cr.y + cr.height * (1 - ic) * 0.5,
          width: cr.height * ic,
          height: cr.height * ic,
        }
      : {
          x: cr.x + (cr.width - cr.height * 0.62) / 2,
          y: cr.y + cr.height * 0.19,
          width: cr.height * 0.62,
          height: cr.height * 0.62,
        }
    : null;
  if (iconBox && o.icon) o.icon(g, iconBox, ink);
  if (o.label) {
    g.fillStyle = ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const left = iconBox ? iconBox.x + iconBox.width : cr.x;
    const right = cr.x + cr.width;
    const pad = cr.height * (o.tight ? 0.07 : 0.18);
    fitText(
      g,
      o.label,
      (left + right) / 2,
      cr.y + cr.height / 2 + size * 0.04,
      right - left - pad * 2,
      size,
      800,
    );
  }
  g.restore();
};

// ---- Choice ----------------------------------------------------------------------------------

export interface ChoiceSpec extends Common {
  options: readonly { label: string; icon?: IconDraw; color?: string }[];
  value: number;
  color?: string;
  size?: number;
  onChange?(index: number, person: boolean): void;
}

export class Choice extends Base {
  readonly kind = "choice";
  options: ChoiceSpec["options"];
  value: number;
  color: string;
  size?: number;
  private readonly onChange?: (i: number, person: boolean) => void;
  constructor(s: ChoiceSpec) {
    super(s);
    this.options = s.options;
    this.value = s.value;
    this.color = s.color ?? COLOR.accent;
    this.size = s.size;
    this.onChange = s.onChange;
  }
  cells(): Rect[] {
    return splitRow(
      this.rect,
      this.options.map(() => 1),
      14,
    );
  }
  override begin(t: Touch) {
    super.begin(t);
    const i = this.cells().findIndex((c) => inRect(c, t.x, t.y));
    if (i >= 0 && i !== this.value) {
      this.value = i;
      this.onChange?.(i, !t.synthetic);
    } else if (i >= 0) this.onChange?.(i, !t.synthetic);
  }
  gesture(to?: number, rand: () => number = Math.random): Gesture | null {
    const n = this.options.length;
    if (n === 0) return null;
    const i = to === undefined ? Math.floor(rand() * n) : clamp(Math.round(to), 0, n - 1);
    const c = this.cells()[i]!;
    return { path: [{ x: c.x + c.width / 2, y: c.y + c.height / 2 }], ms: 110 };
  }
  draw(g: CanvasRenderingContext2D) {
    if (!this.visible) return;
    this.cells().forEach((c, i) => {
      const o = this.options[i]!;
      drawButtonFace(g, c, {
        label: o.label,
        icon: o.icon,
        color: o.color ?? this.color,
        solid: i === this.value,
        pressed: false,
        enabled: this.enabled,
        size: this.size,
      });
    });
  }
}

// ---- Slider ----------------------------------------------------------------------------------

export interface SliderSpec extends Common {
  min: number;
  max: number;
  value: number;
  /** Values snap to this. */
  step?: number;
  color?: string;
  /** The readout beside the label. */
  format?(v: number): string;
  /** Label size, venue px. */
  size?: number;
  onChange?(v: number, person: boolean): void;
}

export class Slider extends Base {
  readonly kind = "slider";
  min: number;
  max: number;
  value: number;
  step: number;
  color: string;
  size: number;
  format?: (v: number) => string;
  private readonly onChange?: (v: number, person: boolean) => void;
  constructor(s: SliderSpec) {
    super(s);
    this.min = s.min;
    this.max = s.max;
    this.value = clamp(s.value, s.min, s.max);
    this.step = s.step ?? 0;
    this.color = s.color ?? COLOR.accent;
    this.size = s.size ?? 38;
    this.format = s.format;
    this.onChange = s.onChange;
  }
  /** The track: the lower part of the rect, inset by the knob's radius. */
  track(): { x0: number; x1: number; y: number; knob: number } {
    const r = this.rect;
    const knob = Math.min(r.height * 0.27, 44);
    const y = r.y + r.height - knob - 6;
    return { x0: r.x + knob, x1: r.x + r.width - knob, y, knob };
  }
  xOf(v: number): number {
    const t = this.track();
    return (
      t.x0 +
      ((clamp(v, this.min, this.max) - this.min) / (this.max - this.min || 1)) * (t.x1 - t.x0)
    );
  }
  valueAt(x: number): number {
    const t = this.track();
    const f = clamp((x - t.x0) / Math.max(1, t.x1 - t.x0), 0, 1);
    let v = this.min + f * (this.max - this.min);
    if (this.step > 0) v = this.min + Math.round((v - this.min) / this.step) * this.step;
    return clamp(v, this.min, this.max);
  }
  set(v: number, person: boolean) {
    const nv = clamp(v, this.min, this.max);
    if (nv === this.value) return;
    this.value = nv;
    this.onChange?.(nv, person);
  }
  override begin(t: Touch) {
    super.begin(t);
    this.set(this.valueAt(t.x), !t.synthetic);
  }
  override move(t: Touch) {
    if (this.finger !== t.id) return;
    super.move(t);
    this.set(this.valueAt(t.x), !t.synthetic);
  }
  gesture(to?: number, rand: () => number = Math.random): Gesture {
    const target = to ?? this.min + rand() * (this.max - this.min);
    const y = this.track().y;
    const from = this.xOf(this.value);
    const end = this.xOf(target);
    const steps = 10;
    return {
      path: Array.from({ length: steps + 1 }, (_, i) => ({
        x: from + ((end - from) * i) / steps,
        y,
      })),
      ms: 500 + Math.abs(end - from) * 1.4,
    };
  }
  draw(g: CanvasRenderingContext2D) {
    if (!this.visible) return;
    const r = this.rect;
    const t = this.track();
    g.save();
    g.globalAlpha = this.enabled ? 1 : 0.35;
    g.textBaseline = "alphabetic";
    g.fillStyle = COLOR.ink;
    g.textAlign = "left";
    const labelY = r.y + this.size * 0.95;
    const readout = this.format?.(this.value) ?? "";
    g.font = font(700, this.size);
    const rw = readout ? g.measureText(readout).width + 24 : 0;
    fitText(g, this.label, r.x + 4, labelY, r.width - rw - 8, this.size, 700);
    if (readout) {
      g.textAlign = "right";
      g.fillStyle = this.color;
      g.font = font(700, this.size * 0.92);
      g.fillText(readout, r.x + r.width - 4, labelY);
    }
    g.lineCap = "round";
    g.lineWidth = Math.max(10, t.knob * 0.42);
    g.strokeStyle = withAlpha(COLOR.ink, 0.18);
    g.beginPath();
    g.moveTo(t.x0, t.y);
    g.lineTo(t.x1, t.y);
    g.stroke();
    const kx = this.xOf(this.value);
    g.strokeStyle = withAlpha(this.color, 0.75);
    g.beginPath();
    g.moveTo(t.x0, t.y);
    g.lineTo(kx, t.y);
    g.stroke();
    g.fillStyle = this.color;
    g.shadowColor = withAlpha(this.color, 0.5);
    g.shadowBlur = this.held ? 30 : 14;
    g.beginPath();
    g.arc(kx, t.y, t.knob * (this.held ? 1.08 : 1), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

// ---- Rotary: the children's big wheel and the adults' dials ---------------------------------

export interface RotarySpec extends Common {
  min: number;
  max: number;
  value: number;
  /** Value units per full turn of the finger. */
  perTurn: number;
  /** Wrap round instead of stopping at the ends. */
  wrap?: boolean;
  style?: "wheel" | "dial";
  color?: string;
  size?: number;
  format?(v: number): string;
  /** Draws the wheel's middle (a crystal on chapter 4's wheel, say). */
  hub?: IconDraw;
  onChange?(v: number, person: boolean): void;
}

export class Rotary extends Base {
  readonly kind = "rotary";
  min: number;
  max: number;
  value: number;
  perTurn: number;
  wrap: boolean;
  style: "wheel" | "dial";
  color: string;
  size: number;
  format?: (v: number) => string;
  hub?: IconDraw;
  private last = 0;
  private readonly onChange?: (v: number, person: boolean) => void;
  constructor(s: RotarySpec) {
    super(s);
    this.min = s.min;
    this.max = s.max;
    this.value = clamp(s.value, s.min, s.max);
    this.perTurn = s.perTurn;
    this.wrap = s.wrap ?? false;
    this.style = s.style ?? "wheel";
    this.color = s.color ?? COLOR.accent;
    this.size = s.size ?? 38;
    this.format = s.format;
    this.hub = s.hub;
    this.onChange = s.onChange;
  }
  /** The wheel's circle: below the label row for dials, the whole square for wheels. */
  circle(): { x: number; y: number; r: number } {
    const r = this.rect;
    const labelH = this.label ? this.size * 1.3 : 0;
    const h = r.height - labelH;
    const rad = Math.max(10, Math.min(r.width, h) / 2 - 4);
    return { x: r.x + r.width / 2, y: r.y + labelH + h / 2, r: rad };
  }
  /** Screen angle (radians, 0 to the right, counterclockwise up) the marker shows for a value. */
  angleOf(v: number): number {
    return Math.PI / 2 - ((v - this.min) / this.perTurn) * Math.PI * 2;
  }
  override hit(x: number, y: number) {
    if (!this.visible || !this.enabled) return false;
    const c = this.circle();
    return Math.hypot(x - c.x, y - c.y) <= c.r * 1.12 || inRect(this.rect, x, y);
  }
  private angleAt(x: number, y: number) {
    const c = this.circle();
    return Math.atan2(c.y - y, x - c.x);
  }
  private set(v: number, person: boolean) {
    let nv = v;
    if (this.wrap) {
      const span = this.max - this.min;
      nv = this.min + ((((v - this.min) % span) + span) % span);
    } else nv = clamp(v, this.min, this.max);
    if (nv === this.value) return;
    this.value = nv;
    this.onChange?.(nv, person);
  }
  override begin(t: Touch) {
    super.begin(t);
    this.last = this.angleAt(t.x, t.y);
  }
  override move(t: Touch) {
    if (this.finger !== t.id) return;
    super.move(t);
    const c = this.circle();
    // Near the middle the angle is unreliable; ignore it there.
    if (Math.hypot(t.x - c.x, t.y - c.y) < c.r * 0.18) return;
    const a = this.angleAt(t.x, t.y);
    let d = a - this.last;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    this.last = a;
    // Clockwise (screen) turns increase the value.
    this.set(this.value - (d / (2 * Math.PI)) * this.perTurn, !t.synthetic);
  }
  gesture(to?: number, rand: () => number = Math.random): Gesture {
    const c = this.circle();
    let target = to ?? this.value + (rand() - 0.5) * this.perTurn * 0.9;
    if (!this.wrap) target = clamp(target, this.min, this.max);
    // Hold the rim at the marker and carry it round to where the target puts it.
    const a0 = this.angleOf(this.value);
    const turn = -((target - this.value) / this.perTurn) * Math.PI * 2;
    const rr = c.r * 0.72;
    const steps = Math.max(4, Math.ceil(Math.abs(turn) / 0.2));
    const path = Array.from({ length: steps + 1 }, (_, i) => {
      const a = a0 + (turn * i) / steps;
      return { x: c.x + rr * Math.cos(a), y: c.y - rr * Math.sin(a) };
    });
    return { path, ms: 500 + Math.abs(turn) * 380 };
  }
  draw(g: CanvasRenderingContext2D) {
    if (!this.visible) return;
    const c = this.circle();
    const r = this.rect;
    g.save();
    g.globalAlpha = this.enabled ? 1 : 0.35;
    if (this.label) {
      g.textBaseline = "alphabetic";
      g.textAlign = "center";
      g.fillStyle = COLOR.ink;
      const readout = this.format?.(this.value);
      fitText(
        g,
        readout ? `${this.label}  ${readout}` : this.label,
        r.x + r.width / 2,
        r.y + this.size,
        r.width,
        this.size,
        700,
      );
    }
    const a = this.angleOf(this.value);
    // Rim.
    g.beginPath();
    g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    g.fillStyle = withAlpha(COLOR.background, 0.8);
    g.fill();
    g.lineWidth = this.style === "wheel" ? 10 : 6;
    g.strokeStyle = withAlpha(this.color, this.held ? 0.95 : 0.6);
    g.stroke();
    if (this.style === "wheel") {
      // Spokes that turn with the value, so the wheel visibly spins.
      g.lineWidth = 6;
      g.strokeStyle = withAlpha(this.color, 0.35);
      for (let i = 0; i < 6; i++) {
        const s = a + (i * Math.PI) / 3;
        g.beginPath();
        g.moveTo(c.x + Math.cos(s) * c.r * 0.3, c.y - Math.sin(s) * c.r * 0.3);
        g.lineTo(c.x + Math.cos(s) * c.r * 0.92, c.y - Math.sin(s) * c.r * 0.92);
        g.stroke();
      }
    } else if (!this.wrap) {
      // The dial's range, as an arc.
      g.lineWidth = 5;
      g.strokeStyle = withAlpha(COLOR.ink, 0.2);
      const a0 = this.angleOf(this.min);
      const a1 = this.angleOf(this.max);
      g.beginPath();
      g.arc(c.x, c.y, c.r * 0.82, -a0, -a1, a1 > a0);
      g.stroke();
    }
    // Marker knob on the rim: where to grab.
    const kx = c.x + Math.cos(a) * c.r * 0.72;
    const ky = c.y - Math.sin(a) * c.r * 0.72;
    g.fillStyle = this.color;
    g.shadowColor = withAlpha(this.color, 0.5);
    g.shadowBlur = this.held ? 30 : 12;
    g.beginPath();
    g.arc(kx, ky, Math.max(14, c.r * (this.style === "wheel" ? 0.17 : 0.2)), 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    if (this.hub) {
      const s = c.r * 0.5;
      this.hub(g, { x: c.x - s / 2, y: c.y - s / 2, width: s, height: s }, this.color);
    }
    g.restore();
  }
}

// ---- Pad: a region the chapter handles itself ------------------------------------------------

export interface PadSpec extends Common {
  onDown?(t: Touch): void;
  onMove?(t: Touch): void;
  onUp?(t: Touch, cancelled: boolean): void;
  /** A bot's or demo's gesture here; a random drag across the pad when absent. */
  botGesture?(rand: () => number, to?: number): Gesture | null;
  /** Draws nothing by default: the chapter draws its own figure. */
  paint?(g: CanvasRenderingContext2D, now: number): void;
}

export class Pad extends Base {
  readonly kind = "pad";
  private readonly spec: PadSpec;
  constructor(s: PadSpec) {
    super(s);
    this.spec = s;
  }
  override begin(t: Touch) {
    super.begin(t);
    this.spec.onDown?.(t);
  }
  override move(t: Touch) {
    if (this.finger !== t.id) return;
    super.move(t);
    this.spec.onMove?.(t);
  }
  override end(t: Touch, cancelled: boolean) {
    if (this.finger === t.id) this.spec.onUp?.(t, cancelled);
    super.end(t, cancelled);
  }
  gesture(to?: number, rand: () => number = Math.random): Gesture | null {
    const own = this.spec.botGesture?.(rand, to);
    if (own !== undefined) return own;
    const r = this.rect;
    const p = () => ({
      x: r.x + r.width * (0.2 + 0.6 * rand()),
      y: r.y + r.height * (0.2 + 0.6 * rand()),
    });
    const a = p();
    const b = p();
    return {
      path: Array.from({ length: 9 }, (_, i) => ({
        x: a.x + ((b.x - a.x) * i) / 8,
        y: a.y + ((b.y - a.y) * i) / 8,
      })),
      ms: 900,
    };
  }
  draw(g: CanvasRenderingContext2D, now: number) {
    if (this.visible) this.spec.paint?.(g, now);
  }
}

export const button = (s: ButtonSpec): Button => new Button(s);
export const choice = (s: ChoiceSpec): Choice => new Choice(s);
export const slider = (s: SliderSpec): Slider => new Slider(s);
export const rotary = (s: RotarySpec): Rotary => new Rotary(s);
export const pad = (s: PadSpec): Pad => new Pad(s);
