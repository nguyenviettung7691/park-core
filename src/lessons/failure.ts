import type {
  FailureReason,
  ScenarioDefinition,
  VehicleProfile,
  VehicleTelemetry,
} from '../contracts';
import type { ColliderBox, WheelEdgeContact } from '../runtime-types';
import { SimulationStateError } from '../vehicle/rig';
import { rotate, vehicleFootprint } from '../vehicle/geometry';

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

function firstFailure(
  scenario: ScenarioDefinition,
  profile: VehicleProfile,
  telemetry: VehicleTelemetry,
  colliders: readonly ColliderBox[],
  contactId: string | null,
  wheelEdges: readonly WheelEdgeContact[],
  speedEnvelopeDwellS: number,
): FailureEvent | null {
  if (contactId !== null) {
    const collider = colliders.find(({ id }) => id === contactId);
    return {
      reason: collider?.kind === 'curb' ? 'curb-contact' : 'collision',
      obstacleId: contactId,
    };
  }

  const climbedCurb = wheelEdges.find(
    (wheel) => wheel.kind === 'curb' && (wheel.state === 'climbing' || wheel.state === 'over'),
  );
  if (climbedCurb) return { reason: 'curb-contact', obstacleId: climbedCurb.colliderId };
  const mountedStop = wheelEdges.find(
    (wheel) => wheel.kind === 'wheel-stop' && wheel.state === 'over',
  );
  if (mountedStop) return { reason: 'wheel-stop-mounted', obstacleId: mountedStop.colliderId };
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
  wheelEdges: readonly WheelEdgeContact[],
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
      wheelEdges,
      speedEnvelopeDwellS,
    ),
    speedEnvelopeDwellS,
  };
}
