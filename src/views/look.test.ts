import { describe, expect, it } from 'vitest';
import { createLookController, type Glance, type LookStepInput } from './look';

const DT = 1 / 120;
const DEG = Math.PI / 180;
const idle: LookStepInput = { mouseDx: 0, mouseDy: 0, stickX: 0, stickY: 0, glance: null, recenter: false };

function run(c: ReturnType<typeof createLookController>, input: Partial<LookStepInput>, steps: number): void {
  for (let i = 0; i < steps; i++) c.step({ ...idle, ...input }, DT);
}

describe('look controller', () => {
  it('mouse applies directly', () => {
    const c = createLookController();
    c.step({ ...idle, mouseDx: 100, mouseDy: 50 }, DT);
    expect(c.pose().yawRad).toBeCloseTo(-0.2, 9);
    expect(c.pose().pitchRad).toBeCloseTo(-0.1, 9);
  });

  it('mouse clamps at yaw and pitch limits', () => {
    const c = createLookController();
    c.step({ ...idle, mouseDx: -1e6, mouseDy: -1e6 }, DT);
    expect(c.pose().yawRad).toBeCloseTo(110 * DEG, 9);
    expect(c.pose().pitchRad).toBeCloseTo(35 * DEG, 9);
    c.step({ ...idle, mouseDx: 1e6, mouseDy: 1e6 }, DT);
    expect(c.pose().yawRad).toBeCloseTo(-160 * DEG, 9);
    expect(c.pose().pitchRad).toBeCloseTo(-45 * DEG, 9);
  });

  it('stick deadzone and rate', () => {
    const c = createLookController();
    run(c, { stickX: 0.1, stickY: -0.14 }, 10);
    expect(c.pose()).toEqual({ yawRad: 0, pitchRad: 0 });
    run(c, { stickX: 1 }, 120);
    expect(c.pose().yawRad).toBeCloseTo(-160 * DEG, 9);
    const p = createLookController();
    run(p, { stickY: 1 }, 60);
    expect(p.pose().pitchRad).toBeCloseTo(-45 * DEG, 9); // 60 deg wanted, clamped
    const q = createLookController();
    run(q, { stickY: -1 }, 60);
    expect(q.pose().pitchRad).toBeCloseTo(35 * DEG, 9);
    const r = createLookController();
    run(r, { stickX: -1 }, 30);
    expect(r.pose().yawRad).toBeCloseTo(45 * DEG, 9);
    const s = createLookController();
    run(s, { stickY: 0.575 }, 60); // (0.575-0.15)/0.85 = 0.5 -> 60 deg/s * 0.5 s
    expect(s.pose().pitchRad).toBeCloseTo(-30 * DEG, 9);
  });

  it.each<[Glance, number, number]>([
    ['left', 110, 0],
    ['right', -110, 0],
    ['back', -160, -5],
  ])('glance %s eases without snap', (glance, yawDeg, pitchDeg) => {
    const c = createLookController();
    let prev = c.pose();
    let maxStep = 0;
    let maxOver = 0;
    for (let i = 1; i <= 240; i++) {
      c.step({ ...idle, glance }, DT);
      const p = c.pose();
      maxStep = Math.max(maxStep, Math.abs(p.yawRad - prev.yawRad) / DEG, Math.abs(p.pitchRad - prev.pitchRad) / DEG);
      const over = Math.sign(yawDeg) * (p.yawRad / DEG - yawDeg);
      maxOver = Math.max(maxOver, over);
      prev = p;
      if (i === 60) {
        expect(Math.abs(p.yawRad / DEG - yawDeg)).toBeLessThan(1);
        expect(Math.abs(p.pitchRad / DEG - pitchDeg)).toBeLessThan(1);
      }
    }
    // Peak speed of a critically damped spring is omega*d/e; back (160 deg) peaks at ~8.06 deg/step.
    expect(maxStep).toBeLessThan(glance === 'back' ? 8.1 : 8);
    expect(maxOver).toBeLessThan(0.5);
  });

  it('release returns to pre-glance pose; mouse ignored during glance', () => {
    const c = createLookController();
    c.step({ ...idle, mouseDx: -(20 * DEG) / 0.002 }, DT);
    expect(c.pose().yawRad).toBeCloseTo(20 * DEG, 9);
    run(c, { glance: 'left', mouseDx: 500 }, 120);
    run(c, {}, 240);
    expect(c.pose().yawRad).toBeCloseTo(20 * DEG, 9);
    expect(c.pose().pitchRad).toBeCloseTo(0, 9);
  });

  it('recenter eases to 0/0 and mouse cancels the ease', () => {
    const c = createLookController();
    c.step({ ...idle, mouseDx: -400, mouseDy: -100 }, DT);
    c.step({ ...idle, recenter: true }, DT);
    expect(Math.abs(c.pose().yawRad)).toBeGreaterThan(0.1); // eased, not snapped
    run(c, {}, 240);
    expect(c.pose()).toEqual({ yawRad: 0, pitchRad: 0 });

    const d = createLookController();
    d.step({ ...idle, mouseDx: -400 }, DT);
    d.step({ ...idle, recenter: true }, DT);
    run(d, {}, 10);
    const mid = d.pose().yawRad;
    d.step({ ...idle, mouseDx: 10 }, DT);
    run(d, {}, 240);
    expect(d.pose().yawRad).toBeCloseTo(mid - 0.02, 6);
  });

  it('reset zeroes pose and velocity instantly', () => {
    const c = createLookController();
    run(c, { glance: 'back' }, 20);
    c.reset();
    expect(c.pose()).toEqual({ yawRad: 0, pitchRad: 0 });
    run(c, {}, 5);
    expect(c.pose()).toEqual({ yawRad: 0, pitchRad: 0 });
  });

  it('rejects non-finite inputs and non-positive dt', () => {
    const c = createLookController();
    expect(() => c.step({ ...idle, mouseDx: NaN }, DT)).toThrow(RangeError);
    expect(() => c.step({ ...idle, stickY: Infinity }, DT)).toThrow(RangeError);
    expect(() => c.step(idle, 0)).toThrow(RangeError);
    expect(() => c.step(idle, -DT)).toThrow(RangeError);
    expect(() => c.step(idle, NaN)).toThrow(RangeError);
  });
});
