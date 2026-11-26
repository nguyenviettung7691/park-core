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
  /** Forward (-Z) shift of the side-mirror anchors and colliders from frontAxle + 0.35 m. */
  readonly sideMirrorZOffsetM: number;
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
  sideMirrorZOffsetM: -0.585,
};

export const vehicleViews: Readonly<Record<VehicleId, VehicleViewProfile>> = {
  sedan: cabinView,
  cuv: cabinView,
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

export function mirrorBoxes(profile: VehicleProfile) {
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
  const boxes = mirrorBoxes(profile);
  const eye = profile.driverEyeLocalM;
  const rear: Vec3Data = [
    eye[0] + view.rearCameraOffsetM[0],
    eye[1] + view.rearCameraOffsetM[1],
    eye[2] + view.rearCameraOffsetM[2],
  ];
  const mirrors: Readonly<Record<MirrorId, MirrorSpec>> = {
    rear: {
      positionM: rear,
      rotation: defaultGlassRotation(eye, rear, rearRay(0, 0, view.glass.rear.pitchDownRad)),
      halfSizeM: view.glass.rear.halfSizeM,
      convexity: view.glass.rear.convexity,
    },
    left: sideMirrorSpec(eye, boxes[0].centerLocalM, -1, view.glass.left, view.sideInnerEdgeInwardRad),
    right: sideMirrorSpec(eye, boxes[1].centerLocalM, 1, view.glass.right, view.sideInnerEdgeInwardRad),
  };
  for (const [id, spec] of Object.entries(mirrors)) {
    if (!spec.rotation.every(Number.isFinite) || !spec.positionM.every(Number.isFinite)) {
      throw new RangeError(`${profile.id}.mirror.${id}: non-finite pose`);
    }
  }
  return {
    driverEyeLocalM: profile.driverEyeLocalM,
    mirrors,
    rearDisplayM: rear,
    bodyVisualZ: [-profile.bodySizeM[2] / 2, profile.bodySizeM[2] / 2] as const,
    bodyPhysicalZ: [
      -(1 - profile.frontWeightFraction) * profile.wheelbaseM - profile.frontOverhangM,
      profile.frontWeightFraction * profile.wheelbaseM + profile.rearOverhangM,
    ] as const,
  };
}
