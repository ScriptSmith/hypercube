// Loading /play/ the same way in the smoke test, the contact sheet and the soak.

export const KIND_ORDER = ["panel", "pair", "wall", "kiosk", "screen", "sphere"];

/** Every frame kind an app declares in any setup. */
export const appKinds = (app) =>
  KIND_ORDER.filter((k) => app.setups.some((s) => s.kinds.includes(k)));

/** One case per app, frame kind and variant. An app without variants has variant null. */
export const playCases = (apps) =>
  apps.flatMap((app) =>
    appKinds(app).flatMap((kind) =>
      (app.variants?.length ? app.variants.map((v) => v.id) : [null]).map((variant) => ({
        app: app.id,
        kind,
        variant,
      })),
    ),
  );

export const caseName = (c) => [c.app, c.kind, c.variant].filter(Boolean).join(" ");

/** The largest size with the venue aspect inside `max`, so `fit` adds almost no letterbox. */
export const viewportFor = (size, max = { width: 1280, height: 960 }) => {
  const scale = Math.min(max.width / size.width, max.height / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
};

/** A /play/ URL relative to the site root, letterboxed to the kind's venue size. */
export const playPath = ({ app, kind, variant, size, bots = 2, seed = "test", params = {} }) => {
  const q = new URLSearchParams({ app, kind });
  if (variant) q.set("variant", variant);
  q.set("fit", `${size.width}x${size.height}`);
  q.set("bots", String(bots));
  q.set("seed", seed);
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  return `play/?${q}`;
};

const MAX_PROBLEMS = 50;

/** Collect page errors, console errors and crashes from now on, keeping the first 50. */
export const watchPage = (page) => {
  const problems = [];
  const add = (text) => {
    if (problems.length < MAX_PROBLEMS) problems.push(text);
  };
  page.on("pageerror", (err) => add(`page error: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const { url } = msg.location();
    add(`console error: ${msg.text()}${url ? ` (${url})` : ""}`);
  });
  page.on("crash", () => add("page crashed"));
  return problems;
};

/** Count animation frames from page load, read back as `frames` by `readState`. */
export const installFrameCounter = (page) =>
  page.addInitScript(() => {
    let frames = 0;
    const tick = () => {
      frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    Object.defineProperty(window, "__hcFrames", { get: () => frames });
  });

export const readState = (page) =>
  page.evaluate(() => {
    const s = window.__hypercube;
    return {
      phase: s?.phase ?? "missing",
      app: s?.app ?? null,
      variant: s?.variant ?? null,
      kind: s?.frame?.kind ?? null,
      room: s?.room ?? "none",
      errors: s ? [...s.errors] : [],
      frames: window.__hcFrames ?? 0,
      time: performance.now(),
    };
  });

/** Wait until the runtime has mounted something (or failed to), then return its state. */
export const waitForRunning = async (page, timeout = 30_000) => {
  try {
    await page.waitForFunction(
      () => ["running", "error"].includes(window.__hypercube?.phase ?? ""),
      undefined,
      { timeout, polling: 100 },
    );
  } catch {
    // Timed out; the returned phase says so.
  }
  return readState(page);
};

/** The stage only, without any letterbox. */
export const shootStage = (page) => page.locator(".hc-stage").screenshot({ timeout: 15_000 });
