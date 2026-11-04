import { describe, expect, it } from 'vitest';
import type { BodyPose, VehicleTelemetry } from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { deriveGeometry } from '../vehicle/geometry';
import { profiles } from '../vehicle/profiles';
import { SimulationStateError } from '../vehicle/rig';
import { collidersForScenario } from '../world/colliders';
import { scenarios } from './scenarios';
import { updateFailure } from './failure';

const profile = profiles.sedan;

function poseAt(x: number, z: number, rollRad = 0): BodyPose {
  return {
    positionM: [x, profile.centerOfMassHeightM, z],
    rotation: [
      Math.sin(rollRad / 2),
      0,
      0,
      Math.cos(rollRad / 2),
    ],
  };
}

function telemetry(overrides: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    simulationTimeS: 1,
    vehicleId: profile.id,
    pose: poseAt(0, 0),
    headingRad: 0,
    signedSpeedMps: 0,
    totalSpeedMps: 0,
    angularSpeedRadps: 0,
    steeringWheelRad: 0,
    frontWheelAnglesRad: [0, 0],
    gear: 'P',
    parkingBrake: true,
    indicator: 'off',
    brake: 1,
    ...overrides,
  };
}

function update(
  scenario = scenarios[1],
  car = telemetry(),
  contactId: string | null = null,
  previousDwellS = 0,
  deltaS = 1 / 120,
  colliders: readonly ColliderBox[] = collidersForScenario(scenario),
) {
  return updateFailure(
    scenario,
    profile,
    car,
    colliders,
    contactId,
    previousDwellS,
    deltaS,
  );
}

describe('lesson failure evaluation', () => {
  it('maps static collider contacts to the first typed collision event', () => {
    const roadside = scenarios[3];

    expect(update(roadside, telemetry(), 'stage3-parked-front').event).toEqual({
      reason: 'collision',
      obstacleId: 'stage3-parked-front',
    });
    expect(update(roadside, telemetry(), 'roadside-curb-right').event).toEqual({
      reason: 'curb-contact',
      obstacleId: 'roadside-curb-right',
    });
    expect(update(roadside, telemetry(), 'roadside-ground').event).toEqual({
      reason: 'collision',
      obstacleId: 'roadside-ground',
    });
  });

  it('does not treat ordinary wheel-ground support as chassis contact', () => {
    const result = update(scenarios[1], telemetry(), null);

    expect(result.event).toBeNull();
  });

  it('detects wheel-side overlap with a curb collider', () => {
    const geometry = deriveGeometry(profile);
    const frontRight = geometry.wheelMountsLocalM[1];
    const curb: ColliderBox = {
      id: 'test-wheel-curb',
      kind: 'curb',
      centerM: [
        profile.trackM / 2 + 0.11,
        profile.tireRadiusM * 0.4,
        frontRight[2],
      ],
      halfExtentsM: [0.01, profile.tireRadiusM * 0.4, 0.02],
      yawRad: 0,
    };

    expect(update(scenarios[1], telemetry(), null, 0, 1 / 120, [curb]).event)
      .toEqual({ reason: 'curb-contact', obstacleId: curb.id });
  });

  it('keeps the approved 0.15 m body-to-curb parking gap free of wheel-curb failure', () => {
    const result = update(
      scenarios[3],
      telemetry({ pose: poseAt(3, 0) }),
    );

    expect(result.event).toBeNull();
  });

  it('fails when the full mirror-aware envelope leaves driving bounds', () => {
    const result = update(
      scenarios[3],
      telemetry({ pose: poseAt(3.1, 0) }),
    );

    expect(result.event).toEqual({ reason: 'out-of-bounds', obstacleId: null });
  });

  it('fails only after tipping beyond thirty degrees', () => {
    expect(update(scenarios[1], telemetry({ pose: poseAt(0, 0, Math.PI / 6) }))
      .event).toBeNull();
    expect(update(scenarios[1], telemetry({ pose: poseAt(0, 0, Math.PI / 6 + 0.01) }))
      .event).toEqual({ reason: 'tipped', obstacleId: null });
  });

  it('requires overspeed above 15 km/h to persist for one simulation second', () => {
    const overLimit = telemetry({ totalSpeedMps: 4.2 });
    const partial = update(scenarios[1], overLimit, null, 0, 0.5);
    expect(partial.event).toBeNull();
    expect(partial.speedEnvelopeDwellS).toBe(0.5);

    const sustained = update(scenarios[1], overLimit, null, partial.speedEnvelopeDwellS, 0.5);
    expect(sustained.event).toEqual({ reason: 'speed-envelope', obstacleId: null });
    expect(sustained.speedEnvelopeDwellS).toBe(1);

    const reset = update(
      scenarios[1],
      telemetry({ totalSpeedMps: 15 / 3.6 }),
      null,
      partial.speedEnvelopeDwellS,
      0.1,
    );
    expect(reset.event).toBeNull();
    expect(reset.speedEnvelopeDwellS).toBe(0);
  });

  it('surfaces non-finite physics telemetry as a simulation application error', () => {
    expect(() => update(
      scenarios[1],
      telemetry({ totalSpeedMps: Number.NaN }),
    )).toThrowError(SimulationStateError);
  });
});
