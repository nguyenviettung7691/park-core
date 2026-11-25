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
  const eyeZ = data.contract.driverEyeLocalM[2];
  const roofFront = eyeZ - 0.25, roofRear = cuv ? 1.15 : 0.62;
  const frontFoot = eyeZ - 0.9, rearFoot = cuv ? half - 0.2 : 1.37;
  const exterior = addNode('Exterior', root);
  const part = (size, center, color, rotation) =>
    transformGeometry(boxGeometry(size, color), center, rotation);
  if (!cuv) {
    authorSedanExterior({ addNode, addMesh }, data,
      { exterior, paint, part, frontZ, rearZ, half, belt, roofY, roofFront });
    authorCockpit({ root, addNode, addMesh, box }, data,
      { belt, eyeZ, roofRear, roofFront, roofY, part });
    authorWheels({ root, addMesh }, data, { frontZ, rearZ, part });
    authorMirrors({ root, addNode, addMesh }, data, exterior, true);
    return;
  }
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
    ? belt - 0.15 + Math.min(1, (z + half) / 0.5) * 0.11 : belt;
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
  const exteriorGlass = addNode('ExteriorGlazing', body);
  const outerGlass = facesGeometry(glassFaces.map((face, index) => ({
    ...face, points: index === 0 || index === 3 ? [...face.points].reverse() : face.points,
  })));
  outerGlass.singleSided = true;
  addMesh('ExteriorWindowFaces', exteriorGlass, outerGlass, palette.glass);
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
  authorCockpit({ root, addNode, addMesh, box }, data,
    { belt, eyeZ, roofRear, roofFront, roofY, part });
  authorWheels({ root, addMesh }, data, { frontZ, rearZ, part });
  authorMirrors({ root, addNode, addMesh }, data, exterior);
}

function authorCockpit({ root, addNode, addMesh, box }, data,
  { belt, eyeZ, roofRear, roofFront, roofY, part }) {
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
}

function authorWheels({ root, addMesh }, data, { frontZ, rearZ, part }) {
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
}

