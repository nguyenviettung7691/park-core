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

/** On-disk form: degrees, keyed by mirror. */
export type SavedMirrorOffsets = Readonly<Record<MirrorId, { readonly yawDeg: number; readonly pitchDeg: number }>>;

const MIRROR_IDS: readonly MirrorId[] = ['rear', 'left', 'right'];
const DEG = Math.PI / 180;

export function offsetsFromSaved(saved: SavedMirrorOffsets | undefined): MirrorOffsets {
  if (!saved) return ZERO_MIRROR_OFFSETS;
  const convert = (id: MirrorId): MirrorOffset =>
    ({ yawRad: saved[id].yawDeg * DEG, pitchRad: saved[id].pitchDeg * DEG });
  return clampMirrorOffsets({ rear: convert('rear'), left: convert('left'), right: convert('right') });
}

export function savedFromOffsets(offsets: MirrorOffsets): SavedMirrorOffsets {
  const clamped = clampMirrorOffsets(offsets);
  const convert = (id: MirrorId) =>
    ({ yawDeg: clamped[id].yawRad / DEG, pitchDeg: clamped[id].pitchRad / DEG });
  return { rear: convert('rear'), left: convert('left'), right: convert('right') };
}

/**
 * Lenient parse of saved adjustments: unknown vehicles and non-object entries are dropped,
 * bad numbers become 0 and large ones are capped, so a damaged entry never rejects settings.
 */
export function parseSavedMirrorAdjustments(
  value: unknown, vehicleIds: readonly string[],
): Readonly<Record<string, SavedMirrorOffsets>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const limitDeg = MIRROR_LIMIT_RAD / DEG;
  const angle = (raw: unknown) => typeof raw === 'number' && Number.isFinite(raw)
    ? Math.max(-limitDeg, Math.min(limitDeg, raw)) : 0;
  const result: Record<string, SavedMirrorOffsets> = {};
  for (const vehicleId of vehicleIds) {
    const entry = record[vehicleId];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const mirrors = entry as Record<string, unknown>;
    const parsed = {} as Record<MirrorId, { yawDeg: number; pitchDeg: number }>;
    for (const id of MIRROR_IDS) {
      const raw = mirrors[id];
      const offset = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
      parsed[id] = { yawDeg: angle(offset.yawDeg), pitchDeg: angle(offset.pitchDeg) };
    }
    result[vehicleId] = parsed;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
