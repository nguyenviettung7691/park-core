import type { VehicleProfile } from '../contracts';

const RAMP_PER_S = 1;
const RECENTER_PER_S = 1.5;

export function ackermann(s: number, profile: VehicleProfile): readonly [number, number] {
  const delta = s * profile.steeringWheelLockRad / profile.steeringRatio;
  if (Math.abs(delta) < 0.0001) return [0, 0];
  const L = profile.wheelbaseM, halfT = profile.trackM / 2;
  const R = L / Math.tan(Math.abs(delta));
  const inner = Math.atan(L / (R - halfT));
  const outer = Math.atan(L / (R + halfT));
  return delta > 0 ? [inner, outer] : [-outer, -inner];
}

export function stepKeyboardSteering(current: number, target: number, h: number): number {
  if (target === 0 || current * target < 0) {
    const step = RECENTER_PER_S * h;
    return Math.abs(current) <= step ? 0 : current - Math.sign(current) * step;
  }
  const step = RAMP_PER_S * h;
  const next = current + Math.sign(target - current) * step;
  return Math.abs(target - current) <= step ? target : next;
}
