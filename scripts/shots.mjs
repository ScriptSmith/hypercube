#!/usr/bin/env node
// Screenshot contact sheet for human review.
//
//   pnpm shots [--no-thumbs | --thumbs-only] [--only=<app>,<app>] [--run=<seconds>]
//
// Runs every app in every frame kind and variant it declares, with two bots, for a few seconds,
// then writes shots/<app>/<kind>[.<variant>].png and shots/index.html. It also writes a
// 640 x 400 thumbnail for each app in the landing gallery to public/thumbs/<id>.png, and one for
// each of the manifest's `thumb.looks` to public/thumbs/<id>.<look>.png, unless --no-thumbs is
// given. --thumbs-only writes the thumbnails and keeps the sheet's earlier shots. It uses the
// preview server on HC_PORT (4173) if one is running and otherwise builds and starts one. It
// exits 1 if any app showed errors or a blank stage, or a thumbnail could not be made.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverApps, importTs, loadVenueSizes, ROOT } from "./lib/apps.mjs";
import { launchChromium } from "./lib/browser.mjs";
import {
  caseName,
  installFrameCounter,
  KIND_ORDER,
  playCases,
  playPath,
  readState,
  shootStage,
  viewportFor,
  waitForRunning,
  watchPage,
} from "./lib/play.mjs";
import { BLANK_STDDEV, decodePng, pixelStats } from "./lib/png.mjs";
import { ensureServer } from "./lib/server.mjs";

const OUT = join(ROOT, "shots");
const THUMBS = join(ROOT, "public/thumbs");
const RESULTS = join(OUT, "shots.json");
const THUMB = { width: 640, height: 400 };
/** Sheet CSS px per venue px, so every display keeps its real size relative to the others. */
const SHEET_SCALE = 0.16;
const CONCURRENCY = 4;

const parseArgs = (argv) => {
  const opts = { thumbs: true, cases: true, only: null, runMs: 3000 };
  for (const arg of argv) {
    const [key, value] = arg.split("=", 2);
    if (key === "--no-thumbs") opts.thumbs = false;
    else if (key === "--thumbs-only") opts.cases = false;
    else if (key === "--only" && value) opts.only = new Set(value.split(","));
    else if (key === "--run" && Number(value) > 0) opts.runMs = Number(value) * 1000;
    else {
      console.error(
        `Unknown argument ${arg}\nUsage: pnpm shots [--no-thumbs | --thumbs-only] [--only=<app>,<app>] [--run=<seconds>]`,
      );
      process.exit(2);
    }
  }
  if (!opts.thumbs && !opts.cases) {
    console.error("--no-thumbs and --thumbs-only leave nothing to shoot");
    process.exit(2);
  }
  return opts;
};

const safe = (s) => s.replace(/[^A-Za-z0-9_-]/g, "_");
const shotFile = (c) =>
  `${safe(c.app)}/${c.kind}${c.variant ? `.${safe(c.variant)}` : ""}${c.look ? `.${c.look}` : ""}.png`;

/** A sphere is shot twice: its flat feed, and the ball as people see it. */
const withGlobes = (cases) =>
  cases.flatMap((c) => (c.kind === "sphere" ? [c, { ...c, look: "globe" }] : [c]));

/** URL parameters a case adds to `playPath`. */
const caseParams = (c) => (c.look ? { look: c.look } : {});

/** Run tasks with at most `n` in flight, keeping results in input order. */
const pool = async (items, n, task) => {
  const results = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
};

