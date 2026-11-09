#!/usr/bin/env node
// Long-run leak check for one app.
//
//   pnpm soak <app> [minutes=60] [kind=wall] [--quick] [--variant=<id>] [--bots=<n>] [--every=<s>]
//     [--param=<name>=<value> ...]
//
// Runs the app with bots (2 by default) and samples the JS heap (after a forced garbage
// collection), DOM node count, canvas count and frame rate every 30 s. --quick runs for two
// minutes and samples every 10 s, for routine use. The kind defaults to wall, or the app's first
// declared kind if it has no wall. --param adds a URL parameter, such as `--param=o.benches=3`
// for an app option, and can be repeated.
//
// It exits 1 if, between the first samples after warm-up (five minutes, or a quarter of a shorter
// run) and the last ones, the heap grows by more than 10 % or 2 MB, whichever is larger, or the
// DOM by more than 10 % or 50 nodes, whichever is larger; or if the page logs errors, crashes or
// stops running. See scripts/lib/soak.mjs. It uses the preview server on HC_PORT (4173) if one is
// running and otherwise builds and starts one.
import { discoverApps, loadVenueSizes } from "./lib/apps.mjs";
import { launchChromium } from "./lib/browser.mjs";
import {
  appKinds,
  installFrameCounter,
  playPath,
  readState,
  viewportFor,
  waitForRunning,
  watchPage,
} from "./lib/play.mjs";
import { ensureServer } from "./lib/server.mjs";
import { assessSoak } from "./lib/soak.mjs";

const USAGE =
  "Usage: pnpm soak <app> [minutes=60] [kind=wall] [--quick] [--variant=<id>] [--bots=<n>] [--every=<s>] [--param=<name>=<value> ...]";
const MB = 1024 * 1024;

const fail = (msg) => {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
};

const parseArgs = (argv) => {
  const positional = [];
  const flags = {};
  const params = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq < 0 ? true : arg.slice(eq + 1);
    if (key !== "param") {
      flags[key] = value;
      continue;
    }
    const split = typeof value === "string" ? value.indexOf("=") : -1;
    if (split < 1) fail(`--param needs <name>=<value>, got ${arg}`);
    params[value.slice(0, split)] = value.slice(split + 1);
  }
  for (const key of Object.keys(flags)) {
    if (!["quick", "variant", "bots", "every"].includes(key)) fail(`Unknown option --${key}`);
  }
  const [app, ...rest] = positional;
  if (!app) fail("Name an app.");
  const minutes = rest.find((a) => /^[\d.]+$/.test(a));
  const kind = rest.find((a) => a !== minutes) ?? null;
  const quick = flags.quick === true;
  const opts = {
    app,
    minutes: quick ? 2 : Number(minutes ?? 60),
    kind,
    variant: typeof flags.variant === "string" ? flags.variant : null,
    bots: flags.bots === undefined ? 2 : Number(flags.bots),
    everyMs: (flags.every === undefined ? (quick ? 10 : 30) : Number(flags.every)) * 1000,
    params,
  };
  if (!(opts.minutes > 0)) fail(`Bad duration ${minutes}`);
  if (!Number.isInteger(opts.bots) || opts.bots < 0 || opts.bots > 16) fail("Bots must be 0 to 16");
  if (!(opts.everyMs >= 1000)) fail("--every must be at least 1 second");
  return opts;
};

const clock = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const COLUMNS = ["time", "heap MB", "Δ heap", "DOM", "Δ DOM", "canvases", "fps", "errors"];
const WIDTHS = [6, 8, 8, 6, 6, 9, 6, 7];
const row = (cells) => cells.map((c, i) => String(c).padStart(WIDTHS[i] ?? 8)).join(" ");

const sleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

