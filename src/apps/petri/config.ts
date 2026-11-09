import type { FrameKind, OptionValues } from "../../core/types";
import { type Family, isFamily } from "./stamps";

export type Speed = "slow" | "normal" | "fast";

export interface PetriConfig {
  /** The family asked for. The frame may still fall back to `life` without float targets. */
  family: Family;
  /** Venue px per Life cell. */
  cell: number;
  speed: Speed;
  /** Regions across a wall (slime and turing). */
  regions: number;
  /** On a bank, each panel sets the condition of the dish above it. */
  slices: boolean;
  rain: boolean;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export const readConfig = (
  variant: string,
  options: OptionValues,
  kind: FrameKind,
): PetriConfig => {
  const cell = Number(pick(options.cell, ["4", "6", "8"], "6"));
  const regions = typeof options.regions === "number" ? options.regions : 2;
  return {
    family: isFamily(variant) ? variant : "life",
    cell,
    speed: pick(options.speed, ["slow", "normal", "fast"], "normal"),
    regions: kind === "wall" ? Math.min(3, Math.max(1, Math.round(regions))) : 1,
    slices: options.slices !== false,
    rain: options.rain !== false,
  };
};

/** Life generations per second. */
export const lifeRate = (speed: Speed): number =>
  speed === "slow" ? 6 : speed === "fast" ? 24 : 12;

/** Slime agent steps per second. */
export const slimeRate = (speed: Speed): number =>
  speed === "slow" ? 30 : speed === "fast" ? 120 : 60;

/** Reaction-diffusion iterations per rendered frame (at 60 fps). */
export const turingIterations = (speed: Speed): number =>
  speed === "slow" ? 8 : speed === "fast" ? 16 : 12;

/** Slime agents at full resolution on a whole 5760 x 2160 wall, and the most on any frame. */
export const WALL_AGENTS = 1_600_000;
const WALL_AREA = 5760 * 2160;
const MAX_AGENTS = 2_400_000;

/**
 * Agents for a world of `area` venue px², so density matches the wall's. Scales with `res`
 * squared; a software rasteriser gets a thirty-second.
 */
export const agentCount = (area: number, res: number, software: boolean): number => {
  const n = WALL_AGENTS * (area / WALL_AREA) * res * res * (software ? 1 / 32 : 1);
  // Below this a slime mould starves: too few agents to hold a network, so it balls up.
  return Math.max(16_384, Math.min(MAX_AGENTS, Math.round(n)));
};

/** Venue px per slime trail texel (half the venue resolution at res 1). */
export const trailCell = (res: number, software: boolean): number =>
  (2 / Math.max(0.25, res)) * (software ? 4 : 1);

/** Venue px per reaction-diffusion cell. */
export const turingCell = (res: number, software: boolean): number =>
  Math.min(8, (3 / Math.max(0.25, Math.min(1, res))) * (software ? 2 : 1));
