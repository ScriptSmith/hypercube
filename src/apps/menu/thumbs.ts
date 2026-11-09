/**
 * Ids with a screenshot in `public/thumbs/`. Reading only the glob's keys makes Vite inline the
 * file names without importing anything, so a missing thumbnail is never requested.
 */
const THUMBS: ReadonlySet<string> = new Set(
  Object.keys(import.meta.glob("../../../public/thumbs/*.png")).map((path) =>
    (path.split("/").at(-1) ?? "").replace(/\.png$/, ""),
  ),
);

export const hasThumb = (id: string): boolean => THUMBS.has(id);

/** Thumbnails are served from the site root, one level above the player page. */
export const thumbUrl = (id: string): string =>
  new URL(`../thumbs/${encodeURIComponent(id)}.png`, location.href).href;
