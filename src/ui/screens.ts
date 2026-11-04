import type {
  AppState, AttemptSummary, CompletedAttemptRecord, FailureReason, InputSource,
} from '../contracts';
import { vi } from '../messages';
import type {
  AttemptHistoryStatus, PersistenceRecord, ScreenAction, ScreenContext, ShellView,
} from '../runtime-types';
import { scenarios } from '../lessons/scenarios';
export { mountCalibration } from './calibration';

export interface InputSetup {
  readonly source: InputSource;
  readonly index: number | null;
  readonly devices: readonly { readonly index: number; readonly id: string }[];
  readonly ready: boolean;
  readonly savedCalibrationAvailable: boolean;
}

const FAILURE_MESSAGES: Readonly<Record<FailureReason, keyof typeof vi>> = {
  collision: 'failureCollision',
  'curb-contact': 'failureCurbContact',
  'out-of-bounds': 'failureOutOfBounds',
  tipped: 'failureTipped',
  'speed-envelope': 'failureSpeedEnvelope',
};
const STEP_LABELS = new Map(
  Object.values(scenarios).flatMap(({ steps }) =>
    steps.map((step) => [step.id, vi[step.instructionKey]] as const)),
);
const OBSTACLE_MESSAGES: Readonly<Record<string, keyof typeof vi>> = {
  ground: 'obstacleGround',
  'roadside-curb-right': 'obstacleRoadsideCurb',
  'stage1-parked-left': 'obstacleStage1Left',
  'stage1-parked-right': 'obstacleStage1Right',
  'stage2-parked-left': 'obstacleStage2Left',
  'stage2-parked-right': 'obstacleStage2Right',
  'stage3-parked-rear': 'obstacleStage3Rear',
  'stage3-parked-front': 'obstacleStage3Front',
  'stage4-adjacent-vehicle': 'obstacleStage4Vehicle',
  'stage5-parked-rear': 'obstacleStage5Rear',
  'stage5-parked-front': 'obstacleStage5Front',
};

function historyStatusText(status: AttemptHistoryStatus): string {
  if (status === 'persistent') return vi.historyPersistent;
  if (status === 'reset-required') return vi.historyResetRequired;
  return vi.historySessionOnly;
}

function summaryRows(summary: AttemptSummary): readonly (readonly [string, string])[] {
  const clearances = summary.closestSampledClearanceM === null
    ? vi.noRecordedValue
    : `${summary.closestSampledClearanceM.toFixed(2)} m`;
  const steps = summary.acknowledgedStepIds.length
    ? summary.acknowledgedStepIds
      .map((id) => STEP_LABELS.get(id) ?? vi.historyUnknownStep).join('; ')
    : vi.noRecordedValue;
  const aids = summary.usedAids.length
    ? summary.usedAids.map((aid) => vi[aid === 'chase' ? 'aidChase'
      : aid === '360' ? 'aid360' : aid === 'trajectory' ? 'aidTrajectory' : 'aidHelp']).join(', ')
    : vi.noRecordedValue;
  const rows: (readonly [string, string])[] = [
    [vi.historyElapsed, `${summary.elapsedSimulationS.toFixed(1)} giây`],
    [vi.historyClosestClearance, clearances],
    [vi.historyPeakSpeed, `${(summary.peakSpeedMps * 3.6).toFixed(1)} km/h`],
    [vi.historyDirectionChanges, String(summary.directionChanges)],
    [vi.historyAcknowledged, steps],
    [vi.historyAids, aids],
  ];
  if (summary.failureReason) {
    rows.push([vi.historyFailure, vi[FAILURE_MESSAGES[summary.failureReason]]]);
  }
  if (summary.obstacleId) {
    const message = OBSTACLE_MESSAGES[summary.obstacleId] ?? 'historyObstacleGeneric';
    rows.push([vi.historyObstacle, vi[message]]);
  }
  return rows;
}

function recordLabel(record: CompletedAttemptRecord): string {
  const date = new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(record.completedAt));
  const vehicle = record.summary.vehicleId === 'sedan' ? vi.sedan : vi.cuv;
  const result = record.summary.outcome === 'success' ? vi.outcomeSuccess : vi.outcomeFail;
  return `${date} — ${vi[`stage${record.summary.stageId}`]} — ${vehicle} — ${result}`;
}

