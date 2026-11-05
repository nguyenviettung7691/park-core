// SPDX-License-Identifier: CC-BY-NC-4.0
import { palette } from './palette.mjs';

export function authorEnvironment({ root, addNode, box }, assetId) {
    const groundSize = assetId === 'garage' ? [30, 0.24, 30] : [50, 0.24, 32];
    box('Ground', root, [0, -0.12, 0], groundSize, palette.concrete);

    const markings = addNode('ParkingMarkings', root);
    const slotZ = assetId === 'garage' ? 4 : -3;
    for (let slot = -1; slot <= 1; slot++) {
      const x = slot * 3.2;
      box(`ParkingLine${slot}Left`, markings, [x - 1.45, 0.012, slotZ],
        [0.08, 0.018, 5.2], palette.marking);
      box(`ParkingLine${slot}Right`, markings, [x + 1.45, 0.012, slotZ],
        [0.08, 0.018, 5.2], palette.marking);
      box(`ParkingLine${slot}Rear`, markings, [x, 0.012, slotZ + 2.56],
        [2.9, 0.018, 0.08], palette.target);
    }

    const walls = addNode('WallsAndCurbs', root);
    if (assetId === 'garage') {
      box('BackWall', walls, [0, 2.8, -14.8], [30, 5.6, 0.4], palette.concrete);
      box('LeftWall', walls, [-14.8, 2.8, 0], [0.4, 5.6, 30], palette.concrete);
      box('RightWall', walls, [14.8, 2.8, 0], [0.4, 5.6, 30], palette.concrete);
      const pillars = addNode('Pillars', root);
      for (const x of [-9, 9]) {
        for (const z of [-8, 8]) {
          box(`Pillar${x < 0 ? 'L' : 'R'}${z < 0 ? 'F' : 'B'}`, pillars,
            [x, 2.45, z], [0.7, 4.9, 0.7], palette.metal);
        }
      }
      const ceiling = addNode('Ceiling', root);
      box('CeilingPanel', ceiling, [0, 5.75, 0], [30, 0.25, 30], palette.trim);
    } else {
      box('CurbLeft', walls, [-4.2, 0.12, 0], [0.3, 0.24, 32], palette.metal);
      box('CurbRight', walls, [4.2, 0.12, 0], [0.3, 0.24, 32], palette.metal);
      box('RoadsideFence', walls, [8, 0.9, 0], [0.18, 1.8, 28], palette.concrete);
      box('RoadsideBlock', walls, [-7.2, 0.35, -1], [1.2, 0.7, 0.7], palette.target);
    }
}