const main = async () => {
  const opts = parseArgs(process.argv.slice(2));
  const apps = await discoverApps();
  const app = apps.find((a) => a.id === opts.app);
  if (!app) fail(`Unknown app ${opts.app}. Apps: ${apps.map((a) => a.id).join(", ")}`);
  const kinds = appKinds(app);
  const kind = opts.kind ?? (kinds.includes("wall") ? "wall" : kinds[0]);
  if (!kinds.includes(kind))
    fail(`${app.id} does not declare kind ${kind}; it has ${kinds.join(", ")}`);
  if (opts.variant && !app.variants?.some((v) => v.id === opts.variant)) {
    fail(`${app.id} has no variant ${opts.variant}`);
  }
  const size = (await loadVenueSizes())[kind];
  const durationMs = opts.minutes * 60_000;

  const server = await ensureServer();
  const browser = await launchChromium();
  const stop = new AbortController();
  process.once("SIGINT", () => {
    console.error("Interrupted; assessing the samples so far");
    stop.abort();
  });

  const reasons = [];
  const samples = [];
  try {
    const context = await browser.newContext({ viewport: viewportFor(size) });
    const page = await context.newPage();
    const problems = watchPage(page);
    await installFrameCounter(page);
    const path = playPath({
      app: app.id,
      kind,
      variant: opts.variant,
      size,
      bots: opts.bots,
      params: opts.params,
    });
    console.log(`Soaking ${new URL(path, server.url).href}`);
    console.log(`for ${opts.minutes} min, sampling every ${opts.everyMs / 1000} s\n`);
    await page.goto(new URL(path, server.url).href);
    let last = await waitForRunning(page);
    if (last.phase !== "running" || last.app !== app.id) {
      throw new Error(`${app.id} did not start: ${last.phase}, ${last.errors.join("; ")}`);
    }
    const cdp = await context.newCDPSession(page);
    console.log(row(COLUMNS));

    const start = Date.now();
    for (let next = 0; !stop.signal.aborted; next += opts.everyMs) {
      await sleep(start + next - Date.now(), stop.signal);
      if (stop.signal.aborted) break;
      await cdp.send("HeapProfiler.collectGarbage");
      const m = await page.evaluate(() => ({
        heap: performance.memory?.usedJSHeapSize ?? 0,
        dom: document.getElementsByTagName("*").length,
        canvases: document.getElementsByTagName("canvas").length,
      }));
      const state = await readState(page);
      const span = (state.time - last.time) / 1000;
      // The first sample comes straight after load, too soon to count frames.
      const fps = span >= 1 ? (state.frames - last.frames) / span : null;
      last = state;
      const s = { t: Date.now() - start, ...m, fps, errors: state.errors.length + problems.length };
      samples.push(s);
      const first = samples[0] ?? s;
      console.log(
        row([
          clock(s.t),
          (s.heap / MB).toFixed(2),
          `${s.heap >= first.heap ? "+" : ""}${((s.heap - first.heap) / MB).toFixed(2)}`,
          s.dom,
          `${s.dom >= first.dom ? "+" : ""}${s.dom - first.dom}`,
          s.canvases,
          fps === null ? "-" : fps.toFixed(1),
          s.errors,
        ]),
      );
      if (state.phase !== "running" || state.app !== app.id) {
        reasons.push(`page left the app: ${state.app ?? "nothing"} ${state.phase}`);
        break;
      }
      if (s.t >= durationMs) break;
    }
    if (samples[0]?.heap === 0)
      reasons.push("performance.memory unavailable; is the flag missing?");
    const errors = [...(await readState(page)).errors, ...problems];
    if (errors.length) reasons.push(`errors:\n    ${errors.slice(0, 10).join("\n    ")}`);
  } catch (err) {
    reasons.push(`harness: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  } finally {
    await browser.close();
    server.stop();
  }

  const elapsed = samples.at(-1)?.t ?? 0;
  const verdict = assessSoak(samples, Math.min(durationMs, elapsed));
  console.log("");
  if (verdict.heap && verdict.dom) {
    const { heap, dom } = verdict;
    console.log(
      `After ${clock(verdict.warmup)} warm-up: heap ${(heap.base / MB).toFixed(2)} to ${(heap.end / MB).toFixed(2)} MB ` +
        `(limit +${(heap.limit / MB).toFixed(2)}, trend ${(heap.perHour / MB).toFixed(2)} MB/h), ` +
        `DOM ${dom.base} to ${dom.end} nodes (limit +${Math.round(dom.limit)})`,
    );
  }
  const all = [...verdict.reasons, ...reasons];
  if (all.length) {
    console.log(`FAIL\n  ${all.join("\n  ")}`);
    process.exitCode = 1;
  } else {
    console.log("PASS");
  }
};

await main();
