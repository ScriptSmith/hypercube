/**
 * The eleven chapters in poster order. Ids name the chapter folders, the `chapter` option's
 * values (written out again in the manifest, which loads on its own) and the wire's chapter
 * index, so they never change once deployed.
 */
export const CHAPTER_IDS = [
  "spectrum",
  "interference",
  "crystal",
  "bragg",
  "goniometer",
  "patterns",
  "inverse",
  "absences",
  "synthesis",
  "helix",
  "mystery",
] as const;

export type ChapterId = (typeof CHAPTER_IDS)[number];

export const CHAPTER_COUNT = CHAPTER_IDS.length;

export const isChapterId = (v: unknown): v is ChapterId =>
  typeof v === "string" && (CHAPTER_IDS as readonly string[]).includes(v);

export const chapterIndex = (id: ChapterId): number => CHAPTER_IDS.indexOf(id);

/**
 * The number a frame shows for each chapter: its place in the poster, except on the wall, whose
 * six columns are a selection and count 1 to 6 so visitors never see gaps such as 2, 4, 6.
 */
export const chapterNumbering = (
  kind: string,
  groups: readonly (readonly ChapterId[])[],
): ((id: ChapterId) => number) => {
  const order: readonly ChapterId[] = kind === "wall" ? groups.flat() : CHAPTER_IDS;
  return (id) => {
    const i = order.indexOf(id);
    return (i < 0 ? chapterIndex(id) : i) + 1;
  };
};

/** The wall's six columns, by the `set` option. */
export const WALL_SETS: Record<"highlights" | "first" | "last", readonly ChapterId[]> = {
  // Crystal before Bragg: its layers are what chapter 4's figure turns.
  highlights: ["crystal", "bragg", "patterns", "absences", "helix", "mystery"],
  first: ["spectrum", "interference", "crystal", "bragg", "goniometer", "patterns"],
  last: ["patterns", "inverse", "absences", "synthesis", "helix", "mystery"],
};
