// SPDX-License-Identifier: MIT
/** @typedef {{ positions: number[], normals: number[], colors: number[], indices: number[] }} Geometry */
export function boxGeometry(sizeM, color) {
  const [x, y, z] = sizeM.map((value) => value / 2);
  const faces = [
    { normal: [0, 0, 1], shade: 1, points: [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]] },
    { normal: [0, 0, -1], shade: 0.76, points: [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]] },
    { normal: [1, 0, 0], shade: 0.86, points: [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]] },
    { normal: [-1, 0, 0], shade: 0.82, points: [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]] },
    { normal: [0, 1, 0], shade: 1.08, points: [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]] },
    { normal: [0, -1, 0], shade: 0.62, points: [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]] },
  ];
  const positions = [], normals = [], colors = [], indices = [];
  for (const face of faces) {
    const start = positions.length / 3;
    for (const point of face.points) {
      positions.push(...point);
      normals.push(...face.normal);
      colors.push(...color.map((channel) => Math.min(1, channel * face.shade)));
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return { positions, normals, colors, indices };
}
export function cylinderXGeometry(radiusM, widthM, color, segments = 16) {
  const positions = [], normals = [], colors = [], indices = [];
  const x = widthM / 2;
  for (let i = 0; i < segments; i++) {
    const a = i * Math.PI * 2 / segments;
    const b = (i + 1) * Math.PI * 2 / segments;
    const start = positions.length / 3;
    const points = [
      [-x, Math.cos(a) * radiusM, Math.sin(a) * radiusM],
      [-x, Math.cos(b) * radiusM, Math.sin(b) * radiusM],
      [x, Math.cos(b) * radiusM, Math.sin(b) * radiusM],
      [x, Math.cos(a) * radiusM, Math.sin(a) * radiusM],
    ];
    const radial = [[0, Math.cos(a), Math.sin(a)], [0, Math.cos(b), Math.sin(b)],
      [0, Math.cos(b), Math.sin(b)], [0, Math.cos(a), Math.sin(a)]];
    for (let j = 0; j < points.length; j++) {
      positions.push(...points[j]);
      normals.push(...radial[j]);
      colors.push(...color);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  for (const side of [-1, 1]) {
    const centerIndex = positions.length / 3;
    positions.push(side * x, 0, 0);
    normals.push(side, 0, 0);
    colors.push(...color);
    for (let i = 0; i < segments; i++) {
      const angle = i * Math.PI * 2 / segments;
      positions.push(side * x, Math.cos(angle) * radiusM, Math.sin(angle) * radiusM);
      normals.push(side, 0, 0);
      colors.push(...color);
    }
    for (let i = 0; i < segments; i++) {
      const current = centerIndex + 1 + i;
      const next = centerIndex + 1 + (i + 1) % segments;
      indices.push(centerIndex, side > 0 ? current : next, side > 0 ? next : current);
    }
  }
  return { positions, normals, colors, indices };
}

export function torusGeometry(radiusM, tubeM, color, segments = 18, tubeSegments = 6) {
  const positions = [], normals = [], colors = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    const u = i * Math.PI * 2 / segments;
    for (let j = 0; j <= tubeSegments; j++) {
      const v = j * Math.PI * 2 / tubeSegments;
      const radial = radiusM + tubeM * Math.cos(v);
      positions.push(radial * Math.cos(u), radial * Math.sin(u), tubeM * Math.sin(v));
      normals.push(Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v));
      colors.push(...color);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < tubeSegments; j++) {
      const a = i * (tubeSegments + 1) + j;
      const b = a + tubeSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { positions, normals, colors, indices };
}
