import { describe, expect, it } from 'vitest';
import { fitDrawingBuffer } from './fit';

describe('drawing buffer sizing', () => {
  it.each([
    [1280, 720, 1, 1280, 720],
    [1280, 720, 2, 2560, 1440],
    [2560, 1440, 2, 2560, 1440],
    [5120, 1440, 1, 2560, 720],
    [5000, 300, 1, 2560, 154],
    [400, 3000, 1, 192, 1440],
    [0.01, 0.01, 1, 1, 1],
  ])('fits %sx%s at %s DPR', (w, h, dpr, width, height) => {
    expect(fitDrawingBuffer(w, h, dpr)).toEqual({ width, height });
  });

  it('skips hidden layouts instead of allocating a bogus buffer', () => {
    expect(fitDrawingBuffer(0, 720, 1)).toBeNull();
    expect(fitDrawingBuffer(1280, 0, 1)).toBeNull();
  });

  it.each([
    [NaN, 5, 1], [-1, 5, 1], [5, Infinity, 1],
    [5, 5, 0], [5, 5, NaN], [5, 5, Infinity],
  ])('rejects invalid dimensions or DPR (%s,%s,%s)', (w, h, dpr) => {
    expect(() => fitDrawingBuffer(w, h, dpr)).toThrow(RangeError);
  });
});
