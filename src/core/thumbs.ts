import type { AppManifest, FrameKind, OptionValues, ThumbShot } from "./types";

/** One gallery preview of an app, as `pnpm shots` renders it and the gallery shows it. */
export interface ThumbPreview {
  /** File name without `.png` in `public/thumbs/`: the app id, then the look's name. */
  stem: string;
  /** Absent when the manifest names no kind; `pnpm shots` then picks one. */
  kind?: FrameKind;
  variant?: string;
  options: OptionValues;
  seconds: number;
}

const DEFAULT_SECONDS = 3;

const safe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_");

/** A look's own kind, variant and options joined with dots, such as `wall.colours-teal`. */
export const lookName = (look: ThumbShot): string =>
  [
    look.kind,
    look.variant,
    ...Object.entries(look.options ?? {}).map(([key, value]) => `${key}-${value}`),
  ]
    .filter((part): part is string => Boolean(part))
    .map(safe)
    .join(".");

/** The app's previews: the default thumbnail first, then each of `thumb.looks`. */
export const thumbPreviews = (app: AppManifest): ThumbPreview[] => {
  const thumb = app.thumb ?? {};
  const first: ThumbPreview = {
    stem: app.id,
    kind: thumb.kind,
    variant: thumb.variant ?? app.variants?.[0]?.id,
    options: { ...thumb.options },
    seconds: thumb.seconds ?? DEFAULT_SECONDS,
  };
  const looks = (thumb.looks ?? []).map((look): ThumbPreview => ({
    stem: `${app.id}.${lookName(look)}`,
    kind: look.kind ?? first.kind,
    variant: look.variant ?? first.variant,
    options: { ...first.options, ...look.options },
    seconds: look.seconds ?? first.seconds,
  }));
  return [first, ...looks];
};
