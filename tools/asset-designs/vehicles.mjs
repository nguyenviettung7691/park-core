// SPDX-License-Identifier: CC-BY-NC-4.0
import { cylinderXGeometry, torusGeometry } from '../asset-geometry.mjs';
import { palette } from './palette.mjs';

export function authorVehicle({ root, addNode, addMesh, box }, assetId, data) {
  const yawQuaternion = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    const [width, height, length] = data.bodySizeM;
    const bodyCenterY = (data.clearanceM + height) / 2 - data.comHeightM;
    const body = box('Body', root, [0, bodyCenterY, 0],
      [width, height - data.clearanceM, length], palette.body);
    box('Hood', body, [0, 0.04, -length * 0.31],
      [width * 0.93, 0.22, length * 0.3], palette.body);
    box('Cabin', body, [0, height * 0.17, -0.02],
      [width * 0.78, height * 0.44, length * 0.43], palette.trim);
    box('Windshield', body, [0, height * 0.36, -0.68],
      [width * 0.7, 0.045, 0.64], palette.glass);
    box('RearWindow', body, [0, height * 0.36, 0.88],
      [width * 0.68, 0.04, 0.48], palette.glass);
    box('Dashboard', body, [-0.08, 0.27, -0.62],
      [1.1, 0.16, 0.38], palette.trim);
    box('DriverSeat', body, [-0.36, 0.05, 0.12],
      [0.5, 0.62, 0.58], palette.trim);
    addMesh('SteeringWheel', body, torusGeometry(0.17, 0.025, palette.metal), palette.metal,
      [-0.36, 0.46, -0.68]);
    box('FrontBumper', body, [0, -0.06, -length * 0.49],
      [width * 0.97, 0.16, 0.12], palette.trim);
    box('RearBumper', body, [0, -0.06, length * 0.49],
      [width * 0.97, 0.16, 0.12], palette.trim);
    for (const side of [-1, 1]) {
      box(`Headlight${side < 0 ? 'Left' : 'Right'}`, body,
        [side * width * 0.34, 0.03, -length * 0.47],
        [0.22, 0.11, 0.06], palette.light);
    }

    const frontZ = -(1 - data.frontWeightFraction) * data.wheelbaseM;
    const rearZ = data.frontWeightFraction * data.wheelbaseM;
    const wheelY = data.tireRadiusM - data.comHeightM;
    const wheelPositions = [
      ['WheelFL', -data.trackM / 2, frontZ],
      ['WheelFR', data.trackM / 2, frontZ],
      ['WheelRL', -data.trackM / 2, rearZ],
      ['WheelRR', data.trackM / 2, rearZ],
    ];
    const wheelGeometry = cylinderXGeometry(data.tireRadiusM, 0.18, palette.tire);
    for (const [name, x, z] of wheelPositions) {
      addMesh(name, root, wheelGeometry, palette.tire, [x, wheelY, z]);
    }
    const eye = [-0.36, data.eyeHeightM - data.comHeightM,
      -(1 - data.frontWeightFraction) * data.wheelbaseM + 0.25];
    addNode('DriverEye', root, { translation: eye });
    const mirrorY = data.mirrorHeightM - data.comHeightM;
    const mirrorZ = frontZ + 0.35;
    addNode('MirrorRear', root, {
      translation: [0, eye[1] + 0.12, eye[2] - 0.75],
      rotation: yawQuaternion(Math.PI),
    });
    box('MirrorSurfaceRear', root, [0, eye[1] + 0.12, eye[2] - 0.75],
      [0.24, 0.1, 0.025], palette.metal);
    for (const side of [-1, 1]) {
      const sideName = side < 0 ? 'Left' : 'Right';
      const mirrorX = side * (data.mirrorWidthM + width) / 4;
      addNode(`Mirror${sideName}`, root, {
        translation: [mirrorX, mirrorY, mirrorZ],
        rotation: yawQuaternion(side < 0 ? 105 * Math.PI / 180 : -105 * Math.PI / 180),
      });
      box(`MirrorSurface${sideName}`, root, [mirrorX, mirrorY, mirrorZ],
        [0.18, 0.1, 0.035], palette.metal);
    }

}
