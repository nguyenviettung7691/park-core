// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, MeshBasicMaterial } from 'three';
import * as clockModule from '../clock';
import { createPreview, PreviewStartError, type PreviewDeps, type PreviewRenderer } from './preview';

afterEach(() => vi.restoreAllMocks());

function fixture() {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const canvas = document.createElement('canvas');
  const container = document.createElement('div');
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
  const events = { onPaused: vi.fn(), onFault: vi.fn() };
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
    new DOMRect(0, 0, width, height));
  const deps: PreviewDeps = {
    now: () => time,
    requestFrame: (cb) => { frames.set(++nextId, cb); return nextId; },
    cancelFrame: (id) => { frames.delete(id); },
    createRenderer: vi.fn(() => renderer),
    createContext: vi.fn(() => ({ getExtension: () => null })),
  };
  return {
    canvas, container, renderer, events, deps, frames,
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
    expect(f.renderer.render).toHaveBeenCalledTimes(1);
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
        for (const call of add.mock.calls) {
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
