import {
  TARGET_MEAN_FPS,
  TARGET_P95_MS,
  type MeasurementPhase,
} from './metrics';

export interface ReferenceSetup {
  readonly drawingWidthPx: number | null;
  readonly drawingHeightPx: number | null;
  readonly refreshHz: number | null;
  readonly browserZoomPercent: number | null;
  readonly machineDetailsProvided: boolean;
}

export interface PerformanceResult {
  readonly phase: MeasurementPhase;
  readonly p95Ms: number | null;
  readonly meanFps: number | null;
  readonly catchUpLossS: number;
  readonly clampLossS: number;
}

export type GraphicsSuggestion = 'lower-render-scale' | 'lower-auxiliary-quality';

export function isReferenceComparable(setup: ReferenceSetup): boolean {
  return setup.drawingWidthPx === 2560 &&
    setup.drawingHeightPx === 1440 &&
    setup.refreshHz === 60 &&
    setup.browserZoomPercent === 100 &&
    setup.machineDetailsProvided;
}

export function getGraphicsSuggestions(
  result: PerformanceResult,
): readonly GraphicsSuggestion[] {
  if (result.phase !== 'complete') return [];
  const suggestions: GraphicsSuggestion[] = [];
  if ((result.p95Ms !== null && result.p95Ms > TARGET_P95_MS) ||
      (result.meanFps !== null && result.meanFps < TARGET_MEAN_FPS)) {
    suggestions.push('lower-render-scale');
  }
  if (result.catchUpLossS > 0 || result.clampLossS > 0) {
    suggestions.push('lower-auxiliary-quality');
  }
  return suggestions;
}