export function mountScreen(
  root: HTMLElement,
  state: AppState,
  context: ScreenContext,
  onAction: (action: ScreenAction) => void,
  view?: ShellView,
  input?: InputSetup,
): () => void {
  const screen = document.createElement('main');
  const preview = view?.preview ?? 'closed';
  screen.className = preview === 'running' ? 'preview-shell panel' : 'screen panel';
  if (preview === 'paused') screen.classList.add('preview-paused');
  const listeners = new AbortController();

  function text(tag: 'h1' | 'h2' | 'p', value: string) {
    const element = document.createElement(tag);
    element.textContent = value;
    screen.append(element);
    return element;
  }

  function button(label: string, handler: () => void) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', handler, { signal: listeners.signal });
    screen.append(element);
    return element;
  }

  function persistenceNotices() {
    const records: readonly PersistenceRecord[] = ['progress', 'settings', 'calibration'];
    for (const record of records) {
      const label = record === 'progress' ? vi.progressRecord
        : record === 'settings' ? vi.settingsRecord : vi.calibrationRecord;
      if (context.recordStatus[record] === 'session-only') {
        const notice = text('p', `${label}: ${vi.sessionOnlyRecord}`);
        notice.className = 'storage-notice';
        notice.setAttribute('role', 'status');
      } else if (context.recordStatus[record] === 'reset-required') {
        const notice = text('p', `${label}: ${vi.unreadableRecord}`);
        notice.className = 'storage-notice';
        notice.setAttribute('role', 'alert');
        if (context.resetRequested === record) {
          const confirm = button(vi.confirmResetRecord, () =>
            onAction({ type: 'confirm-reset', record }));
          confirm.dataset.confirmReset = record;
          button(vi.cancelReset, () => onAction({ type: 'cancel-reset' }));
        } else {
          const request = button(vi.requestResetRecord, () =>
            onAction({ type: 'request-reset', record }));
          request.dataset.resetRecord = record;
        }
      }
    }
  }

  function renderSummary(summary: AttemptSummary) {
    const list = document.createElement('dl');
    for (const [label, value] of summaryRows(summary)) {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      list.append(term, description);
    }
    screen.append(list);
  }

  function historyResetControls(resetRequested: boolean) {
    if (resetRequested) {
      button(vi.confirmHistoryReset, () => onAction({ type: 'confirm-history-reset' }));
      button(vi.cancelHistoryReset, () => onAction({ type: 'cancel-history-reset' }));
    } else {
      button(vi.historyReset, () => onAction({ type: 'request-history-reset' }));
    }
  }

  function inputControls() {
    if (!input) return;
    function select(
      name: string, labelText: string, options: readonly (readonly [string, string])[],
      value: string, onChange: (value: string) => void,
    ) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const node = document.createElement('select');
      node.id = name;
      label.htmlFor = name;
      for (const [key, text] of options) {
        const option = document.createElement('option');
        option.value = key; option.textContent = text;
        node.append(option);
      }
      node.value = value;
      node.addEventListener('change', () => onChange(node.value), { signal: listeners.signal });
      screen.append(label, node);
    }
    select('input-source', vi.inputSource, [['keyboard', vi.keyboard], ['gamepad', vi.gamepad]],
      input.source, (source) => {
        if (source !== 'keyboard' && source !== 'gamepad') throw new RangeError('Invalid input source');
        onAction({ type: 'select-input', source, gamepadIndex: input.index });
      });
    if (input.source === 'gamepad') {
      text('p', vi.deviceHelp);
      select('input-device', vi.device,
        [['', vi.controllerDisconnected], ...input.devices.map((device) =>
          [String(device.index), device.id] as const)], input.index === null ? '' : String(input.index),
        (value) => onAction({
          type: 'select-input', source: 'gamepad', gamepadIndex: value === '' ? null : Number(value),
        }));
      button(vi.discoverDevices, () => onAction({
        type: 'select-input', source: 'gamepad', gamepadIndex: input.index,
      }));
      if (input.savedCalibrationAvailable) {
        text('p', vi.savedCalibrationHelp);
        const verify = button(vi.verifySavedCalibration, () =>
          onAction({ type: 'verify-saved-calibration' }));
        verify.id = 'verify-saved-calibration';
      }
      if (!input.ready) text('p', vi.controllerNeedsSetup);
      const setup = button(vi.calibrate, () => onAction({ type: 'open-calibration' }));
      setup.id = 'calibrate-device';
      setup.disabled = input.index === null;
    }
  }

  if (state.kind === 'loading') {
    text('h1', vi.appTitle);
    const progressState = view?.assetLoadProgress ?? null;
    const status = text('p', progressState
      ? vi[progressState.resource === 'vehicle' ? 'loadingVehicle' : 'loadingEnvironment']
      : vi.loadingAssets);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const progress = document.createElement('progress');
    progress.setAttribute('aria-label', status.textContent ?? vi.loadingAssets);
    if (progressState?.totalBytes !== null && progressState?.totalBytes !== undefined) {
      progress.max = progressState.totalBytes;
      progress.value = Math.min(progressState.loadedBytes, progressState.totalBytes);
    }
    screen.append(progress);
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'briefing') {
    const scenario = scenarios[state.stageId];
    text('h1', vi[scenario.titleKey]);
    text('p', context.selectedVehicleId === 'sedan' ? vi.sedan : vi.cuv);
    text('p', vi.briefingNotice).setAttribute('role', 'status');
    text('h2', vi.briefingStep);
    const firstStep = scenario.steps[0];
    if (firstStep) text('p', vi[firstStep.instructionKey]);
    button(vi.startDriving, () => onAction({ type: 'start-driving' }));
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'history-loading') {
    text('h1', vi.openHistory);
    const status = text('p', vi.historyLoading);
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'history-list') {
    text('h1', vi.openHistory);
    const status = text('p', historyStatusText(state.status));
    status.setAttribute('role', state.status === 'reset-required' ? 'alert' : 'status');
    const list = document.createElement('div');
    list.className = 'history-list';
    if (state.records.length === 0) text('p', vi.historyEmpty);
    for (const record of state.records) {
      const item = button(recordLabel(record), () =>
        onAction({ type: 'select-attempt', id: record.id }));
      item.dataset.attemptId = record.id;
      list.append(item);
    }
    screen.append(list);
    historyResetControls(state.resetRequested);
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'history-detail') {
    text('h1', vi.openHistory);
    const status = text('p', historyStatusText(state.status));
    status.setAttribute('role', state.status === 'reset-required' ? 'alert' : 'status');
    text('h2', recordLabel(state.record));
    renderSummary(state.record.summary);
    button(vi.backToHistory, () => onAction({ type: 'back-to-history' }));
    historyResetControls(state.resetRequested);
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'success' || state.kind === 'fail') {
    text('h1', state.kind === 'success' ? vi.successTitle : vi.failTitle);
    const result = text('p', state.historyStatus === 'saving'
      ? vi.historyLoading : historyStatusText(state.historyStatus));
    result.setAttribute('role', 'status');
    renderSummary(state.summary);
    button(vi.retryLesson, () => onAction({ type: 'retry' }));
    button(vi.continue, () => onAction({ type: 'continue' }));
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'paused') {
    text('h1', vi.pausedNotice);
    button(vi.resumePreview, () => onAction({ type: 'resume' }));
    inputControls();
    text('p', vi.controlsHelp);
    button(vi.retryLesson, () => onAction({ type: 'retry' }));
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'playing') {
    const instruction = scenarios[state.lesson.stageId]
      .steps[state.lesson.stepIndex]?.instructionKey;
    if (instruction) {
      const status = text('p', vi[instruction]);
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
    }
  } else if (state.kind === 'error') {
    text('h1', vi.appTitle);
    text('p', vi[state.messageKey]).setAttribute('role', 'alert');
    if (state.retryable) {
      if (state.messageKey === 'webglContextLost') {
        button(vi.reload, () => window.location.reload());
      } else button(vi.retry, () => onAction({ type: 'retry' }));
    }
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'menu' && preview !== 'closed') {
    const controls = document.createElement('div');
    controls.className = 'preview-controls';
    const badge = text('h1', vi.previewBadge);
    if (preview === 'running') badge.className = 'preview-badge';
    text('p', context.selectedVehicleId === 'sedan' ? vi.sedan : vi.cuv);
    text('p', preview === 'paused' ? vi.pausedNotice : vi.previewNotice);
    if (preview === 'paused') {
      if (view?.pauseReason === 'contact') text('p', vi.contactStop);
      else {
        const resume = button(vi.resumePreview, () => onAction({ type: 'resume' }));
        controls.append(resume);
        resume.disabled = input ? !input.ready : false;
        inputControls();
        text('p', vi.controlsHelp);
      }
    }
    screen.append(controls);
  } else if (state.kind === 'menu') {
    let selectedStageId = context.selectedStageId;
    let selectedVehicleId = context.selectedVehicleId;
    text('h1', vi.appTitle);
    text('p', vi.menuTitle);
    text('p', vi.menuNotice);
    const label = document.createElement('label');
    label.htmlFor = 'vehicle';
    label.textContent = vi.vehicleLabel;
    const select = document.createElement('select');
    select.id = 'vehicle';
    for (const id of ['sedan', 'cuv'] as const) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = vi[id];
      select.append(option);
    }
    select.value = context.selectedVehicleId;
    select.addEventListener('change', () => {
      if (select.value !== 'sedan' && select.value !== 'cuv') {
        throw new RangeError('Invalid vehicle selection');
      }
      selectedVehicleId = select.value;
      onAction({ type: 'select-vehicle', vehicleId: select.value });
    }, { signal: listeners.signal });
    screen.append(label, select);
    const stages = document.createElement('div');
    stages.className = 'stage-list';
    stages.setAttribute('role', 'group');
    stages.setAttribute('aria-label', vi.stageListLabel);
    for (const stageId of [1, 2, 3, 4, 5] as const) {
      const choice = document.createElement('button');
      choice.type = 'button';
      choice.dataset.stageId = String(stageId);
      choice.setAttribute('aria-pressed', String(context.selectedStageId === stageId));
      const unlocked = context.unlockedStageIds.includes(stageId);
      choice.disabled = !unlocked;
      const progressLabel = context.progress.completedStages.includes(stageId)
        ? vi.completedStage : unlocked ? '' : vi.lockedStage;
      choice.textContent = `${vi[`stage${stageId}`]}${progressLabel ? ` — ${progressLabel}` : ''}`;
      choice.addEventListener('click', () => {
        selectedStageId = stageId;
        for (const stage of stages.querySelectorAll<HTMLButtonElement>('[data-stage-id]')) {
          stage.setAttribute('aria-pressed', String(Number(stage.dataset.stageId) === stageId));
        }
        onAction({ type: 'select-stage', stageId });
      }, { signal: listeners.signal });
      stages.append(choice);
    }
    screen.append(stages);
    persistenceNotices();
    inputControls();
    text('p', vi.controlsHelp);
    const start = button(vi.startStage, () => onAction({
      type: 'start', stageId: selectedStageId, vehicleId: selectedVehicleId,
    }));
    start.id = 'start-stage';
    start.disabled = !context.unlockedStageIds.includes(selectedStageId) ||
      (input ? !input.ready : false);
    const freeDrive = button(vi.freeDrive, () => onAction({ type: 'free-drive' }));
    freeDrive.disabled = input ? !input.ready : false;
    button(vi.openHistory, () => onAction({ type: 'open-history' }));
  }
  root.append(screen);
  if (preview !== 'running') {
    const target = context.resetRequested
      ? screen.querySelector<HTMLButtonElement>(`[data-confirm-reset="${context.resetRequested}"]`)
      : screen.querySelector<HTMLButtonElement>(
        `[data-stage-id="${context.selectedStageId}"]:not(:disabled)`,
      );
    (target ?? screen.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
  }
  return () => {
    listeners.abort();
    screen.remove();
  };
}
