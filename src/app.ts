import { vi } from './messages';
import type {
  AttemptSummary, ControllerCalibration, EnvironmentId, LessonRuntime, MessageKey, StageId,
  VehicleId,
} from './contracts';
import type { ScreenAction, ScreenContext, ShellView } from './runtime-types';
import type {
  AttemptHistorySnapshot, AttemptHistoryStatus, AttemptHistoryStore, PersistenceRecord,
  PersistenceResult,
} from './runtime-types';
import {
  createPreview, PreviewStartError, type Preview, type PreviewSessionMode,
} from './render/preview';
import { AssetLoadError, loadSceneAssets } from './world/assets';
import type { AssetLoadProgress, SceneAssets } from './runtime-types';
import { mountHud } from './ui/hud';
import { mountCalibration, mountScreen, type InputSetup } from './ui/screens';
import { createPersistence, unlockedStages, type PersistenceStore } from './storage/persistence';
import { createAttemptHistoryStore } from './storage/attempt-history';
import { scenarios } from './lessons/scenarios';

export interface AppDeps {
  createPreview: typeof createPreview;
  loadSceneAssets: typeof loadSceneAssets;
  createPersistence: () => PersistenceStore;
  createAttemptHistoryStore: () => AttemptHistoryStore;
  getGamepads: () => readonly (Gamepad | null)[];
}

export interface AppHandle {
  dispose(): void;
  recordConfirmedStageSuccess(stageId: StageId): PersistenceResult;
}

