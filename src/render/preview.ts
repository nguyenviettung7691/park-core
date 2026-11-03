import {
  BoxGeometry, Color, Mesh, MeshBasicMaterial, PerspectiveCamera,
  PlaneGeometry, Scene, WebGLRenderer,
} from 'three';
import { createClock } from '../clock';
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
}

export interface PreviewEvents {
  onPaused(): void;
  onFault(kind: 'context-lost' | 'runtime-error', error?: unknown): void;
}

export interface Preview {
  resume(): void;
  dispose(): void;
}

export class PreviewStartError extends Error {
  constructor(
    readonly reason: 'webgl-unsupported' | 'renderer-failed',
    options?: ErrorOptions,
  ) {
    super(reason, options);
    this.name = 'PreviewStartError';
  }
}

function buildScene() {
  const scene = new Scene();
  scene.background = new Color('#151318');
  const groundGeometry = new PlaneGeometry(18, 18);
  const bodyGeometry = new BoxGeometry(1.8, 1.2, 3.6);
  const markerGeometry = new BoxGeometry(0.06, 0.06, 5);
  const groundMaterial = new MeshBasicMaterial({ color: '#302936' });
  const bodyMaterial = new MeshBasicMaterial({ color: '#9B59B6' });
  const markerMaterial = new MeshBasicMaterial({ color: '#D5B1E3' });
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  const body = new Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.65;
  const forward = new Mesh(markerGeometry, markerMaterial);
  forward.position.set(-3, 0.05, 0);
  const right = new Mesh(markerGeometry, markerMaterial);
  right.rotation.y = Math.PI / 2;
  right.position.set(0, 0.05, 3);
  scene.add(ground, body, forward, right);
  return {
    scene,
    dispose() {
      for (const resource of [
        groundGeometry, bodyGeometry, markerGeometry,
        groundMaterial, bodyMaterial, markerMaterial,
      ]) resource.dispose();
      scene.clear();
    },
  };
}

export function createPreview(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  events: PreviewEvents,
  overrides: Partial<PreviewDeps> = {},
): Preview {
  const deps: PreviewDeps = {
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    createContext: (element) => element.getContext('webgl2'),
    createRenderer: (element) => new WebGLRenderer({ canvas: element }),
    ...overrides,
  };
  let renderer: PreviewRenderer;
  let context: PreviewContext | null = null;
  try {
    context = deps.createContext(canvas);
    if (!context) throw new PreviewStartError('webgl-unsupported');
    renderer = deps.createRenderer(canvas);
  } catch (error) {
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    if (error instanceof PreviewStartError) throw error;
    throw new PreviewStartError('renderer-failed', { cause: error });
  }

  const content = buildScene();
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(7, 6, 9);
  camera.lookAt(0, 0, 0);
  const clock = createClock();
  let disposed = false;
  let faulted = false;
  let lost = false;
  let running = true;
  let frameId: number | null = null;
  let lastTime = deps.now();

  function stop() {
    running = false;
    if (frameId !== null) deps.cancelFrame(frameId);
    frameId = null;
    clock.reset();
  }

  function fault(kind: 'context-lost' | 'runtime-error', error?: unknown) {
    if (disposed || faulted) return;
    faulted = true;
    stop();
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
      const time = deps.now();
      clock.advance((time - lastTime) / 1000, () => {});
      lastTime = time;
      renderer.render(content.scene, camera);
      frameId = deps.requestFrame(tick);
    } catch (error) {
      fault('runtime-error', error);
    }
  }

  function pause() {
    if (!running || disposed || faulted) return;
    stop();
    events.onPaused();
  }

  function onVisibility() {
    if (document.hidden) pause();
  }

  function onLost(event: Event) {
    event.preventDefault();
    lost = true;
    fault('context-lost');
  }

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize);
  const preview: Preview = {
    resume() {
      if (running || disposed || faulted || document.hidden) return;
      clock.reset();
      lastTime = deps.now();
      running = true;
      frameId = deps.requestFrame(tick);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', pause);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      observer?.disconnect();
      content.dispose();
      renderer.dispose();
      if (!lost) renderer.forceContextLoss();
    },
  };

  try {
    resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onLost);
    observer?.observe(container);
    frameId = deps.requestFrame(tick);
    return preview;
  } catch (error) {
    preview.dispose();
    throw new PreviewStartError('renderer-failed', { cause: error });
  }
}
