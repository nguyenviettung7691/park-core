import { vi } from './messages';
import type { ControllerCalibration, EnvironmentId, MessageKey, VehicleId } from './contracts';
import type { ScreenAction, ScreenContext, ShellView } from './runtime-types';
import { createPreview, PreviewStartError, type Preview } from './render/preview';
import { AssetLoadError, loadSceneAssets } from './world/assets';
import type { AssetLoadProgress, SceneAssets } from './runtime-types';
import { mountHud } from './ui/hud';
import { mountCalibration, mountScreen, type InputSetup } from './ui/screens';

export interface AppDeps {
  createPreview: typeof createPreview;
  loadSceneAssets: typeof loadSceneAssets;
  getGamepads: () => readonly (Gamepad | null)[];
}

export function createApp(root: HTMLElement, overrides: Partial<AppDeps> = {}): { dispose(): void } {
  const deps: AppDeps = {
    createPreview,
    loadSceneAssets,
    getGamepads: () => typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [],
    ...overrides,
  };
  let context: ScreenContext = {
    progress: { version: 1, completedStages: [], lastVehicle: 'sedan' },
    settings: {
      version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
      cameraMode: 'driver', overhead: false, trajectory: false,
      inputSource: 'keyboard', resolutionScale: 1,
    },
    selectedStageId: 1, selectedVehicleId: 'sedan',
  };
  let view: ShellView = { state: { kind: 'menu' }, preview: 'closed' };
  let preview: Preview | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let gamepadIndex: number | null = null;
  let devices: readonly Gamepad[] = [];
  const calibrations = new Map<string, ControllerCalibration>();
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
    return {
      source: context.settings.inputSource, index: gamepadIndex, devices,
      ready: context.settings.inputSource === 'keyboard' ||
        (pad !== undefined && verified.get(pad.index) === pad.id && calibrations.has(pad.id)),
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
        status.textContent = '';
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
    const loading = assetLoadController;
    assetLoadController = null;
    loading?.abort();
    const current = preview;
    preview = null;
    current?.dispose();
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
      view = { ...view, preview: 'running', pauseReason: null };
      clearStatus();
      hud.setDriveControls(context.settings.inputSource === 'gamepad');
      drawScreen();
    });
  }
  function startPreview(
    assets: SceneAssets, token: number, environmentId: EnvironmentId, vehicleId: VehicleId,
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
    view = { state: { kind: 'menu' }, preview: 'paused', pauseReason: null };
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
          view = { ...view, preview: 'paused', pauseReason: reason };
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
      });
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
  function openPreview() {
    if (!ready()) return;
    closePreview();
    const token = generation;
    const controller = new AbortController();
    assetLoadController = controller;
    const environmentId: EnvironmentId = 'garage';
    const vehicleId = context.selectedVehicleId;
    view = {
      state: { kind: 'loading', stageId: context.selectedStageId },
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
        startPreview(assets, token, environmentId, vehicleId);
      },
      (error: unknown) => failAssetLoad(error, token, controller.signal),
    );
  }
  function onAction(action: ScreenAction) {
    if (disposed) return;
    switch (action.type) {
      case 'select-vehicle':
        context = { ...context, selectedVehicleId: action.vehicleId };
        break;
      case 'open-preview':
      case 'reset-preview':
      case 'retry':
        openPreview();
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
        context = { ...context, settings: { ...context.settings, inputSource: action.source } };
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
        preview?.updateSettings(action.settings);
        hud.updateSettings(action.settings);
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
        throw new Error(`Action not implemented in the prototype: ${action.type}`);
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
