import type {
  BodyPose,
  ParkingTarget,
  VehicleProfile,
  VehicleTelemetry,
  Vec3Data,
} from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { rotate, vehicleFootprint } from '../vehicle/geometry';

const LINEAR_SPEED_LIMIT_MPS = 0.1;
const ANGULAR_SPEED_LIMIT_RADPS = 0.05;
const GEOMETRY_EPSILON = 1e-8;

export interface ParkingUpdate {
  readonly eligible: boolean;
  readonly dwellS: number;
  readonly complete: boolean;
}

function wrapAngle(angleRad: number): number {
  return Math.atan2(Math.sin(angleRad), Math.cos(angleRad));
}

function containedInTarget(
  pose: BodyPose,
  profile: VehicleProfile,
  target: ParkingTarget,
): boolean {
  const halfWidthM = target.region.halfWidthM - target.insetM;
  const halfLengthM = target.region.halfLengthM - target.insetM;
  if (halfWidthM < 0 || halfLengthM < 0) return false;
  const cos = Math.cos(target.region.headingRad);
  const sin = Math.sin(target.region.headingRad);
  return vehicleFootprint(pose, profile).every((corner) => {
    const dx = corner[0] - target.region.centerM[0];
    const dz = corner[2] - target.region.centerM[2];
    const localX = cos * dx - sin * dz;
    const localZ = sin * dx + cos * dz;
    return Math.abs(localX) <= halfWidthM + GEOMETRY_EPSILON
      && Math.abs(localZ) <= halfLengthM + GEOMETRY_EPSILON;
  });
}

function bodyFootprint(pose: BodyPose, profile: VehicleProfile): readonly Vec3Data[] {
  const frontZ = -((1 - profile.frontWeightFraction) * profile.wheelbaseM
    + profile.frontOverhangM);
  const rearZ = profile.frontWeightFraction * profile.wheelbaseM
    + profile.rearOverhangM;
  const halfWidthM = profile.bodySizeM[0] / 2;
  const localCorners: readonly Vec3Data[] = [
    [-halfWidthM, 0, frontZ],
    [halfWidthM, 0, frontZ],
    [halfWidthM, 0, rearZ],
    [-halfWidthM, 0, rearZ],
  ];
  return localCorners.map((corner) => {
    const rotated = rotate(pose.rotation, corner);
    return [
      pose.positionM[0] + rotated[0],
      pose.positionM[1] + rotated[1],
      pose.positionM[2] + rotated[2],
    ];
  });
}

function bodyCurbGapM(
  pose: BodyPose,
  profile: VehicleProfile,
  target: ParkingTarget,
  curb: ColliderBox,
): number | null {
  if (curb.kind !== 'curb') return null;
  const cos = Math.cos(curb.yawRad);
  const sin = Math.sin(curb.yawRad);
  const normal: readonly [number, number] = [cos, -sin];
  const tangent: readonly [number, number] = [sin, cos];
  const project = (point: Vec3Data, axis: readonly [number, number]) =>
    point[0] * axis[0] + point[2] * axis[1];
  const targetSide = project(
    [
      target.region.centerM[0] - curb.centerM[0],
      0,
      target.region.centerM[2] - curb.centerM[2],
    ],
    normal,
  );
  if (Math.abs(targetSide) <= curb.halfExtentsM[0]) return null;
  const side = Math.sign(targetSide);
  const curbCenterNormal = project(curb.centerM, normal);
  const innerEdge = curbCenterNormal + side * curb.halfExtentsM[0];
  const bodyCorners = bodyFootprint(pose, profile);
  const normalProjections = bodyCorners.map((corner) => project(corner, normal));
  const bodyEdge = side > 0
    ? Math.min(...normalProjections)
    : Math.max(...normalProjections);
  const bodyTangentProjections = bodyCorners.map((corner) => project(corner, tangent));
  const curbCenterTangent = project(curb.centerM, tangent);
  const curbMinTangent = curbCenterTangent - curb.halfExtentsM[2];
  const curbMaxTangent = curbCenterTangent + curb.halfExtentsM[2];
  if (Math.max(...bodyTangentProjections) < curbMinTangent
    || Math.min(...bodyTangentProjections) > curbMaxTangent) {
    return null;
  }
  return side > 0 ? bodyEdge - innerEdge : innerEdge - bodyEdge;
}

export function updateParking(
  telemetry: VehicleTelemetry,
  profile: VehicleProfile,
  target: ParkingTarget,
  curb: ColliderBox | null,
  previousDwellS: number,
  deltaS: number,
): ParkingUpdate {
  const headingError = Math.abs(wrapAngle(
    telemetry.headingRad - target.region.headingRad,
  ));
  let curbGapEligible = true;
  if (target.curbId !== null || target.curbGapRangeM !== null) {
    curbGapEligible = target.curbId !== null
      && target.curbGapRangeM !== null
      && curb !== null
      && curb.id === target.curbId;
    if (curbGapEligible && curb && target.curbGapRangeM) {
      const gapM = bodyCurbGapM(telemetry.pose, profile, target, curb);
      curbGapEligible = gapM !== null
        && gapM >= target.curbGapRangeM[0] - GEOMETRY_EPSILON
        && gapM <= target.curbGapRangeM[1] + GEOMETRY_EPSILON;
    }
  }
  const eligible = containedInTarget(telemetry.pose, profile, target)
    && headingError <= target.headingToleranceRad + GEOMETRY_EPSILON
    && telemetry.totalSpeedMps < LINEAR_SPEED_LIMIT_MPS
    && telemetry.angularSpeedRadps < ANGULAR_SPEED_LIMIT_RADPS
    && telemetry.gear === 'P'
    && telemetry.parkingBrake
    && curbGapEligible;
  const dwellS = eligible
    ? Math.min(previousDwellS + deltaS, target.stationaryDwellS)
    : 0;
  return {
    eligible,
    dwellS,
    complete: eligible
      && dwellS + GEOMETRY_EPSILON >= target.stationaryDwellS,
  };
}
