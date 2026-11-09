/**
 * Colours. Each joint shares a colour with its dial and the ring on the arm. Pieces and bins
 * take the shared palette's first three player colours, which stay distinct for colour-blind
 * viewers; the joints use other hues so a dial is never mistaken for a bin.
 */
import { PALETTE } from "../../core/ui";

export const JOINT_COLORS: readonly string[] = [
  "#6cf7f8", // base: cyan
  "#f29b1d", // shoulder: orange
  "#89da9b", // elbow: green
  "#ad83d1", // forearm roll: purple
  "#ff6b5e", // wrist bend: coral
  "#f6efc0", // twist: cream
];

export const GRIP_COLOR = PALETTE.foreground;

export const PIECE_COLORS: readonly string[] = PALETTE.players.slice(0, 3);

/**
 * The lift's beam, shared by the frames and the screen so the two halves match where they meet:
 * its colour and strength, its brightness at the foot and where it leaves the frame's top edge,
 * and its brightness across its width (edge to edge).
 */
export const BEAM = {
  color: "#8fd8ff",
  opacity: 0.55,
  foot: 0.85,
  top: 0.32,
  across: [
    [0, 0],
    [0.22, 0.45],
    [0.5, 1],
    [0.78, 0.45],
    [1, 0],
  ],
} as const;
