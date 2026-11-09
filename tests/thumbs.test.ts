import { describe, expect, it } from "vitest";
import { listApps } from "../src/core/registry";
import { lookName, thumbPreviews } from "../src/core/thumbs";
import type { AppManifest, FrameKind } from "../src/core/types";

const demo: AppManifest = {
  id: "demo",
  title: "Demo",
  category: "visual",
  blurb: "",
  setups: [{ setup: "solo", kinds: ["sphere", "wall"] }],
  variants: [
    { id: "plain", title: "Plain" },
    { id: "fancy", title: "Fancy" },
  ],
  network: "none",
  thumb: {
    kind: "sphere",
    seconds: 6,
    looks: [{ variant: "fancy" }, { kind: "wall", options: { colours: "teal" }, seconds: 2 }],
  },
};

describe("thumbnail previews", () => {
  it("names a look by its own kind, variant and options", () => {
    expect(lookName({ variant: "reef" })).toBe("reef");
    expect(lookName({ kind: "wall", options: { colours: "teal", balls: 3 } })).toBe(
      "wall.colours-teal.balls-3",
    );
    expect(lookName({ options: { "odd key": "a/b" } })).toBe("odd_key-a_b");
  });

  it("keeps the first preview at the app id and fills each look from it", () => {
    expect(thumbPreviews(demo)).toEqual([
      { stem: "demo", kind: "sphere", variant: "plain", options: {}, seconds: 6 },
      { stem: "demo.fancy", kind: "sphere", variant: "fancy", options: {}, seconds: 6 },
      {
        stem: "demo.wall.colours-teal",
        kind: "wall",
        variant: "plain",
        options: { colours: "teal" },
        seconds: 2,
      },
    ]);
  });

  it("gives an app without thumbnail settings one preview, shot after 3 s", () => {
    const { thumb: _, variants: __, ...bare } = demo;
    expect(thumbPreviews(bare)).toEqual([
      { stem: "demo", kind: undefined, variant: undefined, options: {}, seconds: 3 },
    ]);
  });
});

describe("every manifest's looks", () => {
  const apps = listApps();
  const kindsOf = (app: AppManifest): FrameKind[] => app.setups.flatMap((s) => s.kinds);

  it.each(apps.filter((a) => a.thumb?.looks?.length).map((a) => [a.id, a] as const))(
    "%s lists previews it can run",
    (_, app) => {
      const previews = thumbPreviews(app);
      const stems = previews.map((p) => p.stem);
      expect(new Set(stems).size, "look names repeat").toBe(stems.length);
      for (const look of app.thumb?.looks ?? []) {
        expect(lookName(look), "a look must change something").not.toBe("");
      }
      for (const p of previews) {
        if (p.kind) expect(kindsOf(app), p.stem).toContain(p.kind);
        const variants = app.variants?.map((v) => v.id) ?? [];
        if (p.variant) expect(variants, p.stem).toContain(p.variant);
        for (const [key, value] of Object.entries(p.options)) {
          const option = app.options?.find((o) => o.key === key);
          expect(option, `${p.stem}: no option ${key}`).toBeDefined();
          if (option?.kinds && p.kind) expect(option.kinds, p.stem).toContain(p.kind);
          const values = option?.type === "enum" ? option.values.map((v) => v.id) : null;
          if (values) expect(values, p.stem).toContain(String(value));
        }
      }
    },
  );

  it("are few, so the gallery stays light", () => {
    for (const app of apps) expect(thumbPreviews(app).length, app.id).toBeLessThanOrEqual(4);
  });
});
