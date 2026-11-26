import type { BodyPose, Vec3Data, VehicleId, VehicleProfile } from '../contracts';

export type MirrorId = 'rear' | 'left' | 'right';

interface VehicleViewProfile {
  readonly rearCameraOffsetM: Vec3Data;
  readonly rearDisplayOffsetM: Vec3Data;
  readonly mirrorYawRad: Readonly<Record<MirrorId, number>>;
  /** Forward (-Z) shift of the side-mirror anchors and colliders from frontAxle + 0.35 m. */
  readonly sideMirrorZOffsetM: number;
}

// Sedan and CUV interior subtasks of issue #12: side mirrors sit at the A-pillar base
// ahead of the driver; the rearview camera and its display hang under the windshield header.
const cabinView: VehicleViewProfile = {
  rearCameraOffsetM: [0.36, 0.14, -0.56],
  rearDisplayOffsetM: [0, 0, 0],
  mirrorYawRad: { rear: Math.PI, left: 105 * Math.PI / 180, right: -105 * Math.PI / 180 },
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
  if (!view.rearDisplayOffsetM.every(Number.isFinite)) {
    throw new RangeError(`${profile.id}.rearDisplayOffsetM must be finite`);
  }
  const boxes = mirrorBoxes(profile);
  const mirror = (id: MirrorId, positionM: Vec3Data): BodyPose => {
    const yaw = view.mirrorYawRad[id];
    if (!Number.isFinite(yaw) || !positionM.every(Number.isFinite)) {
      throw new RangeError(`${profile.id}.mirror.${id}: non-finite pose`);
    }
    return { positionM, rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] };
  };
  const rear: Vec3Data = [
    profile.driverEyeLocalM[0] + view.rearCameraOffsetM[0],
    profile.driverEyeLocalM[1] + view.rearCameraOffsetM[1],
    profile.driverEyeLocalM[2] + view.rearCameraOffsetM[2],
  ];
  const rearDisplayM: Vec3Data = [
    rear[0] + view.rearDisplayOffsetM[0],
    rear[1] + view.rearDisplayOffsetM[1],
    rear[2] + view.rearDisplayOffsetM[2],
  ];
  return {
    driverEyeLocalM: profile.driverEyeLocalM,
    mirrors: {
      rear: mirror('rear', rear),
      left: mirror('left', boxes[0].centerLocalM),
      right: mirror('right', boxes[1].centerLocalM),
    },
    rearDisplayM,
    bodyVisualZ: [-profile.bodySizeM[2] / 2, profile.bodySizeM[2] / 2] as const,
    bodyPhysicalZ: [
      -(1 - profile.frontWeightFraction) * profile.wheelbaseM - profile.frontOverhangM,
      profile.frontWeightFraction * profile.wheelbaseM + profile.rearOverhangM,
    ] as const,
  };
}
