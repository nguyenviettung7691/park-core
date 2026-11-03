export function fitDrawingBuffer(
  cssW: number,
  cssH: number,
  dpr: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(cssW) || !Number.isFinite(cssH) ||
      cssW < 0 || cssH < 0 || !Number.isFinite(dpr) || dpr <= 0) {
    throw new RangeError('Invalid drawing buffer dimensions or pixel ratio');
  }
  if (cssW === 0 || cssH === 0) return null;
  const scale = Math.min(dpr, 2560 / cssW, 1440 / cssH);
  return {
    width: Math.max(1, Math.round(cssW * scale)),
    height: Math.max(1, Math.round(cssH * scale)),
  };
}
