import { describe, expect, it } from 'vitest';
import type { Vec3Data } from '../contracts';
import {
  headEyeLocal, headOffsetLocal, LOOK_LEFT_LIMIT_RAD, LOOK_RIGHT_LIMIT_RAD,
  SHOULDER_ONSET_RAD, ZERO_SEAT, type HeadClearance,
} from './head-pose';

const deg = (d: number): number => d * Math.PI / 180;
const wideBox: HeadClearance = { minM: [-10, -10, -10], maxM: [10, 10, 10] };

function expectVec(actual: Vec3Data, expected: Vec3Data, digits = 9): void {
  for (let i = 0; i < 3; i += 1) expect(actual[i]).toBeCloseTo(expected[i]!, digits);
}

describe('head pose', () => {
  it('exports limits as positive magnitudes', () => {
    expect(LOOK_LEFT_LIMIT_RAD).toBeCloseTo(deg(110), 12);
    expect(LOOK_RIGHT_LIMIT_RAD).toBeCloseTo(deg(160), 12);
    expect(SHOULDER_ONSET_RAD).toBeCloseTo(deg(60), 12);
    expect(ZERO_SEAT).toEqual({ foreAftM: 0, heightM: 0 });
  });

  it('is zero below onset', () => {
    for (const y of [59.9, -59.9, 0]) expect([...headOffsetLocal(deg(y))]).toEqual([0, 0, 0]);
  });

  it('leans fully at left limit', () => {
    expectVec(headOffsetLocal(deg(110)), [-0.06, 0, -0.05]);
  });

  it('matches right at 110 and 160', () => {
    expectVec(headOffsetLocal(deg(-110)), [0.14, 0, -0.03]);
    expectVec(headOffsetLocal(deg(-160)), [0.19, 0.03, 0.02]);
  });

  it('clamps yaw beyond limits', () => {
    expectVec(headOffsetLocal(deg(170)), [-0.06, 0, -0.05]);
    expectVec(headOffsetLocal(deg(-179)), [0.19, 0.03, 0.02]);
  });

  it('is C1 at 110 right', () => {
    const h = 1e-4;
    const at = (y: number): Vec3Data => headOffsetLocal(y);
    const c = deg(-110);
    const lo = at(c - h), mid = at(c), hi = at(c + h);
    for (let i = 0; i < 3; i += 1) {
      const back = (mid[i]! - lo[i]!) / h;
      const fwd = (hi[i]! - mid[i]!) / h;
      expect(Math.abs(fwd - back)).toBeLessThan(1e-3);
    }
  });

  it('is monotonic in magnitude on both sides', () => {
    for (const sign of [1, -1]) {
      let prev = 0;
      for (let d = 0; d <= 180; d += 0.5) {
        const [x, y, z] = headOffsetLocal(deg(sign * d));
        const mag = Math.hypot(x, y, z);
        expect(mag).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = mag;
      }
    }
  });

  it('seat adds rigidly', () => {
    const eye: Vec3Data = [0.3, 1.2, -0.1];
    expectVec(headEyeLocal(eye, { foreAftM: 0.1, heightM: 0.05 }, 0, wideBox), [0.3, 1.25, 0]);
  });

  it('clamps into the box', () => {
    const box: HeadClearance = { minM: [-0.01, 1.19, -0.12], maxM: [0.02, 1.21, -0.08] };
    const p = headEyeLocal([0, 1.2, -0.1], ZERO_SEAT, deg(-160), box);
    for (let i = 0; i < 3; i += 1) {
      expect(p[i]!).toBeGreaterThanOrEqual(box.minM[i]!);
      expect(p[i]!).toBeLessThanOrEqual(box.maxM[i]!);
    }
  });

  it('throws on non-finite yaw', () => {
    expect(() => headOffsetLocal(Number.NaN)).toThrow(RangeError);
    expect(() => headEyeLocal([0, 0, 0], ZERO_SEAT, Infinity, wideBox)).toThrow(RangeError);
  });
});
