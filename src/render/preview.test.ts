// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, MeshBasicMaterial } from 'three';
import * as clockModule from '../clock';
import { createWorld } from '../world/colliders';
import { testGamepad } from '../test/gamepad';
import { createPreview as startPreview, PreviewStartError, type PreviewDeps, type PreviewRenderer } from './preview';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

const options = {
  vehicleId: 'sedan', source: 'keyboard', gamepadIndex: null,
  calibration: null, getGamepads: () => [],
} as const;

function gamepadOptions() {
  const pad = testGamepad();
  return {
    pad,
    options: {
      ...options, source: 'gamepad' as const, gamepadIndex: 0, getGamepads: () => [pad],
      calibration: {
        version: 1, deviceId: 'wheel', steeringAxis: 0, steeringLeft: -1,
        steeringCenter: 0, steeringRight: 1,
        throttle: { kind: 'button', index: 7, released: 0, pressed: 1 },
        brake: { kind: 'button', index: 6, released: 0, pressed: 1 },
        reverseButton: 4, driveButton: 5,
      } as const,
    },
  };
}

function createPreview(
  canvas: HTMLCanvasElement, container: HTMLElement,
  events: Parameters<typeof startPreview>[2], deps: Partial<PreviewDeps>,
) {
  const preview = startPreview(canvas, container, events, options, deps);
  canvas.focus();
  preview.resume();
  return preview;
}

function fixture() {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const canvas = document.createElement('canvas');
  const container = document.createElement('div');
  canvas.tabIndex = 0;
  container.append(canvas);
  document.body.append(container);
  const world = createWorld();
  let width = 1280;
  let height = 720;
  let time = 0;
  let nextId = 0;
  const frames = new Map<number, (t: number) => void>();
  const renderer = {
    render: vi.fn<PreviewRenderer['render']>(),
    setSize: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  const events = { onPaused: vi.fn(), onFault: vi.fn(), onTelemetry: vi.fn(), onNotice: vi.fn() };
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
    new DOMRect(0, 0, width, height));
  const deps: PreviewDeps = {
    now: () => time,
    requestFrame: (cb) => { frames.set(++nextId, cb); return nextId; },
    cancelFrame: (id) => { frames.delete(id); },
    createRenderer: vi.fn(() => renderer),
    createContext: vi.fn(() => ({ getExtension: () => null })),
    createWorld: () => world,
  };
  return {
    canvas, container, renderer, events, deps, frames, world,
    key(code: string, type = 'keydown') {
      canvas.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    },
    setSize(w: number, h: number) { width = w; height = h; },
    setTime(t: number) { time = t; },
    frame(t = time + 8) {
      time = t;
      const entry = frames.entries().next().value;
      if (!entry) throw new Error('No frame scheduled');
      frames.delete(entry[0]);
      entry[1](t);
    },
  };
}

