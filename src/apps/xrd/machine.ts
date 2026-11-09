/**
 * The diffractometer as geometry: the sample's reciprocal lattice turned by the stage, the Ewald
 * sphere, and where each flash lands on the detector. Pure; chapter 5, the screen and the wall's
 * banner all draw from it, so the dials and the big machine always agree.
 *
 * Lab frame: the beam runs along +x from the tube to the sample at the origin, y is up, and z
 * points out of the diffraction plane (the x–y plane) towards the room, along the main axis that
 * ω and the arm turn about. s_in = (1/λ, 0, 0).
 *
 * The stage stacks three circles: ω turns everything about the main axis (z); χ rides on it and
 * tilts the sample from flat about the axis that lies along the beam when ω is 0 (x); φ rides on
 * both and spins the sample on its surface normal (y in the sample's frame). A vector fixed in
 * the sample reaches the lab as G_lab = Rz(ω) · Rx(χ) · Ry(φ) · G_sample. At rest the sample
 * lies flat, its normal +y, so the beam skims along its surface at ω = 0 and strikes it head on
 * at ω = 90°.
 *
 * A point G flashes when the scattered arrow s_out = G + s_in has length 1/λ, that is when G
 * touches the Ewald sphere; it lands where s_out meets the detector, if it does.
 */
import {
  type Crystal,
  type CrystalId,
  CRYSTALS,
  brightness,
  reciprocalBasis,
  type Vec3,
} from "./crystals";
import presetData from "./data/presets.json";

const DEG = Math.PI / 180;

export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const mul = (a: Mat3, b: Mat3): Mat3 => {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r.push(a[i * 3]! * b[j]! + a[i * 3 + 1]! * b[3 + j]! + a[i * 3 + 2]! * b[6 + j]!);
  return r as unknown as Mat3;
};

export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

