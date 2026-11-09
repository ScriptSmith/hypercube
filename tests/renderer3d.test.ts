import {
  BoxGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  SphereGeometry,
} from "three";
import { describe, expect, it } from "vitest";
import { disposeTree } from "../src/core/renderer3d";

const counted = <T extends { addEventListener(t: "dispose", cb: () => void): void }>(
  x: T,
  seen: Set<unknown>,
): T => {
  x.addEventListener("dispose", () => seen.add(x));
  return x;
};

describe("disposeTree", () => {
  it("disposes every geometry, material and material texture once", () => {
    const seen = new Set<unknown>();
    const box = counted(new BoxGeometry(), seen);
    const ball = counted(new SphereGeometry(), seen);
    const map = counted(new DataTexture(new Uint8Array(4), 1, 1), seen);
    const shared = counted(new MeshPhongMaterial({ map }), seen);
    const a = counted(new MeshBasicMaterial(), seen);
    const b = counted(new MeshBasicMaterial(), seen);
    const root = new Group();
    const inner = new Group();
    root.add(new Mesh(box, shared), inner);
    inner.add(new Mesh(ball, shared), new Mesh(box, [a, b]));
    disposeTree(root);
    expect(seen).toEqual(new Set([box, ball, map, shared, a, b]));
  });
});
