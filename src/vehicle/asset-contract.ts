import type { HeadClearance } from '../views/head-pose';
import type { BodyPose, QuatData, Vec3Data, VehicleId, VehicleProfile } from '../contracts';

export type MirrorId = 'rear' | 'left' | 'right';

/** Glass pose (centre + default rotation; local +Z faces the eye), size and convexity. */
export interface MirrorSpec extends BodyPose {
  readonly halfSizeM: readonly [number, number];
  readonly convexity: number;
}

interface MirrorGlassView {
  readonly halfSizeM: readonly [number, number];
  readonly convexity: number;
  /** Reflected centre ray pitch below horizontal. */
  readonly pitchDownRad: number;
}

interface VehicleViewProfile {
  readonly rearCameraOffsetM: Vec3Data;
  readonly glass: Readonly<Record<MirrorId, MirrorGlassView>>;
  /** Side mirrors: the inner view edge points this far inward of straight back. */
  readonly sideInnerEdgeInwardRad: number;
  /** Side glass centre height above the mirror collider centre (inside the housing). */
  readonly sideGlassRiseM: number;
  /** Forward (-Z) shift of the side-mirror anchors and colliders from frontAxle + 0.35 m. */
  readonly sideMirrorZOffsetM: number;
  /** Seat adjustment range from the nominal eye point (+Z rearward, height adds to Y). */
  readonly seatRangeM: { readonly foreAft: readonly [number, number]; readonly height: readonly [number, number] };
  /** Head clearance box relative to `driverEyeLocalM`; the contract exposes it absolute. */
  readonly headClearanceM: HeadClearance;
}

const DEG = Math.PI / 180;

// Sedan and CUV interior subtasks of issue #12: side mirrors sit at the A-pillar base
// ahead of the driver; the rearview camera and its display (rearDisplayM) share one point
// under the windshield header.
const cabinView: VehicleViewProfile = {
  rearCameraOffsetM: [0.36, 0.14, -0.56],
  // Issue #9: typical glass sizes; flat driver mirror, slightly convex passenger mirror,
  // aimed at the common "sliver of your own car" setting.
  glass: {
    rear: { halfSizeM: [0.12, 0.03], convexity: 1, pitchDownRad: 2 * DEG },
    left: { halfSizeM: [0.11, 0.065], convexity: 1, pitchDownRad: 3 * DEG },
    right: { halfSizeM: [0.11, 0.065], convexity: 1.3, pitchDownRad: 3 * DEG },
  },
  sideInnerEdgeInwardRad: 1 * DEG,
  // Rearward-facing glass reaches further inboard; raising it 4.4 cm inside its housing keeps
  // the whole passenger face above the dashboard from the eye (passing band ~4.0-4.8 cm).
  sideGlassRiseM: 0.044,
  sideMirrorZOffsetM: -0.585,
  seatRangeM: { foreAft: [-0.1, 0.1], height: [-0.03, 0.05] },
  // Issue #23: the box holds every raw eye (seat range + head lean, up to +0.03 m when looking
  // back) with >= 1 cm margin; src/world/head-clearance.test.ts keeps each sampled eye >= 0.12 m
  // from every triangle of the exported vehicle.
  headClearanceM: { minM: [-0.2, -0.06, -0.2], maxM: [0.3, 0.09, 0.16] },
};

// The CUV headliner is only 0.19 m above its default eye (sedan 0.275 m), so at +5 cm seat
// height with the +3 cm look-back lean the eye came within 0.110 m of it. The cabin geometry is
// not changed for the seat: the CUV seat rises at most 3 cm (eye >= 0.13 m from the headliner)
// and its box top stays 0.12 m below the headliner, so even a clamped eye clears it.
const cuvCabinView: VehicleViewProfile = {
  ...cabinView,
  seatRangeM: { foreAft: [-0.1, 0.1], height: [-0.03, 0.03] },
  headClearanceM: { minM: [-0.2, -0.06, -0.2], maxM: [0.3, 0.07, 0.16] },
};

export const vehicleViews: Readonly<Record<VehicleId, VehicleViewProfile>> = {
  sedan: cabinView,
  cuv: cuvCabinView,
};

