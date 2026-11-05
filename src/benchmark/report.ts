import type { CameraMode, VehicleId } from '../contracts';
import type { SettingsSaveV1 } from '../runtime-types';
import {
  TARGET_MEAN_FPS, TARGET_P95_MS, type MeasurementResult, type MeasurementTiming,
} from './metrics';

export const REPORT_SCHEMA_VERSION = 1;
export const WORKLOAD_VERSION = 1;
export const REQUIRED_DRAWING_BUFFER = { width: 2560, height: 1440 } as const;
export const REQUIRED_REFRESH_HZ = 60;
export const MAX_INVALID_ATTEMPTS = 20;

export interface BenchmarkCase {
  readonly id: string;
  readonly vehicleId: VehicleId;
  readonly cameraMode: CameraMode;
}
export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  { id: 'sedan-driver', vehicleId: 'sedan', cameraMode: 'driver' },
  { id: 'sedan-chase', vehicleId: 'sedan', cameraMode: 'chase' },
  { id: 'cuv-driver', vehicleId: 'cuv', cameraMode: 'driver' },
  { id: 'cuv-chase', vehicleId: 'cuv', cameraMode: 'chase' },
];

export function workloadSettings(cameraMode: CameraMode): SettingsSaveV1 {
  return {
    version: 1, volume: 0, muted: true, driverFovDeg: 60, cameraMode, overhead: true,
    trajectory: true, inputSource: 'keyboard', resolutionScale: 1,
  };
}

export const REFERENCE_MACHINE = {
  cpu: 'AMD Ryzen 5 7600 (6 cores / 12 threads)',
  gpu: 'NVIDIA GeForce RTX 4060 (8 GB dedicated VRAM)',
  ram: '32 GB dual-channel DDR5',
  storage: 'NVMe SSD, at least 10 GB free',
  os: 'Windows 11 64-bit',
  browsers: 'Current stable Chrome and Firefox, hardware acceleration enabled',
  display: '2560x1440 at 60 Hz, browser zoom 100%',
} as const;

export interface MachineMetadata {
  readonly cpu: string;
  readonly gpu: string;
  readonly ram: string;
  readonly os: string;
  readonly driver: string;
  readonly browser: string;
  readonly refreshHz: number;
  readonly zoom100Confirmed: boolean;
}
export interface EnvironmentInfo {
  readonly userAgent: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly renderer: { readonly vendor: string; readonly renderer: string } | null;
}
export interface CaseOutcome {
  readonly caseId: string;
  readonly result: MeasurementResult;
  readonly drawingBuffer: { readonly width: number; readonly height: number } | null;
}
export interface InvalidAttempt {
  readonly caseId: string;
  readonly reason: string;
}

