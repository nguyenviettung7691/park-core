import { PerspectiveCamera, WebGLRenderer } from 'three';
import type { World } from 'cannon-es';
import type {
  ControllerCalibration, InputAction, InputSource, MessageKey, VehicleId, VehicleTelemetry,
} from '../contracts';
import type { PreviewPauseReason } from '../runtime-types';
import { createClock } from '../clock';
import { createInputController } from '../input/controller';
import { profiles } from '../vehicle/profiles';
import { createVehicleRig, SimulationStateError } from '../vehicle/rig';
import { addColliderBoxes, createWorld, prototypeSpawn, prototypeYard } from '../world/colliders';
import { buildPrototypeScene } from './prototype';
import { fitDrawingBuffer } from './fit';

export type PreviewRenderer = Pick<WebGLRenderer, 'render' | 'setSize' | 'dispose' | 'forceContextLoss'>;
export interface PreviewContext {
  getExtension(name: 'WEBGL_lose_context'): WEBGL_lose_context | null;
}
export interface PreviewDeps {
  now(): number;
  requestFrame(cb: (time: number) => void): number;
  cancelFrame(id: number): void;
  createRenderer(canvas: HTMLCanvasElement): PreviewRenderer;
  createContext(canvas: HTMLCanvasElement): PreviewContext | null;
  createWorld(): World;
}
export interface PrototypeOptions {
  readonly vehicleId: VehicleId;
  readonly source: InputSource;
  readonly gamepadIndex: number | null;
  readonly calibration: ControllerCalibration | null;
  readonly getGamepads: () => readonly (Gamepad | null)[];
}
export interface PreviewEvents {
  onPaused(reason: PreviewPauseReason): void;
  onFault(kind: 'context-lost' | 'runtime-error', error?: unknown): void;
  onTelemetry(telemetry: VehicleTelemetry): void;
  onNotice(messageKey: MessageKey): void;
}
export interface Preview {
  resume(): boolean;
  pause(): void;
  enqueue(action: InputAction): void;
  selectSource(source: InputSource, index?: number): void;
  setCalibration(value: ControllerCalibration): void;
  dispose(): void;
}
export class PreviewStartError extends Error {
  constructor(
    readonly reason: 'webgl-unsupported' | 'renderer-failed' | 'simulation-failed',
    options?: ErrorOptions,
  ) {
    super(reason, options);
    this.name = 'PreviewStartError';
  }
}

