// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeasurement } from './metrics';
import { createBenchmarkPage, downloadJson, type BenchmarkPageOptions } from './page';
import { buildReport, type CaseOutcome } from './report';
import type { Preview, PreviewEvents, PreviewFrameSample } from '../render/preview';
import type { SceneAssets } from '../runtime-types';

const TIMING = { warmupMs: 20, measurementMs: 50, testOnly: true } as const;
const CASES = [
  ['sedan', 'driver'], ['sedan', 'chase'], ['cuv', 'driver'], ['cuv', 'chase'],
] as const;

interface Live {
  events: PreviewEvents;
  preview: Preview;
  prototype: Record<string, unknown>;
  assets: SceneAssets;
}

function harness(extra: Partial<BenchmarkPageOptions> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  let nowMs = 1000;
  const environment = {
    userAgent: 'TestAgent/1.0',
    viewport: { width: 2560, height: 1440 },
    devicePixelRatio: 1,
    renderer: { vendor: 'Vendor', renderer: 'Renderer' } as { vendor: string; renderer: string } | null,
  };
  const downloads: { name: string; text: string }[] = [];
  const assetsMade: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const loads: { vehicle: string; environment: string; signal: AbortSignal }[] = [];
  const lives: Live[] = [];
  const state = {
    loadGate: null as Promise<void> | null,
    loadError: null as Error | null,
    createError: null as Error | null,
    lock: true,
  };
  const loadSceneAssets = vi.fn(async (env: string, vehicle: string, signal: AbortSignal) => {
    loads.push({ vehicle, environment: env, signal });
    if (state.loadGate) await state.loadGate;
    if (state.loadError) throw state.loadError;
    const dispose = vi.fn();
    assetsMade.push({ dispose });
    return { dispose } as unknown as SceneAssets;
  });
  const createPreview = vi.fn((
    canvas: HTMLCanvasElement, _container: HTMLElement, events: PreviewEvents, prototype: unknown,
  ) => {
    if (state.createError) throw state.createError;
    const proto = prototype as Record<string, unknown>;
    const assets = proto.sceneAssets as SceneAssets;
    let disposed = false;
    const preview = {
      resume: vi.fn(() => true),
      pause: vi.fn(),
      requestPointerLock: vi.fn(async () => state.lock),
      dispose: vi.fn(() => {
        if (!disposed) { disposed = true; assets.dispose(); }
      }),
    } as unknown as Preview;
    expect(canvas.isConnected).toBe(true);
    lives.push({ events, preview, prototype: proto, assets });
    return preview;
  });
  const page = createBenchmarkPage(root, {
    createPreview: createPreview as unknown as BenchmarkPageOptions['createPreview'],
    loadSceneAssets: loadSceneAssets as unknown as BenchmarkPageOptions['loadSceneAssets'],
    now: () => nowMs,
    timing: TIMING,
    readEnvironment: () => ({ ...environment, viewport: { ...environment.viewport } }),
    download: (name, text) => downloads.push({ name, text }),
    buildRevision: 'abc123',
    lockSettleMs: 0,
    ...extra,
  });
  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  function fill(overrides: Record<string, string> = {}) {
    const values: Record<string, string> = {
      'meta-cpu': 'Test CPU', 'meta-gpu': 'Test GPU', 'meta-ram': '32 GB', 'meta-os': 'Windows 11 26100',
      'meta-driver': 'Driver 1.0', 'meta-browser': 'Browser 1.0', 'meta-refresh': '60', ...overrides,
    };
    for (const [id, value] of Object.entries(values)) $<HTMLInputElement>(id).value = value;
    $<HTMLInputElement>('meta-confirm-zoom').checked = true;
  }
  async function begin() {
    $('benchmark-start').click();
    await flush();
    $('benchmark-lock').click();
    await flush();
  }
  const live = () => lives[lives.length - 1]!;
  function frame(offset: number, over: Partial<PreviewFrameSample> = {}) {
    live().events.onFrame?.({
      completedAtMs: 1000 + offset, elapsedS: 0.01, droppedTimeS: 0, clampedTimeS: 0,
      drawingWidthPx: 2560, drawingHeightPx: 1440, ...over,
    });
  }
  const finishFrames = () => { for (const t of [10, 20, 30, 40, 50, 60, 70]) frame(t); };
  const report = () => {
    $('benchmark-export').click();
    return JSON.parse(downloads[downloads.length - 1]!.text) as Record<string, any>;
  };
  return {
    root, page, $, flush, fill, begin, live, lives, frame, finishFrames, report, downloads, state,
    environment, assetsMade, loads, loadSceneAssets, createPreview,
    setNow: (value: number) => { nowMs = value; },
  };
}
type Harness = ReturnType<typeof harness>;
let current: Harness | null = null;
function setup(extra: Partial<BenchmarkPageOptions> = {}) {
  current = harness(extra);
  return current;
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => {
  current?.page.dispose();
  current = null;
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('setup validation', () => {
  it('does not load anything until actual machine metadata and confirmations are complete', async () => {
    const h = setup();
    h.$('benchmark-start').click();
    await h.flush();
    expect(h.loadSceneAssets).not.toHaveBeenCalled();
    expect(h.$('benchmark-status').textContent).not.toBe('');

    h.fill();
    h.$<HTMLInputElement>('meta-confirm-zoom').checked = false;
    h.$('benchmark-start').click();
    expect(h.loadSceneAssets).not.toHaveBeenCalled();

    h.fill({ 'meta-refresh': '144' });
    h.$('benchmark-start').click();
    expect(h.loadSceneAssets).not.toHaveBeenCalled();

    h.fill({ 'meta-cpu': '  ' });
    h.$('benchmark-start').click();
    expect(h.loadSceneAssets).not.toHaveBeenCalled();
  });

  it('keeps export disabled until a case result exists', () => {
    const h = setup();
    expect(h.$<HTMLButtonElement>('benchmark-export').disabled).toBe(true);
  });

  it('never instantiates the learner app or touches persistence', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const h = setup();
    h.fill();
    await h.begin();
    h.finishFrames();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(h.root.querySelector('#hud, #app')).toBeNull();
  });
});

describe('four-case suite', () => {
  it('runs the fixed cases in order with the fixed workload and exports a complete test-only report', async () => {
    const h = setup();
    h.fill();
    for (const [vehicle, camera] of CASES) {
      await h.begin();
      const { prototype } = h.live();
      expect(h.loads.at(-1)).toMatchObject({ environment: 'garage', vehicle });
      expect(prototype).toMatchObject({
        environmentId: 'garage', vehicleId: vehicle, source: 'keyboard',
        settings: {
          version: 1, muted: true, driverFovDeg: 60, cameraMode: camera, overhead: true,
          trajectory: true, resolutionScale: 1, inputSource: 'keyboard',
        },
      });
      h.finishFrames();
      expect(h.live().preview.dispose).toHaveBeenCalledTimes(1);
    }
    expect(h.assetsMade).toHaveLength(4);
    for (const asset of h.assetsMade) expect(asset.dispose).toHaveBeenCalledTimes(1);
    const report = h.report();
    expect(report).toMatchObject({
      schemaVersion: 1, workloadVersion: 1, buildRevision: 'abc123',
      timing: { warmupMs: 20, measurementMs: 50, testOnly: true },
      suite: { status: 'complete', completeCases: 4, measuredVerdict: 'ineligible-test-only' },
      referenceEvidence: 'not-assessed',
      browser: { userAgent: 'TestAgent/1.0' },
      renderer: { available: true, vendor: 'Vendor', renderer: 'Renderer' },
      display: { devicePixelRatio: 1, viewport: { width: 2560, height: 1440 } },
    });
    expect(report.cases.map((c: any) => [c.vehicleId, c.cameraMode])).toEqual(CASES.map((c) => [...c]));
    const first = report.cases[0];
    expect(first).toMatchObject({
      status: 'complete', verdictEligible: false, verdict: null,
      drawingBuffer: { width: 2560, height: 1440 },
      metrics: { intervalCount: 5, p50Ms: 10, p95Ms: 10, maxMs: 10, totalLossS: 0 },
    });
    expect(first.samples.intervalMs).toEqual([10, 10, 10, 10, 10]);
    expect(first.samples.completedAtMs).toHaveLength(5);
    expect(h.$('benchmark-results').querySelectorAll('[data-case-id]')).toHaveLength(4);
    expect(h.$<HTMLButtonElement>('benchmark-start').disabled).toBe(true);
  });

  it('exports a partial suite as incomplete and labels user-entered reference metadata as unvalidated', async () => {
    const h = setup();
    h.fill({
      'meta-cpu': 'AMD Ryzen 5 7600', 'meta-gpu': 'NVIDIA GeForce RTX 4060', 'meta-ram': '32 GB DDR5',
    });
    await h.begin();
    h.finishFrames();
    const report = h.report();
    expect(report.suite).toMatchObject({ status: 'incomplete', completeCases: 1 });
    expect(report.cases).toHaveLength(1);
    expect(report.actualMachine).toMatchObject({ cpu: 'AMD Ryzen 5 7600', refreshHz: 60 });
    expect(report.referenceEvidence).toBe('not-assessed');
    expect(JSON.stringify(report)).not.toMatch(/validated"?:\s*true|reference[- ]hardware validated/i);
  });

  it('reports unavailable renderer metadata explicitly', async () => {
    const h = setup();
    h.environment.renderer = null;
    h.fill();
    await h.begin();
    h.finishFrames();
    expect(h.report().renderer).toEqual({ available: false, vendor: null, renderer: null });
  });

  it('records a wrong drawing buffer as invalid, never as a pass', async () => {
    const h = setup();
    h.fill();
    await h.begin();
    h.frame(10, { drawingWidthPx: 1920, drawingHeightPx: 1080 });
    const report = h.report();
    expect(report.cases[0]).toMatchObject({ status: 'invalid', verdict: null, metrics: null, samples: null });
    expect(report.cases[0].invalidReason).toMatch(/2560/);
    expect(report.suite.status).toBe('incomplete');
    expect(h.live().preview.dispose).toHaveBeenCalledTimes(1);
  });

  it('ignores query parameters and keeps the fixed shipping timing', async () => {
    history.replaceState(null, '', '/benchmark.html?warmupMs=1&measurementMs=1&testOnly=1');
    const h = setup({ timing: undefined });
    h.fill();
    await h.begin();
    for (let t = 100; t <= 65000; t += 100) h.frame(t);
    h.$('benchmark-cancel').click();
    const report = h.report();
    expect(report.timing).toEqual({ warmupMs: 10000, measurementMs: 60000, testOnly: false });
    expect(report.cases[0].status).toBe('invalid');
  });
});

describe('invalidation', () => {
  const mouse = () => {
    const event = new MouseEvent('mousemove');
    Object.defineProperty(event, 'movementX', { value: 4 });
    document.dispatchEvent(event);
  };
  const hidden = () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'hidden');
  };
  const triggers: [string, (h: Harness) => void][] = [
    ['resize', () => window.dispatchEvent(new Event('resize'))],
    ['device pixel ratio change', (h) => { h.environment.devicePixelRatio = 2; h.frame(15); }],
    ['viewport change', (h) => { h.environment.viewport = { width: 1280, height: 720 }; h.frame(15); }],
    ['window blur', () => window.dispatchEvent(new Event('blur'))],
    ['visibility hidden', hidden],
    ['pointer lock loss', () => document.dispatchEvent(new Event('pointerlockchange'))],
    ['mouse look', mouse],
    ['steering key', () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))],
    ['gear key', () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4' }))],
    ['preview pause', (h) => h.live().events.onPaused('contact')],
    ['preview fault', (h) => h.live().events.onFault('context-lost')],
    ['preview notice', (h) => h.live().events.onNotice('contactStop')],
    ['escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))],
    ['cancel button', (h) => h.$('benchmark-cancel').click()],
  ];
  it.each(triggers)('invalidates the running case on %s and stays invalid', async (_name, trigger) => {
    const h = setup();
    h.fill();
    await h.begin();
    h.frame(10);
    trigger(h);
    h.finishFrames();
    const report = h.report();
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0]).toMatchObject({ status: 'invalid', verdict: null, metrics: null });
    expect(report.cases[0].invalidReason).toBeTruthy();
    expect(report.suite.status).toBe('incomplete');
    expect(h.live().preview.dispose).toHaveBeenCalledTimes(1);
  });

  it('allows retrying the invalid case and replaces it with a valid result', async () => {
    const h = setup();
    h.fill();
    await h.begin();
    window.dispatchEvent(new Event('resize'));
    await h.begin();
    h.finishFrames();
    const report = h.report();
    expect(h.loads.map((l) => l.vehicle)).toEqual(['sedan', 'sedan']);
    expect(report.cases).toHaveLength(1);
    expect(report.cases[0].status).toBe('complete');
    expect(report.invalidAttempts).toEqual([
      expect.objectContaining({ caseId: 'sedan-driver', reason: expect.any(String) }),
    ]);
  });

  it('ignores pointer-lock acquisition movement during the settle delay, before the case starts', async () => {
    const h = setup({ lockSettleMs: 20 });
    h.fill();
    h.$('benchmark-start').click();
    await h.flush();
    h.$('benchmark-lock').click();
    await h.flush();
    const event = new MouseEvent('mousemove');
    Object.defineProperty(event, 'movementX', { value: 9 });
    document.dispatchEvent(event);
    expect(h.live().preview.resume).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.live().preview.resume).toHaveBeenCalledTimes(1);
    h.finishFrames();
    expect(h.report().cases[0].status).toBe('complete');
  });

  it('cancels the settle delay without starting the simulation', async () => {
    const h = setup({ lockSettleMs: 20 });
    h.fill();
    h.$('benchmark-start').click();
    await h.flush();
    h.$('benchmark-lock').click();
    await h.flush();
    h.$('benchmark-cancel').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(h.live().preview.resume).not.toHaveBeenCalled();
    expect(h.live().preview.dispose).toHaveBeenCalledTimes(1);
  });

  it('ignores input events before the measured run starts', async () => {
    const h = setup();
    h.fill();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new Event('resize'));
    await h.begin();
    h.finishFrames();
    expect(h.report().cases[0].status).toBe('complete');
  });
});