describe('preview lifecycle', () => {
  it('creates a settled paused preview and only runs after a successful explicit resume', () => {
    const f = fixture();
    const p = startPreview(f.canvas, f.container, f.events, options, f.deps);
    expect(f.frames.size).toBe(0);
    expect(f.renderer.render).toHaveBeenCalledTimes(1);
    f.canvas.focus();
    expect(p.resume()).toBe(true);
    expect(p.resume()).toBe(false);
    p.pause();
    expect(f.frames.size).toBe(0);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    expect(p.resume()).toBe(false);
    p.dispose();
  });

  it('moves the real rig only from focused input and publishes actual telemetry', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.key('KeyS'); f.key('Digit4'); f.key('Space');
    f.frame(20);
    f.key('KeyS', 'keyup'); f.key('KeyW');
    for (let i = 1; i <= 120; i++) f.frame(20 + i * 1000 / 60);
    const telemetry = f.events.onTelemetry.mock.lastCall?.[0];
    expect(telemetry.gear).toBe('D');
    expect(telemetry.parkingBrake).toBe(false);
    expect(telemetry.signedSpeedMps).toBeGreaterThan(0.1);
    expect(telemetry.pose.positionM[2]).toBeLessThan(3.9);
    expect(f.events.onTelemetry.mock.calls.length).toBeLessThanOrEqual(41);
    p.dispose();
  });

  it('retains gear actions through a zero-step frame and consumes them once', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.key('KeyS'); f.key('Digit2');
    f.frame(1);
    f.key('Digit2', 'keyup');
    f.frame(20);
    f.key('KeyS', 'keyup');
    f.frame(70);
    expect(f.events.onTelemetry.mock.lastCall?.[0].gear).toBe('R');
    expect(f.events.onNotice).not.toHaveBeenCalledWith('gearRejected');
    p.dispose();
  });

  it('clears pending actions and blocks held keyboard controls on resume', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.key('KeyS'); f.key('Digit2'); f.frame(1);
    p.pause();
    expect(p.resume()).toBe(false);
    expect(f.events.onNotice).toHaveBeenLastCalledWith('keysNotReleased');
    f.key('KeyS', 'keyup'); f.key('Digit2', 'keyup');
    expect(p.resume()).toBe(true);
    f.frame(60);
    expect(f.events.onTelemetry.mock.lastCall?.[0].gear).toBe('P');
    expect(() => p.selectSource('gamepad', 0)).toThrow();
    p.dispose();
  });

  it('stops at a real chassis contact and never resumes through the barrier', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    const body = f.world.bodies.find((candidate) => candidate.mass > 0)!;
    body.position.z = -7.815;
    body.velocity.z = -15 / 3.6;
    f.frame(100);
    expect(f.events.onPaused).toHaveBeenCalledExactlyOnceWith('contact');
    expect(f.events.onNotice).toHaveBeenCalledWith('contactStop');
    expect(f.frames.size).toBe(0);
    expect(p.resume()).toBe(false);
    p.dispose();
    expect(f.world.bodies).toHaveLength(0);
  });

  it('requires explicit resume after window refocus even when a keyup was lost', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.key('KeyS');
    window.dispatchEvent(new Event('blur'));
    expect(f.frames.size).toBe(0);
    expect(p.resume()).toBe(false);
    window.dispatchEvent(new Event('focus'));
    expect(f.frames.size).toBe(0);
    expect(p.resume()).toBe(true);
    f.canvas.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyS', repeat: true, bubbles: true,
    }));
    f.frame(60);
    expect(f.events.onTelemetry.mock.lastCall?.[0].brake).toBe(0);
    p.dispose();
  });

  it('surfaces non-finite physics and disposes its world on close', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.world.bodies.find((candidate) => candidate.mass > 0)!.position.x = NaN;
    f.frame(20);
    expect(f.events.onFault).toHaveBeenCalledWith('runtime-error', expect.any(Error));
    expect(f.frames.size).toBe(0);
    p.dispose();
    expect(f.world.bodies).toHaveLength(0);
  });

  it('releases the renderer and world when settling fails before listeners are mounted', () => {
    const f = fixture();
    f.world.gravity.set(0, 100, 0);
    expect(() => startPreview(f.canvas, f.container, f.events, options, f.deps))
      .toThrow(expect.objectContaining({ reason: 'simulation-failed' }));
    expect(f.renderer.dispose).toHaveBeenCalledOnce();
    expect(f.renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(f.world.bodies).toHaveLength(0);
    expect(f.frames.size).toBe(0);
  });

  it('uses live gamepad pedals for resume and pauses before stepping an invalid frame', () => {
    const f = fixture();
    const gamepad = gamepadOptions();
    const p = startPreview(f.canvas, f.container, f.events, gamepad.options, f.deps);
    gamepad.pad.buttons[7]!.value = 0.03;
    expect(p.resume()).toBe(false);
    expect(f.events.onNotice).toHaveBeenLastCalledWith('pedalsNotReleased');
    gamepad.pad.buttons[7]!.value = 0.02;
    expect(p.resume()).toBe(true);
    const step = vi.spyOn(f.world, 'step');
    gamepad.pad.connected = false;
    f.frame(20);
    expect(step).not.toHaveBeenCalled();
    expect(f.events.onPaused).toHaveBeenCalledExactlyOnceWith('controller');
    expect(f.events.onNotice).toHaveBeenLastCalledWith('controllerDisconnected');
    p.dispose();
  });

  it('keeps gamepad brake input live while a normal HUD button owns focus', () => {
    const f = fixture();
    const gamepad = gamepadOptions();
    const p = startPreview(f.canvas, f.container, f.events, gamepad.options, f.deps);
    f.canvas.focus();
    p.resume();
    gamepad.pad.buttons[6]!.value = 1;
    const button = document.createElement('button');
    f.container.append(button);
    button.focus();
    p.enqueue({ type: 'request-gear', gear: 'D' });
    f.frame(60);
    expect(f.events.onTelemetry.mock.lastCall?.[0].gear).toBe('D');
    expect(f.events.onPaused).not.toHaveBeenCalled();
    p.dispose();
  });
  it('rejects unsupported WebGL before constructing a renderer', () => {
    const f = fixture();
    expect(() => createPreview(f.canvas, f.container, f.events, {
      ...f.deps, createContext: () => null,
    })).toThrow(expect.objectContaining({ reason: 'webgl-unsupported' }));
    expect(f.deps.createRenderer).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(0);
  });

  it('reports renderer construction errors as typed startup failures', () => {
    const f = fixture();
    expect(() => createPreview(f.canvas, f.container, f.events, {
      ...f.deps, createRenderer: () => { throw new Error('GPU unavailable'); },
    })).toThrow(PreviewStartError);
    expect(f.frames.size).toBe(0);
  });

  it('releases the acquired WebGL context if renderer construction fails', () => {
    const f = fixture();
    const loseContext = vi.fn();
    expect(() => createPreview(f.canvas, f.container, f.events, {
      ...f.deps,
      createContext: () => ({
        getExtension: () => ({ loseContext, restoreContext: vi.fn() }),
      }),
      createRenderer: () => { throw new Error('Renderer startup failed'); },
    })).toThrow(PreviewStartError);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  it('caps the buffer and uses the same scene and camera on each frame', () => {
    const f = fixture();
    f.setSize(5120, 1440);
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    expect(f.renderer.setSize).toHaveBeenLastCalledWith(2560, 720, false);
    f.frame();
    f.frame();
    const [scene, camera] = f.renderer.render.mock.calls[0];
    expect(scene.children.length).toBeGreaterThan(1);
    expect(camera).toHaveProperty('aspect', 5120 / 1440);
    expect(f.renderer.render).toHaveBeenLastCalledWith(scene, camera);
    p.dispose();
  });

  it('skips zero-size layouts and reports invalid resize instead of escaping the listener', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.renderer.setSize.mockClear();
    f.setSize(0, 0);
    window.dispatchEvent(new Event('resize'));
    expect(f.renderer.setSize).not.toHaveBeenCalled();
    f.setSize(NaN, 720);
    window.dispatchEvent(new Event('resize'));
    expect(f.events.onFault).toHaveBeenCalledWith('runtime-error', expect.any(RangeError));
    expect(f.frames.size).toBe(0);
    p.dispose();
  });

  it('blur pauses until explicit resume and uses a fresh time origin', () => {
    const clock = clockModule.createClock();
    const advance = vi.spyOn(clock, 'advance');
    vi.spyOn(clockModule, 'createClock').mockReturnValue(clock);
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.frame();
    window.dispatchEvent(new Event('blur'));
    expect(f.frames.size).toBe(0);
    expect(f.events.onPaused).toHaveBeenCalledTimes(1);
    f.setTime(60_000);
    window.dispatchEvent(new Event('focus'));
    expect(f.frames.size).toBe(0);
    p.resume();
    p.resume();
    expect(f.frames.size).toBe(1);
    f.frame(60_001);
    expect(advance).toHaveBeenLastCalledWith(0.001, expect.any(Function));
    expect(f.events.onFault).not.toHaveBeenCalled();
    expect(f.frames.size).toBe(1);
    p.dispose();
  });

  it('does not subtract a frame-start timestamp from the later initialization clock', () => {
    const f = fixture();
    f.setTime(1000);
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    const [id, callback] = f.frames.entries().next().value!;
    f.frames.delete(id);
    callback(999);
    expect(f.events.onFault).not.toHaveBeenCalled();
    expect(f.renderer.render).toHaveBeenCalledTimes(2);
    p.dispose();
  });

  it('tab hiding pauses without auto-resume on visibility restoration', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(f.frames.size).toBe(0);
    expect(f.events.onPaused).toHaveBeenCalledTimes(1);
    p.dispose();
  });

  it('context loss stops rendering, reports once and cannot recurse through disposal', () => {
    const f = fixture();
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    const lost = new Event('webglcontextlost', { cancelable: true });
    f.canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(f.events.onFault).toHaveBeenCalledTimes(1);
    expect(f.events.onFault).toHaveBeenCalledWith('context-lost');
    expect(f.frames.size).toBe(0);
    p.dispose();
    p.resume();
    f.canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(f.events.onFault).toHaveBeenCalledTimes(1);
    expect(f.renderer.forceContextLoss).not.toHaveBeenCalled();
  });

  it('frame exceptions stop the loop and surface the original error', () => {
    const f = fixture();
    const error = new Error('Render failed');
    const p = createPreview(f.canvas, f.container, f.events, f.deps);
    f.renderer.render.mockImplementation(() => { throw error; });
    f.frame();
    expect(f.events.onFault).toHaveBeenCalledWith('runtime-error', error);
    expect(f.frames.size).toBe(0);
    p.dispose();
  });

  it('ten open/dispose cycles release frames, listeners and scene resources exactly once', () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(MeshBasicMaterial.prototype, 'dispose');
    for (let i = 0; i < 10; i++) {
      const f = fixture();
      const addWindow = vi.spyOn(window, 'addEventListener');
      const removeWindow = vi.spyOn(window, 'removeEventListener');
      const addDocument = vi.spyOn(document, 'addEventListener');
      const removeDocument = vi.spyOn(document, 'removeEventListener');
      const addCanvas = vi.spyOn(f.canvas, 'addEventListener');
      const removeCanvas = vi.spyOn(f.canvas, 'removeEventListener');
      const p = createPreview(f.canvas, f.container, f.events, f.deps);
      p.dispose();
      p.dispose();
      expect(f.renderer.dispose).toHaveBeenCalledTimes(1);
      expect(f.renderer.forceContextLoss).toHaveBeenCalledTimes(1);
      expect(f.frames.size).toBe(0);
      for (const [add, remove] of [
        [addWindow, removeWindow], [addDocument, removeDocument], [addCanvas, removeCanvas],
      ]) {
        for (const call of add.mock.calls.filter((call) =>
          !(typeof call[2] === 'object' && call[2]?.signal))) {
          expect(remove.mock.calls.some((removed) =>
            removed[0] === call[0] && removed[1] === call[1])).toBe(true);
        }
      }
      window.dispatchEvent(new Event('blur'));
      expect(f.events.onPaused).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    }
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
  });

  it('disconnects its resize observer so disposed scenes cannot resize', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      observe = observe;
      disconnect = disconnect;
    });
    try {
      const f = fixture();
      const p = createPreview(f.canvas, f.container, f.events, f.deps);
      expect(observe).toHaveBeenCalledWith(f.container);
      p.dispose();
      p.dispose();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