export type MeasuredVerdict = 'pass' | 'fail' | 'incomplete' | 'ineligible-test-only';
interface Criterion {
  readonly limit: number;
  readonly actual: number | null;
  readonly pass: boolean | null;
}
export interface CaseReport {
  readonly id: string;
  readonly vehicleId: VehicleId;
  readonly cameraMode: CameraMode;
  readonly status: 'complete' | 'invalid';
  readonly invalidReason: string | null;
  readonly drawingBuffer: { readonly width: number; readonly height: number } | null;
  readonly verdictEligible: boolean;
  readonly verdict: boolean | null;
  readonly criteria: { readonly p95Ms: Criterion; readonly meanFps: Criterion; readonly lossS: Criterion };
  readonly metrics: {
    readonly intervalCount: number;
    readonly elapsedMs: number | null;
    readonly measuredStartMs: number | null;
    readonly measuredEndMs: number | null;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly p99Ms: number | null;
    readonly maxMs: number | null;
    readonly meanFps: number | null;
    readonly catchUpLossS: number;
    readonly clampLossS: number;
    readonly totalLossS: number;
  } | null;
  readonly samples: {
    readonly completedAtMs: number[];
    readonly intervalMs: number[];
    readonly elapsedS: number[];
    readonly droppedTimeS: number[];
    readonly clampedTimeS: number[];
  } | null;
}
export interface BenchmarkReport {
  readonly schemaVersion: 1;
  readonly workloadVersion: 1;
  readonly generatedAt: string;
  readonly buildRevision: string;
  readonly timing: MeasurementTiming;
  readonly workload: {
    readonly environment: 'garage';
    readonly spawn: 'sandbox';
    readonly gear: 'P';
    readonly parkingBrake: true;
    readonly drawingBuffer: typeof REQUIRED_DRAWING_BUFFER;
    readonly settings: Omit<SettingsSaveV1, 'cameraMode'>;
    readonly note: string;
  };
  readonly targets: { readonly p95MaxMs: number; readonly meanFpsMin: number; readonly totalLossS: 0 };
  readonly referenceMachine: typeof REFERENCE_MACHINE;
  readonly actualMachine: MachineMetadata;
  readonly browser: { readonly userAgent: string };
  readonly renderer: {
    readonly available: boolean;
    readonly vendor: string | null;
    readonly renderer: string | null;
  };
  readonly display: {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: number;
  };
  readonly suite: {
    readonly status: 'complete' | 'incomplete';
    readonly completeCases: number;
    readonly requiredCases: number;
    readonly measuredVerdict: MeasuredVerdict;
  };
  readonly referenceEvidence: 'not-assessed';
  readonly cases: CaseReport[];
  readonly invalidAttempts: readonly InvalidAttempt[];
  readonly disclaimer: string;
}

export function validateMachine(raw: Record<string, string>, zoomConfirmed: boolean): {
  readonly machine: MachineMetadata | null; readonly errors: string[];
} {
  const text = (key: string) => (raw[key] ?? '').trim();
  const errors: string[] = [];
  const labels: [string, string][] = [
    ['cpu', 'CPU'], ['gpu', 'GPU'], ['ram', 'RAM'], ['os', 'Hệ điều hành (kèm bản dựng)'],
    ['driver', 'Phiên bản driver GPU'], ['browser', 'Trình duyệt và phiên bản'],
  ];
  for (const [key, label] of labels) if (!text(key)) errors.push(`Thiếu thông tin: ${label}.`);
  const refreshHz = Number(text('refresh'));
  if (text('refresh') === '' || !Number.isFinite(refreshHz)) errors.push('Thiếu tần số quét thực tế (Hz).');
  else if (refreshHz !== REQUIRED_REFRESH_HZ) {
    errors.push(`Giao thức phiên bản 1 yêu cầu màn hình đặt ở ${REQUIRED_REFRESH_HZ} Hz.`);
  }
  if (!zoomConfirmed) errors.push('Hãy xác nhận trình duyệt đang ở mức thu phóng 100%.');
  if (errors.length > 0) return { machine: null, errors };
  return {
    machine: {
      cpu: text('cpu'), gpu: text('gpu'), ram: text('ram'), os: text('os'), driver: text('driver'),
      browser: text('browser'), refreshHz, zoom100Confirmed: true,
    },
    errors,
  };
}

