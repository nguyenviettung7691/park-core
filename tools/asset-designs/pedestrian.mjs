// SPDX-License-Identifier: CC-BY-NC-4.0
import { boxGeometry, facesGeometry, mergeGeometry, transformGeometry } from '../asset-geometry.mjs';

// Original low-poly adult pedestrian (issue #25), 1.7 m tall, base at y = 0, facing -Z.
// Six mesh nodes share the runtime placeholder's names and pivots: legs hang from the hip
// (y = 0.8), arms from the shoulder (y = 1.4); body and head are centred on their own origins.
const HIP_Y = 0.8, SHOULDER_Y = 1.4, HEAD_Y = 1.55, HEAD_R = 0.15;
const colors = {
  jacket: [0.36, 0.42, 0.5], trousers: [0.2, 0.22, 0.27], shoe: [0.15, 0.14, 0.14],
  skin: [0.8, 0.62, 0.5], hair: [0.22, 0.16, 0.12], pack: [0.46, 0.4, 0.33], belt: [0.12, 0.12, 0.13],
};

/** Tapered box: bottom half-extents (w0, d0) at y0, top (w1, d1) at y1, centred on x = z = 0. */
function frustum(y0, y1, [w0, d0], [w1, d1], color, center = [0, 0, 0]) {
  const ring = (y, w, d) => [[-w, y, d], [w, y, d], [w, y, -d], [-w, y, -d]];
  const b = ring(y0, w0, d0), t = ring(y1, w1, d1);
  const faces = [0, 1, 2, 3].map((i) => ({ color, points: [b[i], b[(i + 1) % 4], t[(i + 1) % 4], t[i]] }));
  faces.push({ color, points: [t[0], t[1], t[2], t[3]] });
  faces.push({ color, points: [b[3], b[2], b[1], b[0]] });
  return transformGeometry(facesGeometry(faces), center);
}

function cube([cx, cy, cz], size, color) {
  return transformGeometry(boxGeometry(size, color), [cx, cy, cz]);
}

/** Flat-shaded UV sphere about the origin; the colour is chosen per face from its centroid. */
function sphere(radius, segments, rings, colorOf) {
  const point = (ring, seg) => {
    const polar = Math.PI * ring / rings, azimuth = Math.PI * 2 * (seg % segments) / segments;
    return [radius * Math.sin(polar) * Math.cos(azimuth), radius * Math.cos(polar),
      radius * Math.sin(polar) * Math.sin(azimuth)];
  };
  const faces = [];
  for (let ring = 0; ring < rings; ring++) {
    for (let seg = 0; seg < segments; seg++) {
      const corners = [point(ring, seg), point(ring, seg + 1), point(ring + 1, seg + 1), point(ring + 1, seg)];
      // Polar quads collapse to triangles: drop repeated corners.
      const same = (p, q) => p.every((v, axis) => Math.abs(v - q[axis]) < 1e-9);
      const points = corners.filter((p, i) => !same(p, corners[(i + 3) % 4]));
      if (points.length < 3) continue;
      const centroid = points.reduce((sum, p) => sum.map((v, axis) => v + p[axis] / points.length), [0, 0, 0]);
      const a = points[1].map((v, axis) => v - points[0][axis]);
      const b = points[2].map((v, axis) => v - points[0][axis]);
      const normal = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const outward = normal.reduce((sum, v, axis) => sum + v * centroid[axis], 0) >= 0;
      faces.push({ color: colorOf(centroid), points: outward ? points : [...points].reverse() });
    }
  }
  return facesGeometry(faces);
}

function body() {
  const parts = [
    frustum(-0.3, 0.3, [0.165, 0.1], [0.215, 0.115], colors.jacket),          // torso, y 0.8-1.4
    frustum(-0.37, -0.28, [0.17, 0.1], [0.18, 0.105], colors.trousers),       // hips below the jacket
    cube([0, -0.215, 0], [0.37, 0.04, 0.21], colors.belt),
    cube([0, 0.05, 0.17], [0.28, 0.36, 0.12], colors.pack),                   // daypack on the back (+Z)
    cube([0, 0.2, 0.235], [0.2, 0.1, 0.03], colors.pack),
    cube([-0.1, 0.12, -0.105], [0.04, 0.3, 0.02], colors.belt),               // pack straps over the chest
    cube([0.1, 0.12, -0.105], [0.04, 0.3, 0.02], colors.belt),
    cube([0, 0.31, 0], [0.12, 0.05, 0.12], colors.skin),                      // neck
  ];
  return mergeGeometry(parts);
}

function head() {
  const hair = (c) => (c[1] > 0.25 * HEAD_R || (c[2] > 0.1 * HEAD_R && c[1] > -0.35 * HEAD_R))
    ? colors.hair : colors.skin;
  return mergeGeometry([
    sphere(HEAD_R, 10, 8, hair),
    cube([0, -0.01, -HEAD_R - 0.012], [0.04, 0.06, 0.04], colors.skin),       // nose marks the front (-Z)
  ]);
}

/** Leg hanging from the hip pivot: thigh, calf, cuff and a shoe pointing forward (-Z). */
function leg() {
  return mergeGeometry([
    frustum(-0.42, 0, [0.075, 0.085], [0.088, 0.095], colors.trousers),
    frustum(-0.74, -0.42, [0.058, 0.065], [0.075, 0.085], colors.trousers),
    frustum(-0.76, -0.72, [0.062, 0.07], [0.058, 0.065], colors.belt),
    cube([0, -0.78, -0.04], [0.11, 0.04, 0.26], colors.shoe),
    cube([0, -0.745, -0.075], [0.09, 0.03, 0.14], colors.shoe),
  ]);
}

/** Arm hanging from the shoulder pivot: upper sleeve, forearm sleeve and a hand. */
function arm() {
  return mergeGeometry([
    frustum(-0.3, 0, [0.043, 0.047], [0.052, 0.055], colors.jacket),
    frustum(-0.52, -0.3, [0.036, 0.04], [0.043, 0.047], colors.jacket),
    cube([0, -0.56, 0], [0.065, 0.08, 0.075], colors.skin),
    cube([0, -0.6, -0.005], [0.055, 0.02, 0.06], colors.skin),
  ]);
}

/** Authors the hidden `PedestrianTemplate` (six mesh nodes) under `parent`; the runtime hides it. */
export function authorPedestrianTemplate({ addNode, addMesh }, parent) {
  const template = addNode('PedestrianTemplate', parent);
  const mid = (HIP_Y + SHOULDER_Y) / 2;
  addMesh('PedestrianBody', template, body(), colors.jacket, [0, mid, 0]);
  addMesh('PedestrianHead', template, head(), colors.skin, [0, HEAD_Y, 0]);
  addMesh('PedestrianLegL', template, leg(), colors.trousers, [-0.11, HIP_Y, 0]);
  addMesh('PedestrianLegR', template, leg(), colors.trousers, [0.11, HIP_Y, 0]);
  addMesh('PedestrianArmL', template, arm(), colors.jacket, [-0.26, SHOULDER_Y, 0]);
  addMesh('PedestrianArmR', template, arm(), colors.jacket, [0.26, SHOULDER_Y, 0]);
  return template;
}
