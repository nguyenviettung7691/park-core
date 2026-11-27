import type { Vec3Data } from '../contracts';

export function orientedRectangle(
  centerM: Vec3Data,
  halfWidthM: number,
  halfLengthM: number,
  yawRad: number,
): readonly [Vec3Data, Vec3Data, Vec3Data, Vec3Data] {
  const cos = Math.cos(yawRad), sin = Math.sin(yawRad);
  const local = [
    [-halfWidthM, -halfLengthM],
    [halfWidthM, -halfLengthM],
    [halfWidthM, halfLengthM],
    [-halfWidthM, halfLengthM],
  ] as const;
  return [
    [centerM[0] + cos * local[0][0] + sin * local[0][1], centerM[1],
      centerM[2] - sin * local[0][0] + cos * local[0][1]],
    [centerM[0] + cos * local[1][0] + sin * local[1][1], centerM[1],
      centerM[2] - sin * local[1][0] + cos * local[1][1]],
    [centerM[0] + cos * local[2][0] + sin * local[2][1], centerM[1],
      centerM[2] - sin * local[2][0] + cos * local[2][1]],
    [centerM[0] + cos * local[3][0] + sin * local[3][1], centerM[1],
      centerM[2] - sin * local[3][0] + cos * local[3][1]],
  ];
}

export function polygonsOverlap(
  first: readonly Vec3Data[],
  second: readonly Vec3Data[],
): boolean {
  const axes = [...first, ...second].map((point, index, points) => {
    const next = points[(index + 1) % points.length];
    return [-(next[2] - point[2]), next[0] - point[0]] as const;
  });
  return axes.every(([axisX, axisZ]) => {
    const project = (polygon: readonly Vec3Data[]) => polygon.map(
      (point) => point[0] * axisX + point[2] * axisZ,
    );
    const firstProjection = project(first);
    const secondProjection = project(second);
    return Math.max(...firstProjection) >= Math.min(...secondProjection) - 1e-8
      && Math.max(...secondProjection) >= Math.min(...firstProjection) - 1e-8;
  });
}

