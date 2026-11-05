// SPDX-License-Identifier: CC-BY-NC-4.0
import { boxGeometry, mergeGeometry, transformGeometry } from '../asset-geometry.mjs';
import { palette } from './palette.mjs';

export function authorEnvironment({ root, addNode, addMesh, box }, assetId) {
  const garage = assetId === 'garage';
  const concrete = [0.57, 0.54, 0.51], dark = [0.22, 0.21, 0.24];
  const groundSize = garage ? [30, 0.24, 30] : [50, 0.24, 32];
  box('Ground', root, [0, -0.12, 0], groundSize, garage ? [0.4, 0.39, 0.4] : concrete);
  const part = (center, size, color, rotation) =>
    transformGeometry(boxGeometry(size, color), center, rotation);
  const batch = (name, parent, parts) => addMesh(name, parent, mergeGeometry(parts), concrete);
  const glyphs = {
    P: ['110', '101', '110', '100', '100'],
    B: ['110', '101', '110', '101', '110'],
    1: ['010', '110', '010', '010', '111'],
    2: ['110', '001', '010', '100', '111'],
    3: ['110', '001', '010', '001', '110'],
  };
  const lettering = (text, x, y, z, scale) => {
    const parts = [];
    [...text].forEach((letter, index) => glyphs[letter].forEach((row, rowIndex) =>
      [...row].forEach((pixel, column) => {
        if (pixel === '1') parts.push(part([x + (index * 4 + column) * scale, y - rowIndex * scale, z],
          [scale * 0.92, scale * 0.92, 0.008], [0.87, 0.84, 0.75]));
      })));
    return parts;
  };
  const markings = addNode('ParkingMarkings', root);
  const lines = [];
  for (let slot = -1; slot <= 1; slot++) {
    const x = garage ? slot * 3.2 : 2.85, z = garage ? -5 : slot * 9;
    const w = garage ? 2.9 : 2.3, l = garage ? 5.2 : 6.4;
    for (const side of [-1, 1]) lines.push(part([x + side * w / 2, 0.013, z], [0.075, 0.018, l], palette.marking));
    lines.push(part([x, 0.013, z + l / 2], [w, 0.018, 0.075], palette.marking));
  }
  batch('BayLines', markings, lines);
  const walls = addNode('WallsAndCurbs', root);
  if (garage) {
    box('BackWall', walls, [0, 2.8, -14.8], [30, 5.6, 0.4], concrete);
    box('LeftWall', walls, [-14.8, 2.8, 0], [0.4, 5.6, 30], concrete);
    box('RightWall', walls, [14.8, 2.8, 0], [0.4, 5.6, 30], concrete);
    const wallParts = [part([0, 1.15, -14.59], [29.2, 0.25, 0.014], [0.39, 0.3, 0.43])];
    for (const side of [-1, 1]) {
      wallParts.push(part([side * 14.59, 1.15, 0], [0.014, 0.25, 29.2], [0.39, 0.3, 0.43]));
      wallParts.push(part([side * 14.58, 0.17, 0], [0.02, 0.25, 29.2], dark));
    }
    for (let x = -12; x <= 12; x += 3) wallParts.push(part([x, 2.8, -14.58], [0.015, 5.6, 0.018], [0.43, 0.4, 0.39]));
    for (let z = -12; z <= 12; z += 3) {
      for (const side of [-1, 1]) wallParts.push(part([side * 14.58, 2.8, z], [0.018, 5.6, 0.015], [0.43, 0.4, 0.39]));
    }
    wallParts.push(part([-0.1, 2.25, -14.56], [1.4, 0.8, 0.04], dark));
    wallParts.push(...lettering('B1', -0.58, 2.49, -14.53, 0.11));
    batch('GarageWallDetails', walls, wallParts);
    const floorParts = [];
    for (let v = -12; v <= 12; v += 3) {
      floorParts.push(part([v, 0.002, 0], [0.012, 0.002, 30], [0.32, 0.31, 0.32]));
      floorParts.push(part([0, 0.002, v], [30, 0.002, 0.012], [0.32, 0.31, 0.32]));
    }
    batch('ConcreteJoints', root, floorParts);
    const pillars = addNode('Pillars', root), guards = [];
    for (const x of [-9, 9]) {
      for (const z of [-8, 8]) {
        box(`Pillar${x < 0 ? 'L' : 'R'}${z < 0 ? 'F' : 'B'}`, pillars,
          [x, 2.45, z], [0.7, 4.9, 0.7], [0.63, 0.59, 0.52]);
        guards.push(part([x, 0.45, z], [0.71, 0.9, 0.71], dark));
        for (let y = 0.22; y < 0.9; y += 0.26) {
          for (const side of [-1, 1]) guards.push(part([x, y, z + side * 0.361],
            [0.66, 0.09, 0.012], [0.74, 0.67, 0.38], [0, 0, -0.35]));
        }
        guards.push(part([x, 1.7, z + 0.36], [0.44, 0.58, 0.015], dark));
        guards.push(...lettering(x < 0 ? '1' : '2', x - 0.1, 1.87, z + 0.375, 0.08));
      }
    }
    batch('PillarGuardsAndLabels', pillars, guards);
    const ceiling = addNode('Ceiling', root);
    box('CeilingPanel', ceiling, [0, 5.75, 0], [30, 0.25, 30], [0.29, 0.28, 0.3]);
    const fixtures = [];
    for (const x of [-10, 0, 10]) {
      fixtures.push(part([x, 5.35, 0], [0.07, 0.07, 29], [0.43, 0.39, 0.4]));
      for (const z of [-10, -3, 4, 11]) {
        fixtures.push(part([x, 5.47, z], [2.4, 0.13, 0.24], dark));
        fixtures.push(part([x, 5.395, z], [2.2, 0.018, 0.19], [0.95, 0.9, 0.75]));
      }
    }
    for (const z of [-8, 8]) fixtures.push(part([0, 5.48, z], [30, 0.2, 0.25], [0.38, 0.35, 0.37]));
    batch('CeilingFixtures', ceiling, fixtures);
  } else {
    box('CurbLeft', walls, [-4.2, 0.12, 0], [0.3, 0.24, 32], [0.66, 0.63, 0.57]);
    box('CurbRight', walls, [4.2, 0.12, 0], [0.3, 0.24, 32], [0.66, 0.63, 0.57]);
    box('RoadsideFence', walls, [8, 0.9, 0], [0.18, 1.8, 28], [0.48, 0.45, 0.42]);
    box('RoadsideBlock', walls, [-7.2, 0.35, -1], [1.2, 0.7, 0.7], [0.56, 0.53, 0.48]);
    const surface = [part([0, 0.001, 0], [8.1, 0.002, 32], [0.23, 0.23, 0.25])];
    for (const side of [-1, 1]) {
      for (let z = -15; z <= 15; z += 1.5) {
        surface.push(part([side * 6.1, 0.003, z], [3.4, 0.003, 0.015], [0.43, 0.4, 0.38]));
        surface.push(part([side * 4.2, 0.242, z], [0.3, 0.004, 0.02], [0.34, 0.32, 0.31]));
      }
      surface.push(part([side * 6.2, 0.003, 0], [0.016, 0.003, 32], [0.43, 0.4, 0.38]));
      surface.push(part([side * 3.85, 0.004, 0], [0.08, 0.004, 32], [0.79, 0.76, 0.69]));
    }
    for (let z = -14; z < 16; z += 4) surface.push(part([-0.65, 0.004, z], [0.08, 0.004, 1.7], [0.78, 0.75, 0.67]));
    batch('RoadSurfaceDetails', root, surface);
    const fence = [], frontage = [];
    for (let z = -13; z <= 13; z += 2) {
      fence.push(part([7.89, 0.9, z], [0.035, 1.8, 0.06], [0.32, 0.31, 0.31]));
      fence.push(part([7.89, 1.65, z], [0.025, 0.035, 2], [0.29, 0.28, 0.3]));
    }
    for (let z = -10; z <= 10; z += 5) {
      frontage.push(part([10, 1.4, z], [2.7, 2.8, 4.6], [0.6, 0.55 + (z + 10) * 0.002, 0.48]));
      frontage.push(part([8.63, 1.55, z], [0.025, 1.25, 3.5], [0.2, 0.21, 0.23]));
      frontage.push(part([8.6, 1.55, z], [0.035, 1.25, 0.05], [0.76, 0.72, 0.63]));
      frontage.push(part([8.6, 1.55, z - 1.72], [0.035, 1.25, 0.05], [0.76, 0.72, 0.63]));
      frontage.push(part([8.6, 2.35, z], [0.06, 0.2, 4], [0.4, 0.31, 0.42]));
    }
    batch('FenceDetails', walls, fence);
    batch('BackgroundFrontage', root, frontage);
  }
}
