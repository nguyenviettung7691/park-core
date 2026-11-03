import type { ControllerCalibration, PedalBinding } from '../contracts';

const STEERING_DEAD_ZONE = 0.02;
const MIN_PEDAL_SPAN = 0.1;
const MAX_INDEX = 63;

function checkSample(raw: number): void {
  if (!Number.isFinite(raw) || Math.abs(raw) > 1) {
    throw new RangeError(`Input sample out of range: ${raw}`);
  }
}

export function normalizePedal(raw: number, binding: PedalBinding): number {
  checkSample(raw);
  const span = binding.pressed - binding.released;
  if (!Number.isFinite(span) || span === 0) throw new RangeError('Pedal endpoints are not distinct');
  return Math.min(1, Math.max(0, (raw - binding.released) / span));
}

export function normalizeSteering(raw: number, calibration: ControllerCalibration): number {
  checkSample(raw);
  const { steeringCenter: centre, steeringLeft: left, steeringRight: right } = calibration;
  const offset = raw - centre;
  const leftSpan = left - centre;
  const rightSpan = right - centre;
  if (!(leftSpan * rightSpan < 0)) throw new RangeError('Steering endpoints must straddle the centre');
  const signed = offset * leftSpan > 0 ? offset / leftSpan : -offset / rightSpan;
  const clamped = Math.min(1, Math.max(-1, signed));
  const magnitude = Math.abs(clamped);
  if (magnitude <= STEERING_DEAD_ZONE) return 0;
  return Math.sign(clamped) * (magnitude - STEERING_DEAD_ZONE) / (1 - STEERING_DEAD_ZONE);
}

function isIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_INDEX;
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}

function validatePedal(value: unknown): PedalBinding | null {
  if (typeof value !== 'object' || value === null) return null;
  const { kind, index, released, pressed } = value as Record<string, unknown>;
  if ((kind !== 'axis' && kind !== 'button') || !isIndex(index)) return null;
  if (!isUnit(released) || !isUnit(pressed)) return null;
  if (kind === 'button' && (released < 0 || pressed < 0)) return null;
  if (Math.abs(pressed - released) < MIN_PEDAL_SPAN) return null;
  return { kind, index, released, pressed };
}

export function validateCalibration(value: unknown): ControllerCalibration | null {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    if (v.version !== 1 || typeof v.deviceId !== 'string' || v.deviceId === '') return null;
    const { steeringAxis, steeringLeft, steeringCenter, steeringRight,
      reverseButton, driveButton } = v;
    if (!isIndex(steeringAxis) || !isIndex(reverseButton) || !isIndex(driveButton)) return null;
    if (reverseButton === driveButton) return null;
    if (!isUnit(steeringLeft) || !isUnit(steeringCenter) || !isUnit(steeringRight)) return null;
    const between = (steeringLeft < steeringCenter && steeringCenter < steeringRight)
      || (steeringRight < steeringCenter && steeringCenter < steeringLeft);
    if (!between) return null;
    const throttle = validatePedal(v.throttle);
    const brake = validatePedal(v.brake);
    if (!throttle || !brake) return null;
    return { version: 1, deviceId: v.deviceId, steeringAxis, steeringLeft, steeringCenter,
      steeringRight, throttle, brake, reverseButton, driveButton };
  } catch {
    return null;
  }
}
