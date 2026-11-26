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