// Sedan exterior shell: one closed lofted lower body (hood, belt ledges, trunk deck,
// fascias, floor and lined wheel wells) plus a greenhouse whose glass and pillar
// panels share edges, so no interior cavity shows from outside.
// Inferred from a two-view reference: windshield foot is limited by the unchanged
// dashboard, so the hood/trunk ratio is approximate. The roof front stays on the
// cockpit headliner; physical profile, eye and mirror anchors are unchanged.
function authorSedanExterior({ addNode, addMesh }, data, s) {
  const { exterior, paint, part, frontZ, rearZ, half, belt, roofY, roofFront } = s;
  const roofRear = 0.85; // inferred: roof covers the rear bench; cockpit headliner keeps its old extent
  const sill = data.clearanceM, tire = data.tireRadiusM;
  const archRadius = tire + 0.075;
  const wsFoot = -1.68, rearFoot = 1.75, glassBase = 0.81, glassTop = 0.72;
  const hoodNose = 0.74, crown = 0.03, wellInner = 0.5, railH = 0.045;
  const quarterZ = -1.0, pillarB = 0.1, doorRearZ = 0.95, cPillarTopZ = 0.72;
  const well = [0.09, 0.09, 0.1], seam = [0.12, 0.11, 0.13];
  const amber = [0.86, 0.46, 0.06], lampRed = [0.65, 0.06, 0.09];
  const widthAt = (z) => data.bodySizeM[0] / 2 - Math.max(0, -z - (half - 0.3)) * 0.2 -
    Math.max(0, z - (half - 0.2)) * 0.2;
  const hoodT = (z) => Math.min(1, Math.max(0, (z + half) / (wsFoot + half)));
  const topAt = (z) => z < wsFoot ? hoodNose + (belt - hoodNose) * (1 - (1 - hoodT(z)) ** 2) : belt;
  const crownAt = (z) => z < wsFoot ? crown * (1 - hoodT(z)) : 0;
  const axles = [frontZ, rearZ];
  const archAxle = (z) => axles.find((axle) => Math.abs(z - axle) < archRadius);
  const archY = (z, axle) => tire + Math.sqrt(Math.max(0, archRadius ** 2 - (z - axle) ** 2));
  const archPoints = (axle) => Array.from({ length: 13 }, (_, i) =>
    [axle + archRadius * Math.cos(i * Math.PI / 12), tire + archRadius * Math.sin(i * Math.PI / 12)]);

  const sections = new Set([-half, -half + 0.1, -half + 0.3, -half + 0.5, -1.95, wsFoot,
    rearFoot, half - 0.2, half]);
  for (const axle of axles) for (const [z] of archPoints(axle)) sections.add(z);
  const zs = [...sections].sort((a, b) => a - b);
  const faces = [], hoodFaces = [];
  const hoodColumns = [-1, -0.4, 0.4, 1];
  const hoodPoint = (z, f) => [f * widthAt(z), topAt(z) + (Math.abs(f) < 1 ? crownAt(z) : 0), z];
  for (let i = 0; i < zs.length - 1; i++) {
    const a = zs[i], b = zs[i + 1];
    const axle = archAxle((a + b) / 2);
    const bottom = (z) => axle === undefined ? sill : archY(z, axle);
    for (const side of [-1, 1]) {
      faces.push({ color: paint, points: [[side * widthAt(a), bottom(a), a],
        [side * widthAt(b), bottom(b), b], [side * widthAt(b), topAt(b), b], [side * widthAt(a), topAt(a), a]] });
      if (a >= wsFoot && b <= rearFoot) {
        faces.push({ color: paint, points: [[side * glassBase, belt, a], [side * widthAt(a), belt, a],
          [side * widthAt(b), belt, b], [side * glassBase, belt, b]] });
      }
    }
    if (b <= wsFoot) {
      for (let c = 0; c < hoodColumns.length - 1; c++) {
        hoodFaces.push({ color: paint, points: [hoodPoint(a, hoodColumns[c]), hoodPoint(a, hoodColumns[c + 1]),
          hoodPoint(b, hoodColumns[c + 1]), hoodPoint(b, hoodColumns[c])] });
      }
    } else if (a >= rearFoot) {
      faces.push({ color: paint, points: [[-widthAt(a), belt, a], [widthAt(a), belt, a],
        [widthAt(b), belt, b], [-widthAt(b), belt, b]] });
    }
    const floor = axle === undefined ? widthAt : () => wellInner;
    faces.push({ color: palette.trim, points: [[-floor(a), sill, a], [floor(a), sill, a],
      [floor(b), sill, b], [-floor(b), sill, b]] });
  }
  const nose = -half, noseW = widthAt(nose);
  faces.push({ color: paint, points: [[-noseW, sill, nose], [noseW, sill, nose],
    [noseW, topAt(nose), nose], [0.4 * noseW, topAt(nose) + crownAt(nose), nose],
    [-0.4 * noseW, topAt(nose) + crownAt(nose), nose], [-noseW, topAt(nose), nose]] });
  const tailW = widthAt(half);
  faces.push({ color: paint, points: [[-tailW, sill, half], [tailW, sill, half],
    [tailW, belt, half], [-tailW, belt, half]] });
  for (const axle of axles) {
    const arch = archPoints(axle);
    for (const side of [-1, 1]) {
      for (let i = 0; i < arch.length - 1; i++) {
        const [za, ya] = arch[i], [zb, yb] = arch[i + 1];
        faces.push({ color: well, points: [[side * widthAt(za), ya, za], [side * widthAt(zb), yb, zb],
          [side * wellInner, yb, zb], [side * wellInner, ya, za]] });
      }
      for (const z of [axle - archRadius, axle + archRadius]) {
        faces.push({ color: well, points: [[side * wellInner, sill, z], [side * widthAt(z), sill, z],
          [side * widthAt(z), tire, z], [side * wellInner, tire, z]] });
      }
      faces.push({ color: well, points: [...arch.map(([z, y]) => [side * wellInner, y, z]),
        [side * wellInner, sill, axle - archRadius], [side * wellInner, sill, axle + archRadius]] });
    }
  }
  faces.push({ color: paint, points: [[-glassTop, roofY, roofFront], [glassTop, roofY, roofFront],
    [glassTop, roofY, roofRear], [-glassTop, roofY, roofRear]] });
  const body = addMesh('Body', exterior, facesGeometry(faces), paint, [0, -data.comHeightM, 0]);
  addMesh('Hood', body, facesGeometry(hoodFaces), paint);

  // Greenhouse planes. Side glass leans in from glassBase to glassTop.
  const rise = roofY - belt, railY = roofY - railH;
  const tY = (y) => (y - belt) / rise;
  const sidePoint = (side, z, y) => [side * (glassBase - (glassBase - glassTop) * tY(y)), y, z];
  const frontEdge = (y) => wsFoot + (roofFront - wsFoot) * tY(y);
  const rearEdge = (y) => rearFoot + (roofRear - rearFoot) * tY(y);
  const sideQuad = (side, color, [z0, z1], [z2, z3]) => ({ color, points: [sidePoint(side, z0, belt),
    sidePoint(side, z1, belt), sidePoint(side, z2, railY), sidePoint(side, z3, railY)] });
  const endPoint = (footZ, topZ, x, v) => [x, belt + rise * v, footZ + (topZ - footZ) * v];
  const halfAt = (v) => glassBase - (glassBase - glassTop) * v;
  const glassV = 1 - 0.05 / rise, strip = 0.07;
  const endPanels = (footZ, topZ) => {
    const p = (x, v) => endPoint(footZ, topZ, x, v);
    const glass = { color: palette.glass, points: [p(-halfAt(0) + strip, 0), p(halfAt(0) - strip, 0),
      p(halfAt(glassV) - strip, glassV), p(-halfAt(glassV) + strip, glassV)] };
    const frame = [{ color: paint, points: [p(-halfAt(glassV), glassV), p(halfAt(glassV), glassV),
      p(halfAt(1), 1), p(-halfAt(1), 1)] }];
    for (const side of [-1, 1]) {
      frame.push({ color: paint, points: [p(side * halfAt(0), 0), p(side * (halfAt(0) - strip), 0),
        p(side * (halfAt(glassV) - strip), glassV), p(side * halfAt(glassV), glassV)] });
    }
    return { glass, frame };
  };
  const front = endPanels(wsFoot, roofFront), rear = endPanels(rearFoot, roofRear);
  const aWidth = 0.09;
  const cLine = (y) => doorRearZ + (cPillarTopZ - doorRearZ) * tY(y) / tY(railY);
  const glassFaces = [front.glass, rear.glass];
  const aPillars = [...front.frame], bPillars = [], cPillars = [...rear.frame];
  for (const side of [-1, 1]) {
    aPillars.push(sideQuad(side, paint, [frontEdge(belt), frontEdge(belt) + aWidth],
      [frontEdge(railY) + aWidth, frontEdge(railY)]));
    glassFaces.push(sideQuad(side, palette.glass, [frontEdge(belt) + aWidth, quarterZ - 0.02],
      [quarterZ - 0.02, frontEdge(railY) + aWidth]));
    bPillars.push(sideQuad(side, paint, [quarterZ - 0.02, quarterZ + 0.02], [quarterZ + 0.02, quarterZ - 0.02]));
    glassFaces.push(sideQuad(side, palette.glass, [quarterZ + 0.02, pillarB - 0.04], [pillarB - 0.04, quarterZ + 0.02]));
    bPillars.push(sideQuad(side, paint, [pillarB - 0.04, pillarB + 0.04], [pillarB + 0.04, pillarB - 0.04]));
    glassFaces.push(sideQuad(side, palette.glass, [pillarB + 0.04, cLine(belt)], [cLine(railY), pillarB + 0.04]));
    cPillars.push(sideQuad(side, paint, [cLine(belt), rearEdge(belt)], [rearEdge(railY), cLine(railY)]));
    bPillars.push({ color: paint, points: [sidePoint(side, frontEdge(railY), railY),
      sidePoint(side, rearEdge(railY), railY), sidePoint(side, roofRear, roofY), sidePoint(side, roofFront, roofY)] });
  }
  addMesh('Cabin', body, facesGeometry(bPillars), paint);
  addMesh('Windshield', body, facesGeometry(aPillars), paint);
  addMesh('RearWindow', body, facesGeometry(cPillars), paint);
  const glazing = addNode('ParkedGlazing', body);
  addMesh('StaticWindowFaces', glazing, facesGeometry(glassFaces), palette.glass);
  const cabinCenter = [0, (belt + roofY) / 2, (wsFoot + rearFoot) / 2];
  const outerGlass = facesGeometry(glassFaces.map((face) => {
    const [p0, p1, p2] = face.points;
    const u = p1.map((v, i) => v - p0[i]), w = p2.map((v, i) => v - p0[i]);
    const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const centroid = [0, 1, 2].map((i) => face.points.reduce((sum, p) => sum + p[i], 0) / face.points.length);
    const outward = normal.reduce((sum, v, i) => sum + v * (centroid[i] - cabinCenter[i]), 0) > 0;
    return outward ? face : { ...face, points: [...face.points].reverse() };
  }));
  outerGlass.singleSided = true;
  addMesh('ExteriorWindowFaces', addNode('ExteriorGlazing', body), outerGlass, palette.glass);

  // Bolt-on details: bumpers wrap the tapered corners, lamps, grille, seams.
  const detail = [];
  const taper = Math.atan(0.2);
  const seamBar = (side, z1, y1, z2, y2) => part([0.01, Math.hypot(y2 - y1, z2 - z1), 0.012],
    [side * (widthAt((z1 + z2) / 2) + 0.004), (y1 + y2) / 2, (z1 + z2) / 2], seam,
    [Math.atan2(z2 - z1, y2 - y1), 0, 0]);
  for (const [z, wrapZ, wrapLength, sign] of [[-half, -half + 0.15, 0.32, 1], [half, half - 0.1, 0.22, -1]]) {
    detail.push(part([1.74, 0.15, 0.1], [0, 0.37, z], palette.trim));
    for (const side of [-1, 1]) {
      detail.push(part([0.07, 0.15, wrapLength], [side * widthAt(wrapZ), 0.37, wrapZ], palette.trim,
        [0, side * sign * taper, 0]));
    }
  }
  detail.push(part([0.66, 0.13, 0.03], [0, 0.62, -half - 0.005], [0.2, 0.19, 0.22]));
  detail.push(part([0.66, 0.012, 0.035], [0, 0.62, -half - 0.006], [0.3, 0.29, 0.32]));
  detail.push(part([0.34, 0.11, 0.015], [0, 0.55, half + 0.008], [0.84, 0.8, 0.71]));
  detail.push(transformGeometry(cylinderXGeometry(0.035, 0.16, palette.metal, 10),
    [-0.5, 0.25, half + 0.03], [0, Math.PI / 2, 0]));
  detail.push(part([1.56, 0.006, 0.012], [0, belt + 0.003, rearFoot + 0.05], seam));
  for (const side of [-1, 1]) {
    detail.push(part([0.34, 0.12, 0.04], [side * 0.56, 0.62, -half - 0.005], [0.98, 0.89, 0.69]));
    detail.push(part([0.26, 0.13, 0.04], [side * 0.5, 0.7, half + 0.005], lampRed));
    detail.push(part([0.2, 0.13, 0.04], [side * 0.74, 0.7, half + 0.005], amber));
    detail.push(part([0.02, 0.06, 0.12], [side * 0.905, 0.7, half - 0.32], amber));
    detail.push(part([0.012, 0.006, half - rearFoot - 0.07], [side * 0.78, belt + 0.003,
      (half + rearFoot + 0.05) / 2], seam));
    for (const z of [pillarB - 0.2, doorRearZ - 0.12]) {
      detail.push(part([0.02, 0.03, 0.13], [side * 0.91, 0.74, z], palette.metal));
    }
    const frontArchEnd = frontZ + archRadius + 0.03;
    detail.push(seamBar(side, frontArchEnd, sill + 0.04, frontArchEnd, 0.66));
    detail.push(seamBar(side, frontArchEnd, 0.66, quarterZ, belt - 0.005));
    detail.push(seamBar(side, pillarB, sill + 0.04, pillarB, belt - 0.005));
    detail.push(seamBar(side, doorRearZ, sill + 0.04, doorRearZ, belt - 0.005));
  }
  addMesh('ExteriorDetails', body, mergeGeometry(detail), paint);
}

