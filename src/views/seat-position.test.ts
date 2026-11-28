import { describe, expect, it } from 'vitest';
import { deriveVehicleAssetContract } from '../vehicle/asset-contract';
import { profiles } from '../vehicle/profiles';
import { parseSavedSeatPositions, savedFromSeat, seatFromSaved } from './seat-position';
import { ZERO_SEAT } from './head-pose';

const RANGE = { foreAft: [-0.1, 0.1], height: [-0.03, 0.05] } as const;

describe('seat position persistence', () => {
  it('round-trips integer centimetres', () => {
    const saved = savedFromSeat({ foreAftM: 0.04, heightM: -0.02 });
    expect(saved).toEqual({ foreAftCm: 4, heightCm: -2 });
    const seat = seatFromSaved(saved, RANGE);
    expect(seat.foreAftM).toBeCloseTo(0.04, 9);
    expect(seat.heightM).toBeCloseTo(-0.02, 9);
  });

  it('rounds to whole centimetres', () => {
    expect(savedFromSeat({ foreAftM: 0.0449, heightM: 0.0151 })).toEqual({ foreAftCm: 4, heightCm: 2 });
  });

  it('defaults when nothing is saved', () => {
    expect(seatFromSaved(undefined, RANGE)).toEqual(ZERO_SEAT);
  });

  it('clamps to the vehicle range when converting', () => {
    const seat = seatFromSaved({ foreAftCm: 10, heightCm: 5 }, { foreAft: [-0.05, 0.06], height: [-0.02, 0.03] });
    expect(seat.foreAftM).toBeCloseTo(0.06, 9);
    expect(seat.heightM).toBeCloseTo(0.03, 9);
  });

  it('fits the real vehicle ranges', () => {
    for (const profile of Object.values(profiles)) {
      const { seatRangeM } = deriveVehicleAssetContract(profile);
      const seat = seatFromSaved({ foreAftCm: 10, heightCm: -3 }, seatRangeM);
      expect(seat.foreAftM).toBeLessThanOrEqual(seatRangeM.foreAft[1]);
      expect(seat.heightM).toBeGreaterThanOrEqual(seatRangeM.height[0]);
    }
  });
});

describe('parseSavedSeatPositions', () => {
  const ids = ['sedan', 'cuv'];
  it('zeroes bad numbers and missing fields', () => {
    expect(parseSavedSeatPositions({ sedan: { foreAftCm: 'x', heightCm: NaN } }, ids))
      .toEqual({ sedan: { foreAftCm: 0, heightCm: 0 } });
    expect(parseSavedSeatPositions({ sedan: { foreAftCm: 3 } }, ids))
      .toEqual({ sedan: { foreAftCm: 3, heightCm: 0 } });
  });
  it('clamps to the spec range and rounds', () => {
    expect(parseSavedSeatPositions({ sedan: { foreAftCm: 99, heightCm: -99 } }, ids))
      .toEqual({ sedan: { foreAftCm: 10, heightCm: -3 } });
    expect(parseSavedSeatPositions({ cuv: { foreAftCm: 2.6, heightCm: 4.4 } }, ids))
      .toEqual({ cuv: { foreAftCm: 3, heightCm: 4 } });
  });
  it('drops unknown vehicles and non-object entries', () => {
    expect(parseSavedSeatPositions({ truck: { foreAftCm: 1, heightCm: 1 }, sedan: 'x', cuv: [] }, ids))
      .toBeUndefined();
  });
  it('returns undefined for non-objects', () => {
    for (const bad of [null, undefined, 3, 'x', []]) expect(parseSavedSeatPositions(bad, ids)).toBeUndefined();
  });
});
