import { describe, expect, it } from 'vitest';
import type {
  BodyPose,
  ParkingTarget,
  VehicleTelemetry,
} from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { profiles } from '../vehicle/profiles';
import { vehicleFootprint } from '../vehicle/geometry';
import { updateParking } from './parking';

const profile = profiles.sedan;
const insetM = 0.05;
const target = (overrides: Partial<ParkingTarget> = {}): ParkingTarget => ({
  region: {
    centerM: [0, 0, 0],
    halfWidthM: 1.25,
    halfLengthM: 3.25,
    headingRad: 0,
  },
  insetM,
  headingToleranceRad: 5 * Math.PI / 180,
  stationaryDwellS: 2,
  curbId: null,
  curbGapRangeM: null,
  ...overrides,
});
const rightCurb: ColliderBox = {
  id: 'roadside-curb-right',
  kind: 'curb',
  centerM: [4.2, 0.12, 0],
  halfExtentsM: [0.15, 0.12, 16],
  yawRad: 0,
};

function poseAt(x: number, z: number, headingRad: number): BodyPose {
  return {
    positionM: [x, profile.centerOfMassHeightM, z],
    rotation: [
      0,
      Math.sin(headingRad / 2),
      0,
      Math.cos(headingRad / 2),
    ],
  };
}

function telemetry(overrides: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    simulationTimeS: 1,
    vehicleId: profile.id,
    pose: poseAt(0, 0, 0),
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
  parkingTarget: ParkingTarget = target(),
  car: VehicleTelemetry = telemetry(),
  curb: ColliderBox | null = null,
  previousDwellS = 0,
  deltaS = 0.1,
) {
  return updateParking(car, profile, parkingTarget, curb, previousDwellS, deltaS);
}

function worldOffset(
  localX: number,
  localZ: number,
  headingRad: number,
): readonly [number, number] {
  return [
    Math.cos(headingRad) * localX + Math.sin(headingRad) * localZ,
    -Math.sin(headingRad) * localX + Math.cos(headingRad) * localZ,
  ];
}

function toLocal(point: readonly number[], center: readonly number[], headingRad: number) {
  const dx = point[0] - center[0];
  const dz = point[2] - center[2];
  return [
    Math.cos(headingRad) * dx - Math.sin(headingRad) * dz,
    Math.sin(headingRad) * dx + Math.cos(headingRad) * dz,
  ];
}

