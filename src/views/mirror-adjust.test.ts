import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { deriveVehicleAssetContract } from '../vehicle/asset-contract';
import { profiles } from '../vehicle/profiles';
import {
  clampMirrorOffsets, MIRROR_LIMIT_RAD, MIRROR_RATE_RADPS, stepMirrorOffsets, ZERO_MIRROR_OFFSETS,
} from './mirror-adjust';

const DEG = Math.PI / 180;

describe('mirror adjustment', () => {
  it('steps at 8°/s', () => {
    expect(MIRROR_RATE_RADPS).toBeCloseTo(8 * DEG, 12);
    const next = stepMirrorOffsets(ZERO_MIRROR_OFFSETS, 'left', { yaw: 1, pitch: 0 }, 1);
    expect(Math.abs(next.left.yawRad)).toBeCloseTo(8 * DEG, 9);
    expect(next.left.pitchRad).toBe(0);
    expect(next.right).toEqual(ZERO_MIRROR_OFFSETS.right);
    expect(next.rear).toEqual(ZERO_MIRROR_OFFSETS.rear);
  });

  it('clamps at ±12°', () => {
    expect(MIRROR_LIMIT_RAD).toBeCloseTo(12 * DEG, 12);
    let offsets = ZERO_MIRROR_OFFSETS;
    for (let i = 0; i < 5; i++) offsets = stepMirrorOffsets(offsets, 'rear', { yaw: -1, pitch: 1 }, 1);
    expect(Math.abs(offsets.rear.yawRad)).toBeCloseTo(12 * DEG, 9);
    expect(Math.abs(offsets.rear.pitchRad)).toBeCloseTo(12 * DEG, 9);
    const held = stepMirrorOffsets(offsets, 'rear', { yaw: -1, pitch: 1 }, 1);
    expect(held.rear).toEqual(offsets.rear);
  });

  it('ignores non-finite or negative time steps', () => {
    for (const dt of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(stepMirrorOffsets(ZERO_MIRROR_OFFSETS, 'left', { yaw: 1, pitch: 1 }, dt))
        .toEqual(ZERO_MIRROR_OFFSETS);
    }
  });

  it('clampMirrorOffsets zeroes non-finite values and caps large ones', () => {
    const value = clampMirrorOffsets({
      rear: { yawRad: Number.NaN, pitchRad: 90 * DEG },
      left: { yawRad: -90 * DEG, pitchRad: Number.POSITIVE_INFINITY },
      right: { yawRad: 0.05, pitchRad: -0.05 },
    });
    expect(value.rear.yawRad).toBe(0);
    expect(value.rear.pitchRad).toBeCloseTo(12 * DEG, 12);
    expect(value.left.yawRad).toBeCloseTo(-12 * DEG, 12);
    expect(value.left.pitchRad).toBe(0);
    expect(value.right).toEqual({ yawRad: 0.05, pitchRad: -0.05 });
  });

  it('moves the reflected view the way the arrow points', () => {
    const contract = deriveVehicleAssetContract(profiles.sedan);
    const spec = contract.mirrors.left;
    const eye = new Vector3(...profiles.sedan.driverEyeLocalM);
    const centre = new Vector3(...spec.positionM);
    const view = (offsets: typeof ZERO_MIRROR_OFFSETS) => {
      const glass = new Quaternion(...spec.rotation)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), offsets.left.yawRad))
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), offsets.left.pitchRad));
      const normal = new Vector3(0, 0, 1).applyQuaternion(glass);
      const incoming = centre.clone().sub(eye).normalize();
      return incoming.addScaledVector(normal, -2 * incoming.dot(normal));
    };
    const base = view(ZERO_MIRROR_OFFSETS);
    const left = view(stepMirrorOffsets(ZERO_MIRROR_OFFSETS, 'left', { yaw: -1, pitch: 0 }, 0.5));
    const up = view(stepMirrorOffsets(ZERO_MIRROR_OFFSETS, 'left', { yaw: 0, pitch: 1 }, 0.5));
    // Vehicle left is -X and up is +Y.
    expect(left.x).toBeLessThan(base.x - 0.05);
    expect(up.y).toBeGreaterThan(base.y + 0.05);
  });
});
