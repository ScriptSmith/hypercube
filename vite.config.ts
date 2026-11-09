import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const LICENSES = "third-party-licenses.txt";

/** The folder of the package a bundled module belongs to, or null for our own code. */
const packageDir = (id: string): string | null => {
  const m = /^(.*[/\\]node_modules[/\\])((?:@[^/\\]+[/\\])?[^/\\]+)/.exec(id);
  return m ? m[1]! + m[2]! : null;
};

/** Node's lookup: the nearest node_modules folder above `from` that holds `name`. */
const findPackage = (name: string, from: string): string | null => {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dirname(dir) === dir) return null;
  }
};

/**
 * Prebuilt packages such as MapLibre and PeerJS carry their own dependencies inside their bundles,
 * where Vite's licence file can't see them, so the notices of every bundled package's
 * dependencies are appended to it.
 */
const nestedLicenses = (): Plugin => {
  const bundled = new Set<string>();
  return {
    name: "nested-licenses",
    apply: "build",
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        for (const id of Object.keys(out.modules)) {
          const dir = packageDir(id);
          if (dir) bundled.add(dir);
        }
      }
    },
    writeBundle(options) {
      const file = join(options.dir ?? "dist", LICENSES);
      if (!existsSync(file)) return;
      const listed = new Set(
        [...bundled].map((dir) => JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name),
      );
      const sections = new Map<string, string>();
      const visit = (dir: string) => {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        for (const dep of Object.keys(pkg.dependencies ?? {})) {
          if (dep.startsWith("@types/") || listed.has(dep) || sections.has(dep)) continue;
          const depDir = findPackage(dep, dir);
          if (!depDir) continue;
          const meta = JSON.parse(readFileSync(join(depDir, "package.json"), "utf8"));
          const text = readdirSync(depDir).find((f) => /^licen[cs]e(\.|$)/i.test(f));
          const author = typeof meta.author === "string" ? meta.author : meta.author?.name;
          const body = text
            ? readFileSync(join(depDir, text), "utf8").trim()
            : `${meta.license} licence${author ? `, by ${author}` : ""}. The package has no licence file.`;
          sections.set(dep, `## ${dep} - ${meta.version} (${meta.license})\n\n${body}\n`);
          visit(depDir);
        }
      };
      for (const dir of bundled) visit(dir);
      if (sections.size === 0) return;
      const names = [...sections.keys()].sort();
      appendFileSync(
        file,
        "\n# Inside the packages above\n\nSome of the packages above ship prebuilt bundles that " +
          "include these dependencies:\n\n" +
          names.map((n) => sections.get(n)).join("\n"),
      );
    },
  };
};

export default defineConfig({
  // Relative so the build works at the site root or under any other path.
  base: "./",
  plugins: [nestedLicenses(), ...(process.env.HTTPS ? [basicSsl()] : [])],
  build: {
    // Parallel sessions build into their own folder (HC_OUTDIR) so e2e runs don't clobber each other.
    outDir: process.env.HC_OUTDIR ?? "dist",
    target: "es2022",
    // Minifying drops the libraries' licence comments, so their notices ship in one file instead.
    license: { fileName: LICENSES },
    rollupOptions: {
      input: {
        landing: resolve(root, "index.html"),
        play: resolve(root, "play/index.html"),
        sim: resolve(root, "sim/index.html"),
        admin: resolve(root, "admin/index.html"),
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
