/**
 * Cross-fades gallery tiles between a piece's previews. One timer serves every tile, and only
 * tiles near the viewport change. Each further picture loads a turn before it shows, so a tile
 * that is looked at briefly costs one more picture. With reduced motion every tile keeps its
 * first picture and loads nothing more.
 */

/** How long each preview shows. */
export const HOLD_MS = 5000;
const TICK_MS = 250;
const NEAR = "200px 0px";
const GOLDEN = 0.618033988749895;

/**
 * Which preview tile number `tile` shows `elapsed` ms after it first came near the viewport. The
 * first preview stays for between half a hold and one and a half, spread by the golden ratio so
 * tiles side by side change at different moments; then each takes a turn of one hold.
 */
export const previewAt = (elapsed: number, tile: number, count: number, hold = HOLD_MS): number => {
  if (count < 2) return 0;
  const first = hold * (0.5 + ((tile * GOLDEN) % 1));
  if (elapsed < first) return 0;
  return (1 + Math.floor((elapsed - first) / hold)) % count;
};

interface Look {
  img: HTMLImageElement;
  url: string;
  ready: boolean;
}

interface Tile {
  art: HTMLElement;
  index: number;
  urls: readonly string[];
  /** The previews after the first, once the tile has come near the viewport. */
  looks: Look[] | null;
  /** 0 is the first preview, the tile's own picture; k is `looks[k - 1]`. */
  shown: number;
  since: number | null;
}

/**
 * Show preview `to` over preview `from`. Looks lie above the first picture: one coming in fades in
 * on top of the one going out, which stays opaque underneath; going back to the first, the look
 * fades out. Classes left by the turn before are cleared first, long after their fades ended.
 */
export const crossFade = (looks: readonly HTMLElement[], from: number, to: number): void => {
  for (const img of looks) img.classList.remove("is-under", "is-out");
  const out = from > 0 ? looks[from - 1] : undefined;
  const next = to > 0 ? looks[to - 1] : undefined;
  if (out && out !== next) {
    out.classList.remove("is-in");
    out.classList.add(next ? "is-under" : "is-out");
  }
  next?.classList.add("is-in");
};

export interface Cycler {
  /** Cycle `art` through its own picture and then `urls`; `index` staggers it among tiles. */
  add(art: HTMLElement, urls: readonly string[], index: number): void;
}

export const createCycler = (now: () => number = () => performance.now()): Cycler => {
  if (typeof IntersectionObserver === "undefined") return { add() {} };
  const reduce =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const tiles = new Map<Element, Tile>();
  const near = new Set<Tile>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const show = (tile: Tile, to: number) => {
    if (to === tile.shown || !tile.looks) return;
    crossFade(
      tile.looks.map((l) => l.img),
      tile.shown,
      to,
    );
    tile.shown = to;
  };

  const load = (tile: Tile) => {
    if (tile.looks) return;
    const looks: Look[] = tile.urls.map((url) => {
      const img = document.createElement("img");
      img.className = "look";
      img.alt = "";
      img.decoding = "async";
      img.draggable = false;
      const look = { img, url, ready: false };
      img.addEventListener("load", () => (look.ready = true), { once: true });
      img.addEventListener(
        "error",
        () => {
          // Drop a missing picture from the turns, back on the first if it was showing.
          show(tile, 0);
          img.remove();
          tile.looks?.splice(tile.looks.indexOf(look), 1);
        },
        { once: true },
      );
      return look;
    });
    tile.looks = looks;
    tile.art.append(...looks.map((l) => l.img));
  };

  /** Start loading preview `k` of the tile, if it is a look not yet asked for. */
  const request = (tile: Tile, k: number) => {
    const look = k > 0 ? tile.looks?.[k - 1] : undefined;
    if (look && !look.img.hasAttribute("src")) look.img.src = look.url;
  };

  const wake = (tile: Tile) => {
    load(tile);
    request(tile, tile.shown + 1);
    tile.since ??= now();
  };

  const tick = () => {
    const t = now();
    for (const tile of near) {
      if (!tile.looks || tile.since === null) continue;
      const count = tile.looks.length + 1;
      const to = previewAt(t - tile.since, tile.index, count);
      request(tile, to);
      if (to === 0 || tile.looks[to - 1]?.ready) {
        show(tile, to);
        request(tile, (to + 1) % count);
      }
    }
  };

  const schedule = () => {
    const run = near.size > 0 && !reduce?.matches;
    if (run && timer === null) timer = setInterval(tick, TICK_MS);
    if (!run && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (reduce?.matches) for (const tile of tiles.values()) show(tile, 0);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const tile = tiles.get(entry.target);
        if (!tile) continue;
        if (!entry.isIntersecting) {
          near.delete(tile);
          continue;
        }
        near.add(tile);
        if (!reduce?.matches) wake(tile);
      }
      schedule();
    },
    { rootMargin: NEAR },
  );
  reduce?.addEventListener("change", () => {
    if (!reduce.matches) for (const tile of near) wake(tile);
    schedule();
  });

  return {
    add(art, urls, index) {
      if (urls.length === 0) return;
      tiles.set(art, { art, index, urls, looks: null, shown: 0, since: null });
      observer.observe(art);
    },
  };
};
