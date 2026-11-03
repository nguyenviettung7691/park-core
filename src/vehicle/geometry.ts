import type { BodyPose, QuatData, Vec3Data, VehicleId, VehicleProfile } from '../contracts';

export const GRAVITY_MPS2 = 9.81;

export interface LocalBox { readonly centerLocalM: Vec3Data; readonly halfExtentsM: Vec3Data }
export interface VehicleGeometry {
  readonly frontAxleZ: number; readonly rearAxleZ: number;
  readonly wheelMountsLocalM: readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data];
  readonly chassis: LocalBox; readonly mirrors: readonly [LocalBox, LocalBox];
  readonly driverEyeLocalM: Vec3Data;
}

// Designer-selected conservative mirror mounting heights above ground.
const MIRROR_HEIGHT_M: Readonly<Record<VehicleId, number>> = { sedan: 0.95, cuv: 1.1 };

export function deriveGeometry(profile: VehicleProfile): VehicleGeometry {
  const f = profile.frontWeightFraction, L = profile.wheelbaseM;
  const [width, height, length] = profile.bodySizeM;
  const frontAxleZ = -(1 - f) * L;
  const rearAxleZ = f * L;
  const mountY = (axleFraction: number, stiffness: number) =>
    profile.tireRadiusM + profile.suspensionRestLengthM
    - (GRAVITY_MPS2 * axleFraction / 2) / stiffness - profile.centerOfMassHeightM;
  const k = profile.suspensionStiffness;
  const x = profile.trackM / 2;
  const frontY = mountY(f, k[0]), rearY = mountY(1 - f, k[2]);
  const frontExtent = -frontAxleZ + profile.frontOverhangM;
  const rearExtent = rearAxleZ + profile.rearOverhangM;
  const mirrorHalfX = (profile.mirrorWidthM - width) / 4;
  const mirrorX = (profile.mirrorWidthM + width) / 4;
  const mirrorY = MIRROR_HEIGHT_M[profile.id] - profile.centerOfMassHeightM;
  const mirrorZ = frontAxleZ + 0.35;
  const mirror = (sx: number): LocalBox => ({
    centerLocalM: [sx * mirrorX, mirrorY, mirrorZ], halfExtentsM: [mirrorHalfX, 0.05, 0.1],
  });
  return {
    frontAxleZ, rearAxleZ,
    wheelMountsLocalM: [[-x, frontY, frontAxleZ], [x, frontY, frontAxleZ],
      [-x, rearY, rearAxleZ], [x, rearY, rearAxleZ]],
    chassis: {
      centerLocalM: [0, (profile.groundClearanceM + height) / 2 - profile.centerOfMassHeightM,
        (rearExtent - frontExtent) / 2],
      halfExtentsM: [width / 2, (height - profile.groundClearanceM) / 2, length / 2],
    },
    mirrors: [mirror(-1), mirror(1)],
    driverEyeLocalM: profile.driverEyeLocalM,
  };
}

export function rotate(q: QuatData, v: Vec3Data): Vec3Data {
  const [qx, qy, qz, qw] = q, [x, y, z] = v;
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

const toWorld = (pose: BodyPose, local: Vec3Data): Vec3Data => {
  const r = rotate(pose.rotation, local);
  return [pose.positionM[0] + r[0], pose.positionM[1] + r[1], pose.positionM[2] + r[2]];
};

export function rearAxleCenter(pose: BodyPose, profile: VehicleProfile): Vec3Data {
  const fwd = rotate(pose.rotation, [0, 0, -1]);
  const d = profile.frontWeightFraction * profile.wheelbaseM;
  const p = pose.positionM;
  return [p[0] - fwd[0] * d, p[1] - fwd[1] * d, p[2] - fwd[2] * d];
}

// Corners at COM height, ordered FL, FR, RR, RL (a closed loop), mirror width included.
export function vehicleFootprint(pose: BodyPose, profile: VehicleProfile):
  readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data] {
  const f = profile.frontWeightFraction, L = profile.wheelbaseM;
  const front = -((1 - f) * L + profile.frontOverhangM);
  const rear = f * L + profile.rearOverhangM;
  const x = profile.mirrorWidthM / 2;
  return [toWorld(pose, [-x, 0, front]), toWorld(pose, [x, 0, front]),
    toWorld(pose, [x, 0, rear]), toWorld(pose, [-x, 0, rear])];
}