export const vehicleNodeNames = [
  'Exterior', 'ParkedGlazing', 'ExteriorGlazing',
  'Body', 'WheelFL', 'WheelFR', 'WheelRL', 'WheelRR', 'DriverEye',
  'MirrorRear', 'MirrorLeft', 'MirrorRight',
  'MirrorSurfaceRear', 'MirrorSurfaceLeft', 'MirrorSurfaceRight',
  'Dashboard', 'SteeringWheel', 'Cabin', 'Windshield', 'RearWindow',
] as const;

type V3 = [number, number, number];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const add = (a: readonly number[], b: readonly number[], scale = 1): V3 =>
  [a[0]! + b[0]! * scale, a[1]! + b[1]! * scale, a[2]! + b[2]! * scale];
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: readonly number[], b: readonly number[]): V3 =>
  [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const normalize = (a: readonly number[]): V3 => {
  const length = Math.hypot(a[0]!, a[1]!, a[2]!);
  return [a[0]! / length, a[1]! / length, a[2]! / length];
};

/** Unit quaternion of the roll-free basis whose +Z is `normal`. */
function basisQuaternion(normal: V3): QuatData {
  const x = normalize(cross([0, 1, 0], normal));
  const y = cross(normal, x);
  const [m00, m10, m20] = x, [m01, m11, m21] = y, [m02, m12, m22] = normal;
  const trace = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const length = Math.hypot(...q);
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** Rearward (+Z) ray turned `outwardRad` towards `side` (-1 left, +1 right), pitched down. */
function rearRay(side: number, outwardRad: number, pitchDownRad: number): V3 {
  return [side * Math.sin(outwardRad) * Math.cos(pitchDownRad), -Math.sin(pitchDownRad),
    Math.cos(outwardRad) * Math.cos(pitchDownRad)];
}

/** Default glass rotation: the normal bisects the directions to the eye and the reflected ray. */
export function defaultGlassRotation(
  eye: Vec3Data, glassCenter: Vec3Data, reflectedDir: Vec3Data,
): QuatData {
  return basisQuaternion(normalize(add(normalize(sub(eye, glassCenter)), normalize(reflectedDir))));
}

/** Outward angle (towards `side`) the eye sees through the inner (car-side) view edge. */
function innerEdgeOutwardRad(
  eye: Vec3Data, center: Vec3Data, side: number, view: MirrorGlassView, outwardRad: number,
): number {
  const normal = normalize(add(normalize(sub(eye, center)),
    rearRay(side, outwardRad, view.pitchDownRad)));
  const right = normalize(cross([0, 1, 0], normal));
  const span = view.halfSizeM[0] * view.convexity;
  const edges = [add(center, right, span), add(center, right, -span)];
  const inner = Math.abs(edges[0]![0]) < Math.abs(edges[1]![0]) ? edges[0]! : edges[1]!;
  const incoming = normalize(sub(inner, eye));
  const ray = add(incoming, normal, -2 * dot(incoming, normal));
  return Math.atan2(side * ray[0], ray[2]);
}

function sideMirrorSpec(
  eye: Vec3Data, center: Vec3Data, side: number, view: MirrorGlassView, innerInwardRad: number,
): MirrorSpec {
  // The inner edge turns outward monotonically with the aim, so bisect on the centre aim.
  let low = -10 * DEG;
  let high = 40 * DEG;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (innerEdgeOutwardRad(eye, center, side, view, mid) < -innerInwardRad) low = mid;
    else high = mid;
  }
  const outward = (low + high) / 2;
  return {
    positionM: center,
    rotation: defaultGlassRotation(eye, center, rearRay(side, outward, view.pitchDownRad)),
    halfSizeM: view.halfSizeM,
    convexity: view.convexity,
  };
}

/** Mirror mount (door base) boxes: they anchor the side glass and bound the mount itself. */
function mirrorMountBoxes(profile: VehicleProfile) {
  const width = profile.bodySizeM[0];
  const x = (profile.mirrorWidthM + width) / 4;
  const y = profile.mirrorHeightM - profile.centerOfMassHeightM;
  const z = -(1 - profile.frontWeightFraction) * profile.wheelbaseM + 0.35 +
    vehicleViews[profile.id].sideMirrorZOffsetM;
  const box = (side: number) => ({
    centerLocalM: [side * x, y, z] as Vec3Data,
    halfExtentsM: [(profile.mirrorWidthM - width) / 4, 0.05, 0.1] as Vec3Data,
  });
  return [box(-1), box(1)] as const;
}

/**
 * Housing dimensions shared by the GLB generator and the collider, so the physics box
 * always covers what the driver sees. The shell sits behind the glass, framed by `rimM`.
 */
export const MIRROR_HOUSING = Object.freeze({
  rimM: 0.0125,
  gapM: 0.008,
  sideShellDepthM: 0.05,
  rearShellDepthM: 0.035,
  doorInsetM: 0.02,
  arm: Object.freeze({ heightM: 0.035, depthM: 0.05, dropM: 0.08 }),
  foot: Object.freeze({ sizeM: [0.05, 0.05, 0.07] as const, dropM: 0.105 }),
});

function rotateByQuaternion(q: QuatData, v: readonly number[]): V3 {
  const [x, y, z, w] = q;
  const t = cross([x, y, z], v).map((c) => 2 * c);
  const u = cross([x, y, z], t);
  return [v[0]! + w * t[0]! + u[0]!, v[1]! + w * t[1]! + u[1]!, v[2]! + w * t[2]! + u[2]!];
}

/**
 * Side-mirror colliders: the mount box grown to cover the housing shell (oriented with
 * the default glass), its arm and its foot, as authored in tools/asset-designs/vehicles.mjs.
 */
type MirrorBoxes = readonly [
  { readonly centerLocalM: Vec3Data; readonly halfExtentsM: Vec3Data },
  { readonly centerLocalM: Vec3Data; readonly halfExtentsM: Vec3Data },
];
// deriveGeometry runs every physics step (lesson curb checks); the aim solve behind the
// boxes should not, so they are computed once per (frozen) profile.
const mirrorBoxCache = new WeakMap<VehicleProfile, MirrorBoxes>();

export function mirrorBoxes(profile: VehicleProfile): MirrorBoxes {
  const cached = mirrorBoxCache.get(profile);
  if (cached) return cached;
  const boxes = computeMirrorBoxes(profile);
  mirrorBoxCache.set(profile, boxes);
  return boxes;
}

function computeMirrorBoxes(profile: VehicleProfile): MirrorBoxes {
  const contract = deriveVehicleAssetContract(profile);
  const mounts = mirrorMountBoxes(profile);
  const doorX = profile.bodySizeM[0] / 2 - MIRROR_HOUSING.doorInsetM;
  const box = (index: 0 | 1, spec: MirrorSpec) => {
    const mount = mounts[index];
    const min = sub(mount.centerLocalM, mount.halfExtentsM);
    const max = add(mount.centerLocalM, mount.halfExtentsM);
    const include = (point: readonly number[]) => {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis]!, point[axis]!);
        max[axis] = Math.max(max[axis]!, point[axis]!);
      }
    };
    const glass = spec.positionM;
    const depth = MIRROR_HOUSING.sideShellDepthM;
    const half = [spec.halfSizeM[0] + MIRROR_HOUSING.rimM, spec.halfSizeM[1] + MIRROR_HOUSING.rimM, depth / 2];
    const back = -(depth / 2 + MIRROR_HOUSING.gapM);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      include(add(glass, rotateByQuaternion(spec.rotation, [sx * half[0]!, sy * half[1]!, back + sz * half[2]!])));
    }
    const side = Math.sign(glass[0]);
    const { arm, foot } = MIRROR_HOUSING;
    for (const y of [-arm.dropM - arm.heightM / 2, -arm.dropM + arm.heightM / 2]) {
      for (const z of [-arm.depthM / 2, arm.depthM / 2]) {
        include([glass[0], glass[1] + y, glass[2] + z]);
        include([side * doorX, glass[1] + y, glass[2] + z]);
      }
    }
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) {
      include([side * doorX + dx * foot.sizeM[0] / 2, glass[1] - foot.dropM + dy * foot.sizeM[1] / 2,
        glass[2] + dz * foot.sizeM[2] / 2]);
    }
    return {
      centerLocalM: [(min[0]! + max[0]!) / 2, (min[1]! + max[1]!) / 2, (min[2]! + max[2]!) / 2] as Vec3Data,
      halfExtentsM: [(max[0]! - min[0]!) / 2, (max[1]! - min[1]!) / 2, (max[2]! - min[2]!) / 2] as Vec3Data,
    };
  };
  return [box(0, contract.mirrors.left), box(1, contract.mirrors.right)] as const;
}

