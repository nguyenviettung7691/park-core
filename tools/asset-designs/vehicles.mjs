// SPDX-License-Identifier: CC-BY-NC-4.0
import { boxGeometry, cylinderXGeometry, facesGeometry, mergeGeometry,
  torusGeometry, transformGeometry } from '../asset-geometry.mjs';
import { palette } from './palette.mjs';

export function authorVehicle({ root, addNode, addMesh, box }, assetId, data) {
  const cuv = assetId === 'cuv';
  const paint = cuv ? [0.74, 0.66, 0.52] : [0.43, 0.23, 0.52];
  const [width, height, length] = data.bodySizeM;
  const roofY = height - (cuv ? 0.075 : 0);
  const half = length / 2, belt = cuv ? 0.99 : 0.83;
  const frontZ = -(1 - data.frontWeightFraction) * data.wheelbaseM;
  const rearZ = data.frontWeightFraction * data.wheelbaseM;
  const roofFront = -0.48, roofRear = cuv ? 1.15 : 0.62;
  const frontFoot = -1.27, rearFoot = cuv ? half - 0.2 : 1.37;
  const exterior = addNode('Exterior', root);
  const part = (size, center, color, rotation) =>
    transformGeometry(boxGeometry(size, color), center, rotation);
  const widthAt = (z) => width / 2 - Math.max(0, -z - (half - 0.45)) * 0.38 -
    Math.max(0, z - (half - 0.2)) * 0.22;
  const archRadius = data.tireRadiusM + 0.075;
  const sections = new Set([-half, -half + 0.15, -half + 0.45, frontFoot, rearFoot, half - 0.2, half]);
  for (const axle of [frontZ, rearZ]) {
    for (let i = 0; i <= 12; i++) sections.add(axle + archRadius * Math.cos(i * Math.PI / 12));
  }
  const zValues = [...sections].sort((a, b) => a - b);
  const lowerAt = (z) => Math.max(data.clearanceM, ...[frontZ, rearZ].map((axle) =>
    Math.abs(z - axle) <= archRadius
      ? data.tireRadiusM + Math.sqrt(Math.max(0, archRadius ** 2 - (z - axle) ** 2)) : 0));
  const faces = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < zValues.length - 1; i++) {
      const a = zValues[i], b = zValues[i + 1];
      faces.push({ color: paint, points: [[side * widthAt(a), lowerAt(a), a],
        [side * widthAt(b), lowerAt(b), b], [side * widthAt(b), belt, b], [side * widthAt(a), belt, a]] });
    }
  }
  faces.push({ color: palette.trim, points: [[-0.7, data.clearanceM, -half], [0.7, data.clearanceM, -half],
    [0.7, data.clearanceM, half], [-0.7, data.clearanceM, half]] });
  for (const z of [-half, half]) faces.push({ color: paint, points: [[-widthAt(z), data.clearanceM, z],
    [widthAt(z), data.clearanceM, z], [widthAt(z), belt - 0.13, z], [-widthAt(z), belt - 0.13, z]] });
  faces.push({ color: paint, points: [[-0.69, roofY, roofFront], [0.69, roofY, roofFront],
    [0.69, roofY, roofRear], [-0.69, roofY, roofRear]] });
  const rails = cuv ? [-1, 1].map((s) => part([0.065, 0.075, 1.65],
    [s * 0.57, height - 0.0375, 0.37], palette.trim)) : [];
  const body = addMesh('Body', exterior, mergeGeometry([facesGeometry(faces), ...rails]),
    paint, [0, -data.comHeightM, 0]);

  const hoodFaces = [];
  const hoodZ = [-half, -half + 0.12, -half + 0.35, frontFoot];
  for (let i = 0; i < hoodZ.length - 1; i++) {
    for (let segment = 0; segment < 4; segment++) {
      const point = (z, s) => {
        const x = (s / 2 - 1) * widthAt(z);
        const rise = Math.min(1, (z + half) / 0.5);
        return [x, belt - 0.15 + rise * 0.11 + (1 - (x / widthAt(z)) ** 2) * 0.04, z];
      };
      hoodFaces.push({ color: paint, points: [point(hoodZ[i], segment), point(hoodZ[i], segment + 1),
        point(hoodZ[i + 1], segment + 1), point(hoodZ[i + 1], segment)] });
    }
  }
  addMesh('Hood', body, facesGeometry(hoodFaces), paint);
  const frameParts = [];
  const pillar = (side, z1, y1, z2, y2, thickness) => {
    const dy = y2 - y1, dz = z2 - z1;
    return part([thickness, Math.hypot(dy, dz), 0.065],
      [side * 0.73, (y1 + y2) / 2, (z1 + z2) / 2], paint, [Math.atan2(dz, dy), 0, 0]);
  };
  for (const side of [-1, 1]) {
    frameParts.push(pillar(side, 0.15, belt, 0.15, roofY - 0.02, 0.06));
    frameParts.push(part([0.07, 0.055, roofRear - roofFront], [side * 0.72, roofY - 0.03, (roofRear + roofFront) / 2], paint));
  }
  addMesh('Cabin', body, mergeGeometry(frameParts), paint);
  addMesh('Windshield', body, mergeGeometry([-1, 1].map((s) =>
    pillar(s, frontFoot, belt, roofFront, roofY - 0.05, 0.065))), paint);
  addMesh('RearWindow', body, mergeGeometry([-1, 1].map((s) =>
    pillar(s, rearFoot, belt, roofRear, roofY - 0.05, cuv ? 0.12 : 0.075))), paint);
  const glazing = addNode('ParkedGlazing', body);
  const glassFaces = [
    { points: [[-0.7, belt, frontFoot], [0.7, belt, frontFoot],
      [0.69, roofY - 0.04, roofFront], [-0.69, roofY - 0.04, roofFront]], color: palette.glass },
    { points: [[-0.7, belt, rearFoot], [0.7, belt, rearFoot],
      [0.69, roofY - 0.04, roofRear], [-0.69, roofY - 0.04, roofRear]], color: palette.glass },
    ...[-1, 1].map((s) => ({ points: [[s * 0.73, belt, frontFoot], [s * 0.73, belt, rearFoot],
      [s * 0.69, roofY - 0.04, roofRear], [s * 0.69, roofY - 0.04, roofFront]], color: palette.glass })),
  ];
  addMesh('StaticWindowFaces', glazing, facesGeometry(glassFaces), palette.glass);
  const rearDeck = cuv
    ? part([1.66, 0.1, half - rearFoot], [0, belt - 0.04, (half + rearFoot) / 2], paint)
    : part([1.72, 0.09, half - rearFoot], [0, belt - 0.07, (half + rearFoot) / 2], paint);
  const detail = [rearDeck];
  for (const side of [-1, 1]) {
    detail.push(part([0.025, 0.035, length - 0.4], [side * 0.885, belt - 0.23, 0], palette.trim));
    for (const z of [-0.25, 0.85]) {
      detail.push(part([0.035, 0.035, 0.16], [side * 0.9, belt - 0.09, z], palette.metal));
      detail.push(part([0.012, belt - 0.28, 0.012], [side * 0.901, (belt + 0.22) / 2, z + 0.2], palette.trim));
    }
    detail.push(part([0.33, 0.115, 0.05], [side * 0.57, belt - 0.22, -half + 0.015], [0.98, 0.89, 0.69]));
    detail.push(part(cuv ? [0.14, 0.32, 0.05] : [0.36, 0.12, 0.05],
      [side * 0.64, belt - 0.19, half - 0.01], [0.65, 0.06, 0.09]));
    if (cuv) {
      for (const axle of [frontZ, rearZ]) {
        for (let i = 0; i < 12; i++) {
          const angle = (i + 0.5) * Math.PI / 12;
          detail.push(part([0.026, 0.035, archRadius * Math.PI / 12],
            [side * 0.901, data.tireRadiusM + archRadius * Math.sin(angle), axle + archRadius * Math.cos(angle)],
            palette.trim, [angle - Math.PI / 2, 0, 0]));
        }
      }
    }
  }
  detail.push(part([0.76, 0.16, 0.035], [0, belt - 0.35, -half - 0.005], palette.trim));
  for (const z of [-half, half]) {
    detail.push(part([1.6, 0.13, 0.06], [0, 0.3, z], palette.trim));
    detail.push(part([0.34, 0.09, 0.015], [0, belt - 0.31, z * 1.003], [0.84, 0.8, 0.71]));
  }
  addMesh('ExteriorDetails', body, mergeGeometry(detail), paint);
  const cockpit = addNode('Cockpit', root, { translation: [0, -data.comHeightM, 0] });
  box('Dashboard', cockpit, [0, belt - 0.06, frontFoot + 0.17], [1.46, 0.16, 0.26], palette.trim);
  const cabinParts = [part([1.42, 0.07, roofRear - roofFront], [0, roofY - 0.075, (roofRear + roofFront) / 2], palette.trim)];
  for (const x of [-0.36, 0.36]) {
    cabinParts.push(part([0.49, 0.12, 0.58], [x, 0.43, 0.14], [0.19, 0.17, 0.2]));
    cabinParts.push(part([0.48, 0.5, 0.13], [x, 0.72, 0.43], [0.22, 0.2, 0.23], [-0.12, 0, 0]));
    cabinParts.push(part([0.24, 0.16, 0.12], [x, 1.02, 0.44], palette.trim));
  }
  cabinParts.push(part([1.35, 0.42, 0.16], [0, 0.65, roofRear - 0.05], palette.trim));
  cabinParts.push(part([0.19, 0.28, 0.64], [0, 0.44, -0.2], palette.trim));
  cabinParts.push(part([0.3, 0.09, 0.025], [-0.36, belt + 0.02, frontFoot + 0.31], [0.08, 0.08, 0.1]));
  addMesh('SeatsAndInterior', cockpit, mergeGeometry(cabinParts), palette.trim);
  addMesh('SteeringWheel', cockpit, mergeGeometry([torusGeometry(0.17, 0.024, palette.trim),
    boxGeometry([0.29, 0.035, 0.045], palette.metal), boxGeometry([0.075, 0.09, 0.06], palette.trim)]),
  palette.trim, [-0.36, belt + 0.015, frontFoot + 0.5]);

  const wheel = mergeGeometry([cylinderXGeometry(data.tireRadiusM, 0.19, palette.tire, 24),
    cylinderXGeometry(data.tireRadiusM * 0.86, 0.205, [0.105, 0.1, 0.11], 24),
    cylinderXGeometry(data.tireRadiusM * 0.64, 0.215, palette.metal, 16),
    cylinderXGeometry(data.tireRadiusM * 0.48, 0.22, palette.trim, 16),
    ...Array.from({ length: 5 }, (_, i) => part([0.225, 0.035, data.tireRadiusM * 1.1],
      [0, 0, 0], palette.metal, [i * Math.PI / 5, 0, 0])),
    cylinderXGeometry(0.055, 0.23, [0.68, 0.66, 0.69], 12)]);
  for (const [name, side, z] of [['WheelFL', -1, frontZ], ['WheelFR', 1, frontZ],
    ['WheelRL', -1, rearZ], ['WheelRR', 1, rearZ]]) {
    addMesh(name, root, wheel, palette.tire, [side * data.trackM / 2, data.tireRadiusM - data.comHeightM, z]);
  }
  const eye = [-0.36, data.eyeHeightM - data.comHeightM, frontZ + 0.25];
  addNode('DriverEye', root, { translation: eye });
  const yawQuaternion = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const mirrors = [['Rear', [0, eye[1] + 0.12, eye[2] - 0.75], Math.PI],
    ...[-1, 1].map((side) => [side < 0 ? 'Left' : 'Right',
      [side * (data.mirrorWidthM + width) / 4, data.mirrorHeightM - data.comHeightM, frontZ + 0.35],
      (side < 0 ? 105 : -105) * Math.PI / 180])];
  for (const [name, position, yaw] of mirrors) {
    addNode(`Mirror${name}`, root, { translation: position, rotation: yawQuaternion(yaw) });
    const size = name === 'Rear' ? [0.24, 0.1, 0.025] : [0.18, 0.1, 0.035];
    box(`MirrorSurface${name}`, root, position, size, palette.metal);
    addMesh(`MirrorHousing${name}`, exterior, boxGeometry(size.map((v) => v + 0.025), palette.trim),
      palette.trim, [position[0], position[1], position[2] - 0.04]);
  }
}
