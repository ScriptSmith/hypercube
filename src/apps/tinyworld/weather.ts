import type { Rng } from "../../core/types";
import { E, type ElementId } from "./elements";

/**
 * Self-running weather for the parts of the world nobody can reach: drifting clouds that rain or
 * snow now and then, a wind that bends smoke and steam, the volcano on the wall's floating island,
 * and the delta's spring. Positions are in cells (y up). Everything here is fixed-size.
 */
export type EmitMode = 0 | 1 | 2;

export interface Emit {
  (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    chance: number,
    element: ElementId,
    life: readonly [number, number],
    /** 0 fills open cells, 1 also lights flammable ones, 2 erases loose matter instead. */
    mode?: EmitMode,
  ): void;
}

export interface Cloud {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** 0 to 1, eased in and out. */
  rain: number;
  snow: boolean;
  state: "calm" | "rain";
  timer: number;
  seed: number;
}

export interface Island {
  /** Centre and half size, in cells. */
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  /** Cone offset from the centre, half width, height and crater half width. */
  cone: [number, number, number, number];
}

export interface WeatherSpec {
  gridW: number;
  gridH: number;
  /** Cell size in venue px. */
  cell: number;
  /** Lowest cloud row, as a fraction of the height. */
  cloudBand: [number, number];
  clouds: number;
  /** Cloud half width range in cells. */
  cloudSize: [number, number];
  /** The island with the volcano, if any. */
  volcano: Island | null;
  /** The delta's spring and sand chute on the cliff top, in cells. */
  spring: { x: number; y: number } | null;
  /** Rain and snow on (the `weather` option). */
  sky: boolean;
}

export interface Weather {
  readonly clouds: readonly Cloud[];
  readonly wind: number;
  /** True while the volcano erupts. */
  readonly erupting: boolean;
  update(dt: number): void;
  /** Write emitters for one GPU tick that stands for `ticks` 60 Hz updates. */
  emit(out: Emit, ticks: number): void;
  /** Start a drain cycle afresh: calm skies. */
  calm(): void;
}

/** Where the crater mouth is, for the eruption emitters. */
export const craterOf = (island: Island): { x: number; y: number } => ({
  x: island.cx + island.cone[0],
  y: island.cy + island.cone[2] * 0.76,
});

export const islandFor = (gridW: number, gridH: number): Island => {
  const hw = Math.round(gridW * 0.11);
  const hh = Math.max(4, Math.round(gridH * 0.08));
  const coneH = Math.round(hh * 1.7);
  return {
    cx: Math.round(gridW * 0.6),
    cy: Math.round(gridH * 0.64),
    hw,
    hh,
    cone: [Math.round(hw * 0.1), Math.round(hw * 0.4), coneH, Math.max(2, Math.round(hw * 0.05))],
  };
};

