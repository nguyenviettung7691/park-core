import { vi } from './messages';
import type { MessageKey } from './contracts';
import type { ScreenAction, ScreenContext, ShellView } from './runtime-types';
import { createPreview, PreviewStartError, type Preview } from './render/preview';
import { mountHud } from './ui/hud';
import { mountScreen } from './ui/screens';

export interface AppDeps {
  createPreview: typeof createPreview;
}

export function createApp(root: HTMLElement, overrides: Partial<AppDeps> = {}): { dispose(): void } {
  const deps: AppDeps = { createPreview, ...overrides };
  let context: ScreenContext = {
    progress: { version: 1, completedStages: [], lastVehicle: 'sedan' },
    settings: {
      version: 1, volume: 0.5, muted: false, driverFovDeg: 60,
      cameraMode: 'driver', overhead: false, trajectory: false,
      inputSource: 'keyboard', resolutionScale: 1,
    },
    selectedStageId: 1,
    selectedVehicleId: 'sedan',
  };
  let view: ShellView = { state: { kind: 'menu' }, preview: 'closed' };
  let preview: Preview | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let generation = 0;
  let disposed = false;
  let unmountScreen: (() => void) | undefined;
  const unmountHud = mountHud(root);
  const layer = document.createElement('div');
  layer.id = 'screen-layer';
  root.append(layer);
  const status = root.querySelector<HTMLElement>('#status-message')!;

  function drawScreen() {
    unmountScreen?.();
    unmountScreen = mountScreen(layer, view.state, context, onAction, view);
  }

  function closePreview() {
    generation++;
    const current = preview;
    preview = null;
    current?.dispose();
    canvas?.remove();
    canvas = null;
  }

  function showError(messageKey: MessageKey, retryable: boolean) {
    closePreview();
    view = { state: { kind: 'error', messageKey, retryable }, preview: 'closed' };
    status.textContent = vi[messageKey];
    drawScreen();
  }

  function openPreview() {
    closePreview();
    const token = generation;
    canvas = document.createElement('canvas');
    canvas.id = 'simulation';
    canvas.setAttribute('aria-label', vi.previewBadge);
    root.prepend(canvas);
    view = { state: { kind: 'menu' }, preview: 'running' };
    status.textContent = '';
    drawScreen();
    try {
      const opened = deps.createPreview(canvas, root, {
        onPaused() {
          if (disposed || token !== generation) return;
          view = { ...view, preview: 'paused' };
          status.textContent = vi.pausedNotice;
          drawScreen();
        },
        onFault(kind) {
          if (disposed || token !== generation) return;
          showError(kind === 'context-lost' ? 'webglContextLost' : 'runtimeError', true);
        },
      });
      if (disposed || token !== generation) opened.dispose();
      else preview = opened;
    } catch (error) {
      if (disposed || token !== generation) return;
      const unsupported = error instanceof PreviewStartError && error.reason === 'webgl-unsupported';
      showError(unsupported ? 'webglUnsupported' : 'rendererFailed', !unsupported);
    }
  }

  function onAction(action: ScreenAction) {
    if (disposed) return;
    switch (action.type) {
      case 'select-vehicle':
        context = { ...context, selectedVehicleId: action.vehicleId };
        break;
      case 'open-preview':
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
        preview?.resume();
        view = { ...view, preview: 'running' };
        status.textContent = '';
        drawScreen();
        break;
      default:
        throw new Error(`Action not implemented in Phase 2: ${action.type}`);
    }
  }

  drawScreen();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      closePreview();
      unmountScreen?.();
      layer.remove();
      unmountHud();
    },
  };
}