export const rotX = (deg: number): Mat3 => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (deg: number): Mat3 => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (deg: number): Mat3 => {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const unit = (v: Vec3): Vec3 => {
  const l = norm(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (u: Vec3, v: Vec3): Vec3 => [
  u[1] * v[2] - u[2] * v[1],
  u[2] * v[0] - u[0] * v[2],
  u[0] * v[1] - u[1] * v[0],
];
const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

/** Degrees. */
export interface StageAngles {
  omega: number;
  chi: number;
  phi: number;
}

/** Sample frame to lab frame. */
export const stageMatrix = (s: StageAngles): Mat3 =>
  mul(rotZ(s.omega), mul(rotX(s.chi), rotY(s.phi)));

/**
 * Whether a scattered ray leaves through the sample's top surface. The sample is a thick crystal
 * seen in reflection, so a ray heading down into it is absorbed and never reaches a detector
 * (Cullity and Stock, the diffractometer's geometry). The beam itself always comes in from above
 * within the dials' ranges: s_in · n = -sin ω cos χ.
 */
export const leavesSurface = (stage: StageAngles, sOut: Vec3): boolean => {
  const n = apply(stageMatrix(stage), [0, 1, 0]);
  return dot(n, sOut) > 0;
};

/** The axes of the three circles in the lab, where the dials have left them. */
export const stageAxes = (s: StageAngles): { omega: Vec3; chi: Vec3; phi: Vec3 } => {
  const rw = rotZ(s.omega);
  return {
    omega: [0, 0, 1],
    chi: apply(rw, [1, 0, 0]),
    phi: apply(stageMatrix(s), [0, 1, 0]),
  };
};

/**
 * The turn that sets a crystal on the sample: the (h k l) planes parallel to the surface (their
 * normal along the sample's +y), with the crystal's a axis kept as near the beam as it can be.
 */
export const orientFor = (c: Crystal, hkl: Vec3): Mat3 => {
  const [as, bs, cs] = reciprocalBasis(c.cell);
  const g: Vec3 = [
    hkl[0] * as[0] + hkl[1] * bs[0] + hkl[2] * cs[0],
    hkl[0] * as[1] + hkl[1] * bs[1] + hkl[2] * cs[1],
    hkl[0] * as[2] + hkl[1] * bs[2] + hkl[2] * cs[2],
  ];
  const ny = unit(g);
  // Any direction not along the normal will do for the in-plane axis.
  const seed: Vec3 = Math.abs(ny[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  const nx = unit(cross(cross(ny, seed), ny));
  const nz = cross(nx, ny);
  // Rows are the crystal's directions expressed in the sample frame's axes.
  return [nx[0], nx[1], nx[2], ny[0], ny[1], ny[2], nz[0], nz[1], nz[2]];
};

/** The planes laid flat on the stage for each crystal: the running example's (1 1 1). */
export const FLAT: Record<CrystalId, Vec3> = {
  salt: [0, 0, 1],
  kcl: [0, 0, 1],
  aluminium: [1, 1, 1],
  diamond: [1, 1, 1],
  silicon: [0, 0, 1],
  graphite: [0, 0, 1],
  quartz: [0, 0, 1],
  ice: [0, 0, 1],
  corundum: [0, 0, 1],
  zircon: [0, 0, 1],
};

export interface LatticePoint {
  hkl: Vec3;
  /** In the crystal's Cartesian frame, Å⁻¹. */
  g: Vec3;
  /** |F|², electrons², for how bright its flash is. */
  F2: number;
}

/** Every reflection with |G| ≤ maxS that isn't missing, nearest first. */
export const latticePoints = (c: Crystal, maxS: number, limit = 600): LatticePoint[] => {
  const [as, bs, cs] = reciprocalBasis(c.cell);
  const hMax = Math.ceil(maxS * c.cell.a);
  const kMax = Math.ceil(maxS * c.cell.b);
  const lMax = Math.ceil(maxS * c.cell.c);
  const out: LatticePoint[] = [];
  let strongest = 0;
  for (let h = -hMax; h <= hMax; h++) {
    for (let k = -kMax; k <= kMax; k++) {
      for (let l = -lMax; l <= lMax; l++) {
        if (h === 0 && k === 0 && l === 0) continue;
        const g: Vec3 = [
          h * as[0] + k * bs[0] + l * cs[0],
          h * as[1] + k * bs[1] + l * cs[1],
          h * as[2] + k * bs[2] + l * cs[2],
        ];
        if (norm(g) > maxS) continue;
        const F2 = brightness(c, h, k, l);
        strongest = Math.max(strongest, F2);
        out.push({ hkl: [h, k, l], g, F2 });
      }
    }
  }
  const kept = out.filter((p) => p.F2 >= strongest * 1e-3);
  kept.sort((a, b) => norm(a.g) - norm(b.g));
  return kept.slice(0, limit);
};

// ---- Detectors -------------------------------------------------------------------------------

export type DetectorKind = "strip" | "plate";

export interface Detector {
  kind: DetectorKind;
  /** Sample to detector, mm. */
  distance: number;
  columns: number;
  rows: number;
  /** Pixel height (and, for the plate, width), mm. */
  pixel: number;
  /** Angle one column covers, degrees: fixed on the strip, arctan(p/D) on the plate. */
  thetaPixel: number;
}

/**
 * The presets' settings (`data/presets.json`, round numbers of our own): one data object, so the
 * presets and detector sizes change in one place, and the simulated maps' script reads the same.
 */
interface PresetRecord {
  label: string;
  omegaDeg: number;
  chiDeg: number;
  phiDeg: number;
  twoThetaStartDeg: number;
  twoThetaCentreDeg: number;
  distanceMm: number;
  wavelengthA: number;
  pixelMm: number;
  columnDeg: number;
  frameRows: number;
  frameColumns: number;
  plateRows?: number;
  plateColumns?: number;
}

const record = (label: string): PresetRecord => {
  const r = (presetData.presets as PresetRecord[]).find((p) => p.label === label);
  if (!r) throw new Error(`no preset ${label}`);
  return r;
};
const STRIP_RECORD = record("Curved strip");
const PLATE_RECORD = record("Flat plate");

/** The curved strip: 1101 columns 0.1° apart at 280 mm, 200 rows of 0.075 mm. */
export const STRIP: Detector = {
  kind: "strip",
  distance: STRIP_RECORD.distanceMm,
  columns: STRIP_RECORD.frameColumns,
  rows: STRIP_RECORD.frameRows,
  pixel: STRIP_RECORD.pixelMm,
  thetaPixel: STRIP_RECORD.columnDeg,
};

/**
 * The flat plate: 400 pixels wide and 800 tall, 0.1 mm each, at 120 mm. A frame's many
 * more columns are the arm's scan, not the plate.
 */
export const PLATE: Detector = {
  kind: "plate",
  distance: PLATE_RECORD.distanceMm,
  columns: PLATE_RECORD.plateColumns ?? 400,
  rows: PLATE_RECORD.plateRows ?? 800,
  pixel: PLATE_RECORD.pixelMm,
  thetaPixel: Math.atan(PLATE_RECORD.pixelMm / PLATE_RECORD.distanceMm) / DEG,
};

/** Width as the arm sees it: degrees of arc for the strip, mm for the plate. */
export const detectorWidth = (d: Detector): number =>
  d.kind === "strip" ? d.columns * d.thetaPixel : d.columns * d.pixel;
export const detectorHeight = (d: Detector): number => d.rows * d.pixel;

/** Where a ray meets the detector, in mm from the detector's centre: u across, v up (out of plane). */
export interface Hit {
  u: number;
  v: number;
  /** -0.5 to 0.5 across and up the face. */
  fu: number;
  fv: number;
  /** In the lab, mm from the sample. */
  at: Vec3;
}

/**
 * Where the ray from the sample along `dir` meets a detector whose centre the arm holds at
 * `armTwoTheta` (degrees, in the diffraction plane), or null if it misses.
 */
export const detectorHit = (det: Detector, armTwoTheta: number, dir: Vec3): Hit | null => {
  const u = unit(dir);
  const D = det.distance;
  const H = detectorHeight(det);
  if (det.kind === "strip") {
    // A strip of a cylinder of radius D about the main axis.
    const r = Math.hypot(u[0], u[1]);
    if (r < 1e-9) return null;
    const psi = Math.atan2(u[1], u[0]) / DEG;
    let off = psi - armTwoTheta;
    off = ((((off + 180) % 360) + 360) % 360) - 180;
    const span = detectorWidth(det);
    const v = (D * u[2]) / r;
    if (Math.abs(off) > span / 2 || Math.abs(v) > H / 2) return null;
    const t = D / r;
    return {
      u: off * DEG * D,
      v,
      fu: off / span,
      fv: v / H,
      at: [u[0] * t, u[1] * t, u[2] * t],
    };
  }
  const c: Vec3 = [Math.cos(armTwoTheta * DEG), Math.sin(armTwoTheta * DEG), 0];
  const e1: Vec3 = [-Math.sin(armTwoTheta * DEG), Math.cos(armTwoTheta * DEG), 0];
  const along = dot(u, c);
  if (along <= 1e-9) return null;
  const t = D / along;
  const p: Vec3 = [u[0] * t, u[1] * t, u[2] * t];
  const W = detectorWidth(det);
  const pu = dot(p, e1);
  const pv = p[2];
  if (Math.abs(pu) > W / 2 || Math.abs(pv) > H / 2) return null;
  return { u: pu, v: pv, fu: pu / W, fv: pv / H, at: p };
};

/** The lab direction of a point on the detector face (fu, fv from -0.5 to 0.5). */
export const detectorPoint = (det: Detector, armTwoTheta: number, fu: number, fv: number): Vec3 => {
  const D = det.distance;
  const v = fv * detectorHeight(det);
  if (det.kind === "strip") {
    const psi = (armTwoTheta + fu * detectorWidth(det)) * DEG;
    return [D * Math.cos(psi), D * Math.sin(psi), v];
  }
  const a = armTwoTheta * DEG;
  const u = fu * detectorWidth(det);
  return [D * Math.cos(a) - u * Math.sin(a), D * Math.sin(a) + u * Math.cos(a), v];
};

// ---- Flashes ---------------------------------------------------------------------------------

/** How far from the sphere a point may be and still flash, as a share of 1/λ. */
export const SHELL = 0.004;

export interface Machine {
  crystal: Crystal;
  /** Crystal frame to sample frame. */
  orient: Mat3;
  stage: StageAngles;
  armTwoTheta: number;
  lambda: number;
  detector: Detector;
}

/** How far G_lab + s_in is from the sphere, Å⁻¹: positive outside. */
export const sphereGap = (gLab: Vec3, lambda: number): number => {
  const k = 1 / lambda;
  return Math.hypot(gLab[0] + k, gLab[1], gLab[2]) - k;
};

export const labVector = (m: Pick<Machine, "orient" | "stage">, g: Vec3): Vec3 =>
  apply(stageMatrix(m.stage), apply(m.orient, g));

export interface Flash {
  point: LatticePoint;
  /** s_out, Å⁻¹. */
  sOut: Vec3;
  /** 2θ of the flash, degrees. */
  twoTheta: number;
  /** Where it lands on the detector, or null when it misses. */
  hit: Hit | null;
  /** 1 on the sphere, falling to 0 at the shell's edge. */
  strength: number;
}

const flashOf = (m: Machine, p: LatticePoint, gLab: Vec3, gap: number): Flash => {
  const k = 1 / m.lambda;
  const sOut: Vec3 = [gLab[0] + k, gLab[1], gLab[2]];
  const cos2t = sOut[0] / (norm(sOut) || 1);
  return {
    point: p,
    sOut,
    twoTheta: Math.acos(Math.max(-1, Math.min(1, cos2t))) / DEG,
    hit: detectorHit(m.detector, m.armTwoTheta, sOut),
    strength: Math.max(0, 1 - Math.abs(gap) / (SHELL * k)),
  };
};

/** Points within the shell now. */
export const flashes = (m: Machine, points: readonly LatticePoint[]): Flash[] => {
  const k = 1 / m.lambda;
  const R = mul(stageMatrix(m.stage), m.orient);
  const out: Flash[] = [];
  for (const p of points) {
    const g = apply(R, p.g);
    const gap = sphereGap(g, m.lambda);
    if (Math.abs(gap) <= SHELL * k) out.push(flashOf(m, p, g, gap));
  }
  return out;
};

/**
 * Points that crossed the sphere between two stage settings, so a fast turn can't skip a flash
 * between frames. Each is reported at its place in the newer setting.
 */
export const crossings = (
  m: Machine,
  before: StageAngles,
  points: readonly LatticePoint[],
): Flash[] => {
  const k = 1 / m.lambda;
  const R0 = mul(stageMatrix(before), m.orient);
  const R1 = mul(stageMatrix(m.stage), m.orient);
  const out: Flash[] = [];
  for (const p of points) {
    const g0 = apply(R0, p.g);
    const g1 = apply(R1, p.g);
    const a = sphereGap(g0, m.lambda);
    const b = sphereGap(g1, m.lambda);
    if (a > 0 !== b > 0 || Math.abs(b) <= SHELL * k) {
      const f = flashOf(m, p, g1, 0);
      out.push({ ...f, strength: 1 });
    }
  }
  return out;
};

// ---- The machine's state, as dials -----------------------------------------------------------

export interface MachineState extends StageAngles {
  armTwoTheta: number;
  distance: number;
  detector: DetectorKind;
  lambda: number;
}

export const DIAL_RANGE = {
  omega: [0, 90],
  chi: [-90, 90],
  phi: [-180, 180],
  armTwoTheta: [0, 150],
  distance: [80, 320],
} as const;

/**
 * Presets for the two detectors (`data/presets.json`), labelled for visitors only as "Curved
 * strip" and "Flat plate", each with its own tube's Kα1 wavelength.
 */
export interface Preset {
  label: string;
  state: MachineState;
  /** The values the frame itself stores. */
  stored: {
    omega: number;
    chi: number;
    phi: number;
    twoTheta: number;
    distance: number;
    lambda: number;
    pixel: number;
  };
}

const presetOf = (kind: DetectorKind, r: PresetRecord): Preset => ({
  label: r.label,
  state: {
    omega: r.omegaDeg,
    chi: r.chiDeg,
    phi: r.phiDeg,
    // The strip's frame spans its scan, so the arm holds the scan's middle; the plate's turn is
    // the one at its scan's end, where the arm stands at twice the turn, the symmetric pose.
    armTwoTheta: kind === "strip" ? r.twoThetaCentreDeg : 2 * r.omegaDeg,
    distance: r.distanceMm,
    detector: kind,
    lambda: r.wavelengthA,
  },
  stored: {
    omega: r.omegaDeg,
    chi: r.chiDeg,
    phi: r.phiDeg,
    twoTheta: r.twoThetaStartDeg,
    distance: r.distanceMm,
    lambda: r.wavelengthA,
    pixel: r.pixelMm,
  },
});

export const PRESETS: Record<DetectorKind, Preset> = {
  strip: presetOf("strip", STRIP_RECORD),
  plate: presetOf("plate", PLATE_RECORD),
};

export const detectorFor = (kind: DetectorKind, distance?: number): Detector => {
  const base = kind === "strip" ? STRIP : PLATE;
  if (distance === undefined || distance === base.distance) return base;
  // A strip keeps its columns' angle; a plate's columns cover a smaller angle farther away.
  return kind === "strip"
    ? { ...base, distance }
    : { ...base, distance, thetaPixel: Math.atan(base.pixel / distance) / DEG };
};

/** A machine for a crystal at a state, the crystal's (h k l) planes lying flat on the stage. */
export const machineFor = (
  crystal: CrystalId | Crystal,
  state: MachineState,
  flat: Vec3 = [0, 0, 1],
): Machine => {
  const c = typeof crystal === "string" ? CRYSTALS[crystal] : crystal;
  return {
    crystal: c,
    orient: orientFor(c, flat),
    stage: { omega: state.omega, chi: state.chi, phi: state.phi },
    armTwoTheta: state.armTwoTheta,
    lambda: state.lambda,
    detector: detectorFor(state.detector, state.distance),
  };
};