export function deriveVehicleAssetContract(profile: VehicleProfile) {
  const positive = ['mirrorWidthM', 'mirrorHeightM', 'wheelbaseM', 'trackM',
    'frontOverhangM', 'rearOverhangM', 'groundClearanceM',
    'centerOfMassHeightM', 'tireRadiusM'] as const;
  for (const field of positive) {
    if (!Number.isFinite(profile[field]) || profile[field] <= 0) {
      throw new RangeError(`${profile.id}.${field} must be finite and positive`);
    }
  }
  if (!profile.bodySizeM.every((value) => Number.isFinite(value) && value > 0) ||
      !profile.driverEyeLocalM.every(Number.isFinite) ||
      !(profile.frontWeightFraction > 0 && profile.frontWeightFraction < 1) ||
      profile.mirrorWidthM <= profile.bodySizeM[0] ||
      profile.groundClearanceM >= profile.bodySizeM[1] ||
      Math.abs(profile.wheelbaseM + profile.frontOverhangM + profile.rearOverhangM -
        profile.bodySizeM[2]) > 0.02) {
    throw new RangeError(`${profile.id}: inconsistent dimensions, eye or axle/overhang contract`);
  }
  const view = vehicleViews[profile.id];
  const boxes = mirrorMountBoxes(profile);
  const eye = profile.driverEyeLocalM;
  const rear: Vec3Data = [
    eye[0] + view.rearCameraOffsetM[0],
    eye[1] + view.rearCameraOffsetM[1],
    eye[2] + view.rearCameraOffsetM[2],
  ];
  const { minM, maxM } = view.headClearanceM;
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(minM[axis]) || !Number.isFinite(maxM[axis]) || !(minM[axis]! < maxM[axis]!)) {
      throw new RangeError(`${profile.id}.headClearanceM: bounds must be finite with min < max`);
    }
  }
  const headClearance: HeadClearance = {
    minM: [eye[0] + minM[0], eye[1] + minM[1], eye[2] + minM[2]],
    maxM: [eye[0] + maxM[0], eye[1] + maxM[1], eye[2] + maxM[2]],
  };
  const mirrors: Readonly<Record<MirrorId, MirrorSpec>> = {
    rear: {
      positionM: rear,
      rotation: defaultGlassRotation(eye, rear, rearRay(0, 0, view.glass.rear.pitchDownRad)),
      halfSizeM: view.glass.rear.halfSizeM,
      convexity: view.glass.rear.convexity,
    },
    left: sideMirrorSpec(eye, add(boxes[0].centerLocalM, [0, view.sideGlassRiseM, 0]), -1,
      view.glass.left, view.sideInnerEdgeInwardRad),
    right: sideMirrorSpec(eye, add(boxes[1].centerLocalM, [0, view.sideGlassRiseM, 0]), 1,
      view.glass.right, view.sideInnerEdgeInwardRad),
  };
  for (const [id, spec] of Object.entries(mirrors)) {
    if (!spec.rotation.every(Number.isFinite) || !spec.positionM.every(Number.isFinite)) {
      throw new RangeError(`${profile.id}.mirror.${id}: non-finite pose`);
    }
  }
  return {
    driverEyeLocalM: profile.driverEyeLocalM,
    mirrors,
    seatRangeM: view.seatRangeM,
    headClearance,
    rearDisplayM: rear,
    bodyVisualZ: [-profile.bodySizeM[2] / 2, profile.bodySizeM[2] / 2] as const,
    bodyPhysicalZ: [
      -(1 - profile.frontWeightFraction) * profile.wheelbaseM - profile.frontOverhangM,
      profile.frontWeightFraction * profile.wheelbaseM + profile.rearOverhangM,
    ] as const,
  };
}