const shoot = async (browser, base, c, size, runMs) => {
  const result = { ...c, file: shotFile(c), fps: 0, stddev: 0, issues: [] };
  const context = await browser.newContext({ viewport: viewportFor(size) });
  try {
    const page = await context.newPage();
    const problems = watchPage(page);
    await installFrameCounter(page);
    await page.goto(new URL(playPath({ ...c, size, params: caseParams(c) }), base).href);
    const start = await waitForRunning(page);
    await page.waitForTimeout(runMs);
    const end = await readState(page);
    const png = await shootStage(page);
    mkdirSync(join(OUT, safe(c.app)), { recursive: true });
    writeFileSync(join(OUT, result.file), png);
    result.stddev = pixelStats(decodePng(png)).stddev;
    result.fps = (end.frames - start.frames) / Math.max(0.001, (end.time - start.time) / 1000);
    if (end.phase !== "running") result.issues.push(`phase ${end.phase}`);
    if (end.app !== c.app) result.issues.push(`mounted ${end.app ?? "nothing"}`);
    if (result.stddev <= BLANK_STDDEV) result.issues.push("blank stage");
    result.issues.push(...end.errors, ...problems);
  } catch (err) {
    result.file = null;
    result.issues.push(`harness: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  } finally {
    await context.close();
  }
  return result;
};

/** The declared kind whose shape loses least when cropped to 16:10. */
const thumbKind = (app, venue) => {
  const target = Math.log(THUMB.width / THUMB.height);
  const cost = (k) => Math.abs(Math.log(venue[k].width / venue[k].height) - target);
  return KIND_ORDER.filter((k) => app.setups.some((s) => s.kinds.includes(k))).sort(
    (a, b) => cost(a) - cost(b),
  )[0];
};

/**
 * Render the stage so a centred 16:10 crop is a little over 640 x 400 CSS px, at device scale 2
 * for detail, and capture exactly 640 x 400 at CSS scale so Chromium downsamples it. Every
 * preview is cropped this way, whatever its display's shape, so gallery tiles keep their size.
 */
const thumbnail = async (browser, base, app, preview, kind, size) => {
  const margin = 4;
  const scale =
    size.width / size.height > THUMB.width / THUMB.height
      ? (THUMB.height + margin) / size.height
      : (THUMB.width + margin) / size.width;
  const viewport = { width: Math.ceil(size.width * scale), height: Math.ceil(size.height * scale) };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    const params = Object.fromEntries(
      Object.entries(preview.options).map(([key, value]) => [`o.${key}`, value]),
    );
    if (kind === "sphere") params.look = "globe";
    const variant = preview.variant ?? null;
    await page.goto(new URL(playPath({ app: app.id, kind, variant, size, params }), base).href);
    const state = await waitForRunning(page);
    if (state.phase !== "running" || state.app !== app.id) return false;
    await page.waitForTimeout(preview.seconds * 1000);
    // A sphere's thumbnail is the globe preview, without its buttons and flat inset.
    if (kind === "sphere") {
      await page.addStyleTag({ content: ".hc-globe-bar,.hc-globe-flat{display:none!important}" });
    }
    const box = await page.locator(".hc-stage").boundingBox();
    if (!box) return false;
    const clip = {
      x: Math.round(box.x + (box.width - THUMB.width) / 2),
      y: Math.round(box.y + (box.height - THUMB.height) / 2),
      ...THUMB,
    };
    mkdirSync(THUMBS, { recursive: true });
    await page.screenshot({ path: join(THUMBS, `${preview.stem}.png`), clip, scale: "css" });
    return true;
  } finally {
    await context.close();
  }
};

const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  );

/** Remove an app's look thumbnails that its manifest no longer lists. */
const removeStaleLooks = (app, previews) => {
  const keep = new Set(previews.map((p) => `${p.stem}.png`));
  for (const file of readdirSync(THUMBS)) {
    if (file.startsWith(`${app.id}.`) && file.endsWith(".png") && !keep.has(file)) {
      rmSync(join(THUMBS, file));
      console.error(`  removed public/thumbs/${file}, no longer a look`);
    }
  }
};

const sheet = ({ apps, venue, results, thumbs, base }) => {
  const bad = results.filter((r) => r.issues.length > 0).length;
  const sections = apps.map((app) => {
    const figures = results
      .filter((r) => r.app === app.id)
      .map((r) => {
        const size = venue[r.kind];
        const w = Math.round(size.width * SHEET_SCALE);
        const h = Math.round(size.height * SHEET_SCALE);
        const variant = app.variants?.find((v) => v.id === r.variant)?.title ?? r.variant;
        const label = [r.kind, variant, r.look].filter(Boolean).map(esc).join(" · ");
        const img = r.file
          ? `<a href="${esc(r.file)}"><img src="${esc(r.file)}" width="${w}" height="${h}" alt="${esc(caseName(r))}" loading="lazy"></a>`
          : `<div class="missing" style="width:${w}px;height:${h}px">no shot</div>`;
        const issues = r.issues.map((i) => `<li>${esc(i)}</li>`).join("");
        return `<figure class="${r.issues.length ? "has-issues" : ""}">${img}<figcaption><b>${label}</b> <span class="muted">${r.fps.toFixed(0)} fps</span>${issues ? `<ul>${issues}</ul>` : ""}</figcaption></figure>`;
      })
      .join("\n");
    const tags = [app.id, app.category, app.hidden ? "hidden" : ""].filter(Boolean).map(esc);
    return `<section><h2>${esc(app.title)} <small>${tags.join(" · ")}</small></h2><div class="row">${figures}</div></section>`;
  });
  const thumbRow = thumbs.length
    ? `<section><h2>Gallery thumbnails <small>public/thumbs, 640 × 400</small></h2><div class="row">${thumbs
        .map(
          (t) =>
            `<figure><img src="../public/thumbs/${esc(t.stem)}.png" width="320" height="200" alt="${esc(t.stem)}"><figcaption><b>${esc(t.stem)}</b> <span class="muted">${esc(t.kind)}</span></figcaption></figure>`,
        )
        .join("")}</div></section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hypercube shots</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 24px; background: #0b0d12; color: #e6e8ee; font: 14px/1.4 system-ui, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
h2 { margin: 0 0 12px; font-size: 18px; }
small, .muted { color: #8a90a0; font-weight: 400; }
section { margin: 36px 0; }
.row { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-end; }
figure { margin: 0; max-width: 100%; }
img, .missing { display: block; max-width: 100%; height: auto; background: #000; outline: 1px solid #2a2f3a; }
.missing { display: grid; place-items: center; color: #8a90a0; }
.has-issues img, .has-issues .missing { outline: 3px solid #ff5c5c; }
figcaption { margin-top: 6px; }
ul { margin: 4px 0 0; padding-left: 18px; color: #ff8a8a; max-width: 60ch; }
</style>
</head>
<body>
<header>
<h1>Hypercube shots</h1>
<p class="muted">${esc(new Date().toISOString().slice(0, 16).replace("T", " "))} UTC from ${esc(base)}. ${results.length} shots, ${bad} with problems. Displays are drawn in proportion to their venue sizes; click a shot for full size.</p>
</header>
${thumbRow}
${sections.join("\n")}
</body>
</html>
`;
};

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));
  const allApps = await discoverApps();
  const apps = opts.only ? allApps.filter((a) => opts.only.has(a.id)) : allApps;
  if (opts.only && apps.length !== opts.only.size) {
    const known = new Set(allApps.map((a) => a.id));
    console.error(`Unknown app: ${[...opts.only].filter((id) => !known.has(id)).join(", ")}`);
    process.exit(2);
  }
  const venue = await loadVenueSizes();
  const { thumbPreviews } = await importTs(join(ROOT, "src/core/thumbs.ts"));

  // A full run starts the sheet afresh; --only keeps the other apps' earlier shots, and
  // --thumbs-only keeps them all.
  let previous = [];
  if (opts.only || !opts.cases) {
    try {
      previous = JSON.parse(readFileSync(RESULTS, "utf8")).results.filter(
        (r) => (!opts.cases || !opts.only.has(r.app)) && allApps.some((a) => a.id === r.app),
      );
    } catch {
      previous = [];
    }
    if (opts.cases) {
      for (const app of apps) rmSync(join(OUT, safe(app.id)), { recursive: true, force: true });
    }
  } else {
    rmSync(OUT, { recursive: true, force: true });
  }
  mkdirSync(OUT, { recursive: true });

  const server = await ensureServer();
  const browser = await launchChromium();
  process.once("SIGINT", () => process.exit(130));
  try {
    const cases = opts.cases ? withGlobes(playCases(apps)) : [];
    console.error(`Shooting ${cases.length} cases from ${apps.length} apps`);
    const fresh = await pool(cases, CONCURRENCY, async (c) => {
      const r = await shoot(browser, server.url, c, venue[c.kind], opts.runMs);
      const note = r.issues.length ? `  ${r.issues.length} problem(s)` : "";
      console.error(`  ${caseName(c).padEnd(32)} ${r.fps.toFixed(0).padStart(3)} fps${note}`);
      return r;
    });

    const thumbKinds = new Map();
    const thumbFailures = [];
    if (opts.thumbs) {
      const listed = apps.filter((a) => !a.hidden);
      mkdirSync(THUMBS, { recursive: true });
      for (const app of listed) removeStaleLooks(app, thumbPreviews(app));
      const jobs = listed.flatMap((app) => thumbPreviews(app).map((preview) => ({ app, preview })));
      await pool(jobs, CONCURRENCY, async ({ app, preview }) => {
        const kind = preview.kind ?? thumbKind(app, venue);
        if (!kind) return;
        const ok = await thumbnail(browser, server.url, app, preview, kind, venue[kind]).catch(
          () => false,
        );
        if (ok) thumbKinds.set(preview.stem, kind);
        else thumbFailures.push(preview.stem);
        console.error(
          ok
            ? `  thumbnail public/thumbs/${preview.stem}.png from ${kind}`
            : `  no thumbnail for ${preview.stem}: it did not start`,
        );
      });
    }

    const order = new Map(allApps.map((a, i) => [a.id, i]));
    const results = [...previous, ...fresh].sort(
      (a, b) => (order.get(a.app) ?? 0) - (order.get(b.app) ?? 0),
    );
    const shown = allApps.filter((a) => apps.includes(a) || results.some((r) => r.app === a.id));
    const thumbs = shown
      .filter((a) => !a.hidden)
      .flatMap((a) => thumbPreviews(a))
      .filter((p) => existsSync(join(THUMBS, `${p.stem}.png`)))
      .map((p) => ({ stem: p.stem, kind: thumbKinds.get(p.stem) ?? "earlier run" }));
    writeFileSync(RESULTS, `${JSON.stringify({ results }, null, 2)}\n`);
    writeFileSync(
      join(OUT, "index.html"),
      sheet({ apps: shown, venue, results, thumbs, base: server.url }),
    );

    const bad = fresh.filter((r) => r.issues.length > 0);
    for (const r of bad) console.error(`${caseName(r)}:\n  ${r.issues.join("\n  ")}`);
    console.log(
      `Contact sheet: ${join(OUT, "index.html")} (${fresh.length} shots, ${bad.length} with problems)`,
    );
    if (thumbFailures.length) console.error(`No thumbnail for ${thumbFailures.join(", ")}`);
    process.exitCode = bad.length > 0 || thumbFailures.length > 0 ? 1 : 0;
  } finally {
    await browser.close();
    server.stop();
  }
};

await main();