describe('loading and ownership', () => {
  it('cancels a stale load and disposes its assets once without creating a preview', async () => {
    let release!: () => void;
    const h = setup();
    h.state.loadGate = new Promise<void>((resolve) => { release = resolve; });
    h.fill();
    h.$('benchmark-start').click();
    await h.flush();
    h.$('benchmark-cancel').click();
    expect(h.loads[0]!.signal.aborted).toBe(true);
    release();
    await h.flush();
    expect(h.createPreview).not.toHaveBeenCalled();
    expect(h.assetsMade).toHaveLength(1);
    expect(h.assetsMade[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(h.$<HTMLButtonElement>('benchmark-start').disabled).toBe(false);
  });

  it('disposes loaded but unused assets when cancelled before the lock click', async () => {
    const h = setup();
    h.fill();
    h.$('benchmark-start').click();
    await h.flush();
    h.$('benchmark-cancel').click();
    expect(h.assetsMade[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(h.createPreview).not.toHaveBeenCalled();
  });

  it('shows an actionable error on load failure and allows retry', async () => {
    const h = setup();
    h.fill();
    h.state.loadError = new Error('network');
    h.$('benchmark-start').click();
    await h.flush();
    expect(h.$('benchmark-status').textContent).toMatch(/\S/);
    expect(h.$('benchmark-status').getAttribute('role')).toBe('status');
    expect(h.root.querySelector('[role="alert"]')).not.toBeNull();
    h.state.loadError = null;
    await h.begin();
    h.finishFrames();
    expect(h.report().cases[0].status).toBe('complete');
  });

  it('disposes assets once when preview creation fails', async () => {
    const h = setup();
    h.fill();
    h.state.createError = new Error('webgl');
    await h.begin();
    expect(h.assetsMade[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(h.root.querySelector('[role="alert"]')).not.toBeNull();
    expect(h.$<HTMLButtonElement>('benchmark-start').disabled).toBe(false);
  });

  it('abandons the attempt without a result when pointer lock is denied', async () => {
    const h = setup();
    h.fill();
    h.state.lock = false;
    await h.begin();
    expect(h.live().preview.dispose).toHaveBeenCalledTimes(1);
    expect(h.live().preview.resume).not.toHaveBeenCalled();
    expect(h.$<HTMLButtonElement>('benchmark-export').disabled).toBe(true);
    expect(h.$<HTMLButtonElement>('benchmark-start').disabled).toBe(false);
  });

  it('disposes the owned preview once and removes every listener on dispose', async () => {
    const win = vi.spyOn(window, 'addEventListener');
    const winOff = vi.spyOn(window, 'removeEventListener');
    const doc = vi.spyOn(document, 'addEventListener');
    const docOff = vi.spyOn(document, 'removeEventListener');
    const h = setup();
    h.fill();
    await h.begin();
    h.frame(10);
    const { preview } = h.live();
    h.page.dispose();
    h.page.dispose();
    expect(preview.dispose).toHaveBeenCalledTimes(1);
    expect(h.assetsMade[0]!.dispose).toHaveBeenCalledTimes(1);
    const unmatched = (on: typeof win, off: typeof win) => on.mock.calls.filter(([type, fn]) =>
      !off.mock.calls.some(([t, f]) => t === type && f === fn));
    expect(unmatched(win, winOff)).toEqual([]);
    expect(unmatched(doc, docOff)).toEqual([]);
    h.frame(20);
    expect(h.root.innerHTML).toBe('');
  });

  it('disposes during loading without creating a preview', async () => {
    let release!: () => void;
    const h = setup();
    h.state.loadGate = new Promise<void>((resolve) => { release = resolve; });
    h.fill();
    h.$('benchmark-start').click();
    await h.flush();
    h.page.dispose();
    release();
    await h.flush();
    expect(h.createPreview).not.toHaveBeenCalled();
    expect(h.assetsMade[0]!.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('report building and export', () => {
  function productionOutcome(intervalMs: number): CaseOutcome {
    const measurement = createMeasurement(0);
    for (let t = intervalMs; t <= 71000; t += intervalMs) {
      measurement.observe({
        completedAtMs: t, elapsedS: intervalMs / 1000, droppedTimeS: 0, clampedTimeS: 0,
        drawingWidthPx: 2560, drawingHeightPx: 1440,
      });
    }
    return {
      caseId: 'sedan-driver', result: measurement.snapshot(),
      drawingBuffer: { width: 2560, height: 1440 },
    };
  }
  const base = {
    machine: {
      cpu: 'AMD Ryzen 5 7600', gpu: 'NVIDIA GeForce RTX 4060', ram: '32 GB', os: 'Windows 11',
      driver: '1', browser: 'Chrome', refreshHz: 60, zoom100Confirmed: true,
    },
    environment: {
      userAgent: 'UA', viewport: { width: 2560, height: 1440 }, devicePixelRatio: 1, renderer: null,
    },
    buildRevision: 'unavailable',
    timing: { warmupMs: 10000, measurementMs: 60000, testOnly: false },
    generatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('gives a measured pass only for four passing cases and never a reference-validated label', () => {
    const passing = ['sedan-driver', 'sedan-chase', 'cuv-driver', 'cuv-chase']
      .map((caseId) => ({ ...productionOutcome(16), caseId }));
    const pass = buildReport({ ...base, outcomes: passing, invalidAttempts: [] });
    expect(pass.suite).toMatchObject({ status: 'complete', measuredVerdict: 'pass' });
    expect(pass.referenceEvidence).toBe('not-assessed');
    expect(pass.cases[0]!.criteria).toMatchObject({
      p95Ms: { limit: 17.5, pass: true }, meanFps: { limit: 57, pass: true }, lossS: { limit: 0, pass: true },
    });
    const fail = buildReport({
      ...base, outcomes: [...passing.slice(0, 3), { ...productionOutcome(20), caseId: 'cuv-chase' }],
      invalidAttempts: [],
    });
    expect(fail.suite.measuredVerdict).toBe('fail');
    const partial = buildReport({ ...base, outcomes: passing.slice(0, 3), invalidAttempts: [] });
    expect(partial.suite).toMatchObject({ status: 'incomplete', measuredVerdict: 'incomplete' });
  });

  it('downloads through a local object URL and revokes it', () => {
    vi.useFakeTimers();
    const urlApi = { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadJson('r.json', '{}', urlApi);
    expect(click).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    expect(document.querySelector('a[download]')).toBeNull();
    vi.useRealTimers();
  });
});
