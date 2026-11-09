/** Small 3D vector helpers for the swimming model, in bowl radii with y up. */
export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const copy = (a: Readonly<V3>): V3 => [a[0], a[1], a[2]];
export const add = (a: Readonly<V3>, b: Readonly<V3>): V3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: Readonly<V3>, b: Readonly<V3>): V3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale = (a: Readonly<V3>, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
/** a + b * s */
export const madd = (a: Readonly<V3>, b: Readonly<V3>, s: number): V3 => [
  a[0] + b[0] * s,
  a[1] + b[1] * s,
  a[2] + b[2] * s,
];
export const dot = (a: Readonly<V3>, b: Readonly<V3>): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Readonly<V3>, b: Readonly<V3>): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Readonly<V3>): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Readonly<V3>, b: Readonly<V3>): number =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a: Readonly<V3>, fallback: Readonly<V3> = [1, 0, 0]): V3 => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : copy(fallback);
};
export const lerp = (a: Readonly<V3>, b: Readonly<V3>, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Rotate `v` about the unit `axis` by `angle` radians (right-handed). */
export const rotate = (v: Readonly<V3>, axis: Readonly<V3>, angle: number): V3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = dot(axis, v) * (1 - c);
  const x = cross(axis, v);
  return [
    v[0] * c + x[0] * s + axis[0] * k,
    v[1] * c + x[1] * s + axis[1] * k,
    v[2] * c + x[2] * s + axis[2] * k,
  ];
};

/** The part of `v` across the unit `n`. */
export const across = (v: Readonly<V3>, n: Readonly<V3>): V3 => madd(v, n, -dot(v, n));

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

export const TAU = Math.PI * 2;
