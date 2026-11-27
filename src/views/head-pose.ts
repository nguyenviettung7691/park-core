import type { Vec3Data } from '../contracts';

/** Seat adjustment from the vehicle's nominal eye point. Seat +Z is rearward; height adds to Y. */
export interface SeatOffset {
  readonly foreAftM: number;
  readonly heightM: number;
}

export const ZERO_SEAT: SeatOffset = Object.freeze({ foreAftM: 0, heightM: 0 });

/** Box (vehicle-local) the driver's eye point must stay inside. */
export interface HeadClearance {
  readonly minM: Vec3Data;
  readonly maxM: Vec3Data;
}

const DEG = Math.PI / 180;

/** Yaw limits as positive magnitudes; positive yaw looks left (see cameras.ts). */
export const LOOK_LEFT_LIMIT_RAD = 110 * DEG;
export const LOOK_RIGHT_LIMIT_RAD = 160 * DEG;
/** |yaw| at which the shoulder-check lean begins. */
export const SHOULDER_ONSET_RAD = 60 * DEG;

const LEFT_FULL: Vec3Data = [-0.06, 0, -0.05];
const RIGHT_AT_110: Vec3Data = [0.14, 0, -0.03];
const RIGHT_AT_160: Vec3Data = [0.19, 0.03, 0.02];

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Head lean (vehicle-local metres) for a look yaw; zero below onset, C1 throughout. */
export function headOffsetLocal(yawRad: number): Vec3Data {
  if (!Number.isFinite(yawRad)) throw new RangeError('yawRad must be finite');
  if (yawRad > 0) {
    const w = smoothstep(SHOULDER_ONSET_RAD, LOOK_LEFT_LIMIT_RAD, Math.min(yawRad, LOOK_LEFT_LIMIT_RAD));
    return [LEFT_FULL[0] * w + 0, LEFT_FULL[1] * w + 0, LEFT_FULL[2] * w + 0]; // + 0 normalises -0
  }
  const a = Math.min(-yawRad, LOOK_RIGHT_LIMIT_RAD);
  const w1 = smoothstep(SHOULDER_ONSET_RAD, LOOK_LEFT_LIMIT_RAD, a);
  const w2 = smoothstep(LOOK_LEFT_LIMIT_RAD, LOOK_RIGHT_LIMIT_RAD, a);
  const at = (i: 0 | 1 | 2): number =>
    RIGHT_AT_110[i] * w1 + (RIGHT_AT_160[i] - RIGHT_AT_110[i]) * w2;
  return [at(0), at(1), at(2)];
}

/** Eye point = base eye + seat + yaw-coupled lean, clamped into the clearance box. */
export function headEyeLocal(
  baseEye: Vec3Data, seat: SeatOffset, yawRad: number, clearance: HeadClearance,
): Vec3Data {
  const o = headOffsetLocal(yawRad);
  const raw: Vec3Data = [baseEye[0] + o[0], baseEye[1] + seat.heightM + o[1], baseEye[2] + seat.foreAftM + o[2]];
  const c = (i: 0 | 1 | 2): number => Math.max(clearance.minM[i], Math.min(clearance.maxM[i], raw[i]));
  return [c(0), c(1), c(2)];
}
