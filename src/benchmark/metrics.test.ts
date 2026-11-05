import { describe, expect, it } from 'vitest';
import type { PreviewFrameSample } from '../render/preview';
import { createMeasurement, summarizeIntervals, type MeasurementTiming } from './metrics';

const timing: MeasurementTiming = { warmupMs: 500, measurementMs: 400, testOnly: true };

function sample(completedAtMs: number, extra: Partial<PreviewFrameSample> = {}): PreviewFrameSample {
  return {
    completedAtMs, elapsedS: 0.016, droppedTimeS: 0, clampedTimeS: 0,
    drawingWidthPx: 2560, drawingHeightPx: 1440, ...extra,
  };
}

function run(intervals: readonly number[], extra: (index: number) => Partial<PreviewFrameSample> = () => ({})) {
  const m = createMeasurement(1000, timing);
  m.observe(sample(1500));
  let t = 1500;
  intervals.forEach((interval, i) => { t += interval; m.observe(sample(t, extra(i))); });
  return m.snapshot();
}

describe('summarizeIntervals', () => {
  it('uses nearest-rank percentiles and interval-weighted FPS', () => {
    expect(summarizeIntervals([40, 10, 30, 20])).toEqual({
      count: 4, totalMs: 100, p50Ms: 20, p95Ms: 40, p99Ms: 40, maxMs: 40, meanFps: 40,
    });
  });

  it.each([[[]], [[10, 0]], [[-1]], [[NaN]], [[Infinity]]])('rejects %j', (values) => {
    expect(() => summarizeIntervals(values)).toThrow(RangeError);
  });
});

describe('measurement timing', () => {
  it('defaults to 10 s warm-up and 60 s measurement and requires testOnly overrides', () => {
    expect(createMeasurement(0).snapshot().timing)
      .toEqual({ warmupMs: 10000, measurementMs: 60000, testOnly: false });
    expect(() => createMeasurement(0, { warmupMs: 1, measurementMs: 2, testOnly: false })).toThrow(RangeError);
    expect(() => createMeasurement(0, { warmupMs: -1, measurementMs: 2, testOnly: true })).toThrow(RangeError);
    expect(() => createMeasurement(0, { warmupMs: 0, measurementMs: 0, testOnly: true })).toThrow(RangeError);
    expect(() => createMeasurement(0, { warmupMs: NaN, measurementMs: 1, testOnly: true })).toThrow(RangeError);
    expect(() => createMeasurement(NaN)).toThrow(RangeError);
  });
});

describe('measurement collection', () => {
  it('has no summaries or verdict without samples', () => {
    const m = createMeasurement(1000, timing);
    m.observe(sample(1200));
    expect(m.snapshot()).toMatchObject({
      phase: 'warmup', p95Ms: null, meanFps: null, verdict: null, measuredStartMs: null,
      intervalCount: 0, samples: [],
    });
  });

  it('excludes warm-up and uses the first post-warm-up frame as baseline without its loss', () => {
    const m = createMeasurement(1000, timing);
    m.observe(sample(1100, { droppedTimeS: 1 }));
    m.observe(sample(1500, { droppedTimeS: 0.5, clampedTimeS: 0.5 }));
    expect(m.snapshot()).toMatchObject({ phase: 'measuring', measuredStartMs: 1500, intervalCount: 0, verdict: null });
    m.observe(sample(1516, { droppedTimeS: 0.25, clampedTimeS: 0.125 }));
    const r = m.snapshot();
    expect(r.samples).toHaveLength(1);
    expect(r.samples[0]).toMatchObject({ completedAtMs: 1516, intervalMs: 16 });
    expect(r).toMatchObject({ intervalCount: 1, catchUpLossS: 0.25, clampLossS: 0.125, totalLossS: 0.375 });
  });

  it('includes the full terminal interval and reports actual duration', () => {
    expect(run([100, 100, 100, 250])).toMatchObject({
      phase: 'complete', intervalCount: 4, elapsedMs: 550, measuredStartMs: 1500, measuredEndMs: 2050,
      maxMs: 250, p50Ms: 100,
    });
  });

  it('freezes after completion and ignores later samples and invalidations', () => {
    const m = createMeasurement(0, { warmupMs: 0, measurementMs: 20, testOnly: true });
    m.observe(sample(0)); m.observe(sample(10)); m.observe(sample(20));
    const before = m.snapshot();
    m.observe(sample(30)); m.invalidate('late');
    expect(m.snapshot()).toEqual(before);
    expect(before.phase).toBe('complete');
  });

  it('makes invalidation sticky and withholds results', () => {
    const m = createMeasurement(0, { warmupMs: 0, measurementMs: 100, testOnly: true });
    m.observe(sample(0)); m.observe(sample(10));
    m.invalidate('input detected');
    m.invalidate('second');
    m.observe(sample(20));
    expect(m.snapshot()).toMatchObject({
      phase: 'invalid', invalidReason: 'input detected', verdict: null, p95Ms: null, meanFps: null,
    });
  });

  it.each([
    ['NaN timestamp', sample(NaN)],
    ['negative loss', sample(1600, { droppedTimeS: -1 })],
    ['zero drawing width', sample(1600, { drawingWidthPx: 0 })],
    ['non-monotonic timestamp', sample(1500)],
  ])('invalidates on %s rather than defaulting', (_name, bad) => {
    const m = createMeasurement(1000, timing);
    m.observe(sample(1500));
    m.observe(bad);
    expect(m.snapshot()).toMatchObject({ phase: 'invalid', verdict: null });
    expect(m.snapshot().invalidReason).toEqual(expect.any(String));
  });

  it('marks the case invalid when the 100000 sample bound is exhausted', () => {
    const m = createMeasurement(0, { warmupMs: 0, measurementMs: 1e9, testOnly: true });
    for (let i = 0; i <= 100001; i++) m.observe(sample(i));
    const r = m.snapshot();
    expect(r.phase).toBe('invalid');
    expect(r.verdict).toBeNull();
    expect(r.samples.length).toBeLessThanOrEqual(100000);
  });
});

describe('target verdict', () => {
  it('passes at exactly 17.5 ms p95 with unrounded FPS above 57', () => {
    const r = run(new Array<number>(23).fill(17.5));
    expect(r).toMatchObject({ phase: 'complete', p95Ms: 17.5, verdict: true });
    expect(r.meanFps).toBeCloseTo(1000 / 17.5);
  });

  it('fails when p95 is just above 17.5 ms', () => {
    expect(run(new Array<number>(23).fill(17.51)).verdict).toBe(false);
  });

  it('fails on mean FPS below 57 even when p95 passes', () => {
    const r = run([...new Array<number>(19).fill(17.5), 100]);
    expect(r.p95Ms).toBe(17.5);
    expect(r.meanFps!).toBeLessThan(57);
    expect(r.verdict).toBe(false);
  });

  it('fails on any positive catch-up or clamp loss', () => {
    const base = new Array<number>(23).fill(17.5);
    expect(run(base, (i) => (i === 3 ? { droppedTimeS: 1e-9 } : {})).verdict).toBe(false);
    expect(run(base, (i) => (i === 3 ? { clampedTimeS: 1e-9 } : {})).verdict).toBe(false);
  });
});