function authorMirrors({ root, addNode, addMesh }, data, exterior, armHousing = false) {
  const eye = data.contract.driverEyeLocalM;
  addNode('DriverEye', root, { translation: eye });
  for (const [id, pose] of Object.entries(data.contract.mirrors)) {
    const name = id[0].toUpperCase() + id.slice(1);
    const position = pose.positionM;
    addNode(`Mirror${name}`, root, { translation: position, rotation: pose.rotation });
    const display = name === 'Rear'
      ? data.contract.rearDisplayM : position;
    const size = name === 'Rear' ? [0.12, 0.05, 0.025] : [0.18, 0.1, 0.035];
    const surface = {
      positions: [-size[0] / 2, -size[1] / 2, 0, size[0] / 2, -size[1] / 2, 0,
        size[0] / 2, size[1] / 2, 0, -size[0] / 2, size[1] / 2, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      colors: Array(12).fill(1), indices: [0, 1, 2, 0, 2, 3], uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    };
    addMesh(`MirrorSurface${name}`, root, surface, [1, 1, 1], display);
    if (armHousing && name !== 'Rear') {
      // Same shell placement as before (rearward of the face, away from the eye),
      // plus a low arm to the door belt below the driver's sightline. Anchors unchanged.
      const side = Math.sign(position[0]);
      const shell = transformGeometry(boxGeometry(size.map((v) => v + 0.025), palette.trim), [0, 0, 0.04]);
      const doorX = data.bodySizeM[0] / 2 - 0.02;
      const arm = boxGeometry([Math.abs(position[0]) + 0.03 - doorX, 0.035, 0.05], palette.trim);
      const armCenter = [side * ((Math.abs(position[0]) + 0.03 + doorX) / 2 - Math.abs(position[0])),
        -0.095, 0.04];
      addMesh(`MirrorHousing${name}`, exterior,
        mergeGeometry([shell, transformGeometry(arm, armCenter)]), palette.trim, display);
      continue;
    }
    addMesh(`MirrorHousing${name}`, exterior, boxGeometry(size.map((v) => v + 0.025), palette.trim),
      palette.trim, [display[0], display[1], display[2] + (name === 'Rear' ? -0.04 : 0.04)]);
  }
}