export function createPreview(
  canvas: HTMLCanvasElement, container: HTMLElement, events: PreviewEvents,
  prototype: PrototypeOptions, overrides: Partial<PreviewDeps> = {},
): Preview {
  const deps: PreviewDeps = {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    createContext: (element) => element.getContext('webgl2'),
    createRenderer: (element) => new WebGLRenderer({ canvas: element }),
    createWorld,
    ...overrides,
  };
  let context: PreviewContext | null = null;
  let renderer: PreviewRenderer;
  try {
    context = deps.createContext(canvas);
    if (!context) throw new PreviewStartError('webgl-unsupported');
    renderer = deps.createRenderer(canvas);
  } catch (error) {
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    if (error instanceof PreviewStartError) throw error;
    throw new PreviewStartError('renderer-failed', { cause: error });
  }
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let faulted = false;
  let lost = false;
  let running = false;
  let contactStopped = false;
  let frameId: number | null = null;
  const clock = createClock();
  let pending: InputAction[] = [];
  function stop() {
    running = false;
    if (frameId !== null) deps.cancelFrame(frameId);
    frameId = null;
    pending = [];
    clock.reset();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    stop();
    for (const cleanup of cleanups.reverse()) cleanup();
    renderer.dispose();
    if (!lost) renderer.forceContextLoss();
  }
  try {
    const world = deps.createWorld();
    cleanups.push(addColliderBoxes(world, prototypeYard));
    const profile = profiles[prototype.vehicleId];
    const rig = createVehicleRig(world, profile);
    cleanups.push(() => rig.dispose());
    rig.settle(prototypeSpawn(profile));
    let current = rig.snapshot(0);
    let previous = current;
    let simulationTime = 0;
    const content = buildPrototypeScene(profile, prototypeYard);
    cleanups.push(() => content.dispose());
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    const input = createInputController(canvas, prototype.getGamepads);
    cleanups.push(() => input.dispose());
    if (prototype.calibration) input.setCalibration(prototype.calibration);
    input.selectSource(prototype.source, prototype.gamepadIndex ?? undefined);
    let lastTime = deps.now();
    let lastTelemetry = -Infinity;

    function pause(reason: PreviewPauseReason) {
      if (!running || disposed || faulted) return;
      stop();
      input.clear();
      events.onPaused(reason);
    }
    function fault(kind: 'context-lost' | 'runtime-error', error?: unknown) {
      if (disposed || faulted) return;
      faulted = true;
      stop();
      input.clear();
      if (kind === 'context-lost') events.onFault(kind);
      else events.onFault(kind, error);
    }
    function resize() {
      const rect = container.getBoundingClientRect();
      const size = fitDrawingBuffer(rect.width, rect.height, window.devicePixelRatio);
      if (!size) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(size.width, size.height, false);
    }
    function onResize() {
      if (disposed || faulted) return;
      try { resize(); }
      catch (error) { fault('runtime-error', error); }
    }
    function tick() {
      frameId = null;
      if (!running || disposed || faulted) return;
      try {
        const poll = input.poll();
        if (poll.issue) {
          pause(prototype.source === 'gamepad' ? 'controller' : 'focus');
          events.onNotice(poll.issue);
          return;
        }
        if (poll.actions.some((action) => action.type === 'pause' || action.type === 'help')) {
          pause('user');
          return;
        }
        pending.push(...poll.actions);
        const time = deps.now();
        const { alpha } = clock.advance((time - lastTime) / 1000, () => {
          if (!running || disposed || faulted) return;
          const actions = pending;
          pending = [];
          for (const notice of rig.applyInput(poll.frame, actions, 1 / 120)) {
            events.onNotice(notice.messageKey);
          }
          world.step(1 / 120);
          if (disposed || faulted) return;
          simulationTime += 1 / 120;
          previous = current;
          current = rig.snapshot(simulationTime);
        });
        lastTime = time;
        if (!running || disposed || faulted) return;
        content.apply({ previous, current, alpha }, camera);
        renderer.render(content.scene, camera);
        if (time - lastTelemetry >= 50) {
          lastTelemetry = time;
          events.onTelemetry(current.telemetry);
        }
        frameId = deps.requestFrame(tick);
      } catch (error) { fault('runtime-error', error); }
    }
    function onBlur() { pause('focus'); }
    function onVisibility() { if (document.hidden) pause('focus'); }
    function editable(target: EventTarget | null) {
      return target instanceof Element &&
        target.closest('input,select,textarea,[contenteditable="true"]') !== null;
    }
    function onKey(event: KeyboardEvent) {
      if (event.code === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey &&
          !editable(event.target)) {
        event.preventDefault();
        pause('user');
      }
    }
    function onFocus(event: FocusEvent) {
      if (editable(event.target)) pause('focus');
    }
    function onCanvasBlur() {
      if (prototype.source === 'keyboard') pause('focus');
    }
    function onLost(event: Event) {
      event.preventDefault();
      lost = true;
      fault('context-lost');
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('blur', onCanvasBlur);
    canvas.addEventListener('webglcontextlost', onLost);
    container.addEventListener('keydown', onKey);
    container.addEventListener('focusin', onFocus);
    cleanups.push(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('blur', onCanvasBlur);
      canvas.removeEventListener('webglcontextlost', onLost);
      container.removeEventListener('keydown', onKey);
      container.removeEventListener('focusin', onFocus);
    });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    cleanups.push(() => observer?.disconnect());
    observer?.observe(container);
    cleanups.push(rig.onContact(() => {
      if (!running || disposed || faulted) return;
      contactStopped = true;
      pause('contact');
      events.onNotice('contactStop');
    }));
    resize();
    content.apply({ previous, current, alpha: 0 }, camera);
    renderer.render(content.scene, camera);
    return {
      resume() {
        if (running || disposed || faulted || contactStopped || document.hidden) return false;
        const issue = input.checkNeutral();
        if (issue) { events.onNotice(issue); return false; }
        input.clear();
        pending = [];
        clock.reset();
        lastTime = deps.now();
        running = true;
        frameId = deps.requestFrame(tick);
        return true;
      },
      pause: () => pause('user'),
      enqueue: (action) => { if (running && !disposed && !faulted) input.enqueue(action); },
      selectSource(value, index) {
        if (running) throw new Error('Input source can only change while paused');
        input.selectSource(value, index);
        prototype = { ...prototype, source: value };
        pending = [];
      },
      setCalibration: (value) => input.setCalibration(value),
      dispose,
    };
  } catch (error) {
    dispose();
    throw new PreviewStartError(error instanceof SimulationStateError
      ? 'simulation-failed' : 'renderer-failed', { cause: error });
  }
}
