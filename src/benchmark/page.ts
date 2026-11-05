import type { Preview, PreviewEvents, PreviewFrameSample } from '../render/preview';
import { createPreview as defaultCreatePreview } from '../render/preview';
import type { SceneAssets } from '../runtime-types';
import { loadSceneAssets as defaultLoadSceneAssets } from '../world/assets';
import { createMeasurement, type Measurement, type MeasurementTiming } from './metrics';
import {
  BENCHMARK_CASES, MAX_INVALID_ATTEMPTS, REQUIRED_DRAWING_BUFFER, WORKLOAD_VERSION,
  buildReport, validateMachine, workloadSettings,
  type BenchmarkCase, type CaseOutcome, type EnvironmentInfo, type InvalidAttempt,
  type MachineMetadata,
} from './report';

declare const __BUILD_REVISION__: string | undefined;

const SHIPPING_TIMING: MeasurementTiming = { warmupMs: 10000, measurementMs: 60000, testOnly: false };
const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|CapsLock)/;

export interface BenchmarkPageOptions {
  readonly createPreview?: typeof defaultCreatePreview;
  readonly loadSceneAssets?: typeof defaultLoadSceneAssets;
  readonly now?: () => number;
  /** Test-only: shortens warm-up/measurement and marks the report ineligible. */
  readonly timing?: Pick<MeasurementTiming, 'warmupMs' | 'measurementMs'>;
  readonly readEnvironment?: () => EnvironmentInfo;
  readonly download?: (filename: string, json: string) => void;
  readonly buildRevision?: string;
  /** Delay after pointer-lock acquisition before the case starts; default 300 ms. */
  readonly lockSettleMs?: number;
}