function caseReport(definition: BenchmarkCase, outcome: CaseOutcome, testOnly: boolean): CaseReport {
  const { result } = outcome;
  const complete = result.phase === 'complete';
  const eligible = !testOnly;
  const verdict = complete && eligible ? result.verdict : null;
  const criterion = (limit: number, actual: number | null, pass: (v: number) => boolean): Criterion => ({
    limit, actual: complete ? actual : null,
    pass: complete && eligible && actual !== null ? pass(actual) : null,
  });
  return {
    id: definition.id,
    vehicleId: definition.vehicleId,
    cameraMode: definition.cameraMode,
    status: complete ? 'complete' : 'invalid',
    invalidReason: complete ? null : result.invalidReason ?? 'Phép đo chưa hoàn tất',
    drawingBuffer: outcome.drawingBuffer,
    verdictEligible: eligible,
    verdict,
    criteria: {
      p95Ms: criterion(TARGET_P95_MS, result.p95Ms, (v) => v <= TARGET_P95_MS),
      meanFps: criterion(TARGET_MEAN_FPS, result.meanFps, (v) => v >= TARGET_MEAN_FPS),
      lossS: criterion(0, result.totalLossS, (v) => v === 0),
    },
    metrics: complete ? {
      intervalCount: result.intervalCount,
      elapsedMs: result.elapsedMs,
      measuredStartMs: result.measuredStartMs,
      measuredEndMs: result.measuredEndMs,
      p50Ms: result.p50Ms, p95Ms: result.p95Ms, p99Ms: result.p99Ms, maxMs: result.maxMs,
      meanFps: result.meanFps,
      catchUpLossS: result.catchUpLossS, clampLossS: result.clampLossS, totalLossS: result.totalLossS,
    } : null,
    samples: complete ? {
      completedAtMs: result.samples.map((s) => s.completedAtMs),
      intervalMs: result.samples.map((s) => s.intervalMs),
      elapsedS: result.samples.map((s) => s.elapsedS),
      droppedTimeS: result.samples.map((s) => s.droppedTimeS),
      clampedTimeS: result.samples.map((s) => s.clampedTimeS),
    } : null,
  };
}

export function buildReport(input: {
  readonly machine: MachineMetadata;
  readonly environment: EnvironmentInfo;
  readonly buildRevision: string;
  readonly timing: MeasurementTiming;
  readonly generatedAt: string;
  readonly outcomes: readonly CaseOutcome[];
  readonly invalidAttempts: readonly InvalidAttempt[];
}): BenchmarkReport {
  const cases = BENCHMARK_CASES.flatMap((definition) => {
    const outcome = input.outcomes.find((o) => o.caseId === definition.id);
    return outcome ? [caseReport(definition, outcome, input.timing.testOnly)] : [];
  });
  const completeCases = cases.filter((c) => c.status === 'complete').length;
  const complete = completeCases === BENCHMARK_CASES.length;
  let measuredVerdict: MeasuredVerdict;
  if (input.timing.testOnly) measuredVerdict = 'ineligible-test-only';
  else if (!complete) measuredVerdict = 'incomplete';
  else measuredVerdict = cases.every((c) => c.verdict === true) ? 'pass' : 'fail';
  const { cameraMode: _camera, ...sharedSettings } = workloadSettings('driver');
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    workloadVersion: WORKLOAD_VERSION,
    generatedAt: input.generatedAt,
    buildRevision: input.buildRevision,
    timing: { ...input.timing },
    workload: {
      environment: 'garage', spawn: 'sandbox', gear: 'P', parkingBrake: true,
      drawingBuffer: REQUIRED_DRAWING_BUFFER, settings: sharedSettings,
      note: 'Stationary sampled Garage views; not a proven worst-case view. Audio muted.',
    },
    targets: { p95MaxMs: TARGET_P95_MS, meanFpsMin: TARGET_MEAN_FPS, totalLossS: 0 },
    referenceMachine: REFERENCE_MACHINE,
    actualMachine: { ...input.machine },
    browser: { userAgent: input.environment.userAgent },
    renderer: input.environment.renderer
      ? { available: true, ...input.environment.renderer }
      : { available: false, vendor: null, renderer: null },
    display: {
      viewport: { ...input.environment.viewport },
      devicePixelRatio: input.environment.devicePixelRatio,
    },
    suite: {
      status: complete ? 'complete' : 'incomplete',
      completeCases,
      requiredCases: BENCHMARK_CASES.length,
      measuredVerdict,
    },
    referenceEvidence: 'not-assessed',
    cases,
    invalidAttempts: input.invalidAttempts.slice(-MAX_INVALID_ATTEMPTS),
    disclaimer: 'Delivered-frame and physics-loss measurements only; not GPU profiling. ' +
      'User-entered machine fields are unverified and do not confer reference-hardware validation.',
  };
}
