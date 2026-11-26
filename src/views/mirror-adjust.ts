import type { MirrorId } from '../vehicle/asset-contract';

export interface MirrorOffset {
  readonly yawRad: number;
  readonly pitchRad: number;
}

/** Driver adjustment of each mirror glass from its default aim. */
export type MirrorOffsets = Readonly<Record<MirrorId, MirrorOffset>>;

export const ZERO_MIRROR_OFFSETS: MirrorOffsets = Object.freeze({
  rear: Object.freeze({ yawRad: 0, pitchRad: 0 }),
  left: Object.freeze({ yawRad: 0, pitchRad: 0 }),
  right: Object.freeze({ yawRad: 0, pitchRad: 0 }),
});

/** Typical power-mirror travel each way from the default aim. */
export const MIRROR_LIMIT_RAD = 12 * Math.PI / 180;
export const MIRROR_RATE_RADPS = 8 * Math.PI / 180;

/** Held-arrow intent: which way the driver wants the reflected view to move. */
export interface MirrorIntent {
  /** -1 view left, +1 view right. */
  readonly yaw: -1 | 0 | 1;
  /** -1 view down, +1 view up. */
  readonly pitch: -1 | 0 | 1;
}

function clampAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MIRROR_LIMIT_RAD, Math.min(MIRROR_LIMIT_RAD, value));
}

export function clampMirrorOffsets(value: MirrorOffsets): MirrorOffsets {
  const clamp = (offset: MirrorOffset): MirrorOffset =>
    ({ yawRad: clampAngle(offset.yawRad), pitchRad: clampAngle(offset.pitchRad) });
  return { rear: clamp(value.rear), left: clamp(value.left), right: clamp(value.right) };
}

/**
 * Advances one mirror by the held intent. A positive glass yaw (about its up axis) turns
 * the rearward view right; a positive glass pitch (about its right axis) tilts it down.
 */
export function stepMirrorOffsets(
  offsets: MirrorOffsets, id: MirrorId, intent: MirrorIntent, dtS: number,
): MirrorOffsets {
  if (!Number.isFinite(dtS) || dtS <= 0 || (intent.yaw === 0 && intent.pitch === 0)) return offsets;
  const current = offsets[id];
  const step = MIRROR_RATE_RADPS * dtS;
  const next = {
    yawRad: clampAngle(current.yawRad + intent.yaw * step),
    pitchRad: clampAngle(current.pitchRad - intent.pitch * step),
  };
  if (next.yawRad === current.yawRad && next.pitchRad === current.pitchRad) return offsets;
  return { ...offsets, [id]: next };
}
