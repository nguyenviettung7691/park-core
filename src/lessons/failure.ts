import type {
  FailureReason,
  ScenarioDefinition,
  Vec3Data,
  VehicleProfile,
  VehicleTelemetry,
} from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { SimulationStateError } from '../vehicle/rig';
import { deriveGeometry, rotate, vehicleFootprint } from '../vehicle/geometry';

const BOUNDS_EPSILON_M = 1e-8;
const TIP_LIMIT_RAD = 30 * Math.PI / 180;
const SPEED_ENVELOPE_LIMIT_MPS = 15 / 3.6;
const SPEED_ENVELOPE_DWELL_S = 1;

export interface FailureEvent {
  readonly reason: FailureReason;
  readonly obstacleId: string | null;
}

export interface FailureUpdate {
  readonly event: FailureEvent | null;
  readonly speedEnvelopeDwellS: number;
}

function assertFiniteTelemetry(telemetry: VehicleTelemetry): void {
  const values = [
    telemetry.simulationTimeS,
    ...telemetry.pose.positionM,
    ...telemetry.pose.rotation,
    telemetry.headingRad,
    telemetry.signedSpeedMps,
    telemetry.totalSpeedMps,
    telemetry.angularSpeedRadps,
    telemetry.steeringWheelRad,
    ...telemetry.frontWheelAnglesRad,
    telemetry.brake,
  ];
  if (!values.every(Number.isFinite)) {
    throw new SimulationStateError('non-finite');
  }
}

function insideBounds(
  scenario: ScenarioDefinition,
  telemetry: VehicleTelemetry,
  profile: VehicleProfile,
): boolean {
  const { centerM, halfWidthM, halfLengthM, headingRad } = scenario.drivingBounds;
  const cos = Math.cos(headingRad);
  const sin = Math.sin(headingRad);
  return vehicleFootprint(telemetry.pose, profile).every((corner) => {
    const dx = corner[0] - centerM[0];
    const dz = corner[2] - centerM[2];
    const localX = cos * dx - sin * dz;
    const localZ = sin * dx + cos * dz;
    return Math.abs(localX) <= halfWidthM + BOUNDS_EPSILON_M
      && Math.abs(localZ) <= halfLengthM + BOUNDS_EPSILON_M;
  });
}

function wheelTouchesCurb(
  telemetry: VehicleTelemetry,
  profile: VehicleProfile,
  curb: ColliderBox,
): boolean {
  const geometry = deriveGeometry(profile);
  const right = rotate(telemetry.pose.rotation, [1, 0, 0]);
  const forward = rotate(telemetry.pose.rotation, [0, 0, -1]);
  const cos = Math.cos(curb.yawRad);
  const sin = Math.sin(curb.yawRad);
  const normal: readonly [number, number] = [cos, -sin];
  const tangent: readonly [number, number] = [sin, cos];
  const dotXZ = (vector: Vec3Data, axis: readonly [number, number]) =>
    vector[0] * axis[0] + vector[2] * axis[1];
  const sideHalfWidthM = Math.max(0, (profile.bodySizeM[0] - profile.trackM) / 2);
  const halfNormalM = sideHalfWidthM * Math.abs(dotXZ(right, normal))
    + profile.tireRadiusM * Math.abs(dotXZ(forward, normal));
  const halfTangentM = sideHalfWidthM * Math.abs(dotXZ(right, tangent))
    + profile.tireRadiusM * Math.abs(dotXZ(forward, tangent));
  const curbMinY = curb.centerM[1] - curb.halfExtentsM[1];
  const curbMaxY = curb.centerM[1] + curb.halfExtentsM[1];

  return geometry.wheelMountsLocalM.some((mount) => {
    const rotated = rotate(telemetry.pose.rotation, mount);
    const wheelCenter: Vec3Data = [
      telemetry.pose.positionM[0] + rotated[0],
      telemetry.pose.positionM[1] + rotated[1],
      telemetry.pose.positionM[2] + rotated[2],
    ];
    const dx = wheelCenter[0] - curb.centerM[0];
    const dz = wheelCenter[2] - curb.centerM[2];
    const localNormal = cos * dx - sin * dz;
    const localTangent = sin * dx + cos * dz;
    const verticalOverlap = wheelCenter[1] + profile.tireRadiusM >= curbMinY
      && wheelCenter[1] - profile.tireRadiusM <= curbMaxY;
    return verticalOverlap
      && Math.abs(localNormal) <= curb.halfExtentsM[0] + halfNormalM
      && Math.abs(localTangent) <= curb.halfExtentsM[2] + halfTangentM;
  });
}

function firstFailure(
  scenario: ScenarioDefinition,
  profile: VehicleProfile,
  telemetry: VehicleTelemetry,
  colliders: readonly ColliderBox[],
  contactId: string | null,
  speedEnvelopeDwellS: number,
): FailureEvent | null {
  if (contactId !== null) {
    const collider = colliders.find(({ id }) => id === contactId);
    return {
      reason: collider?.kind === 'curb' ? 'curb-contact' : 'collision',
      obstacleId: contactId,
    };
  }

  const curb = colliders.find(
    (collider) => collider.kind === 'curb'
      && wheelTouchesCurb(telemetry, profile, collider),
  );
  if (curb) return { reason: 'curb-contact', obstacleId: curb.id };
  if (!insideBounds(scenario, telemetry, profile)) {
    return { reason: 'out-of-bounds', obstacleId: null };
  }

  const up = rotate(telemetry.pose.rotation, [0, 1, 0]);
  const tiltRad = Math.acos(Math.max(-1, Math.min(1, up[1])));
  if (tiltRad > TIP_LIMIT_RAD) return { reason: 'tipped', obstacleId: null };
  if (speedEnvelopeDwellS >= SPEED_ENVELOPE_DWELL_S) {
    return { reason: 'speed-envelope', obstacleId: null };
  }
  return null;
}

export function updateFailure(
  scenario: ScenarioDefinition,
  profile: VehicleProfile,
  telemetry: VehicleTelemetry,
  colliders: readonly ColliderBox[],
  contactId: string | null,
  previousSpeedEnvelopeDwellS: number,
  deltaS: number,
): FailureUpdate {
  assertFiniteTelemetry(telemetry);
  const speedEnvelopeDwellS = telemetry.totalSpeedMps > SPEED_ENVELOPE_LIMIT_MPS
    ? previousSpeedEnvelopeDwellS + deltaS
    : 0;
  return {
    event: firstFailure(
      scenario,
      profile,
      telemetry,
      colliders,
      contactId,
      speedEnvelopeDwellS,
    ),
    speedEnvelopeDwellS,
  };
}
