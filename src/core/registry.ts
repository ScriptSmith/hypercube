import type { AppManifest, AppModule } from "./types";

// No type arguments on these globs: Vitest's module cache only skips files containing the literal
// `import.meta.glob(`, and a cached registry misses apps added since.
const manifestModules = import.meta.glob("../apps/*/manifest.ts", { eager: true }) as Record<
  string,
  { default: AppManifest }
>;
const appModules = import.meta.glob("../apps/*/index.ts") as Record<
  string,
  () => Promise<AppModule>
>;

const idFromPath = (path: string): string => path.split("/").at(-2) ?? "";

const manifests = new Map<string, AppManifest>();
for (const [path, mod] of Object.entries(manifestModules)) {
  const id = idFromPath(path);
  if (mod.default.id !== id) {
    throw new Error(`manifest id "${mod.default.id}" does not match folder "${id}"`);
  }
  manifests.set(id, mod.default);
}

export const listApps = (): AppManifest[] =>
  [...manifests.values()].sort((a, b) => a.title.localeCompare(b.title));

export const getManifest = (id: string): AppManifest | undefined => manifests.get(id);

export const loadApp = async (id: string): Promise<AppModule> => {
  const entry = Object.entries(appModules).find(([path]) => idFromPath(path) === id);
  if (!entry) throw new Error(`no app "${id}"`);
  return entry[1]();
};
