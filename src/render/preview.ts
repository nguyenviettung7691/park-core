import { WebGLRenderer } from 'three';
import type { World } from 'cannon-es';
import type {
  AttemptSummary, ControllerCalibration, EnvironmentId, InputAction, InputSource, LessonRuntime,
  MessageKey, ScenarioDefinition, SensorSnapshot, VehicleId, VehicleTelemetry,
} from '../contracts';
import type { PreviewPauseReason, SceneAssets, SettingsSaveV1 } from '../runtime-types';
import { createClock } from '../clock';
import { createInputController } from '../input/controller';
import { advanceLesson } from '../lessons/checkpoints';
import { createAttemptTracker, finishAttempt, updateAttemptTracker } from '../lessons/attempt';
import { curbTouchBegan } from '../lessons/edge-warnings';
import { updateFailure } from '../lessons/failure';
import { updateParking } from '../lessons/parking';
import { createAudio, type AudioOutput } from '../sensors/audio';
import { createSensors, wheelStopBodies } from '../sensors/proximity';
import { profiles } from '../vehicle/profiles';
import { createVehicleRig, GEAR_SPEED_MPS, SimulationStateError } from '../vehicle/rig';
import {
  addColliderBoxes,
  collidersForEnvironment,
  collidersForScenario,
  createWorld,
  prototypeSpawn,
} from '../world/colliders';
import { createViews, type ViewSystem } from '../views/cameras';
import type { SeatOffset } from '../views/head-pose';
import { createLookController, type LookPose } from '../views/look';
import {
  clampMirrorOffsets, stepMirrorOffsets, ZERO_MIRROR_OFFSETS, type MirrorOffsets,
} from '../views/mirror-adjust';
import { deriveVehicleAssetContract, type MirrorId } from '../vehicle/asset-contract';
import type { RendererPort } from '../views/auxiliary';
import { createAssetScene, type AssetScene } from './asset-scene';
import { fitDrawingBuffer } from './fit';
import { createLessonScene, type LessonScene } from './lesson-scene';
import { getOverheadInset } from '../views/layout';

export type PreviewRenderer = RendererPort &
  Pick<WebGLRenderer, 'setSize' | 'dispose' | 'forceContextLoss'>;
export interface PreviewContext {
  getExtension(name: 'WEBGL_lose_context'): WEBGL_lose_context | null;
}
type PointerLockRequest = Promise<void> | void | false;
export interface PreviewDeps {
  now(): number;
  requestFrame(cb: (time: number) => void): number;
  cancelFrame(id: number): void;
  createRenderer(canvas: HTMLCanvasElement, antialias: boolean): PreviewRenderer;
  createContext(canvas: HTMLCanvasElement, antialias: boolean): PreviewContext | null;
  createWorld(): World;
  requestPointerLock(canvas: HTMLCanvasElement): PointerLockRequest;
  exitPointerLock(): void;
}
export interface PrototypeOptions {
  readonly environmentId: EnvironmentId;
  readonly vehicleId: VehicleId;
  readonly sceneAssets: SceneAssets;
  readonly source: InputSource;
  readonly gamepadIndex: number | null;
  readonly calibration: ControllerCalibration | null;
  readonly getGamepads: () => readonly (Gamepad | null)[];
  readonly settings: SettingsSaveV1;
}
export interface PreviewFrameSample {
  readonly completedAtMs: number;
  readonly elapsedS: number;
  readonly droppedTimeS: number;
  readonly clampedTimeS: number;
  readonly drawingWidthPx: number;
  readonly drawingHeightPx: number;
}
export interface PreviewEvents {
  onFrame?(sample: PreviewFrameSample): void;
  onPaused(reason: PreviewPauseReason): void;
  onFault(kind: 'context-lost' | 'runtime-error', error?: unknown): void;
  onTelemetry(telemetry: VehicleTelemetry): void;
  onSensors(sensors: SensorSnapshot): void;
  onNotice(messageKey: MessageKey): void;
  onLessonUpdate?(runtime: LessonRuntime): void;
  onAttemptOutcome?(summary: AttemptSummary): void;
  /** The driver finished adjusting (or reset) the mirrors of this vehicle. */
  onMirrorOffsets?(vehicleId: VehicleId, offsets: MirrorOffsets): void;
}
export type PreviewSessionMode =
  | { readonly kind: 'sandbox' }
  | { readonly kind: 'lesson'; readonly scenario: ScenarioDefinition };

