import { expect, it } from 'vitest';
import { getOverheadInset } from './layout';

it('reserves the renderer inset in CSS pixels through resizing and empty containers', () => {
  expect(getOverheadInset(1440, 900)).toEqual({ x: 1104, y: 564, size: 320 });
  expect(getOverheadInset(390, 844)).toEqual({ x: 54, y: 508, size: 320 });
  expect(getOverheadInset(200, 150)).toEqual({ x: 66, y: 16, size: 118 });
  expect(getOverheadInset(0, 900)).toEqual({ x: 0, y: 0, size: 0 });
});

it.each([-1, NaN, Infinity])('rejects invalid layout dimensions: %s', (value) => {
  expect(() => getOverheadInset(value, 900)).toThrow(RangeError);
});
