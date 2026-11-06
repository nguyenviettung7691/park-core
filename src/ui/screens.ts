import type {
  AppState, AttemptSummary, CompletedAttemptRecord, FailureReason, InputSource,
} from '../contracts';
import { vi } from '../messages';
import type {
  AttemptHistoryStatus, PersistenceRecord, ScreenAction, ScreenContext, ShellView,
} from '../runtime-types';
import { scenarios } from '../lessons/scenarios';
import { createParkingIllustration } from './illustrations';
import { mountViewSettings } from './view-settings';
import type { ControllerProfile, ControllerProfileId } from '../input/profiles';
export { mountCalibration } from './calibration';

export interface InputSetup {
  readonly source: InputSource;
  readonly index: number | null;
  readonly devices: readonly { readonly index: number; readonly id: string }[];
  readonly ready: boolean;
  readonly savedCalibrationAvailable: boolean;
  readonly profiles: readonly ControllerProfile[];
  readonly matchedProfileId: ControllerProfileId | null;
}

const FAILURE_MESSAGES: Readonly<Record<FailureReason, keyof typeof vi>> = {
  collision: 'failureCollision',
  'curb-contact': 'failureCurbContact',
  'out-of-bounds': 'failureOutOfBounds',
  tipped: 'failureTipped',
  'speed-envelope': 'failureSpeedEnvelope',
};
const PRACTICE_MESSAGES: Readonly<Record<FailureReason, keyof typeof vi>> = {
  collision: 'practiceCollision',
  'curb-contact': 'practiceCurbContact',
  'out-of-bounds': 'practiceOutOfBounds',
  tipped: 'practiceTipped',
  'speed-envelope': 'practiceSpeedEnvelope',
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
  screen.dataset.screen = state.kind;
  if (preview === 'paused') screen.classList.add('preview-paused');
  const listeners = new AbortController();
  let unmountSettings: (() => void) | undefined;

  function text(tag: 'h1' | 'h2' | 'p', value: string, parent: HTMLElement = screen) {
    const element = document.createElement(tag);
    element.textContent = value;
    parent.append(element);
    return element;
  }

  function button(label: string, handler: () => void, parent: HTMLElement = screen) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = label;
    element.addEventListener('click', handler, { signal: listeners.signal });
    parent.append(element);
    return element;
  }

  function persistenceNotices() {
    if (context.onboarding.status !== 'persistent') {
      text('p', `${vi.tutorialRecord}: ${context.onboarding.status === 'reset-required'
        ? vi.unreadableRecord : vi.sessionOnlyRecord}`).setAttribute('role',
        context.onboarding.status === 'reset-required' ? 'alert' : 'status');
    }
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
    const outcome = text('p', summary.outcome === 'success' ? vi.recapSuccess
      : summary.failureReason ? vi[FAILURE_MESSAGES[summary.failureReason]] : vi.outcomeFail);
    outcome.dataset.recapOutcome = summary.outcome;
    outcome.className = 'lead';
    if (summary.failureReason) {
      const tip = document.createElement('aside');
      tip.dataset.practiceTip = '';
      tip.className = 'practice-tip';
      text('h2', vi.practiceLabel, tip);
      text('p', vi[PRACTICE_MESSAGES[summary.failureReason]], tip);
      screen.append(tip);
    }
    const details = document.createElement('details');
    const heading = document.createElement('summary');
    heading.textContent = vi.metricDetails;
    const list = document.createElement('dl');
    for (const [label, value] of summaryRows(summary)) {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      list.append(term, description);
    }
    details.append(heading, list);
    screen.append(details);
  }

  function historyResetControls(resetRequested: boolean) {
    if (resetRequested) {
      button(vi.confirmHistoryReset, () => onAction({ type: 'confirm-history-reset' }));
      button(vi.cancelHistoryReset, () => onAction({ type: 'cancel-history-reset' }));
    } else {
      button(vi.historyReset, () => onAction({ type: 'request-history-reset' }));
    }
  }

  function inputControls(parent: HTMLElement = screen) {
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
      parent.append(label, node);
    }
    select('input-source', vi.inputSource, [['keyboard', vi.keyboard], ['gamepad', vi.gamepad]],
      input.source, (source) => {
        if (source !== 'keyboard' && source !== 'gamepad') throw new RangeError('Invalid input source');
        onAction({ type: 'select-input', source, gamepadIndex: input.index });
      });
    if (input.source === 'gamepad') {
      text('p', vi.deviceHelp, parent);
      select('input-device', vi.device,
        [['', vi.controllerDisconnected], ...input.devices.map((device) =>
          [String(device.index), device.id] as const)], input.index === null ? '' : String(input.index),
        (value) => onAction({
          type: 'select-input', source: 'gamepad', gamepadIndex: value === '' ? null : Number(value),
        }));
      const matchStatus = text('p',
        input.matchedProfileId ? vi.profileMatchSuggested : vi.profileMatchNone, parent);
      matchStatus.dataset.profileMatchStatus = '';
      matchStatus.id = 'profile-match-status';
      const choices = document.createElement('div');
      choices.className = 'controller-profile-list';
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', vi.controllerProfiles);
      for (const profile of input.profiles) {
        const choice = button(profile.name, () => onAction({
          type: 'open-profile-verification', profileId: profile.id,
        }), choices);
        choice.dataset.controllerProfile = profile.id;
        choice.setAttribute('aria-describedby', matchStatus.id);
        if (profile.id === input.matchedProfileId) choice.dataset.suggested = 'true';
        choice.disabled = input.index === null;
      }
      parent.append(choices);
      button(vi.discoverDevices, () => onAction({
        type: 'select-input', source: 'gamepad', gamepadIndex: input.index,
      }), parent);
      if (input.savedCalibrationAvailable) {
        text('p', vi.savedCalibrationHelp, parent);
        const verify = button(vi.verifySavedCalibration, () =>
          onAction({ type: 'verify-saved-calibration' }), parent);
        verify.id = 'verify-saved-calibration';
      }
      if (!input.ready) text('p', vi.controllerNeedsSetup, parent);
      const setup = button(vi.calibrate, () => onAction({ type: 'open-calibration' }), parent);
      setup.id = 'calibrate-device';
      setup.disabled = input.index === null;
    }
  }

  if (view?.overlay) {
    const overlay = view.overlay;
    screen.dataset.screen = overlay.kind;
    screen.setAttribute('role', 'dialog');
    screen.setAttribute('aria-modal', 'true');
    screen.setAttribute('aria-label', overlay.kind === 'help' ? vi.help : vi.settingsTitle);
    text('h1', overlay.kind === 'help' ? vi.help : vi.settingsTitle);
    if (overlay.kind === 'help') {
      text('p', vi.controlsHelp);
      text('p', vi.sensorGuidance);
      text('p', vi.menuNotice);
      button(vi.replayTutorial, () => onAction({ type: 'replay-tutorial' }));
      if (context.onboarding.status !== 'persistent') {
        text('p', `${vi.tutorialRecord}: ${context.onboarding.status === 'reset-required'
          ? vi.unreadableRecord : vi.sessionOnlyRecord}`).setAttribute('role', 'status');
      }
      if (context.onboardingResetRequested) {
        button(vi.tutorialRecordConfirm, () => onAction({ type: 'confirm-onboarding-reset' }));
        button(vi.cancel, () => onAction({ type: 'cancel-onboarding-reset' }));
      } else button(vi.tutorialRecordReset, () => onAction({ type: 'request-onboarding-reset' }));
    } else if (overlay.kind === 'settings') {
      const tabs = document.createElement('nav');
      tabs.className = 'action-row';
      for (const [tab, label] of [['view', vi.viewTab], ['audio', vi.audioTab], ['input', vi.inputTab]] as const) {
        const choice = button(label, () => onAction({ type: 'open-settings', tab }), tabs);
        choice.setAttribute('aria-pressed', String(overlay.tab === tab));
      }
      screen.append(tabs);
      if (overlay.tab === 'input') inputControls();
      else unmountSettings = mountViewSettings(screen, context.settings, overlay.tab, onAction);
      persistenceNotices();
    }
    button(vi.tutorialBack, () => onAction({ type: 'close-overlay' }));
    screen.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        onAction({ type: 'close-overlay' });
      } else if (event.key === 'Tab') {
        const focusable = [...screen.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary',
        )];
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    }, { signal: listeners.signal });
  } else if (state.kind === 'loading') {
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
    button(vi.closePreview, () => onAction({ type: 'menu' })).className = 'primary-action';
  } else if (state.kind === 'briefing') {
    screen.classList.add('briefing');
    const scenario = scenarios[state.stageId];
    text('h1', vi[scenario.titleKey]);
    screen.append(createParkingIllustration(state.stageId));
    text('p', vi[`goal${state.stageId}`]).className = 'lead';
    text('p', context.selectedVehicleId === 'sedan' ? vi.sedan : vi.cuv);
    text('p', vi.briefingNotice).setAttribute('role', 'status');
    text('h2', vi.briefingStep);
    const firstStep = scenario.steps[0];
    if (firstStep) text('p', vi[firstStep.instructionKey]);
    button(vi.startDriving, () => onAction({ type: 'start-driving' })).className = 'primary-action';
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
    const list = document.createElement('ol');
    list.className = 'history-list';
    if (state.records.length === 0) text('p', vi.historyEmpty);
    let visible = 0;
    function appendRecords() {
      if (state.kind !== 'history-list') return;
      for (const record of state.records.slice(visible, visible + 20)) {
        const row = document.createElement('li');
        const item = button('', () => onAction({ type: 'select-attempt', id: record.id }), row);
        item.dataset.attemptId = record.id;
        item.dataset.outcome = record.summary.outcome;
        item.setAttribute('aria-label', recordLabel(record));
        const date = document.createElement('time');
        date.dateTime = record.completedAt;
        date.textContent = new Intl.DateTimeFormat('vi-VN', {
          dateStyle: 'short', timeStyle: 'short',
        }).format(new Date(record.completedAt));
        const lesson = document.createElement('strong');
        lesson.textContent = vi[`stage${record.summary.stageId}`];
        const metadata = document.createElement('span');
        metadata.textContent = `${vi[record.summary.vehicleId]} — ${record.summary.outcome === 'success'
          ? vi.outcomeSuccess : vi.outcomeFail}`;
        item.append(date, lesson, metadata);
        list.append(row);
      }
      visible = Math.min(visible + 20, state.records.length);
    }
    appendRecords();
    screen.append(list);
    const count = text('p', `${vi.historyCount}: ${visible} / ${state.records.length}`);
    count.setAttribute('role', 'status');
    const more = button(vi.showMoreHistory, () => {
      const firstNew = visible;
      appendRecords();
      count.textContent = `${vi.historyCount}: ${visible} / ${state.records.length}`;
      more.hidden = visible >= state.records.length;
      list.children.item(firstNew)?.querySelector('button')?.focus();
    });
    more.hidden = visible >= state.records.length;
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
    screen.classList.add('recap');
    text('h1', state.kind === 'success' ? vi.successTitle : vi.failTitle);
    text('p', `${vi[`stage${state.summary.stageId}`]} · ${vi[state.summary.vehicleId]}`).className = 'eyebrow';
    if (state.kind === 'success') screen.append(createParkingIllustration(state.summary.stageId));
    const result = text('p', state.historyStatus === 'saving'
      ? vi.historyLoading : historyStatusText(state.historyStatus));
    result.setAttribute('role', 'status');
    renderSummary(state.summary);
    if (state.kind === 'success') {
      button(vi.continue, () => onAction({ type: 'continue' })).className = 'primary-action';
      button(vi.retryLesson, () => onAction({ type: 'retry' }));
    } else button(vi.retryLesson, () => onAction({ type: 'retry' })).className = 'primary-action';
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'paused') {
    text('h1', vi.pausedNotice);
    button(vi.resumePreview, () => onAction({ type: 'resume' }));
    button(vi.settingsTitle, () => onAction({ type: 'open-settings', tab: 'view' }));
    button(vi.help, () => onAction({ type: 'open-help' }));
    inputControls();
    text('p', vi.controlsHelp);
    button(vi.retryLesson, () => onAction({ type: 'retry' }));
    button(vi.closePreview, () => onAction({ type: 'menu' }));
  } else if (state.kind === 'playing') {
    const step = scenarios[state.lesson.stageId].steps[state.lesson.stepIndex];
    const instruction = step?.instructionKey;
    if (instruction) {
      const status = text('p', vi[instruction]);
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
    }
    if (step?.required.some((checkpoint) => checkpoint.kind === 'acknowledgement')
      && !state.lesson.acknowledgedStepIds.includes(step.id)) {
      text('p', vi.acknowledgeHint);
    }
  } else if (state.kind === 'error') {
    text('h1', vi.appTitle);
    text('p', vi[state.messageKey]).setAttribute('role', 'alert');
    if (state.retryable) {
      if (state.messageKey === 'webglContextLost') {
        button(vi.reload, () => window.location.reload()).className = 'primary-action';
      } else button(vi.retry, () => onAction({ type: 'retry' })).className = 'primary-action';
    }
    const back = button(vi.closePreview, () => onAction({ type: 'menu' }));
    if (!state.retryable) back.className = 'primary-action';
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
    if (preview === 'paused') {
      button(vi.settingsTitle, () => onAction({ type: 'open-settings', tab: 'view' }));
      button(vi.help, () => onAction({ type: 'open-help' }));
      button(vi.resetPreview, () => onAction({ type: 'reset-preview' }));
      button(vi.closePreview, () => onAction({ type: 'menu' }));
    }
  } else if (state.kind === 'menu') {
    screen.classList.add('lesson-hub');
    let selectedStageId = context.selectedStageId;
    let selectedVehicleId = context.selectedVehicleId;
    const brand = document.createElement('header');
    brand.className = 'brand-lockup';
    const mark = document.createElement('img');
    mark.className = 'brand-mark';
    mark.src = '/park-core-mark.svg';
    mark.alt = '';
    mark.setAttribute('aria-hidden', 'true');
    brand.append(mark);
    text('h1', vi.appTitle, brand);
    screen.append(brand);
    text('p', vi.menuTitle);
    const hero = document.createElement('section');
    hero.className = 'lesson-hero';
    const art = document.createElement('figure');
    art.className = 'lesson-art';
    art.append(createParkingIllustration(context.selectedStageId));
    const card = document.createElement('div');
    card.className = 'intro-copy';
    text('p', vi.yourNextLesson, card).className = 'eyebrow';
    text('h2', vi[`stage${context.selectedStageId}`], card);
    text('p', vi[`goal${context.selectedStageId}`], card);
    hero.append(art, card);
    screen.append(hero);
    const setup = document.createElement('section');
    setup.className = 'setup-panel';
    setup.setAttribute('aria-label', vi.setupLabel);
    text('h2', vi.setupLabel, setup);
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
    setup.append(label, select);
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
    text('h2', vi.curriculum);
    screen.append(stages, setup);
    persistenceNotices();
    inputControls(setup);
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = vi.fullControls;
    details.append(summary);
    text('p', vi.controlsHelp, details);
    setup.append(details);
    const start = button(vi.startStage, () => onAction({
      type: 'start', stageId: selectedStageId, vehicleId: selectedVehicleId,
    }));
    start.id = 'start-stage';
    start.className = 'primary-action';
    card.append(start);
    start.disabled = !context.unlockedStageIds.includes(selectedStageId) ||
      (input ? !input.ready : false);
    const freeDrive = button(vi.freeDrive, () => onAction({ type: 'free-drive' }));
    freeDrive.disabled = input ? !input.ready : false;
    button(vi.openHistory, () => onAction({ type: 'open-history' }));
    button(vi.help, () => onAction({ type: 'open-help' }));
    button(vi.settingsTitle, () => onAction({ type: 'open-settings', tab: 'view' }));
    text('p', vi.sandboxLabel).className = 'safety-note';
    text('p', vi.menuNotice).className = 'safety-note';
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
    unmountSettings?.();
    listeners.abort();
    screen.remove();
  };
}
