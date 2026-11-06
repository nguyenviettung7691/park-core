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
  const windowBottomY = belt - 0.1;
  const frontZ = -(1 - data.frontWeightFraction) * data.wheelbaseM;
  const rearZ = data.frontWeightFraction * data.wheelbaseM;
  const eyeZ = frontZ + 0.25;
  const roofFront = eyeZ - 0.25, roofRear = cuv ? 1.15 : 0.62;
  const frontFoot = eyeZ - 0.78, rearFoot = cuv ? half - 0.2 : half - 0.25;
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
  const upperAt = (z) => z < frontFoot
    ? belt - 0.15 + Math.min(1, (z + half) / 0.5) * 0.05 : windowBottomY;
  const faces = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < zValues.length - 1; i++) {
      const a = zValues[i], b = zValues[i + 1];
      faces.push({ color: paint, points: [[side * widthAt(a), lowerAt(a), a],
        [side * widthAt(b), lowerAt(b), b], [side * widthAt(b), upperAt(b), b], [side * widthAt(a), upperAt(a), a]] });
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
        return [x, upperAt(z) + (1 - (x / widthAt(z)) ** 2) * 0.04, z];
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
    frameParts.push(pillar(side, 0.15, windowBottomY, 0.15, roofY - 0.02, 0.06));
    frameParts.push(part([0.07, 0.055, roofRear - roofFront], [side * 0.72, roofY - 0.03, (roofRear + roofFront) / 2], paint));
  }
  addMesh('Cabin', body, mergeGeometry(frameParts), paint);
  addMesh('Windshield', body, mergeGeometry([-1, 1].map((s) =>
    pillar(s, frontFoot, windowBottomY, roofFront, roofY - 0.05, 0.065))), paint);
  addMesh('RearWindow', body, mergeGeometry([-1, 1].map((s) =>
    pillar(s, rearFoot, windowBottomY, roofRear, roofY - 0.05, cuv ? 0.12 : 0.075))), paint);
  const glazing = addNode('ParkedGlazing', body);
  const glassFaces = [
    { points: [[-0.7, windowBottomY, frontFoot], [0.7, windowBottomY, frontFoot],
      [0.69, roofY - 0.04, roofFront], [-0.69, roofY - 0.04, roofFront]], color: palette.glass },
    { points: [[-0.7, windowBottomY, rearFoot], [0.7, windowBottomY, rearFoot],
      [0.69, roofY - 0.04, roofRear], [-0.69, roofY - 0.04, roofRear]], color: palette.glass },
    ...[-1, 1].map((s) => ({ points: [[s * 0.73, windowBottomY, frontFoot], [s * 0.73, windowBottomY, rearFoot],
      [s * 0.69, roofY - 0.04, roofRear], [s * 0.69, roofY - 0.04, roofFront]], color: palette.glass })),
  ];
  addMesh('StaticWindowFaces', glazing, facesGeometry(glassFaces), palette.glass);
  const exteriorGlass = addNode('ExteriorGlazing', body);
  const outerGlass = facesGeometry(glassFaces.map((face, index) => ({
    ...face, points: index === 0 || index === 3 ? [...face.points].reverse() : face.points,
  })));
  outerGlass.singleSided = true;
  addMesh('ExteriorWindowFaces', exteriorGlass, outerGlass, palette.glass);
  const detail = [];
  if (cuv) {
    detail.push(part([1.66, 0.1, half - rearFoot],
      [0, belt - 0.04, (half + rearFoot) / 2], paint));
  } else {
    const trunkTop = facesGeometry([{
      color: paint,
      points: [
        [-widthAt(rearFoot), belt - 0.025, rearFoot],
        [-widthAt(half), belt - 0.025, half],
        [widthAt(half), belt - 0.025, half],
        [widthAt(rearFoot), belt - 0.025, rearFoot],
      ],
    }]);
    addMesh('Trunk', body, trunkTop, paint);
  }
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
          const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
          const point = (angle, radius) => [side * 0.903,
            data.tireRadiusM + radius * Math.sin(angle), axle + radius * Math.cos(angle)];
          detail.push(facesGeometry([{ color: palette.trim, points: [point(a, archRadius - 0.02),
            point(b, archRadius - 0.02), point(b, archRadius + 0.02), point(a, archRadius + 0.02)] }]));
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
  box('Dashboard', cockpit, [0, belt - 0.06, eyeZ - 0.52], [1.46, 0.16, 0.26], palette.trim);
  const cabinParts = [part([1.42, 0.07, roofRear - roofFront], [0, roofY - 0.075, (roofRear + roofFront) / 2], palette.trim)];
  for (const x of [-0.36, 0.36]) {
    cabinParts.push(part([0.49, 0.12, 0.58], [x, 0.43, 0.14], [0.19, 0.17, 0.2]));
    cabinParts.push(part([0.48, 0.5, 0.13], [x, 0.72, 0.43], [0.22, 0.2, 0.23], [-0.12, 0, 0]));
    cabinParts.push(part([0.24, 0.16, 0.12], [x, 1.02, 0.44], palette.trim));
  }
  cabinParts.push(part([1.35, 0.42, 0.16], [0, 0.65, roofRear - 0.05], palette.trim));
  cabinParts.push(part([0.19, 0.28, 0.64], [0, 0.44, -0.2], palette.trim));
  cabinParts.push(part([0.3, 0.09, 0.025], [-0.36, belt + 0.02, eyeZ - 0.4], [0.08, 0.08, 0.1]));
  for (const x of [-0.43, -0.29]) {
    cabinParts.push(transformGeometry(torusGeometry(0.035, 0.004, [0.75, 0.72, 0.69], 12, 4),
      [x, belt + 0.02, eyeZ - 0.38]));
    cabinParts.push(part([0.003, 0.025, 0.006], [x, belt + 0.025, eyeZ - 0.375], palette.marking));
  }
  addMesh('SeatsAndInterior', cockpit, mergeGeometry(cabinParts), palette.trim);
  addMesh('SteeringWheel', cockpit, mergeGeometry([torusGeometry(0.17, 0.024, palette.trim),
    boxGeometry([0.29, 0.035, 0.045], palette.metal), boxGeometry([0.075, 0.09, 0.06], palette.trim)]),
  palette.trim, [-0.36, belt + 0.015, eyeZ - 0.35]);

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
  const eye = [-0.36, data.eyeHeightM - data.comHeightM, eyeZ];
  addNode('DriverEye', root, { translation: eye });
  const yawQuaternion = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const mirrors = [['Rear', [0, eye[1] + 0.12, eye[2] - 0.75], Math.PI],
    ...[-1, 1].map((side) => [side < 0 ? 'Left' : 'Right',
      [side * (data.mirrorWidthM + width) / 4, data.mirrorHeightM - data.comHeightM, frontZ + 0.35],
      (side < 0 ? 105 : -105) * Math.PI / 180])];
  for (const [name, position, yaw] of mirrors) {
    addNode(`Mirror${name}`, root, { translation: position, rotation: yawQuaternion(yaw) });
    const display = name === 'Rear'
      ? [-0.25, position[1] - 0.075, position[2] + 0.52] : position;
    const size = name === 'Rear' ? [0.12, 0.05, 0.025] : [0.18, 0.1, 0.035];
    const surface = {
      positions: [-size[0] / 2, -size[1] / 2, 0, size[0] / 2, -size[1] / 2, 0,
        size[0] / 2, size[1] / 2, 0, -size[0] / 2, size[1] / 2, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      colors: Array(12).fill(1), indices: [0, 1, 2, 0, 2, 3], uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    };
    addMesh(`MirrorSurface${name}`, root, surface, [1, 1, 1], display);
    addMesh(`MirrorHousing${name}`, exterior, boxGeometry(size.map((v) => v + 0.025), palette.trim),
      palette.trim, [display[0], display[1], display[2] + (name === 'Rear' ? -0.04 : 0.04)]);
  }
}
