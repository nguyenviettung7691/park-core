import type { SensorReading } from '../contracts';

const BAND_LEVEL = { clear: 0, green: 1, yellow: 2, red: 3, stop: 4 } as const;

export function selectMostSevereWarning(
  readings: readonly SensorReading[],
  signedSpeedMps = 0,
): SensorReading | null {
  let selected: SensorReading | null = null;
  for (const reading of readings) {
    if (reading.distanceM === null || reading.band === 'clear') continue;
    if (!selected || BAND_LEVEL[reading.band] > BAND_LEVEL[selected.band] ||
        (reading.band === selected.band && reading.distanceM < selected.distanceM!)) {
      selected = reading;
      continue;
    }
    if (reading.band !== selected.band || reading.distanceM !== selected.distanceM) continue;
    const prefersFront = signedSpeedMps > 0;
    const prefersRear = signedSpeedMps < 0;
    const readingPreferred = prefersFront
      ? reading.id.startsWith('front-')
      : prefersRear && reading.id.startsWith('rear-');
    const selectedPreferred = prefersFront
      ? selected.id.startsWith('front-')
      : prefersRear && selected.id.startsWith('rear-');
    if (readingPreferred && !selectedPreferred) selected = reading;
  }
  return selected;
}
