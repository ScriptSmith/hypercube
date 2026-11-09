// App discovery for the test harness: every folder in src/apps with a manifest.ts.
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ROOT = resolve(import.meta.dirname, "../..");

/**
 * Import a TypeScript module from src. Node strips types natively, which covers manifests that
 * only use `import type`. Anything Node refuses (extensionless value imports, enums) goes
 * through Vite's module runner instead. `HC_LOADER=vite` forces that path.
 */
export const importTs = async (file) => {
  if (process.env.HC_LOADER !== "vite") {
    try {
      return await import(pathToFileURL(file).href);
    } catch (err) {
      if (process.env.HC_LOADER === "node") throw err;
    }
  }
  const { runnerImport } = await import("vite");
  const { module } = await runnerImport(file, {
    configFile: false,
    logLevel: "silent",
    root: ROOT,
  });
  return module;
};

export const discoverApps = async (root = ROOT) => {
  const dir = join(root, "src/apps");
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "manifest.ts")))
    .map((d) => d.name)
    .sort();
  const apps = [];
  for (const id of ids) {
    const manifest = (await importTs(join(dir, id, "manifest.ts"))).default;
    if (manifest?.id !== id) {
      throw new Error(`src/apps/${id}/manifest.ts: default export id does not match the folder`);
    }
    apps.push(manifest);
  }
  return apps;
};

/** Venue size per frame kind, from the runtime so the two never drift apart. */
export const loadVenueSizes = async (root = ROOT) =>
  (await importTs(join(root, "src/core/frame.ts"))).VENUE_SIZE;
