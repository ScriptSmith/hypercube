/**
 * Thick lines and round dots for three.js, built on the CPU each frame. WebGL draws lines one
 * pixel wide, so an edge here is a thin strip facing the camera, soft across its width, and a
 * corner is a small square facing the camera with a round glow. Buffers are sized once; a batch
 * past the limit is cut short.
 */
import {
  AdditiveBlending,
  type Blending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  LinearFilter,
  type Material,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from "three";

const textureFrom = (w: number, h: number, alpha: (u: number, v: number) => number): Texture => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (g) {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(
          255 * Math.max(0, Math.min(1, alpha((x + 0.5) / w, (y + 0.5) / h))),
        );
      }
    }
    g.putImageData(img, 0, 0);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
};

/** Bright in the middle of a strip, soft at its sides (v runs across). */
export const stripTexture = (): Texture =>
  textureFrom(4, 64, (_u, v) => {
    const d = Math.abs(v - 0.5) * 2;
    return d < 0.45 ? 1 : Math.max(0, 1 - (d - 0.45) / 0.55) ** 1.6;
  });

/** A round glow. */
export const dotTexture = (): Texture =>
  textureFrom(64, 64, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    return d < 0.35 ? 1 : Math.max(0, 1 - (d - 0.35) / 0.65) ** 2;
  });

export const glowMaterial = (
  map: Texture,
  blending: Blending = AdditiveBlending,
  opacity = 1,
): MeshBasicMaterial =>
  new MeshBasicMaterial({
    map,
    vertexColors: true,
    transparent: true,
    blending,
    depthWrite: false,
    side: DoubleSide,
    opacity,
  });

export { NormalBlending };

export interface Ribbons {
  readonly geometry: BufferGeometry;
  /** A mesh drawing the strips with `material`; several may share the geometry. */
  mesh(material: Material): Mesh;
  /** Start a batch seen from `eye` (world). */
  begin(eye: Vector3): void;
  /** One strip from p to q, coloured from c0 to c1 (linear RGB), `width` world units across. */
  seg(
    px: number,
    py: number,
    pz: number,
    qx: number,
    qy: number,
    qz: number,
    width: number,
    r0: number,
    g0: number,
    b0: number,
    r1?: number,
    g1?: number,
    b1?: number,
  ): void;
  end(): void;
  readonly count: number;
  dispose(): void;
}

