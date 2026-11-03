import { describe, expect, it } from 'vitest';
import type { VehicleTelemetry } from '../contracts';
import type { ColliderBox } from '../runtime-types';
import { rearAxleCenter } from '../vehicle/geometry';
import { profiles } from '../vehicle/profiles';
import { sampleTrajectory } from './trajectory';

const profile = profiles.sedan;

function makeTelemetry(overrides: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return {
    simulationTimeS: 0,
    vehicleId: 'sedan',
    pose: { positionM: [0, 0.52, 0], rotation: [0, 0, 0, 1] },
    headingRad: 0,
    signedSpeedMps: 0,
    totalSpeedMps: 0,
    angularSpeedRadps: 0,
    steeringWheelRad: 0,
    frontWheelAnglesRad: [0, 0],
    gear: 'D',
    parkingBrake: false,
    indicator: 'off',
    brake: 0,
    ...overrides,
  };
}

const ground: ColliderBox = {
  id: 'ground',
  kind: 'ground',
  centerM: [0, -0.5, 0],
  halfExtentsM: [20, 0.5, 20],
  yawRad: 0,
};

describe('sampleTrajectory', () => {
  it.each([
    { gear: 'D' as const, direction: -1 },
    { gear: 'R' as const, direction: 1 },
  ])('projects a straight path up to 3 m in gear $gear', ({ gear, direction }) => {
    const telemetry = makeTelemetry({ gear });
    const samples = sampleTrajectory(telemetry, profile, [ground]);
    const start = rearAxleCenter(telemetry.pose, profile);

    expect(samples).toHaveLength(31);
    expect(samples[0].rearAxleM).toEqual(start);
    expect(samples[samples.length - 1].rearAxleM[0]).toBeCloseTo(start[0], 6);
    expect(samples[samples.length - 1].rearAxleM[2]).toBeCloseTo(start[2] + direction * 3, 6);
  });

  it('does not predict movement while parked or in neutral', () => {
    for (const gear of ['P', 'N'] as const) {
      const telemetry = makeTelemetry({ gear });
      const samples = sampleTrajectory(telemetry, profile, []);
      expect(samples).toHaveLength(1);
      expect(samples[0].rearAxleM).toEqual(rearAxleCenter(telemetry.pose, profile));
    }
  });

  it('uses the steering input for forward and reverse bicycle paths', () => {
    const steeringWheelRad = profile.steeringWheelLockRad * 0.25;
    const forward = sampleTrajectory(makeTelemetry({ steeringWheelRad }), profile, []);
    const reverse = sampleTrajectory(makeTelemetry({ steeringWheelRad, gear: 'R' }), profile, []);

    expect(forward[forward.length - 1].rearAxleM[0]).toBeLessThan(forward[0].rearAxleM[0]);
    expect(reverse[reverse.length - 1].rearAxleM[0]).toBeLessThan(reverse[0].rearAxleM[0]);
  });

  it('includes the full front and rear overhang in the body envelope', () => {
    const [frontLeft, frontRight, rearRight, rearLeft] =
      sampleTrajectory(makeTelemetry(), profile, [])[0].envelope;

    expect(frontLeft[0]).toBeCloseTo(-1.02, 6);
    expect(frontRight[0]).toBeCloseTo(1.02, 6);
    expect(frontLeft[2]).toBeCloseTo(-2.115, 6);
    expect(frontRight[2]).toBeCloseTo(-2.115, 6);
    expect(rearRight[2]).toBeCloseTo(2.485, 6);
    expect(rearLeft[2]).toBeCloseTo(2.485, 6);
  });

  it('stops before the first overlap with an axis-aligned obstacle', () => {
    const obstacle: ColliderBox = {
      id: 'barrier',
      kind: 'obstacle',
      centerM: [0, 0, -4],
      halfExtentsM: [0.5, 1, 0.25],
      yawRad: 0,
    };
    const samples = sampleTrajectory(makeTelemetry(), profile, [ground, obstacle]);
    const travelledM = rearAxleCenter(makeTelemetry().pose, profile)[2]
      - samples[samples.length - 1].rearAxleM[2];

    expect(travelledM).toBeGreaterThan(1.5);
    expect(travelledM).toBeLessThan(1.7);
  });

  it('uses the rotated obstacle footprint when clipping the path', () => {
    const obstacle: ColliderBox = {
      id: 'rotated-barrier',
      kind: 'obstacle',
      centerM: [1.8, 0, -4.5],
      halfExtentsM: [0.2, 0.5, 1],
      yawRad: Math.PI / 4,
    };
    const samples = sampleTrajectory(makeTelemetry(), profile, [obstacle]);
    const travelledM = rearAxleCenter(makeTelemetry().pose, profile)[2]
      - samples[samples.length - 1].rearAxleM[2];

    expect(travelledM).toBeGreaterThan(2.5);
    expect(travelledM).toBeLessThan(3);
  });

  it('clips when the swept vehicle envelope overlaps an obstacle between samples', () => {
    const telemetry = makeTelemetry({
      pose: { positionM: [-4.935, 0.52, -7.773], rotation: [0, 0, 0, 1] },
      steeringWheelRad: profile.steeringWheelLockRad,
    });
    const barrier: ColliderBox = {
      id: 'barrier',
      kind: 'obstacle',
      centerM: [0, 0.5, -10],
      halfExtentsM: [4, 0.5, 0.05],
      yawRad: 0,
    };

    expect(sampleTrajectory(telemetry, profile, [barrier])).toHaveLength(1);
  });
});
