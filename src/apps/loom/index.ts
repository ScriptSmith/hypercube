/**
 * Fourier Loom. Every harmonic is a sine wave a visitor sets with an amplitude slider and a
 * phase dial; the picture adds them up with a chain of turning circles and draws the sum as a
 * scrolling wave, and in `match` the group tries to make a target shape.
 *
 * - series.ts     the targets' Fourier series and the match measure
 * - conductor.ts  the rules: targets, auto harmonics, matches, the cloth (cloth.ts)
 * - strands.ts    a frame's own harmonics and fingers on their controls (layout.ts)
 * - link.ts, wire.ts, mirror.ts  who follows whom in a bank, and the messages
 * - thread.ts     the threads' travelling waves, shared by frames and the screen
 * - frame.ts      a touch frame (frameview.ts draws it); screen.ts the screen; draw.ts both
 * - bots.ts       injected touches
 */
import type { AppContext, AppInstance } from "../../core/types";
import { mountFrame } from "./frame";
import { mountScreen } from "./screen";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.frame.kind === "screen" || ctx.setup.role === "screen" ? mountScreen(ctx) : mountFrame(ctx);