export function createEnvironmentReader(): () => EnvironmentInfo {
  let renderer: EnvironmentInfo['renderer'] | undefined;
  function probe(): EnvironmentInfo['renderer'] {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return null;
    try {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (!info) return null;
      const vendor: unknown = gl.getParameter(info.UNMASKED_VENDOR_WEBGL);
      const name: unknown = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
      return typeof vendor === 'string' && typeof name === 'string' ? { vendor, renderer: name } : null;
    } finally {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
  return () => {
    if (renderer === undefined) {
      try { renderer = probe(); } catch { renderer = null; }
    }
    return {
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      renderer,
    };
  };
}

export function downloadJson(
  filename: string, json: string,
  urlApi: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): void {
  const url = urlApi.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    setTimeout(() => urlApi.revokeObjectURL(url), 1000);
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const FIELDS: readonly { key: string; label: string; hint: string; type?: string }[] = [
  { key: 'cpu', label: 'CPU thực tế', hint: 'Tên CPU và số nhân' },
  { key: 'gpu', label: 'GPU thực tế', hint: 'Tên GPU và dung lượng VRAM' },
  { key: 'ram', label: 'RAM thực tế', hint: 'Dung lượng và loại RAM' },
  { key: 'os', label: 'Hệ điều hành (kèm bản dựng)', hint: 'Ví dụ: Windows 11 build ...' },
  { key: 'driver', label: 'Phiên bản driver GPU', hint: 'Xem trong trình quản lý driver' },
  { key: 'browser', label: 'Trình duyệt và phiên bản', hint: 'Chrome hoặc Firefox bản ổn định mới nhất' },
  { key: 'refresh', label: 'Tần số quét màn hình thực tế (Hz)', hint: 'Phải là 60', type: 'number' },
];
const VEHICLE_LABEL = { sedan: 'Sedan', cuv: 'CUV' } as const;
const CAMERA_LABEL = { driver: 'góc nhìn người lái', chase: 'camera bám xe' } as const;
const caseLabel = (c: BenchmarkCase) => `${VEHICLE_LABEL[c.vehicleId]} · ${CAMERA_LABEL[c.cameraMode]}`;

type PageState = 'setup' | 'loading' | 'ready' | 'starting' | 'running' | 'closed';

export function createBenchmarkPage(
  root: HTMLElement, options: BenchmarkPageOptions = {},
): { dispose(): void } {
  const createPreview = options.createPreview ?? defaultCreatePreview;
  const loadSceneAssets = options.loadSceneAssets ?? defaultLoadSceneAssets;
  const now = options.now ?? (() => performance.now());
  const readEnvironment = options.readEnvironment ?? createEnvironmentReader();
  const download = options.download ?? ((name: string, json: string) => downloadJson(name, json));
  const buildRevision = options.buildRevision ??
    (typeof __BUILD_REVISION__ === 'string' ? __BUILD_REVISION__ : 'unavailable');
  const timing: MeasurementTiming = options.timing
    ? { warmupMs: options.timing.warmupMs, measurementMs: options.timing.measurementMs, testOnly: true }
    : SHIPPING_TIMING;

  const lockSettleMs = options.lockSettleMs ?? 300;
  let state: PageState = 'setup';
  let attempt = 0;
  let machine: MachineMetadata | null = null;
  let runEnvironment: EnvironmentInfo | null = null;
  let targetCase: BenchmarkCase | null = null;
  let controller: AbortController | null = null;
  let assets: SceneAssets | null = null;
  let preview: Preview | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let measurement: Measurement | null = null;
  let warmupEndMs = 0;
  let deadlineMs = 0;
  let announcedMeasuring = false;
  let detachListeners: (() => void) | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const outcomes = new Map<string, CaseOutcome>();
  const invalidAttempts: InvalidAttempt[] = [];

  const status = element('p', { id: 'benchmark-status', className: 'bm-status' });
  status.setAttribute('role', 'status');
  const cancel = element('button', { id: 'benchmark-cancel', type: 'button', textContent: 'Hủy' });
  const bar = element('div', { className: 'bm-bar' }, status, cancel);
  const alertBox = element('p', { className: 'bm-alert', hidden: true });
  alertBox.setAttribute('role', 'alert');
  const inputs = new Map<string, HTMLInputElement>();
  const fieldset = element('fieldset', { className: 'bm-fields' },
    element('legend', { textContent: 'Thông tin máy thực tế (không tự điền)' }));
  for (const field of FIELDS) {
    const input = element('input', {
      id: `meta-${field.key}`, type: field.type ?? 'text', autocomplete: 'off', required: true,
    });
    input.setAttribute('aria-describedby', `meta-${field.key}-hint`);
    inputs.set(field.key, input);
    fieldset.append(element('div', { className: 'bm-field' },
      element('label', { htmlFor: input.id, textContent: field.label }), input,
      element('small', { id: `${input.id}-hint`, textContent: field.hint })));
  }
  const zoom = element('input', { id: 'meta-confirm-zoom', type: 'checkbox' });
  fieldset.append(element('label', { className: 'bm-check' }, zoom,
    ' Tôi xác nhận trình duyệt đang ở mức thu phóng 100%.'));
  const start = element('button', { id: 'benchmark-start', type: 'button' });
  const lock = element('button', {
    id: 'benchmark-lock', type: 'button', hidden: true,
    textContent: 'Khóa con trỏ và bắt đầu đo',
  });
  const exportButton = element('button', {
    id: 'benchmark-export', type: 'button', disabled: true, textContent: 'Xuất báo cáo JSON',
  });
  const results = element('section', { id: 'benchmark-results', className: 'bm-results' });
  const intro = element('div', { className: 'bm-intro' },
    element('h1', { textContent: 'Park-Core — Kiểm tra hiệu năng' }),
    element('p', {
      textContent: 'Công cụ chẩn đoán dùng cùng bộ mô phỏng thật, không lưu tiến độ học viên. ' +
        'Mỗi lần chạy gồm 4 tình huống cố định (Sedan/CUV, góc nhìn người lái/camera bám xe), ' +
        'mỗi tình huống khởi động 10 giây rồi đo 60 giây. Chỉ đo khung hình đã hiển thị và thời gian ' +
        'vật lý bị bỏ; đây không phải đo hiệu năng GPU.',
    }),
    element('ul', {},
      element('li', { textContent: 'Màn hình đặt ở 60 Hz, trình duyệt ở mức thu phóng 100%, âm thanh tắt.' }),
      element('li', { textContent: 'Cần vùng vẽ thực tế 2560×1440; kích thước khác sẽ bị tính là không hợp lệ.' }),
      element('li', { textContent: 'Trong lúc đo, không chạm chuột, phím hay tay lái; Esc để hủy.' }),
      element('li', { textContent: 'Chạy riêng một bộ trên Chrome và một bộ trên Firefox.' })),
    ...(timing.testOnly ? [element('p', {
      className: 'bm-alert', textContent: 'Chế độ thử nghiệm: kết quả không hợp lệ làm bằng chứng hiệu năng.',
    })] : []));
  const panel = element('main', { className: 'bm-panel' },
    intro, alertBox, fieldset,
    element('div', { className: 'bm-actions' }, start, lock, exportButton), results);
  const stage = element('div', { id: 'benchmark-stage', className: 'bm-stage', hidden: true });
  root.append(bar, panel, stage);

  function setStatus(text: string) { status.textContent = text; }
  function showError(text: string) {
    alertBox.textContent = text;
    alertBox.hidden = false;
    setStatus(text);
  }
  function clearError() { alertBox.textContent = ''; alertBox.hidden = true; }
  function nextCase(): BenchmarkCase | null {
    return BENCHMARK_CASES.find((c) => outcomes.get(c.id)?.result.phase !== 'complete') ?? null;
  }
  function refreshControls() {
    const next = nextCase();
    const retry = next !== null && outcomes.has(next.id);
    start.disabled = state !== 'setup' || next === null;
    start.textContent = next === null ? 'Đã hoàn tất 4 tình huống'
      : retry ? `Thử lại: ${caseLabel(next)}`
        : `Tải và chuẩn bị: ${caseLabel(next)}`;
    lock.hidden = state !== 'ready';
    cancel.disabled = state === 'setup' || state === 'closed';
    exportButton.disabled = outcomes.size === 0;
    fieldset.disabled = state !== 'setup' || [...outcomes.values()].some((o) => o.result.phase === 'complete');
    panel.hidden = state === 'starting' || state === 'running';
    stage.hidden = !panel.hidden;
  }
  function renderResults() {
    results.replaceChildren(element('h2', { textContent: 'Kết quả' }));
    const list = element('ul', {});
    for (const definition of BENCHMARK_CASES) {
      const outcome = outcomes.get(definition.id);
      if (!outcome) continue;
      const { result } = outcome;
      const item = element('li', {});
      item.dataset.caseId = definition.id;
      item.dataset.status = result.phase === 'complete' ? 'complete' : 'invalid';
      if (result.phase === 'complete') {
        const verdict = timing.testOnly ? 'chế độ thử nghiệm, không có kết luận'
          : result.verdict ? 'đạt mục tiêu' : 'không đạt mục tiêu';
        item.textContent = `${caseLabel(definition)}: hoàn tất (${verdict}) — p95 ` +
          `${result.p95Ms?.toFixed(2)} ms, trung bình ${result.meanFps?.toFixed(1)} FPS, ` +
          `${result.intervalCount} khoảng, mất ${result.totalLossS.toFixed(3)} s.`;
      } else {
        item.textContent = `${caseLabel(definition)}: không hợp lệ — ${result.invalidReason ?? 'chưa hoàn tất'}`;
      }
      list.append(item);
    }
    results.append(list);
    if (invalidAttempts.length > 0) {
      results.append(element('p', {
        textContent: `Số lần chạy không hợp lệ đã bị loại: ${invalidAttempts.length}.`,
      }));
    }
  }

  function dropPreview() {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    detachListeners?.();
    detachListeners = null;
    const current = preview;
    preview = null;
    current?.dispose();
    canvas?.remove();
    canvas = null;
    measurement = null;
  }
  function abandon(message: string | null) {
    attempt++;
    dropPreview();
    state = 'setup';
    refreshControls();
    if (message) showError(message); else setStatus('Đã hủy.');
  }
  function finishRun() {
    if (state !== 'running' || !measurement || !targetCase) return;
    const snapshot = measurement.snapshot();
    const complete = snapshot.phase === 'complete';
    const reason = snapshot.invalidReason ?? 'Phép đo chưa hoàn tất.';
    outcomes.set(targetCase.id, {
      caseId: targetCase.id,
      result: complete ? snapshot : { ...snapshot, samples: [] },
      drawingBuffer: complete ? { ...REQUIRED_DRAWING_BUFFER } : null,
    });
    if (!complete) {
      invalidAttempts.push({ caseId: targetCase.id, reason });
      if (invalidAttempts.length > MAX_INVALID_ATTEMPTS) invalidAttempts.shift();
    }
    const label = caseLabel(targetCase);
    attempt++;
    dropPreview();
    state = 'setup';
    clearError();
    renderResults();
    refreshControls();
    if (complete) setStatus(`${label}: hoàn tất.`);
    else showError(`${label}: không hợp lệ — ${reason} Hãy thử lại và giữ yên chuột, phím.`);
  }
  function invalidateRun(reason: string) {
    if (state !== 'running' || !measurement) return;
    measurement.invalidate(reason);
    finishRun();
  }

  function sameDisplay(a: EnvironmentInfo, b: EnvironmentInfo) {
    return a.devicePixelRatio === b.devicePixelRatio && a.viewport.width === b.viewport.width &&
      a.viewport.height === b.viewport.height;
  }
  function onFrame(sample: PreviewFrameSample) {
    if (state !== 'running' || !measurement || !runEnvironment) return;
    if (!sameDisplay(runEnvironment, readEnvironment())) {
      invalidateRun('Kích thước cửa sổ hoặc tỉ lệ điểm ảnh (DPR) đã thay đổi.');
      return;
    }
    if (sample.drawingWidthPx !== REQUIRED_DRAWING_BUFFER.width ||
        sample.drawingHeightPx !== REQUIRED_DRAWING_BUFFER.height) {
      invalidateRun(`Vùng vẽ ${sample.drawingWidthPx}×${sample.drawingHeightPx}, cần ` +
        `${REQUIRED_DRAWING_BUFFER.width}×${REQUIRED_DRAWING_BUFFER.height}.`);
      return;
    }
    measurement.observe(sample);
    if (!announcedMeasuring && sample.completedAtMs >= warmupEndMs) {
      announcedMeasuring = true;
      setStatus('Đang đo… giữ yên chuột và phím.');
    }
    // Snapshots sort every sample, so only take them once completion is possible.
    if (sample.completedAtMs >= deadlineMs) {
      const { phase } = measurement.snapshot();
      if (phase === 'invalid' || phase === 'complete') finishRun();
    }
  }
  const events: PreviewEvents = {
    onFrame,
    onPaused: (reason) => invalidateRun(`Mô phỏng bị tạm dừng (${reason}).`),
    onFault: (kind) => invalidateRun(kind === 'context-lost' ? 'Mất ngữ cảnh WebGL.' : 'Lỗi mô phỏng.'),
    onTelemetry: () => undefined,
    onSensors: () => undefined,
    onNotice: (key) => invalidateRun(`Thông báo bất thường từ mô phỏng (${key}).`),
  };

  function attachListeners() {
    const onResize = () => invalidateRun('Cửa sổ đã đổi kích thước.');
    const onBlur = () => invalidateRun('Cửa sổ mất tiêu điểm.');
    const onVisibility = () => { if (document.hidden) invalidateRun('Trang không còn hiển thị.'); };
    const onLockChange = () => {
      if (document.pointerLockElement === canvas) return;
      if (state === 'starting') abandon('Con trỏ không còn bị khóa. Hãy thử lại.');
      else invalidateRun('Con trỏ không còn bị khóa.');
    };
    const onMouse = (event: MouseEvent) => {
      if (event.movementX !== 0 || event.movementY !== 0) invalidateRun('Phát hiện chuyển động chuột.');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape') invalidateRun('Đã nhấn Esc.');
      else if (!MODIFIER_CODES.test(event.code)) invalidateRun('Phát hiện thao tác phím trong lúc đo.');
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mousemove', onMouse);
    document.addEventListener('keydown', onKey, true);
    detachListeners = () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('keydown', onKey, true);
    };
  }

  function readMachine(): MachineMetadata | null {
    const raw: Record<string, string> = {};
    for (const [key, input] of inputs) raw[key] = input.value;
    const validation = validateMachine(raw, zoom.checked);
    if (!validation.machine) {
      showError(validation.errors.join(' '));
      return null;
    }
    return validation.machine;
  }
  function onStart() {
    if (state !== 'setup') return;
    const next = nextCase();
    if (!next) return;
    const validated = readMachine();
    if (!validated) return;
    machine = validated;
    readEnvironment();
    clearError();
    targetCase = next;
    state = 'loading';
    const id = ++attempt;
    const abort = new AbortController();
    controller = abort;
    refreshControls();
    setStatus(`Đang tải ${caseLabel(next)}…`);
    let loading: Promise<SceneAssets>;
    try {
      loading = loadSceneAssets('garage', next.vehicleId, abort.signal, (progress) => {
        if (id === attempt && state === 'loading') {
          setStatus(`Đang tải ${progress.resource === 'vehicle' ? 'mẫu xe' : 'bãi đỗ'}…`);
        }
      });
    } catch (error) {
      loading = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    void loading.then((loaded) => {
      if (id !== attempt || abort.signal.aborted || state !== 'loading') {
        loaded.dispose();
        return;
      }
      assets = loaded;
      state = 'ready';
      refreshControls();
      setStatus('Đã tải xong. Nhấn "Khóa con trỏ và bắt đầu đo" rồi giữ yên chuột và phím.');
      lock.focus();
    }, () => {
      if (id !== attempt || abort.signal.aborted) return;
      state = 'setup';
      refreshControls();
      showError('Không thể tải tài nguyên. Hãy kiểm tra kết nối rồi thử lại.');
    });
  }
  function onLock() {
    if (state !== 'ready' || !assets || !targetCase) return;
    const owned = assets;
    assets = null;
    const definition = targetCase;
    const id = ++attempt;
    state = 'starting';
    refreshControls();
    runEnvironment = readEnvironment();
    canvas = element('canvas', { id: 'benchmark-canvas', tabIndex: 0 });
    canvas.setAttribute('aria-label', 'Khung mô phỏng đang đo hiệu năng');
    stage.append(canvas);
    try {
      preview = createPreview(canvas, stage, events, {
        environmentId: 'garage', vehicleId: definition.vehicleId, sceneAssets: owned,
        source: 'keyboard', gamepadIndex: null, calibration: null, getGamepads: () => [],
        settings: workloadSettings(definition.cameraMode),
      }, {}, { kind: 'sandbox' });
    } catch {
      owned.dispose();
      abandon('Không thể khởi tạo bộ kết xuất WebGL. Hãy bật tăng tốc phần cứng rồi thử lại.');
      return;
    }
    attachListeners();
    canvas.focus();
    const current = preview;
    const begin = () => {
      if (id !== attempt || current !== preview) return;
      if (!current.resume()) {
        abandon('Không thể bắt đầu mô phỏng. Hãy thử lại.');
        return;
      }
      const startMs = now();
      measurement = createMeasurement(startMs, timing);
      warmupEndMs = startMs + timing.warmupMs;
      deadlineMs = warmupEndMs + timing.measurementMs;
      announcedMeasuring = false;
      state = 'running';
      setStatus('Đang khởi động… giữ yên chuột và phím.');
    };
    void current.requestPointerLock().then((locked) => {
      if (id !== attempt || current !== preview) return;
      if (!locked) {
        abandon('Không thể khóa con trỏ. Hãy cho phép quyền này rồi thử lại.');
        return;
      }
      // Browsers can emit one movement event as the lock is acquired; let it pass before the case.
      if (lockSettleMs > 0) settleTimer = setTimeout(() => { settleTimer = null; begin(); }, lockSettleMs);
      else begin();
    }, () => {
      if (id === attempt && current === preview) abandon('Không thể khóa con trỏ.');
    });
  }
  function onCancel() {
    switch (state) {
      case 'loading':
        controller?.abort();
        abandon(null);
        break;
      case 'ready':
        assets?.dispose();
        assets = null;
        abandon(null);
        break;
      case 'starting': abandon(null); break;
      case 'running': invalidateRun('Người dùng đã hủy.'); break;
      default: break;
    }
  }
  function onExport() {
    if (outcomes.size === 0 || !machine || !runEnvironment) return;
    const report = buildReport({
      machine, environment: runEnvironment, buildRevision, timing,
      generatedAt: new Date().toISOString(), outcomes: [...outcomes.values()], invalidAttempts,
    });
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    download(`park-core-benchmark-v${WORKLOAD_VERSION}-${stamp}.json`, JSON.stringify(report));
  }

  start.addEventListener('click', onStart);
  lock.addEventListener('click', onLock);
  cancel.addEventListener('click', onCancel);
  exportButton.addEventListener('click', onExport);
  refreshControls();
  setStatus('Điền thông tin máy thực tế để bắt đầu.');

  return {
    dispose() {
      if (state === 'closed') return;
      state = 'closed';
      attempt++;
      controller?.abort();
      assets?.dispose();
      assets = null;
      dropPreview();
      start.removeEventListener('click', onStart);
      lock.removeEventListener('click', onLock);
      cancel.removeEventListener('click', onCancel);
      exportButton.removeEventListener('click', onExport);
      root.replaceChildren();
    },
  };
}
