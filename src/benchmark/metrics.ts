import type { PreviewFrameSample } from '../render/preview';

export const MAX_MEASURED_SAMPLES = 100000;
export const TARGET_P95_MS = 17.5;
export const TARGET_MEAN_FPS = 57;

export interface MeasurementTiming {
  readonly warmupMs: number;
  readonly measurementMs: number;
  readonly testOnly: boolean;
}
export interface IntervalSummary {
  readonly count: number;
  readonly totalMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  readonly meanFps: number;
}
export interface MeasuredFrame extends PreviewFrameSample {
  readonly intervalMs: number;
}
export type MeasurementPhase = 'warmup' | 'measuring' | 'complete' | 'invalid';
export interface MeasurementResult {
  readonly phase: MeasurementPhase;
  readonly invalidReason: string | null;
  readonly timing: MeasurementTiming;
  readonly measuredStartMs: number | null;
  readonly measuredEndMs: number | null;
  readonly samples: readonly MeasuredFrame[];
  readonly intervalCount: number;
  readonly elapsedMs: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly maxMs: number | null;
  readonly meanFps: number | null;
  readonly catchUpLossS: number;
  readonly clampLossS: number;
  readonly totalLossS: number;
  readonly verdict: boolean | null;
}
export interface Measurement {
  observe(sample: PreviewFrameSample): void;
  invalidate(reason: string): void;
  snapshot(): MeasurementResult;
}

const DEFAULT_TIMING: MeasurementTiming = { warmupMs: 10000, measurementMs: 60000, testOnly: false };

function nearestRank(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

export function summarizeIntervals(intervalsMs: readonly number[]): IntervalSummary {
  if (intervalsMs.length === 0) throw new RangeError('At least one interval is required');
  let totalMs = 0;
  for (const interval of intervalsMs) {
    if (!Number.isFinite(interval) || interval <= 0) {
      throw new RangeError('Intervals must be finite and positive');
    }
    totalMs += interval;
  }
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  return {
    count: sorted.length,
    totalMs,
    p50Ms: nearestRank(sorted, 0.5),
    p95Ms: nearestRank(sorted, 0.95),
    p99Ms: nearestRank(sorted, 0.99),
    maxMs: sorted[sorted.length - 1]!,
    meanFps: sorted.length / totalMs * 1000,
  };
}

function sampleProblem(sample: PreviewFrameSample): string | null {
  const { completedAtMs, elapsedS, droppedTimeS, clampedTimeS, drawingWidthPx, drawingHeightPx } = sample;
  if (!Number.isFinite(completedAtMs)) return 'Frame timestamp is not finite';
  if (!Number.isFinite(elapsedS) || elapsedS < 0) return 'Frame elapsed time is invalid';
  if (!Number.isFinite(droppedTimeS) || droppedTimeS < 0) return 'Dropped time is invalid';
  if (!Number.isFinite(clampedTimeS) || clampedTimeS < 0) return 'Clamped time is invalid';
  if (!Number.isFinite(drawingWidthPx) || drawingWidthPx <= 0 ||
      !Number.isFinite(drawingHeightPx) || drawingHeightPx <= 0) {
    return 'Drawing size is invalid';
  }
  return null;
}

export function createMeasurement(
  startMs: number, timing: MeasurementTiming = DEFAULT_TIMING,
): Measurement {
  if (!Number.isFinite(startMs)) throw new RangeError('Start time must be finite');
  if (!Number.isFinite(timing.warmupMs) || timing.warmupMs < 0) {
    throw new RangeError('Warm-up must be finite and non-negative');
  }
  if (!Number.isFinite(timing.measurementMs) || timing.measurementMs <= 0) {
    throw new RangeError('Measurement duration must be finite and positive');
  }
  if (!timing.testOnly && (timing.warmupMs !== DEFAULT_TIMING.warmupMs ||
      timing.measurementMs !== DEFAULT_TIMING.measurementMs)) {
    throw new RangeError('Timing overrides require testOnly');
  }
  const config: MeasurementTiming = { ...timing };
  const warmupEndMs = startMs + timing.warmupMs;
  const samples: MeasuredFrame[] = [];
  let phase: MeasurementPhase = 'warmup';
  let invalidReason: string | null = null;
  let baselineMs: number | null = null;
  let lastMs: number | null = null;
  let catchUpLossS = 0;
  let clampLossS = 0;

  function invalidate(reason: string) {
    if (phase === 'invalid' || phase === 'complete') return;
    phase = 'invalid';
    invalidReason = reason;
  }

  return {
    observe(sample) {
      if (phase === 'invalid' || phase === 'complete') return;
      const problem = sampleProblem(sample);
      if (problem) { invalidate(problem); return; }
      if (lastMs !== null && sample.completedAtMs <= lastMs) {
        invalidate('Frame timestamps are not strictly increasing');
        return;
      }
      const previousMs = lastMs;
      lastMs = sample.completedAtMs;
      if (baselineMs === null) {
        if (sample.completedAtMs < warmupEndMs) return;
        baselineMs = sample.completedAtMs;
        phase = 'measuring';
        return;
      }
      if (samples.length >= MAX_MEASURED_SAMPLES) {
        invalidate('Measured sample limit exceeded');
        return;
      }
      samples.push({ ...sample, intervalMs: sample.completedAtMs - previousMs! });
      catchUpLossS += sample.droppedTimeS;
      clampLossS += sample.clampedTimeS;
      if (sample.completedAtMs - baselineMs >= timing.measurementMs) phase = 'complete';
    },
    invalidate,
    snapshot() {
      const frames = phase === 'invalid' || samples.length === 0 ? null : samples;
      const summary = frames ? summarizeIntervals(frames.map((s) => s.intervalMs)) : null;
      const totalLossS = catchUpLossS + clampLossS;
      return {
        phase,
        invalidReason,
        timing: config,
        measuredStartMs: baselineMs,
        measuredEndMs: phase === 'complete' ? lastMs : null,
        samples: [...samples],
        intervalCount: samples.length,
        elapsedMs: summary ? summary.totalMs : null,
        p50Ms: summary?.p50Ms ?? null,
        p95Ms: summary?.p95Ms ?? null,
        p99Ms: summary?.p99Ms ?? null,
        maxMs: summary?.maxMs ?? null,
        meanFps: summary?.meanFps ?? null,
        catchUpLossS,
        clampLossS,
        totalLossS,
        verdict: phase === 'complete' && summary
          ? summary.p95Ms <= TARGET_P95_MS && summary.meanFps >= TARGET_MEAN_FPS && totalLossS === 0
          : null,
      };
    },
  };
}
