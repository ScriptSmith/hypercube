// The production preview server the harness tests against. HC_BASE_URL points everything at
// another server instead; HC_PORT moves the local one.
import { spawn, spawnSync } from "node:child_process";
import { ROOT } from "./apps.mjs";

export const PORT = Number(process.env.HC_PORT ?? 4173);
export const BASE_URL = process.env.HC_BASE_URL ?? `http://localhost:${PORT}/`;
export const EXTERNAL = Boolean(process.env.HC_BASE_URL);

const reachable = async (base) => {
  try {
    const res = await fetch(new URL("play/", base), { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Reuse a running server, or build and start `pnpm preview` and stop it when this process exits.
 * A reused server may be serving an older build.
 */
export const ensureServer = async (log = (msg) => console.error(msg)) => {
  if (await reachable(BASE_URL)) {
    log(`Using the server already running at ${BASE_URL}`);
    return { url: BASE_URL, started: false, stop() {} };
  }
  if (EXTERNAL) throw new Error(`HC_BASE_URL ${BASE_URL} is not reachable`);
  log("No server running; building and starting pnpm preview");
  const build = spawnSync("pnpm", ["build"], { cwd: ROOT, stdio: ["ignore", 2, 2] });
  if (build.status !== 0) throw new Error("pnpm build failed");
  const child = spawn("pnpm", ["preview", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
    // Its own process group, so stopping it also stops the vite process pnpm starts.
    detached: true,
  });
  let stopped = false;
  const stop = () => {
    if (stopped || child.pid === undefined) return;
    stopped = true;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  };
  process.once("exit", stop);
  const deadline = Date.now() + 30_000;
  while (!(await reachable(BASE_URL))) {
    if (child.exitCode !== null || Date.now() > deadline) {
      stop();
      throw new Error(`pnpm preview did not come up on port ${PORT}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  log(`Started pnpm preview at ${BASE_URL}`);
  return { url: BASE_URL, started: true, stop };
};
