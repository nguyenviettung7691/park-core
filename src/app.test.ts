// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { PreviewStartError, type Preview, type PreviewEvents } from './render/preview';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function fixture() {
  const root = document.createElement('div');
  document.body.append(root);
  let live = 0;
  let events: PreviewEvents | undefined;
  const previews: Preview[] = [];
  const factory = vi.fn((canvas: HTMLCanvasElement, _container: HTMLElement, handlers: PreviewEvents) => {
    expect(canvas.isConnected).toBe(true);
    events = handlers;
    live++;
    let disposed = false;
    const preview: Preview = {
      resume: vi.fn(),
      dispose: vi.fn(() => { if (!disposed) { disposed = true; live--; } }),
    };
    previews.push(preview);
    return preview;
  });
  return {
    root, factory, previews,
    get live() { return live; },
    get events() {
      if (!events) throw new Error('No preview events');
      return events;
    },
    click(text: string) {
      const button = [...root.querySelectorAll('button')].find((node) => node.textContent === text);
      if (!button) throw new Error(`Button missing: ${text}`);
      button.click();
    },
  };
}

it('mounts menu without touching WebGL or storage', () => {
  const f = fixture();
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const storage = vi.spyOn(Storage.prototype, 'getItem');
  const app = createApp(f.root, { createPreview: f.factory });
  expect(f.root.querySelector('select')).not.toBeNull();
  expect(f.root.querySelector('canvas')).toBeNull();
  expect(context).not.toHaveBeenCalled();
  expect(storage).not.toHaveBeenCalled();
  expect(f.factory).not.toHaveBeenCalled();
  app.dispose();
});

it('ten open/close cycles keep at most one canvas and release all previews', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  let previous: Element | null = null;
  for (let i = 0; i < 10; i++) {
    f.click('Xem thử mô hình (không lái được)');
    const canvas = f.root.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas).not.toBe(previous);
    expect(f.root.querySelectorAll('canvas').length).toBe(1);
    expect(f.live).toBe(1);
    expect(f.root.textContent).toContain('Bản xem thử — không lái được');
    previous = canvas;
    f.click('Quay lại menu');
    expect(f.live).toBe(0);
    expect(f.root.querySelector('canvas')).toBeNull();
  }
  app.dispose();
  app.dispose();
  expect(f.root.children.length).toBe(0);
  expect(f.previews.every((preview) =>
    vi.mocked(preview.dispose).mock.calls.length === 1)).toBe(true);
});

it('keeps the selected vehicle when leaving the preview', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  const select = f.root.querySelector('select')!;
  select.value = 'cuv';
  select.dispatchEvent(new Event('change'));
  f.click('Xem thử mô hình (không lái được)');
  expect(f.root.textContent).toContain('CUV');
  f.click('Quay lại menu');
  expect(f.root.querySelector('select')?.value).toBe('cuv');
  app.dispose();
});

it('requires explicit resume after preview pause', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Xem thử mô hình (không lái được)');
  f.events.onPaused();
  expect(document.activeElement?.textContent).toBe('Tiếp tục xem thử');
  expect(f.previews[0].resume).not.toHaveBeenCalled();
  f.click('Tiếp tục xem thử');
  expect(f.previews[0].resume).toHaveBeenCalledTimes(1);
  expect(f.root.textContent).not.toContain('Tiếp tục xem thử');
  app.dispose();
});

it('disposes context-lost content before showing recovery and reopens on a fresh canvas', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Xem thử mô hình (không lái được)');
  const canvas = f.root.querySelector('canvas');
  f.events.onFault('context-lost');
  expect(f.live).toBe(0);
  expect(f.root.querySelector('canvas')).toBeNull();
  expect(f.root.textContent).toContain('Tải lại trang');
  f.click('Quay lại menu');
  f.click('Xem thử mô hình (không lái được)');
  expect(f.root.querySelector('canvas')).not.toBe(canvas);
  app.dispose();
});

it('surfaces startup failure without a canvas and offers retry only when recoverable', () => {
  const f = fixture();
  f.factory.mockImplementationOnce(() => { throw new PreviewStartError('webgl-unsupported'); });
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Xem thử mô hình (không lái được)');
  expect(f.root.querySelector('canvas')).toBeNull();
  expect([...f.root.querySelectorAll('button')].map((node) => node.textContent))
    .toEqual(['Quay lại menu']);
  f.click('Quay lại menu');
  f.factory.mockImplementationOnce(() => { throw new PreviewStartError('renderer-failed'); });
  f.click('Xem thử mô hình (không lái được)');
  expect(f.root.textContent).toContain('Thử lại');
  f.click('Thử lại');
  expect(f.live).toBe(1);
  app.dispose();
});

it('ignores callbacks from a closed preview rather than changing the current screen', () => {
  const f = fixture();
  const app = createApp(f.root, { createPreview: f.factory });
  f.click('Xem thử mô hình (không lái được)');
  const old = f.events;
  f.click('Quay lại menu');
  old.onFault('runtime-error', new Error('Late callback'));
  old.onPaused();
  expect(f.root.querySelector('select')).not.toBeNull();
  expect(f.root.textContent).not.toContain('Thử lại');
  app.dispose();
});