interface LessonEvents {
  onLessonUpdate(runtime: LessonRuntime): void;
  onAttemptOutcome(summary: AttemptSummary): void;
}
export interface Preview {
  unlockAudio(): void;
  resume(): boolean;
  pause(): void;
  enqueue(action: InputAction): void;
  selectSource(source: InputSource, index?: number): void;
  setCalibration(value: ControllerCalibration): void;
  requestPointerLock(): Promise<boolean>;
  updateSettings(settings: SettingsSaveV1): void;
  /** Eases the free look pose back to straight ahead on the next fixed step. */
  recenterView(): void;
  /** Moves the driver eye and seat, clamped to this vehicle's seat range. */
  setSeatOffset(seat: SeatOffset): void;
  /** True while the car is held (stopped, in P or with the parking brake on). */
  seatAdjustAllowed(): boolean;
  /** Applies saved mirror adjustments for the current vehicle. */
  setMirrorOffsets(offsets: MirrorOffsets): void;
  /** Returns every mirror to its default aim and reports it for saving. */
  resetMirrors(): void;
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

function expectedPointerLockDenial(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  return error.name === 'NotAllowedError' || error.name === 'SecurityError' ||
    error.name === 'NotSupportedError';
}

function activeAids(settings: SettingsSaveV1): AttemptSummary['usedAids'] {
  const aids: AttemptSummary['usedAids'][number][] = [];
  if (settings.cameraMode === 'chase') aids.push('chase');
  if (settings.overhead) aids.push('360');
  if (settings.trajectory) aids.push('trajectory');
  return aids;
}

function requireLessonEvents(events: PreviewEvents): LessonEvents {
  if (!events.onLessonUpdate || !events.onAttemptOutcome) {
    throw new Error('Lesson preview requires lesson event handlers');
  }
  return {
    onLessonUpdate: events.onLessonUpdate,
    onAttemptOutcome: events.onAttemptOutcome,
  };
}

export function createPreview(
  canvas: HTMLCanvasElement, container: HTMLElement, events: PreviewEvents,
  prototype: PrototypeOptions, overrides: Partial<PreviewDeps> = {},
  mode: PreviewSessionMode = { kind: 'sandbox' },
): Preview {
  const lessonEvents = mode.kind === 'lesson' ? requireLessonEvents(events) : null;
  const deps: PreviewDeps = {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    createContext: (element, antialias) => element.getContext('webgl2', { antialias }),
    createRenderer: (element, antialias) => new WebGLRenderer({ canvas: element, antialias }),
    createWorld,
    requestPointerLock: (element) => {
      const request = element.requestPointerLock;
      return typeof request === 'function' ? request.call(element) : false;
    },
    exitPointerLock: () => {
      if (typeof document.exitPointerLock === 'function') document.exitPointerLock();
    },
    ...overrides,
  };
  let context: PreviewContext | null = null;
  let renderer: PreviewRenderer;
  let content: AssetScene | null = null;
  let ownsAssets = false;
  try {
    context = deps.createContext(canvas, prototype.settings.antialias);
    if (!context) throw new PreviewStartError('webgl-unsupported');
    renderer = deps.createRenderer(canvas, prototype.settings.antialias);
  } catch (error) {
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    if (error instanceof PreviewStartError) throw error;
    throw new PreviewStartError('renderer-failed', { cause: error });
  }
  const cleanups: (() => void)[] = [];
  let disposed = false;
  let drawingSize: { width: number; height: number } | null = null;
  let faulted = false;
  let lost = false;
  let running = false;
  let contactStopped = false;
  let frameId: number | null = null;
  const pointerLockWaiters = new Set<(acquired: boolean) => void>();
  const clock = createClock();
  let pending: InputAction[] = [];
  function settlePointerLockWaiters(acquired: boolean) {
    for (const settle of [...pointerLockWaiters]) settle(acquired);
  }
  function releasePointerLock() {
    if (document.pointerLockElement === canvas) deps.exitPointerLock();
  }
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
    settlePointerLockWaiters(false);
    releasePointerLock();
    for (const cleanup of cleanups.reverse()) cleanup();
    if (ownsAssets) content?.dispose();
    renderer.dispose();
    if (!lost) renderer.forceContextLoss();
  }
  try {
    const world = deps.createWorld();
    const boxes = mode.kind === 'lesson'
      ? collidersForScenario(mode.scenario)
      : collidersForEnvironment(prototype.environmentId);
    const colliderCleanup = addColliderBoxes(world, boxes);
    cleanups.push(colliderCleanup);
    const profile = profiles[prototype.vehicleId];
    const rig = createVehicleRig(world, profile, colliderCleanup.idForBody,
      colliderCleanup.edges);
    const sensors = createSensors(world, rig.body, profile, wheelStopBodies(colliderCleanup.edges));
    cleanups.push(() => rig.dispose());
    rig.settle(mode.kind === 'lesson'
      ? mode.scenario.spawnByVehicle[prototype.vehicleId]
      : prototypeSpawn(profile));
    let current = rig.snapshot(0);
    let previous = current;
    let simulationTime = 0;
    const sceneContent = createAssetScene(prototype.sceneAssets);
    content = sceneContent;
    ownsAssets = true;
    const lessonScene: LessonScene | null = mode.kind === 'lesson'
      ? createLessonScene(mode.scenario, prototype.sceneAssets.vehicle,
        prototype.sceneAssets.environment.getObjectByName('WheelStopTemplate') ?? null)
      : null;
    const genericMarkings = prototype.sceneAssets.environment.getObjectByName('ParkingMarkings');
    if (genericMarkings) genericMarkings.visible = mode.kind === 'sandbox';
    let lessonRuntime: LessonRuntime | null = mode.kind === 'lesson'
      ? {
        stageId: mode.scenario.stageId,
        stepIndex: 0,
        stepDwellS: 0,
        parkingDwellS: 0,
        acknowledgedStepIds: [],
      }
      : null;
    let attemptTracker = mode.kind === 'lesson'
      ? createAttemptTracker(mode.scenario.stageId, prototype.vehicleId)
      : null;
    let speedEnvelopeDwellS = 0;
    let pendingContactId: string | null = null;
    if (lessonScene && lessonRuntime) {
      sceneContent.scene.add(lessonScene.group);
      lessonScene.update(lessonRuntime);
      cleanups.push(() => lessonScene.dispose());
    }
    const views: ViewSystem = createViews(
      renderer, sceneContent.scene, prototype.sceneAssets, profile, boxes,
      {
        mirrorQuality: prototype.settings.mirrorQuality,
        overheadQuality: prototype.settings.overheadQuality,
      },
    );
    cleanups.push(() => views.dispose());
    let currentSettings = prototype.settings;
    const seatRange = deriveVehicleAssetContract(profile).seatRangeM;
    const look = createLookController();
    /**
     * Stepped look poses before and after the latest fixed step. The look controller holds the
     * authoritative stepped pose; only the render interpolates between these with `alpha`.
     */
    let lookPrevious: LookPose = look.pose();
    let lookCurrent: LookPose = lookPrevious;
    function renderedLookPose(alpha: number): LookPose {
      return {
        yawRad: lookPrevious.yawRad + (lookCurrent.yawRad - lookPrevious.yawRad) * alpha,
        pitchRad: lookPrevious.pitchRad + (lookCurrent.pitchRad - lookPrevious.pitchRad) * alpha,
      };
    }
    let mouseDx = 0;
    let mouseDy = 0;
    /** Latched recenter request (button edge or recenterView), fed to exactly one fixed step. */
    let recenterPending = false;
    /** Mirrors and seat are adjusted only in a held, stopped car, never while it is still rolling. */
    function carHeld() {
      return current.telemetry.totalSpeedMps < GEAR_SPEED_MPS &&
        (current.telemetry.gear === 'P' || current.telemetry.parkingBrake);
    }
    function applySettings(value: SettingsSaveV1) {
      views.setCamera(value.cameraMode);
      views.setOverhead(value.overhead);
      views.setTrajectory(value.trajectory);
      views.setFov(value.driverFovDeg);
    }
    applySettings(currentSettings);
    let mirrorOffsets: MirrorOffsets = ZERO_MIRROR_OFFSETS;
    let mirrorSelected: MirrorId | null = null;
    const mirrorNotices = {
      left: 'mirrorAdjustLeft', right: 'mirrorAdjustRight', rear: 'mirrorAdjustRear',
    } as const;
    /** Applies the controller's mirror state: selection notices, tilt, save on deselect. */
    function syncMirror(dtS: number) {
      const mirror = input.mirrorInput();
      if (mirror.blocked) events.onNotice('mirrorAdjustBlocked');
      if (mirror.selected !== null && dtS > 0) {
        const next = stepMirrorOffsets(mirrorOffsets, mirror.selected, mirror.intent, dtS);
        if (next !== mirrorOffsets) {
          mirrorOffsets = next;
          views.setMirrorOffsets(mirrorOffsets);
        }
      }
      if (mirror.selected === mirrorSelected) return;
      const finished = mirrorSelected !== null && mirror.selected === null;
      mirrorSelected = mirror.selected;
      views.setMirrorHighlight(mirrorSelected);
      if (mirrorSelected !== null) events.onNotice(mirrorNotices[mirrorSelected]);
      if (finished) {
        events.onMirrorOffsets?.(prototype.vehicleId, mirrorOffsets);
        events.onNotice('mirrorAdjustDone');
      }
    }
    const input = createInputController(canvas, prototype.getGamepads);
    cleanups.push(() => input.dispose());
    if (prototype.calibration) input.setCalibration(prototype.calibration);
    input.selectSource(prototype.source, prototype.gamepadIndex ?? undefined);
    let lastTime = deps.now();
    let lastRenderTime = Number.NEGATIVE_INFINITY;
    let lastTelemetry = -Infinity;
    let latestSensors: SensorSnapshot | null = null;
    let audio: AudioOutput | null = null;

    function completeAttempt(summary: AttemptSummary) {
      if (!lessonEvents) return;
      contactStopped = true;
      stop();
      input.clear();
      syncMirror(0);
      audio?.suspend();
      releasePointerLock();
      lessonEvents.onAttemptOutcome(summary);
    }

    function pause(reason: PreviewPauseReason) {
      if (!running || disposed || faulted) return;
      stop();
      input.clear();
      syncMirror(0);
      audio?.suspend();
      releasePointerLock();
      events.onPaused(reason);
    }
    function fault(kind: 'context-lost' | 'runtime-error', error?: unknown) {
      if (disposed || faulted) return;
      faulted = true;
      stop();
      input.clear();
      audio?.suspend();
      releasePointerLock();
      if (kind === 'context-lost') events.onFault(kind);
      else events.onFault(kind, error);
    }
    function resize() {
      const rect = container.getBoundingClientRect();
      container.style.setProperty('--overhead-inset-size', `${getOverheadInset(rect.width, rect.height).size}px`);
      const requestedPixelRatio = window.devicePixelRatio * currentSettings.resolutionScale;
      const size = fitDrawingBuffer(rect.width, rect.height, requestedPixelRatio);
      if (!size) {
        views.resize(rect.width, rect.height, requestedPixelRatio);
        return;
      }
      renderer.setSize(size.width, size.height, false);
      drawingSize = { width: size.width, height: size.height };
      views.resize(rect.width, rect.height, size.width / rect.width);
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
        input.setMirrorAdjustAllowed(carHeld());
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
        if (input.lookInput().recenter) recenterPending = true;
        const time = deps.now();
        syncMirror(Math.min(0.1, Math.max(0, (time - lastTime) / 1000)));
        const audioUpdates: {
          readonly sensors: SensorSnapshot;
          readonly speedMps: number;
          readonly simulationTimeS: number;
        }[] = [];
        const elapsedS = (time - lastTime) / 1000;
        const { alpha, droppedTimeS } = clock.advance(elapsedS, () => {
          if (!running || disposed || faulted) return;
          const actions = pending;
          pending = [];
          // Mouse movement of the whole frame (and any recenter) goes to the first step only.
          const lookInput = input.lookInput();
          lookPrevious = lookCurrent;
          look.step({
            mouseDx, mouseDy, stickX: lookInput.stickX, stickY: lookInput.stickY,
            glance: lookInput.glance, recenter: recenterPending,
          }, 1 / 120);
          lookCurrent = look.pose();
          mouseDx = 0;
          mouseDy = 0;
          recenterPending = false;
          for (const notice of rig.applyInput(poll.frame, actions, 1 / 120)) {
            events.onNotice(notice.messageKey);
          }
          pendingContactId = null;
          world.step(1 / 120);
          if (disposed || faulted) return;
          simulationTime += 1 / 120;
          previous = current;
          current = rig.snapshot(simulationTime);
          const curbBegan = curbTouchBegan(previous.wheelEdges, current.wheelEdges);
          const inLesson = mode.kind === 'lesson' && lessonRuntime !== null && attemptTracker !== null;
          // In a lesson the warning waits for the failure check: a failure takes precedence.
          if (curbBegan && !inLesson) events.onNotice('curbTouchWarning');
          const sample = sensors.sample(simulationTime);
          if (sample !== latestSensors) {
            latestSensors = sample;
            events.onSensors(sample);
            audioUpdates.push({
              sensors: sample,
              speedMps: current.telemetry.signedSpeedMps,
              simulationTimeS: simulationTime,
            });
          }
          if (mode.kind === 'lesson' && lessonRuntime && attemptTracker) {
            const failure = updateFailure(
              mode.scenario,
              profile,
              current.telemetry,
              boxes,
              pendingContactId,
              current.wheelEdges,
              speedEnvelopeDwellS,
              1 / 120,
            );
            speedEnvelopeDwellS = failure.speedEnvelopeDwellS;
            if (curbBegan && !failure.event) events.onNotice('curbTouchWarning');
            if (failure.event) {
              attemptTracker = updateAttemptTracker(
                attemptTracker,
                current.telemetry,
                sample,
                actions,
                activeAids(currentSettings),
                lessonRuntime,
                1 / 120,
                curbBegan,
              );
              completeAttempt(finishAttempt(attemptTracker, {
                outcome: 'fail',
                failure: failure.event,
              }));
              return;
            }

            const previousRuntime = lessonRuntime;
            const nextRuntime = advanceLesson(
              mode.scenario,
              previousRuntime,
              current.telemetry,
              actions,
              1 / 120,
            );
            const visibleChanged = nextRuntime.stepIndex !== previousRuntime.stepIndex
              || nextRuntime.acknowledgedStepIds.length
                !== previousRuntime.acknowledgedStepIds.length
              || nextRuntime.acknowledgedStepIds.some(
                (id, index) => id !== previousRuntime.acknowledgedStepIds[index],
              );
            lessonRuntime = nextRuntime;
            if (visibleChanged) {
              lessonScene?.update(lessonRuntime);
              lessonEvents?.onLessonUpdate(lessonRuntime);
            }

            const curb = mode.scenario.target.curbId === null
              ? null
              : boxes.find(({ id }) => id === mode.scenario.target.curbId) ?? null;
            const parking = updateParking(
              current.telemetry,
              profile,
              mode.scenario.target,
              curb,
              lessonRuntime.parkingDwellS,
              1 / 120,
            );
            lessonRuntime = { ...lessonRuntime, parkingDwellS: parking.dwellS };
            attemptTracker = updateAttemptTracker(
              attemptTracker,
              current.telemetry,
              sample,
              actions,
              activeAids(currentSettings),
              lessonRuntime,
              1 / 120,
              curbBegan,
            );
            if (parking.complete) {
              completeAttempt(finishAttempt(attemptTracker, { outcome: 'success' }));
              return;
            }
          }
        });
        const audioUpdate = audioUpdates.at(-1);
        if (audioUpdate && running) {
          audio?.update(audioUpdate.sensors, audioUpdate.speedMps, audioUpdate.simulationTimeS);
        }
        lastTime = time;
        if (!running || disposed || faulted) return;
        const frameRateCap = currentSettings.frameRateCap;
        if (frameRateCap === 'display' || time - lastRenderTime >= 1000 / frameRateCap) {
          sceneContent.apply({ previous, current, alpha });
          views.setLookPose(renderedLookPose(alpha));
          views.render({ previous, current, alpha }, time);
          lastRenderTime = time;
          events.onFrame?.({
            completedAtMs: deps.now(),
            elapsedS,
            droppedTimeS,
            clampedTimeS: Math.max(0, elapsedS - 0.1),
            drawingWidthPx: drawingSize?.width ?? canvas.width,
            drawingHeightPx: drawingSize?.height ?? canvas.height,
          });
        }
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
    function onPointerLockChange() {
      if (document.pointerLockElement === canvas) {
        settlePointerLockWaiters(true);
      } else if (running) pause('focus');
    }
    function onPointerLockError() { settlePointerLockWaiters(false); }
    function onMouseMove(event: MouseEvent) {
      if (!running || document.pointerLockElement !== canvas) return;
      // Non-finite movement is rejected by the look controller inside the fixed step.
      mouseDx += event.movementX;
      mouseDy += event.movementY;
    }
    function onLost(event: Event) {
      event.preventDefault();
      lost = true;
      fault('context-lost');
    }
    audio = createAudio((error) => fault('runtime-error', error));
    audio.setVolume(currentSettings.volume);
    audio.setMuted(currentSettings.muted);
    cleanups.push(() => audio?.dispose());
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    document.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('blur', onCanvasBlur);
    canvas.addEventListener('webglcontextlost', onLost);
    container.addEventListener('keydown', onKey);
    container.addEventListener('focusin', onFocus);
    cleanups.push(() => {
      container.style.removeProperty('--overhead-inset-size');
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('pointerlockerror', onPointerLockError);
      document.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('blur', onCanvasBlur);
      canvas.removeEventListener('webglcontextlost', onLost);
      container.removeEventListener('keydown', onKey);
      container.removeEventListener('focusin', onFocus);
    });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
    cleanups.push(() => observer?.disconnect());
    observer?.observe(container);
    cleanups.push(rig.onContact((colliderId) => {
      if (!running || disposed || faulted) return;
      if (mode.kind === 'lesson') {
        if (pendingContactId === null) pendingContactId = colliderId;
        return;
      }
      contactStopped = true;
      pause('contact');
      events.onNotice('contactStop');
    }));
    resize();
    sceneContent.apply({ previous, current, alpha: 0 });
    views.setLookPose(look.pose());
    views.render({ previous, current, alpha: 0 }, lastTime);
    return {
      unlockAudio() {
        if (disposed || faulted || !audio) return;
        try {
          void audio.unlock().then((result) => {
            if (!disposed && !faulted && result === 'unavailable') {
              events.onNotice('audioUnavailable');
            }
          }, (error: unknown) => fault('runtime-error', error));
        } catch (error) { fault('runtime-error', error); }
      },
      resume() {
        if (running || disposed || faulted || contactStopped || document.hidden) return false;
        if (document.pointerLockElement !== canvas) {
          events.onNotice('pointerLockDenied');
          return false;
        }
        const issue = input.checkNeutral();
        if (issue) {
          events.onNotice(issue);
          releasePointerLock();
          return false;
        }
        input.clear();
        pending = [];
        mouseDx = 0;
        mouseDy = 0;
        // The clock restarts at alpha 0, so continue from the stepped pose the paused view shows.
        lookPrevious = lookCurrent;
        clock.reset();
        lastTime = deps.now();
        lastRenderTime = Number.NEGATIVE_INFINITY;
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
      requestPointerLock() {
        if (disposed || faulted) return Promise.resolve(false);
        if (document.pointerLockElement === canvas) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => {
          let settled = false;
          const settle = (acquired: boolean) => {
            if (settled) return;
            settled = true;
            pointerLockWaiters.delete(settle);
            resolve(acquired);
          };
          pointerLockWaiters.add(settle);
          function fail(error: unknown) {
            settle(false);
            if (!expectedPointerLockDenial(error)) fault('runtime-error', error);
          }
          try {
            const request = deps.requestPointerLock(canvas);
            if (request === false) settle(false);
            else if (request && typeof request.then === 'function') {
              void request.then(() => {
                if (document.pointerLockElement !== canvas) return;
                if (disposed || faulted) {
                  releasePointerLock();
                  settle(false);
                } else settle(true);
              }, fail);
            }
          } catch (error) { fail(error); }
        });
      },
      updateSettings(value) {
        if (disposed || faulted) return;
        try {
          currentSettings = value;
          applySettings(value);
          audio?.setVolume(value.volume);
          audio?.setMuted(value.muted);
          resize();
        } catch (error) { fault('runtime-error', error); }
      },
      recenterView() { recenterPending = true; },
      setSeatOffset(seat) {
        if (disposed || faulted) return;
        try {
          if (!Number.isFinite(seat.foreAftM) || !Number.isFinite(seat.heightM)) {
            throw new RangeError('Seat offset must be finite');
          }
          const clamped: SeatOffset = {
            foreAftM: Math.max(seatRange.foreAft[0], Math.min(seatRange.foreAft[1], seat.foreAftM)),
            heightM: Math.max(seatRange.height[0], Math.min(seatRange.height[1], seat.heightM)),
          };
          views.setSeatOffset(clamped);
          sceneContent.setSeatOffset(clamped);
          if (!running) {
            views.setLookPose(look.pose());
            views.invalidateMirrors();
            views.render({ previous, current, alpha: 0 }, lastTime);
          }
        } catch (error) { fault('runtime-error', error); }
      },
      // Read from the latest stepped snapshot so it is never a frame behind the hold state.
      seatAdjustAllowed: () => carHeld(),
      setMirrorOffsets(offsets) {
        if (disposed || faulted) return;
        try {
          mirrorOffsets = clampMirrorOffsets(offsets);
          views.setMirrorOffsets(mirrorOffsets);
        } catch (error) { fault('runtime-error', error); }
      },
      resetMirrors() {
        if (disposed || faulted) return;
        try {
          mirrorOffsets = ZERO_MIRROR_OFFSETS;
          views.setMirrorOffsets(mirrorOffsets);
          events.onMirrorOffsets?.(prototype.vehicleId, mirrorOffsets);
        } catch (error) { fault('runtime-error', error); }
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw new PreviewStartError(error instanceof SimulationStateError
      ? 'simulation-failed' : 'renderer-failed', { cause: error });
  }
}
