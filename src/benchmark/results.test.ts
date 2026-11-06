import { describe, expect, it } from 'vitest';
import type { MeasurementResult } from './metrics';
import {
  getGraphicsSuggestions,
  isReferenceComparable,
  type PerformanceResult,
  type ReferenceSetup,
} from './results';

const referenceSetup: ReferenceSetup = {
  drawingWidthPx: 2560,
  drawingHeightPx: 1440,
  refreshHz: 60,
  browserZoomPercent: 100,
  machineDetailsProvided: true,
};

function performanceResult(overrides: Partial<PerformanceResult> = {}): PerformanceResult {
  return {
    phase: 'complete',
    p95Ms: 16,
    meanFps: 60,
    catchUpLossS: 0,
    clampLossS: 0,
    ...overrides,
  };
}

describe('reference comparability', () => {
  it('accepts the exact reference setup', () => {
    expect(isReferenceComparable(referenceSetup)).toBe(true);
  });

  it.each([
    ['width', { drawingWidthPx: 1920 }],
    ['height', { drawingHeightPx: 1080 }],
    ['refresh rate', { refreshHz: 144 }],
    ['browser zoom', { browserZoomPercent: 90 }],
    ['machine details', { machineDetailsProvided: false }],
    ['missing drawing size', { drawingWidthPx: null }],
    ['unknown refresh rate', { refreshHz: null }],
    ['unconfirmed zoom', { browserZoomPercent: null }],
  ] as const)('rejects a setup with non-reference %s', (_name, update) => {
    expect(isReferenceComparable({ ...referenceSetup, ...update })).toBe(false);
  });
});

describe('graphics suggestions', () => {
  it('does not suggest changes when a completed result meets the target measurements', () => {
    expect(getGraphicsSuggestions(performanceResult())).toEqual([]);
  });

  it.each([
    ['high p95 frame time', { p95Ms: 18 }],
    ['low mean frame rate', { meanFps: 56 }],
  ] as const)('suggests lower render scale for %s', (_name, update) => {
    expect(getGraphicsSuggestions(performanceResult(update))).toEqual(['lower-render-scale']);
  });

  it('does not recommend lower render scale when a 30 FPS cap explains missed targets', () => {
    expect(getGraphicsSuggestions(performanceResult({
      p95Ms: 34,
      meanFps: 30,
    }), 30)).toEqual(['raise-frame-rate-cap']);
  });

  it.each([
    ['catch-up loss', { catchUpLossS: 0.01 }],
    ['clamp loss', { clampLossS: 0.01 }],
  ] as const)('suggests lower auxiliary quality for %s', (_name, update) => {
    expect(getGraphicsSuggestions(performanceResult(update))).toEqual([
      'lower-auxiliary-quality',
    ]);
  });

  it('suggests both manual changes when both measurements indicate a problem', () => {
    expect(getGraphicsSuggestions(performanceResult({
      p95Ms: 18,
      catchUpLossS: 0.01,
    }))).toEqual(['lower-render-scale', 'lower-auxiliary-quality']);
  });

  it.each(['warmup', 'measuring', 'invalid'] as MeasurementResult['phase'][] )(
    'does not suggest changes for the %s phase',
    (phase) => {
      expect(getGraphicsSuggestions(performanceResult({
        phase,
        p95Ms: 30,
        meanFps: 30,
        catchUpLossS: 1,
        clampLossS: 1,
      }))).toEqual([]);
    },
  );
});
