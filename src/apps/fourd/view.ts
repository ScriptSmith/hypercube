/**
 * One WebGL renderer for the frame (src/core/renderer3d.ts) drawing every view: a port is a
 * scene with its own camera, drawn into its lane with the scissor test, its shape framed in its
 * focus rectangle. Programs compile in the background; nothing draws until they are ready.
 */
import { PerspectiveCamera, type Vector3 } from "three";
import { createRenderer3D, type Renderer3D } from "../../core/renderer3d";
import type { FrameInfo, Rect } from "../../core/types";
import { frameCamera, ringPoints, spherePoints } from "./camera";
import type { Mat4 } from "./rot";
import {
  createKit,
  createStage3,
  createStage4,
  FLOOR_Y,
  type Kit,
  LAMP_Y,
  SHEET_HALF,
  type SliceSlot,
  type SliceStyle,
  type Stage3,
  type Stage4,
} from "./scenes";
import type { Shape } from "./shapes";
import { REACH, shadowRadius } from "./slice";

/** "stack3" is a 3D stage with several slices and no single sheet (a flat bank's screen). */
export type PortKind = "stage4" | "slice4" | "stage3" | "stack3" | "slice3";

export interface Port {
  readonly kind: PortKind;
  readonly stage: Stage4 | Stage3;
  readonly cam: PerspectiveCamera;
  /** Venue px. */
  lane: Rect;
  focus: Rect;
  azimuth: number;
  elevation: number;
}

export interface Painter {
  readonly r3: Renderer3D;
  readonly ready: boolean;
  add(kind: PortKind, slots: number, lane: Rect, focus: Rect, style?: SliceStyle): Port;
  /** Compile every port's programs; call once the ports are added. */
  prepare(): void;
  resize(frame: FrameInfo): void;
  /** Aim a port's camera and update its scene. */
  update(port: Port, shape: Shape, rot: Mat4, slots: readonly SliceSlot[]): void;
  /**
   * Clear, then draw the given ports in order; `only` picks one slot of a port's scene, and a
   * `lane` and `focus` draw it somewhere else (the camera keeps its place, only its framing moves).
   */
  render(list: readonly { port: Port; only?: number; lane?: Rect; focus?: Rect }[]): void;
  dispose(): void;
}

const SLICE3_TILT = 38;

const pointsFor = (kind: PortKind): Vector3[] => {
  switch (kind) {
    case "stage4":
      return spherePoints(shadowRadius() * 1.03);
    case "slice4":
      return spherePoints(1.04);
    case "stage3":
    case "stack3": {
      const corner = SHEET_HALF * Math.SQRT2;
      return ringPoints([
        [LAMP_Y + 0.14, 0],
        [REACH, corner],
        [0, 1.02],
        [-REACH, corner],
        [FLOOR_Y, 1.8],
      ]);
    }
    default: {
      const corner = SHEET_HALF * Math.SQRT2;
      return ringPoints([
        [0.04, corner],
        [-0.04, corner],
      ]);
    }
  }
};

const POINTS: Record<PortKind, Vector3[]> = {
  stage4: pointsFor("stage4"),
  slice4: pointsFor("slice4"),
  stage3: pointsFor("stage3"),
  stack3: pointsFor("stack3"),
  slice3: pointsFor("slice3"),
};

export const createPainter = (root: HTMLElement, frame: FrameInfo): Painter => {
  const r3 = createRenderer3D(root, frame, { alpha: true, antialias: true, zIndex: 0 });
  const renderer = r3.renderer;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.localClippingEnabled = true;
  const kit: Kit = r3.keep(createKit());
  const ports: Port[] = [];
  let info = frame;

  const stagePx = (r: Rect): Rect => ({
    x: r.x * info.unit,
    y: r.y * info.unit,
    width: r.width * info.unit,
    height: r.height * info.unit,
  });

  return {
    r3,
    get ready() {
      return r3.ready;
    },
    add(kind, slots, lane, focus, style) {
      const stage =
        kind === "stage4"
          ? createStage4(kit, slots, true, style)
          : kind === "slice4"
            ? createStage4(kit, slots, false, style)
            : kind === "slice3"
              ? createStage3(kit, { slots, solid: false, sheet: true })
              : createStage3(kit, { slots, solid: true, sheet: kind === "stage3" });
      r3.keep(stage);
      const cam = new PerspectiveCamera(30, 1, 0.1, 100);
      const port: Port = { kind, stage, cam, lane, focus, azimuth: -30, elevation: 22 };
      ports.push(port);
      return port;
    },
    prepare() {
      for (const p of ports) {
        frameCamera(
          p.cam,
          stagePx(p.lane),
          stagePx(p.focus),
          p.azimuth,
          p.elevation,
          POINTS[p.kind],
        );
        r3.prepare(p.stage.scene, p.cam);
      }
    },
    resize(f) {
      info = f;
      r3.resize(f);
    },
    update(port, shape, rot, slots) {
      const el = port.kind === "slice3" ? Math.max(port.elevation, SLICE3_TILT) : port.elevation;
      frameCamera(
        port.cam,
        stagePx(port.lane),
        stagePx(port.focus),
        port.azimuth,
        el,
        POINTS[port.kind],
      );
      port.stage.update(shape, rot, slots, port.cam);
    },
    render(list) {
      if (!r3.ready) return;
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.setScissorTest(true);
      const H = info.height;
      for (const { port, only, lane, focus } of list) {
        if (lane && focus) {
          const el =
            port.kind === "slice3" ? Math.max(port.elevation, SLICE3_TILT) : port.elevation;
          frameCamera(port.cam, stagePx(lane), stagePx(focus), port.azimuth, el, POINTS[port.kind]);
        }
        const l = stagePx(lane ?? port.lane);
        const y = H - l.y - l.height;
        renderer.setViewport(l.x, y, l.width, l.height);
        renderer.setScissor(l.x, y, l.width, l.height);
        if (only !== undefined) port.stage.only(only);
        renderer.render(port.stage.scene, port.cam);
      }
      renderer.setScissorTest(false);
    },
    dispose() {
      ports.length = 0;
      r3.dispose();
    },
  };
};
