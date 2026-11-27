import type { SeatOffset } from './head-pose';
import { ZERO_SEAT } from './head-pose';

/** On-disk form: whole centimetres from the nominal eye point (+ fore/aft is rearward). */
export interface SavedSeatPosition {
  readonly foreAftCm: number;
  readonly heightCm: number;
}

export interface SeatRange {
  readonly foreAft: readonly [number, number];
  readonly height: readonly [number, number];
}

/** Global spec range in cm; each vehicle's own range is applied in seatFromSaved. */
const FORE_AFT_CM: readonly [number, number] = [-10, 10];
const HEIGHT_CM: readonly [number, number] = [-3, 5];

function clamp(value: number, [min, max]: readonly [number, number]): number {
  return Math.max(min, Math.min(max, value));
}

export function seatFromSaved(saved: SavedSeatPosition | undefined, range: SeatRange): SeatOffset {
  if (!saved) return ZERO_SEAT;
  return {
    foreAftM: clamp(saved.foreAftCm / 100, range.foreAft),
    heightM: clamp(saved.heightCm / 100, range.height),
  };
}

export function savedFromSeat(seat: SeatOffset): SavedSeatPosition {
  // + 0 normalises -0 so saves stay clean
  return { foreAftCm: Math.round(seat.foreAftM * 100) + 0, heightCm: Math.round(seat.heightM * 100) + 0 };
}

/**
 * Lenient parse of saved seat positions: unknown vehicles and non-object entries are dropped,
 * bad numbers become 0 and others are rounded and capped, so a damaged entry never rejects settings.
 */
export function parseSavedSeatPositions(
  value: unknown, vehicleIds: readonly string[],
): Readonly<Record<string, SavedSeatPosition>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const cm = (raw: unknown, range: readonly [number, number]) =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.round(clamp(raw, range)) + 0 : 0;
  const result: Record<string, SavedSeatPosition> = {};
  for (const vehicleId of vehicleIds) {
    const entry = record[vehicleId];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const seat = entry as Record<string, unknown>;
    result[vehicleId] = { foreAftCm: cm(seat.foreAftCm, FORE_AFT_CM), heightCm: cm(seat.heightCm, HEIGHT_CM) };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
