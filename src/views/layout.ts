export function getOverheadInset(widthCss: number, heightCss: number): {
  readonly x: number; readonly y: number; readonly size: number;
} {
  if (!Number.isFinite(widthCss) || !Number.isFinite(heightCss) || widthCss < 0 || heightCss < 0) {
    throw new RangeError('Invalid view dimensions');
  }
  const size = Math.min(320, Math.max(0, widthCss - 32), Math.max(0, heightCss - 32));
  return size < 1 ? { x: 0, y: 0, size: 0 } :
    { x: widthCss - size - 16, y: heightCss - size - 16, size };
}
