import type { OptionValues } from "../../core/types";
import { ALL_GATES, BASIC_GATES, type PieceKind } from "./circuit";

export type Variant = "bench" | "goals";
export type MachineKind = "lighthouse" | "fountain" | "windmill" | "crossing" | "rocket";

export const MACHINES: readonly MachineKind[] = [
  "lighthouse",
  "fountain",
  "windmill",
  "crossing",
  "rocket",
];

export interface Config {
  variant: Variant;
  gates: "basic" | "all";
  machine: MachineKind | "rotate";
  /** Workbenches on a wall; other frames have one. */
  benches: number;
}

export const readConfig = (variant: string, o: OptionValues): Config => {
  const machine = String(o.machine ?? "rotate");
  const benches = Number(o.benches ?? 2);
  return {
    variant: variant === "goals" ? "goals" : "bench",
    gates: o.gates === "basic" ? "basic" : "all",
    machine: (MACHINES as readonly string[]).includes(machine)
      ? (machine as MachineKind)
      : "rotate",
    benches: Number.isFinite(benches) ? Math.min(3, Math.max(1, Math.round(benches))) : 2,
  };
};

export const gateKinds = (cfg: Config): readonly PieceKind[] =>
  cfg.gates === "basic" ? BASIC_GATES : ALL_GATES;

/** Bots and attract stand back from a bench for this long after a person touches it. */
export const BOT_YIELD_MS = 15_000;
/** A bench nobody has touched for this long gets its ghost hand back. */
export const GHOST_RETURN_MS = 45_000;
/** While only the ghost works a bench, its starting circuit comes back this often. */
export const ATTRACT_REFRESH_MS = 180_000;
/** A bench nobody has touched for this long goes back to its start, even if others are busy. */
export const BENCH_IDLE_MS = 90_000;
/** How often the goal checker tests every row of the card. */
export const CHECK_MS = 1000;
/** After a card is done the machine shows off this long before the next card. */
export const TRICK_MS = 5000;
/** Hold time for a bench's reset control. */
export const RESET_HOLD_MS = 1000;
