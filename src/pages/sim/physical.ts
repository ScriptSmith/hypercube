/**
 * Drawing-only distances for the simulator, in metres. Display sizes come from
 * `src/core/venue.ts` through the sim's venue values (`./venue.ts`).
 */

/** Space drawn between the two walls of a versus setup. */
export const FACING_GAP = 3;

/** Silhouettes drawn for scale. */
export const PERSON = { adult: 1.75, child: 1.1 } as const;

/** Length of the line a sphere hangs from, between its top and the ceiling. */
export const SPHERE_HANG = 1;
