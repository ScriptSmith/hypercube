/**
 * The wall's banner: the poster's title and the machine stretched across the top of the wall,
 * each part over the column whose chapter explains it, with a leader line down to that column.
 * The wall's own columns drive it, as a bank's frames drive the screen's (drive.ts).
 */
import { type Band, createBand } from "./band";
import { COMMON } from "./captions";
import { COLOR } from "./config";
import { compose, type Driver, ownRun } from "./drive";
import { label } from "./draw";
import type { ChapterId } from "./ids";
import type { Layer3D } from "./layer3d";
import type { Rect } from "./layout";
import { placeParts } from "./parts";

export interface Banner {
  setRect(r: Rect): void;
  update(drivers: readonly Driver[], now: number): void;
  render(): void;
  /** For tests: the leader lines, frame venue px. */
  leaders(): ReturnType<Band["leaders"]>;
  /** For checks: the machine's arm as drawn. */
  arm(): Band["machine"]["arm"];
  dispose(): void;
}

export const createBanner = (
  root: HTMLElement,
  rect: Rect,
  columns: readonly (readonly ChapterId[])[],
  numberOf: (id: ChapterId) => number,
  layer: () => Layer3D,
  frame: () => { unit: number; pixelRatio: number },
): Banner => {
  let r = rect;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;z-index:1;pointer-events:none;";
  root.append(canvas);
  const g = canvas.getContext("2d")!;
  const spots = placeParts(columns, numberOf);
  const band = createBand(layer());
  const start = performance.now();
  let active = {};
  // The machine fills the banner; the title sits in its top-left corner, above the floor.
  const bandRect = () => ({ ...r });
  const place = () => {
    const { unit: u, pixelRatio: k } = frame();
    canvas.style.left = `${r.x * u}px`;
    canvas.style.top = `${r.y * u}px`;
    canvas.style.width = `${r.width * u}px`;
    canvas.style.height = `${r.height * u}px`;
    canvas.width = Math.max(1, Math.round(r.width * u * k));
    canvas.height = Math.max(1, Math.round(r.height * u * k));
    band.place(bandRect(), spots, true);
  };
  place();
  let tick = 0;
  return {
    setRect(nr) {
      r = nr;
      place();
    },
    update(drivers, now) {
      const look = compose(ownRun((now - start) / 1000), drivers, now);
      active = look.active;
      band.update(look, now);
    },
    render() {
      if (tick++ % 2 === 1) return;
      const { unit: u, pixelRatio: k } = frame();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(u * k, 0, 0, u * k, -r.x * u * k, -r.y * u * k);
      const h = r.height;
      // The poster's name, large enough to read across the room, the subtitle under it.
      label(g, COMMON.title, r.x + h * 0.12, r.y + h * 0.12, {
        size: h * 0.16,
        align: "left",
        weight: 900,
      });
      label(g, COMMON.subtitle, r.x + h * 0.12, r.y + h * 0.25, {
        size: h * 0.068,
        align: "left",
        color: COLOR.muted,
        weight: 600,
      });
      band.drawOverlay(g, { size: Math.max(40, h * 0.075), active });
    },
    leaders: () => band.leaders(),
    arm: () => band.machine.arm,
    dispose() {
      band.dispose();
      canvas.remove();
    },
  };
};