export const createWeather = (spec: WeatherSpec, rng: Rng): Weather => {
  const { gridW: W, gridH: H } = spec;
  const clouds: Cloud[] = [];
  const count = spec.sky ? spec.clouds : 0;
  for (let i = 0; i < count; i++) {
    const rx = rng.range(spec.cloudSize[0], spec.cloudSize[1]);
    clouds.push({
      x: ((i + rng.range(0.2, 0.8)) / count) * W,
      y: H * rng.range(spec.cloudBand[0], spec.cloudBand[1]),
      rx,
      ry: rx * rng.range(0.26, 0.34),
      rain: 0,
      snow: false,
      state: "calm",
      timer: rng.range(4, 25),
      seed: rng.range(0, 100),
    });
  }

  let wind = rng.range(-0.3, 0.3);
  let windTarget = wind;
  let windTimer = rng.range(15, 30);
  let volcanoTimer = rng.range(20, 45);
  let eruption = 0;
  let eruptionLength = 1;

  return {
    clouds,
    get wind() {
      return wind;
    },
    get erupting() {
      return eruption > 0;
    },

    update(dt) {
      windTimer -= dt;
      if (windTimer <= 0) {
        windTimer = rng.range(20, 45);
        windTarget = rng.range(-0.6, 0.6);
      }
      wind += (windTarget - wind) * Math.min(1, dt * 0.08);

      for (const c of clouds) {
        c.x += wind * dt * (4 + c.seed * 0.04);
        if (c.x - c.rx * 1.5 > W) c.x = -c.rx * 1.4;
        if (c.x + c.rx * 1.5 < 0) c.x = W + c.rx * 1.4;
        c.timer -= dt;
        if (c.timer <= 0) {
          if (c.state === "calm") {
            c.state = "rain";
            c.snow = rng.next() < 0.18;
            c.timer = rng.range(8, 18);
          } else {
            c.state = "calm";
            c.timer = rng.range(14, 40);
          }
        }
        const target = c.state === "rain" ? 1 : 0;
        c.rain += (target - c.rain) * Math.min(1, dt * 0.6);
      }

      if (spec.volcano && spec.sky) {
        if (eruption > 0) {
          eruption = Math.max(0, eruption - dt);
          if (eruption === 0) volcanoTimer = rng.range(50, 100);
        } else {
          volcanoTimer -= dt;
          if (volcanoTimer <= 0) {
            eruptionLength = rng.range(7, 11);
            eruption = eruptionLength;
          }
        }
      }
    },

    emit(out, ticks) {
      // Sizes are venue px turned into cells, so the weather looks the same at any cell size.
      const v = (px: number) => Math.max(1, px / spec.cell);
      const p = (chance: number) => Math.min(1, chance * ticks);
      for (const c of clouds) {
        if (c.rain < 0.05) continue;
        const y = c.y - c.ry * 0.45;
        const half = c.rx * 0.6;
        // About 0.6 drops a tick from a big cloud in full rain at 3 venue px cells; bigger cells
        // get fewer, bigger drops. Snow is lighter and fewer.
        const area = c.rx * 4.8;
        const chance = ((c.snow ? 0.35 : 0.6) * c.rain * Math.min(1, 3 / spec.cell)) / area;
        out(c.x - half, y, c.x + half, y, v(6), p(chance), c.snow ? E.SNOW : E.WATER, [0, 0]);
      }

      const island = spec.volcano;
      if (island && spec.sky) {
        const mouth = craterOf(island);
        const t = eruption > 0 ? 1 - eruption / eruptionLength : 0;
        // Builds quickly, holds, and dies away.
        const power = eruption > 0 ? Math.min(1, t * 6) * Math.min(1, (1 - t) * 3) : 0;
        if (power > 0) {
          out(
            mouth.x,
            mouth.y,
            mouth.x,
            mouth.y + v(60) * power,
            v(8),
            p(0.05 * power),
            E.LAVA,
            [200, 255],
            1,
          );
          out(
            mouth.x,
            mouth.y + v(12),
            mouth.x,
            mouth.y + v(80) * power,
            v(9),
            p(0.04 * power),
            E.FIRE,
            [70, 150],
          );
        }
        // A thin plume of smoke always, thicker during an eruption.
        out(
          mouth.x,
          mouth.y + v(18),
          mouth.x,
          mouth.y + v(24),
          v(6),
          p(0.01 + 0.04 * power),
          E.SMOKE,
          [140, 220],
        );
      }

      const spring = spec.spring;
      if (spring) {
        out(spring.x, spring.y, spring.x + v(9), spring.y, v(9), p(0.09), E.WATER, [0, 0]);
        out(
          spring.x - v(18),
          spring.y + v(6),
          spring.x - v(18),
          spring.y + v(6),
          v(6),
          p(0.02),
          E.SAND,
          [0, 0],
        );
      }
    },

    calm() {
      for (const c of clouds) {
        c.state = "calm";
        c.timer = rng.range(10, 30);
      }
      eruption = 0;
      volcanoTimer = rng.range(30, 60);
    },
  };
};