describe('parking evaluation', () => {
  it('keeps every mirror-aware footprint corner inside the inset of a rotated target', () => {
    const targetHeading = Math.PI / 4;
    const parkingTarget = target({
      region: {
        centerM: [0, 0, 0],
        halfWidthM: 1.25,
        halfLengthM: 3.25,
        headingRad: targetHeading,
      },
    });
    const centeredPose = poseAt(0, 0, targetHeading);
    const corners = vehicleFootprint(centeredPose, profile);
    const halfWidth = parkingTarget.region.halfWidthM - parkingTarget.insetM;
    const halfLength = parkingTarget.region.halfLengthM - parkingTarget.insetM;

    for (const [index, corner] of corners.entries()) {
      const [localX, localZ] = toLocal(corner, parkingTarget.region.centerM, targetHeading);
      for (const axis of ['width', 'length'] as const) {
        const extent = axis === 'width' ? halfWidth : halfLength;
        const coordinate = axis === 'width' ? localX : localZ;
        const shift = Math.sign(coordinate) * (extent - Math.abs(coordinate) + 0.01);
        const [worldX, worldZ] = worldOffset(
          axis === 'width' ? shift : 0,
          axis === 'length' ? shift : 0,
          targetHeading,
        );
        const result = update(
          parkingTarget,
          telemetry({
            pose: poseAt(worldX, worldZ, targetHeading),
            headingRad: targetHeading,
          }),
        );
        expect(result.eligible, `corner ${index} outside ${axis} inset`).toBe(false);
      }
    }

    expect(update(
      parkingTarget,
      telemetry({
        pose: centeredPose,
        headingRad: targetHeading,
      }),
    ).eligible).toBe(true);
  });

  it('accepts wrapped heading error through the inclusive five-degree boundary', () => {
    const headingError = 5 * Math.PI / 180;
    const parkingTarget = target({
      region: {
        ...target().region,
        halfWidthM: 2,
        halfLengthM: 4,
        headingRad: -Math.PI + 0.01,
      },
    });
    const carHeading = -Math.PI + 0.01 + headingError;

    expect(update(
      parkingTarget,
      telemetry({
        pose: poseAt(0, 0, carHeading),
        headingRad: carHeading,
      }),
    ).eligible).toBe(true);
    expect(update(
      parkingTarget,
      telemetry({
        pose: poseAt(0, 0, carHeading + 0.001),
        headingRad: carHeading + 0.001,
      }),
    ).eligible).toBe(false);
  });

  it('requires low linear and angular speed, P, and the parking brake', () => {
    const invalidStates: readonly Partial<VehicleTelemetry>[] = [
      { totalSpeedMps: 0.1 },
      { angularSpeedRadps: 0.05 },
      { gear: 'D' },
      { parkingBrake: false },
    ];

    for (const state of invalidStates) {
      expect(update(target(), telemetry(state)).eligible).toBe(false);
    }
    expect(update(target(), telemetry({ totalSpeedMps: 0.099, angularSpeedRadps: 0.049 }))
      .eligible).toBe(true);
  });

  it('uses body-to-curb gap endpoints and ignores mirror overhang for that gap', () => {
    const roadsideTarget = (x: number) => target({
      region: {
        centerM: [x, 0, 0],
        halfWidthM: 1.25,
        halfLengthM: 3.5,
        headingRad: 0,
      },
      curbId: rightCurb.id,
      curbGapRangeM: [0.15, 0.3],
    });
    const evaluateAt = (x: number) => update(
      roadsideTarget(x),
      telemetry({ pose: poseAt(x, 0, 0) }),
      rightCurb,
    );

    expect(evaluateAt(3.0).eligible).toBe(true);
    expect(evaluateAt(2.85).eligible).toBe(true);
    expect(evaluateAt(2.84).eligible).toBe(false);
    expect(evaluateAt(3.01).eligible).toBe(false);
    expect(evaluateAt(2.9).eligible).toBe(true);
  });

  it('resets dwell as soon as any parking requirement becomes false', () => {
    const parkingTarget = target();
    const invalidStates: readonly Partial<VehicleTelemetry>[] = [
      { totalSpeedMps: 0.1 },
      { angularSpeedRadps: 0.05 },
      { gear: 'D' },
      { parkingBrake: false },
      { headingRad: 6 * Math.PI / 180, pose: poseAt(0, 0, 6 * Math.PI / 180) },
      { pose: poseAt(0.3, 0, 0) },
    ];

    for (const state of invalidStates) {
      expect(update(
        parkingTarget,
        telemetry(state),
        null,
        1.5,
      ).dwellS).toBe(0);
    }

    const roadsideTarget = target({
      region: {
        centerM: [3.01, 0, 0],
        halfWidthM: 1.25,
        halfLengthM: 3.5,
        headingRad: 0,
      },
      curbId: rightCurb.id,
      curbGapRangeM: [0.15, 0.3],
    });
    expect(update(
      roadsideTarget,
      telemetry({ pose: poseAt(3.01, 0, 0) }),
      rightCurb,
      1.5,
    ).dwellS).toBe(0);
  });

  it('completes only after two continuous eligible simulation seconds', () => {
    const before = update(target(), telemetry(), null, 1.89, 0.1);
    expect(before.eligible).toBe(true);
    expect(before.complete).toBe(false);

    const complete = update(target(), telemetry(), null, 1.9, 0.1);
    expect(complete.dwellS).toBe(2);
    expect(complete.complete).toBe(true);
  });

  it('rejects a missing or mismatched named roadside curb', () => {
    const roadsideTarget = target({
      curbId: rightCurb.id,
      curbGapRangeM: [0.15, 0.3],
    });
    expect(update(roadsideTarget).eligible).toBe(false);
    expect(update(roadsideTarget, telemetry(), {
      ...rightCurb,
      id: 'wrong-curb',
    }).eligible).toBe(false);
  });
});