export const createRibbons = (max: number): Ribbons => {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(max * 4 * 3);
  const col = new Float32Array(max * 4 * 3);
  const uv = new Float32Array(max * 4 * 2);
  const index = new (max * 4 > 65535 ? Uint32Array : Uint16Array)(max * 6);
  for (let i = 0; i < max; i++) {
    uv.set([0, 0, 0, 1, 1, 1, 1, 0], i * 8);
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const posAttr = new BufferAttribute(pos, 3);
  const colAttr = new BufferAttribute(col, 3);
  posAttr.setUsage(DynamicDrawUsage);
  colAttr.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("color", colAttr);
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const eye = new Vector3();
  let n = 0;
  const meshes: Mesh[] = [];

  return {
    geometry,
    mesh(material) {
      const m = new Mesh(geometry, material);
      m.frustumCulled = false;
      meshes.push(m);
      return m;
    },
    begin(e) {
      eye.copy(e);
      n = 0;
    },
    seg(px, py, pz, qx, qy, qz, width, r0, g0, b0, r1 = r0, g1 = g0, b1 = b0) {
      if (n >= max) return;
      const dx = qx - px;
      const dy = qy - py;
      const dz = qz - pz;
      // Across the strip: perpendicular to it and to the line of sight.
      const vx = (px + qx) / 2 - eye.x;
      const vy = (py + qy) / 2 - eye.y;
      const vz = (pz + qz) / 2 - eye.z;
      let sx = dy * vz - dz * vy;
      let sy = dz * vx - dx * vz;
      let sz = dx * vy - dy * vx;
      let sl = Math.hypot(sx, sy, sz);
      if (sl < 1e-9) {
        // Seen end on (or a dot): any direction across the line of sight.
        sx = -vy;
        sy = vx;
        sz = 0;
        sl = Math.hypot(sx, sy, sz) || 1;
      }
      const h = width / 2 / sl;
      sx *= h;
      sy *= h;
      sz *= h;
      const o = n * 12;
      pos[o] = px - sx;
      pos[o + 1] = py - sy;
      pos[o + 2] = pz - sz;
      pos[o + 3] = px + sx;
      pos[o + 4] = py + sy;
      pos[o + 5] = pz + sz;
      pos[o + 6] = qx + sx;
      pos[o + 7] = qy + sy;
      pos[o + 8] = qz + sz;
      pos[o + 9] = qx - sx;
      pos[o + 10] = qy - sy;
      pos[o + 11] = qz - sz;
      col[o] = r0;
      col[o + 1] = g0;
      col[o + 2] = b0;
      col[o + 3] = r0;
      col[o + 4] = g0;
      col[o + 5] = b0;
      col[o + 6] = r1;
      col[o + 7] = g1;
      col[o + 8] = b1;
      col[o + 9] = r1;
      col[o + 10] = g1;
      col[o + 11] = b1;
      n++;
    },
    end() {
      geometry.setDrawRange(0, n * 6);
      posAttr.clearUpdateRanges();
      colAttr.clearUpdateRanges();
      posAttr.addUpdateRange(0, n * 12);
      colAttr.addUpdateRange(0, n * 12);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      for (const m of meshes) m.visible = n > 0;
    },
    get count() {
      return n;
    },
    dispose() {
      geometry.dispose();
    },
  };
};

export interface Dots {
  readonly geometry: BufferGeometry;
  mesh(material: Material): Mesh;
  /** Start a batch with the camera's right and up directions (world, unit). */
  begin(right: Vector3, up: Vector3): void;
  dot(x: number, y: number, z: number, size: number, r: number, g: number, b: number): void;
  end(): void;
  dispose(): void;
}

export const createDots = (max: number): Dots => {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(max * 4 * 3);
  const col = new Float32Array(max * 4 * 3);
  const uv = new Float32Array(max * 4 * 2);
  const index = new Uint16Array(max * 6);
  for (let i = 0; i < max; i++) {
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const posAttr = new BufferAttribute(pos, 3);
  const colAttr = new BufferAttribute(col, 3);
  posAttr.setUsage(DynamicDrawUsage);
  colAttr.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("color", colAttr);
  geometry.setAttribute("uv", new BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const right = new Vector3();
  const up = new Vector3();
  let n = 0;
  const meshes: Mesh[] = [];
  return {
    geometry,
    mesh(material) {
      const m = new Mesh(geometry, material);
      m.frustumCulled = false;
      meshes.push(m);
      return m;
    },
    begin(r, u) {
      right.copy(r);
      up.copy(u);
      n = 0;
    },
    dot(x, y, z, size, r, g, b) {
      if (n >= max) return;
      const o = n * 12;
      const s = size / 2;
      const corners = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const;
      corners.forEach(([a, c], k) => {
        pos[o + k * 3] = x + (right.x * a + up.x * c) * s;
        pos[o + k * 3 + 1] = y + (right.y * a + up.y * c) * s;
        pos[o + k * 3 + 2] = z + (right.z * a + up.z * c) * s;
        col[o + k * 3] = r;
        col[o + k * 3 + 1] = g;
        col[o + k * 3 + 2] = b;
      });
      n++;
    },
    end() {
      geometry.setDrawRange(0, n * 6);
      posAttr.clearUpdateRanges();
      colAttr.clearUpdateRanges();
      posAttr.addUpdateRange(0, n * 12);
      colAttr.addUpdateRange(0, n * 12);
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      for (const m of meshes) m.visible = n > 0;
    },
    dispose() {
      geometry.dispose();
    },
  };
};