export function createApp(root: HTMLElement, overrides: Partial<AppDeps> = {}): AppHandle {
  const deps: AppDeps = {
    createPreview,
    loadSceneAssets,
    createPersistence: () => createPersistence(() =>
      typeof localStorage === 'undefined' ? null : localStorage),
    createAttemptHistoryStore: () => createAttemptHistoryStore(
      typeof indexedDB === 'undefined' ? null : indexedDB,
    ),
    getGamepads: () => typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [],
    ...overrides,
  };
  const persistence = deps.createPersistence();
  const attemptHistory = deps.createAttemptHistoryStore();
  const initial = persistence.snapshot();
  let context: ScreenContext = {
    progress: initial.progress,
    settings: initial.settings,
    selectedStageId: 1,
    selectedVehicleId: initial.progress.lastVehicle,
    unlockedStageIds: unlockedStages(initial.progress),
    recordStatus: initial.recordStatus,
    resetRequested: null,
  };
  let view: ShellView = { state: { kind: 'menu' }, preview: 'closed' };
  let preview: Preview | null = null;
  let retainedAssets: SceneAssets | null = null;
  let currentLesson: LessonRuntime | null = null;
  let activeLessonStageId: StageId | null = null;
  let activeLessonVehicleId: VehicleId | null = null;
  let historySnapshot: AttemptHistorySnapshot | null = null;
  let historyRequest = 0;
  let canvas: HTMLCanvasElement | null = null;
  let gamepadIndex: number | null = null;
  let devices: readonly Gamepad[] = [];
  const calibrations = new Map<string, ControllerCalibration>(
    initial.calibrations.map((value) => [value.deviceId, value]),
  );
  const verified = new Map<number, string>();
  const listeners = new AbortController();
  let generation = 0;
  let resumeAttempt = 0;
  let resumePending = false;
  let assetLoadController: AbortController | null = null;
  let disposed = false;
  let unmountScreen: (() => void) | undefined;
  const hud = mountHud(root, onAction);
  const layer = document.createElement('div');
  layer.id = 'screen-layer';
  root.append(layer);
  const status = root.querySelector<HTMLElement>('#status-message')!;
  let audioUnavailable = false;

  function notice(key: MessageKey) {
    if (key === 'audioUnavailable') audioUnavailable = true;
    status.textContent = vi[key];
  }
  function clearStatus() {
    status.textContent = audioUnavailable ? vi.audioUnavailable : '';
  }
  function recordLabel(record: PersistenceRecord) {
    return record === 'progress' ? vi.progressRecord
      : record === 'settings' ? vi.settingsRecord : vi.calibrationRecord;
  }
  function reportPersistence(result: PersistenceResult) {
    if (result.status === 'persistent') return;
    status.textContent = `${recordLabel(result.record)}: ${
      result.status === 'session-only' ? vi.sessionOnlyNotice : vi.resetRequiredNotice
    }`;
  }
  function refreshPersistence() {
    const saved = persistence.snapshot();
    const unlockedStageIds = unlockedStages(saved.progress);
    const selectedStageId = unlockedStageIds.includes(context.selectedStageId) ? context.selectedStageId : 1;
    context = {
      ...context,
      progress: saved.progress,
      settings: saved.settings,
      selectedStageId,
      selectedVehicleId: saved.progress.lastVehicle,
      unlockedStageIds,
      recordStatus: saved.recordStatus,
    };
    calibrations.clear();
    for (const calibration of saved.calibrations) {
      calibrations.set(calibration.deviceId, calibration);
    }
  }
  function readDevices() {
    try {
      devices = deps.getGamepads().filter((pad): pad is Gamepad => pad !== null && pad.connected);
      for (const [index, id] of verified) {
        if (!devices.some((pad) => pad.index === index && pad.id === id)) verified.delete(index);
      }
      return true;
    } catch {
      devices = [];
      verified.clear();
      notice('controllerUnavailable');
      return false;
    }
  }
  function inputSetup(): InputSetup {
    const pad = devices.find((candidate) => candidate.index === gamepadIndex);
    const calibration = pad ? calibrations.get(pad.id) : undefined;
    const verifiedCalibration = pad !== undefined && verified.get(pad.index) === pad.id;
    return {
      source: context.settings.inputSource, index: gamepadIndex, devices,
      ready: context.settings.inputSource === 'keyboard' ||
        (pad !== undefined && verifiedCalibration && calibration !== undefined),
      savedCalibrationAvailable: calibration !== undefined && !verifiedCalibration,
    };
  }
  function drawScreen() {
    hud.setSession(view.calibrating ? 'closed' : view.preview);
    unmountScreen?.();
    if (view.calibrating && gamepadIndex !== null) {
      const index = gamepadIndex;
      unmountScreen = mountCalibration(layer, index, deps.getGamepads, (value) => {
        calibrations.set(value.deviceId, value);
        verified.set(index, value.deviceId);
        const result = persistence.saveCalibrations([...calibrations.values()]);
        refreshPersistence();
        reportPersistence(result);
        readDevices();
        preview?.setCalibration(value);
        preview?.selectSource('gamepad', index);
        view = { ...view, calibrating: false };
        drawScreen();
      }, () => {
        view = { ...view, calibrating: false };
        drawScreen();
        layer.querySelector<HTMLButtonElement>('#calibrate-device')?.focus();
      });
    } else {
      unmountScreen = mountScreen(layer, view.state, context, onAction, view, inputSetup());
    }
  }
  function closePreview() {
    resumeAttempt++;
    resumePending = false;
    generation++;
    historyRequest++;
    const loading = assetLoadController;
    assetLoadController = null;
    loading?.abort();
    const current = preview;
    preview = null;
    current?.dispose();
    retainedAssets?.dispose();
    retainedAssets = null;
    currentLesson = null;
    canvas?.remove();
    canvas = null;
    hud.update(null, context.settings.inputSource);
    hud.updateSensors(null);
    audioUnavailable = false;
  }
  function showError(messageKey: MessageKey, retryable: boolean) {
    closePreview();
    view = { state: { kind: 'error', messageKey, retryable }, preview: 'closed' };
    notice(messageKey);
    drawScreen();
  }
  function ready() {
    if (context.settings.inputSource === 'gamepad' && !readDevices()) {
      drawScreen();
      return false;
    }
    if (inputSetup().ready) return true;
    notice('controllerNeedsSetup');
    drawScreen();
    return false;
  }
  function resumePreview() {
    const current = preview;
    const token = generation;
    if (!current || resumePending || !ready() || view.pauseReason === 'contact') return;
    canvas?.focus();
    current.unlockAudio();
    resumePending = true;
    const attempt = ++resumeAttempt;
    void current.requestPointerLock().then((locked) => {
      if (disposed || token !== generation || attempt !== resumeAttempt || current !== preview) return;
      resumePending = false;
      if (!locked) {
        view = { ...view, preview: 'paused' };
        drawScreen();
        notice('pointerLockDenied');
        return;
      }
      if (!current.resume()) {
        view = { ...view, preview: 'paused' };
        drawScreen();
        return;
      }
      view = {
        ...view,
        state: view.state.kind === 'paused' && currentLesson
          ? { kind: 'playing', lesson: currentLesson }
          : view.state,
        preview: 'running',
        pauseReason: null,
      };
      clearStatus();
      hud.setDriveControls(context.settings.inputSource === 'gamepad');
      drawScreen();
    });
  }
  function startPreview(
    assets: SceneAssets, token: number, environmentId: EnvironmentId, vehicleId: VehicleId,
    mode: PreviewSessionMode,
  ) {
    if (disposed || token !== generation) {
      assets.dispose();
      return;
    }
    canvas = document.createElement('canvas');
    canvas.id = 'simulation';
    canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', vi.previewBadge);
    root.prepend(canvas);
    currentLesson = mode.kind === 'lesson' ? {
      stageId: mode.scenario.stageId,
      stepIndex: 0,
      stepDwellS: 0,
      parkingDwellS: 0,
      acknowledgedStepIds: [],
    } : null;
    let attemptRecorded = false;
    view = {
      state: currentLesson
        ? { kind: 'paused', lesson: currentLesson, reason: 'focus' }
        : { kind: 'menu' },
      preview: 'paused',
      pauseReason: null,
    };
    audioUnavailable = false;
    status.textContent = '';
    drawScreen();
    const pad = devices.find((candidate) => candidate.index === gamepadIndex);
    try {
      const opened = deps.createPreview(canvas, root, {
        onPaused(reason) {
          if (disposed || token !== generation) return;
          resumeAttempt++;
          resumePending = false;
          if (currentLesson && mode.kind === 'lesson') {
            view = {
              ...view,
              state: {
                kind: 'paused',
                lesson: currentLesson,
                reason: reason === 'contact' ? 'user' : reason,
              },
              preview: 'paused',
              pauseReason: reason,
            };
          } else {
            view = { ...view, preview: 'paused', pauseReason: reason };
          }
          hud.update(null, context.settings.inputSource);
          notice(reason === 'contact' ? 'contactStop' : 'pausedNotice');
          const focused = document.activeElement;
          drawScreen();
          if (focused instanceof HTMLElement && focused.closest('#session-controls') &&
              focused.isConnected && !focused.hidden) focused.focus();
        },
        onFault(kind) {
          if (disposed || token !== generation) return;
          showError(kind === 'context-lost' ? 'webglContextLost' : 'runtimeError', true);
        },
        onTelemetry(value) {
          if (!disposed && token === generation && view.preview === 'running') {
            hud.update(value, context.settings.inputSource);
          }
        },
        onSensors(value) {
          if (!disposed && token === generation) hud.updateSensors(value);
        },
        onLessonUpdate(runtime) {
          if (disposed || token !== generation || mode.kind !== 'lesson') return;
          currentLesson = runtime;
          view = { ...view, state: { kind: 'playing', lesson: runtime } };
          drawScreen();
        },
        onAttemptOutcome(summary) {
          if (disposed || token !== generation || mode.kind !== 'lesson' || attemptRecorded) return;
          attemptRecorded = true;
          if (summary.outcome === 'success') {
            reportPersistence(persistence.recordConfirmedStageSuccess(summary.stageId));
            refreshPersistence();
            view = {
              ...view,
              state: { kind: 'success', summary, historyStatus: 'saving' },
              preview: 'paused',
            };
          } else {
            view = {
              ...view,
              state: { kind: 'fail', summary, historyStatus: 'saving' },
              preview: 'paused',
            };
          }
          drawScreen();
          void attemptHistory.append(summary).then(({ status }) => {
            if (disposed || token !== generation) return;
            if (view.state.kind !== 'success' && view.state.kind !== 'fail') return;
            view = { ...view, state: { ...view.state, historyStatus: status } };
            drawScreen();
          }, () => {
            if (disposed || token !== generation) return;
            showError('runtimeError', false);
          });
        },
        onNotice(key) {
          if (disposed || token !== generation) return;
          if (key === 'controllerDisconnected' || key === 'controllerReplaced') {
            if (gamepadIndex !== null) verified.delete(gamepadIndex);
            if (view.preview !== 'running') drawScreen();
          }
          notice(key);
        },
      }, {
        environmentId, vehicleId,
        sceneAssets: assets, source: context.settings.inputSource,
        gamepadIndex, calibration: pad ? calibrations.get(pad.id) ?? null : null,
        getGamepads: deps.getGamepads, settings: context.settings,
      }, undefined, mode);
      if (disposed || token !== generation) opened.dispose();
      else { preview = opened; void resumePreview(); }
    } catch (error) {
      assets.dispose();
      if (disposed || token !== generation) return;
      const reason = error instanceof PreviewStartError ? error.reason : 'renderer-failed';
      showError(reason === 'webgl-unsupported' ? 'webglUnsupported' :
        reason === 'simulation-failed' ? 'physicsStartFailed' : 'rendererFailed',
      reason !== 'webgl-unsupported');
    }
  }
  function failAssetLoad(error: unknown, token: number, signal: AbortSignal) {
    if (disposed || token !== generation || signal.aborted) return;
    if (assetLoadController?.signal === signal) assetLoadController = null;
    const messageKey: MessageKey = error instanceof AssetLoadError
      ? error.resource === 'vehicle' ? 'vehicleAssetFailed' : 'environmentAssetFailed'
      : 'assetLoadFailed';
    showError(messageKey, true);
  }
  function openPreview(mode: 'lesson' | 'sandbox', stageId = context.selectedStageId) {
    if (!ready()) return;
    closePreview();
    const token = generation;
    const controller = new AbortController();
    assetLoadController = controller;
    const scenario = mode === 'lesson' ? scenarios[stageId] : null;
    const environmentId: EnvironmentId = scenario?.environmentId ?? 'garage';
    const vehicleId = context.selectedVehicleId;
    activeLessonStageId = mode === 'lesson' ? stageId : null;
    activeLessonVehicleId = mode === 'lesson' ? vehicleId : null;
    view = {
      state: { kind: 'loading', stageId, mode },
      preview: 'closed',
      assetLoadProgress: null,
    };
    audioUnavailable = false;
    status.textContent = '';
    drawScreen();
    const onProgress = (progress: AssetLoadProgress) => {
      if (disposed || token !== generation || controller.signal.aborted) return;
      view = { ...view, assetLoadProgress: progress };
      drawScreen();
    };
    let loading: Promise<SceneAssets>;
    try {
      loading = deps.loadSceneAssets(
        environmentId, vehicleId, controller.signal, onProgress,
      );
    } catch (error) {
      failAssetLoad(error, token, controller.signal);
      return;
    }
    void loading.then(
      (assets) => {
        if (disposed || token !== generation || controller.signal.aborted) {
          assets.dispose();
          return;
        }
        assetLoadController = null;
        if (mode === 'lesson' && scenario) {
          retainedAssets = assets;
          view = { state: { kind: 'briefing', stageId }, preview: 'closed' };
          drawScreen();
        } else {
          startPreview(assets, token, environmentId, vehicleId, { kind: 'sandbox' });
        }
      },
      (error: unknown) => failAssetLoad(error, token, controller.signal),
    );
  }
  function readHistory() {
    closePreview();
    const request = ++historyRequest;
    const token = generation;
    view = { state: { kind: 'history-loading' }, preview: 'closed' };
    drawScreen();
    void attemptHistory.list().then((snapshot) => {
      if (disposed || request !== historyRequest || token !== generation ||
          view.state.kind !== 'history-loading') return;
      historySnapshot = snapshot;
      view = {
        state: {
          kind: 'history-list',
          records: snapshot.records,
          status: snapshot.status === 'saving' ? 'session-only' : snapshot.status,
          resetRequested: false,
        },
        preview: 'closed',
      };
      drawScreen();
    }, () => {
      if (disposed || request !== historyRequest || token !== generation) return;
      showError('runtimeError', false);
    });
  }
  function confirmHistoryReset() {
    if (view.state.kind !== 'history-list' && view.state.kind !== 'history-detail') return;
    const request = ++historyRequest;
    const token = generation;
    void attemptHistory.reset().then(() => attemptHistory.list()).then((snapshot) => {
      if (disposed || request !== historyRequest || token !== generation) return;
      historySnapshot = snapshot;
      view = {
        state: {
          kind: 'history-list',
          records: snapshot.records,
          status: snapshot.status === 'saving' ? 'session-only' : snapshot.status,
          resetRequested: false,
        },
        preview: 'closed',
      };
      drawScreen();
    }, () => {
      if (disposed || request !== historyRequest || token !== generation) return;
      showError('runtimeError', false);
    });
  }
  function onAction(action: ScreenAction) {
    if (disposed) return;
    switch (action.type) {
      case 'select-vehicle':
        context = {
          ...context,
          selectedVehicleId: action.vehicleId,
          progress: { ...context.progress, lastVehicle: action.vehicleId },
        };
        reportPersistence(persistence.saveProgress(context.progress));
        refreshPersistence();
        break;
      case 'select-stage':
        if (!context.unlockedStageIds.includes(action.stageId)) return;
        context = { ...context, selectedStageId: action.stageId };
        drawScreen();
        break;
      case 'verify-saved-calibration': {
        if (view.preview === 'running' || view.calibrating || gamepadIndex === null) return;
        const pad = devices.find((candidate) => candidate.index === gamepadIndex);
        const calibration = pad ? calibrations.get(pad.id) : undefined;
        if (!pad || !calibration) return;
        verified.set(pad.index, pad.id);
        preview?.selectSource('gamepad', pad.index);
        preview?.setCalibration(calibration);
        status.textContent = vi.savedCalibrationHelp;
        drawScreen();
        break;
      }
      case 'start':
        if (!context.unlockedStageIds.includes(action.stageId)) return;
        context = {
          ...context, selectedStageId: action.stageId, selectedVehicleId: action.vehicleId,
        };
        openPreview('lesson', action.stageId);
        break;
      case 'start-driving': {
        if (view.state.kind !== 'briefing' || !retainedAssets ||
            activeLessonStageId === null || activeLessonVehicleId === null || !ready()) return;
        const assets = retainedAssets;
        retainedAssets = null;
        const scenario = scenarios[activeLessonStageId];
        startPreview(assets, generation, scenario.environmentId, activeLessonVehicleId, {
          kind: 'lesson',
          scenario,
        });
        break;
      }
      case 'free-drive':
        activeLessonStageId = null;
        activeLessonVehicleId = null;
        openPreview('sandbox');
        break;
      case 'open-history':
        readHistory();
        break;
      case 'select-attempt': {
        const snapshot = historySnapshot;
        const record = snapshot?.records.find((candidate) => candidate.id === action.id);
        if (!snapshot || !record || view.state.kind !== 'history-list') return;
        view = {
          state: {
            kind: 'history-detail',
            record,
            status: view.state.status,
            resetRequested: false,
          },
          preview: 'closed',
        };
        drawScreen();
        break;
      }
      case 'back-to-history':
        if (view.state.kind !== 'history-detail' || !historySnapshot) return;
        view = {
          state: {
            kind: 'history-list',
            records: historySnapshot.records,
            status: historySnapshot.status === 'saving' ? 'session-only' : historySnapshot.status,
            resetRequested: false,
          },
          preview: 'closed',
        };
        drawScreen();
        break;
      case 'request-history-reset':
        if (view.state.kind === 'history-list' || view.state.kind === 'history-detail') {
          view = {
            ...view,
            state: { ...view.state, resetRequested: true },
          };
          drawScreen();
        }
        break;
      case 'cancel-history-reset':
        if (view.state.kind === 'history-list' || view.state.kind === 'history-detail') {
          view = {
            ...view,
            state: { ...view.state, resetRequested: false },
          };
          drawScreen();
        }
        break;
      case 'confirm-history-reset':
        if ((view.state.kind === 'history-list' || view.state.kind === 'history-detail') &&
            view.state.resetRequested) confirmHistoryReset();
        break;
      case 'request-reset':
        if (context.recordStatus[action.record] !== 'reset-required') return;
        context = { ...context, resetRequested: action.record };
        drawScreen();
        break;
      case 'cancel-reset':
        context = { ...context, resetRequested: null };
        drawScreen();
        break;
      case 'confirm-reset':
        if (context.resetRequested !== action.record ||
            context.recordStatus[action.record] !== 'reset-required') return;
        context = { ...context, resetRequested: null };
        verified.clear();
        const reset = persistence.resetRecord(action.record);
        refreshPersistence();
        if (action.record === 'settings') {
          gamepadIndex = null;
          preview?.selectSource('keyboard');
          hud.updateSettings(context.settings);
        }
        reportPersistence(reset);
        drawScreen();
        break;
      case 'open-preview':
        openPreview('sandbox');
        break;
      case 'reset-preview':
      case 'retry':
        if (activeLessonStageId !== null) openPreview('lesson', activeLessonStageId);
        else openPreview('sandbox');
        break;
      case 'continue':
        closePreview();
        view = { state: { kind: 'menu' }, preview: 'closed' };
        drawScreen();
        break;
      case 'close-preview':
      case 'menu':
        closePreview();
        view = { state: { kind: 'menu' }, preview: 'closed' };
        status.textContent = '';
        drawScreen();
        break;
      case 'resume':
        resumePreview();
        break;
      case 'pause':
        preview?.pause();
        break;
      case 'input-action':
        preview?.enqueue(action.action);
        break;
      case 'select-input':
        if (view.preview === 'running' || view.calibrating) return;
        gamepadIndex = action.gamepadIndex;
        if (context.settings.inputSource !== action.source) {
          context = { ...context, settings: { ...context.settings, inputSource: action.source } };
          reportPersistence(persistence.saveSettings(context.settings));
          refreshPersistence();
        }
        hud.updateSettings(context.settings);
        if (action.source === 'gamepad') readDevices();
        preview?.selectSource(action.source, gamepadIndex ?? undefined);
        if (gamepadIndex !== null) {
          const id = devices.find((pad) => pad.index === gamepadIndex)?.id;
          const calibration = id && verified.get(gamepadIndex) === id ? calibrations.get(id) : undefined;
          if (calibration) preview?.setCalibration(calibration);
        }
        drawScreen();
        break;
      case 'update-settings':
        context = { ...context, settings: action.settings };
        reportPersistence(persistence.saveSettings(action.settings));
        refreshPersistence();
        preview?.updateSettings(context.settings);
        hud.updateSettings(context.settings);
        break;
      case 'recenter-view':
        preview?.recenterView();
        break;
      case 'open-calibration':
        if (view.preview === 'running' || gamepadIndex === null || view.pauseReason === 'contact') return;
        view = { ...view, calibrating: true };
        drawScreen();
        break;
      default:
        throw new Error('Unsupported app action');
    }
  }
  function onConnection(event: GamepadEvent) {
    verified.delete(event.gamepad.index);
    if (view.calibrating || context.settings.inputSource === 'keyboard') return;
    if (view.preview !== 'running') {
      readDevices();
      drawScreen();
    }
  }
  window.addEventListener('gamepaddisconnected', onConnection, { signal: listeners.signal });
  window.addEventListener('gamepadconnected', onConnection, { signal: listeners.signal });
  drawScreen();
  return {
    recordConfirmedStageSuccess(stageId) {
      if (disposed) throw new Error('Cannot record stage success after app disposal');
      const result = persistence.recordConfirmedStageSuccess(stageId);
      refreshPersistence();
      reportPersistence(result);
      if (view.state.kind === 'menu' && view.preview === 'closed') drawScreen();
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.abort();
      closePreview();
      unmountScreen?.();
      layer.remove();
      hud.dispose();
    },
  };
}
