/**
 * Fourth Dimension. A shape from four-dimensional space seen the only two ways our space can see
 * it: its shadow (a perspective projection into 3D) and its slice (where it crosses our space).
 * The same trick one dimension down shows a cube passing through a flat world.
 *
 * - rot.ts      4D rotations: plane turns, Gram-Schmidt, quaternion pairs for easing
 * - shapes.ts   the four families in two, three and four dimensions
 * - hull.ts, slice.ts  convex hulls; slices, extents and the projection along w
 * - orient.ts   the resting pose, "first" buttons and a bank's slow turn; show.ts the attract show
 * - layout.ts   where views and controls go; controls.ts fingers on them; orbit.ts the camera
 * - scenes.ts, ribbons.ts, camera.ts, view.ts  three.js; flat.ts the 2D stage; panel.ts the DOM
 * - frame.ts    a touch frame (solo, a bank's frame, or a screen on its own); screen.ts a bank's
 *   screen; link.ts and wire.ts between them; bots.ts injected touches
 */
import type { AppContext, AppInstance } from "../../core/types";
import { mountFrame } from "./frame";
import { mountScreen } from "./screen";

export const mount = (ctx: AppContext): AppInstance =>
  ctx.setup.name === "bank" && (ctx.frame.kind === "screen" || ctx.setup.role === "screen")
    ? mountScreen(ctx)
    : mountFrame(ctx);
