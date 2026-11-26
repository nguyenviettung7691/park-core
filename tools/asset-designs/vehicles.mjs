// SPDX-License-Identifier: CC-BY-NC-4.0
import { boxGeometry, cylinderXGeometry, facesGeometry, mergeGeometry,
  torusGeometry, transformGeometry } from '../asset-geometry.mjs';
import { palette } from './palette.mjs';

export function authorVehicle({ root, addNode, addMesh, box }, assetId, data) {
  const cuv = assetId === 'cuv';
  const paint = cuv ? [0.74, 0.66, 0.52] : [0.43, 0.23, 0.52];
  const height = data.bodySizeM[1], length = data.bodySizeM[2];
  const roofY = height - (cuv ? 0.075 : 0);
  const half = length / 2, belt = cuv ? 0.99 : 0.83;
  const frontZ = -(1 - data.frontWeightFraction) * data.wheelbaseM;
  const rearZ = data.frontWeightFraction * data.wheelbaseM;
  const eyeZ = data.contract.driverEyeLocalM[2];
  const exterior = addNode('Exterior', root);
  const part = (size, center, color, rotation) =>
    transformGeometry(boxGeometry(size, color), center, rotation);
  if (!cuv) {
    authorSedanExterior({ addNode, addMesh }, data,
      { exterior, paint, part, frontZ, rearZ, half, belt, roofY, roofFront: frontZ });
    authorSedanCockpit({ root, addNode, addMesh }, data, { roofFront: frontZ, part });
    authorWheels({ root, addMesh }, data, { frontZ, rearZ, part });
    authorMirrors({ root, addNode, addMesh }, data, exterior, 'sedan');
    return;
  }
  // The CUV cockpit (dashboard, headliner, seats) is unchanged by the exterior subtask,
  // so the roof front stays on its headliner and the windshield foot clears its dashboard.
  const roofFront = eyeZ - 0.25, roofRear = cuvRoofRearZ;
  authorCuvExterior({ addNode, addMesh }, data,
    { exterior, paint, part, frontZ, rearZ, half, belt, roofY, roofFront });
  authorCockpit({ root, addNode, addMesh, box }, data,
    { belt, eyeZ, roofRear, roofFront, roofY, part });
  authorWheels({ root, addMesh }, data, { frontZ, rearZ, part });
  authorMirrors({ root, addNode, addMesh }, data, exterior, 'cuv');
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

// Sedan cabin (issue #12 interior subtask). Coordinates are ground-relative inside the
// Cockpit node. Seats, wheel and pedals are arranged around the driver eye anchor
// (moved back 0.3 m for this subtask); the windshield, wheel wells and roof come from the sedan exterior. Named controls
// (SteeringWheelPivot, SpeedometerNeedle, *Lamp, *Pedal) are driven by asset-scene.ts.
function authorSedanCockpit({ root, addNode, addMesh }, data, { roofFront, part }) {
  const cockpit = addNode('Cockpit', root, { translation: [0, -data.comHeightM, 0] });
  const [eyeX, , eyeZ] = data.contract.driverEyeLocalM;
  const dash = [0.34, 0.32, 0.37], dashDark = [0.2, 0.19, 0.22], panel = [0.42, 0.4, 0.45];
  const light = [0.68, 0.66, 0.7], seat = [0.45, 0.43, 0.48], seatDark = [0.33, 0.31, 0.35];
  const floorColor = [0.25, 0.24, 0.27], face = [0.06, 0.06, 0.07], mark = [0.9, 0.88, 0.84];
  const quat = (axis, angle) => axis.map((v) => v * Math.sin(angle / 2)).concat(Math.cos(angle / 2));
  const roofRear = sedanRoofRearZ, headliner = data.bodySizeM[1] - 0.055;
  const trimX = 0.775, wellX = 0.5, floorY = 0.24;
  const frontArch = [-1.6, -0.83], rearArchStart = 1.1;

  // Dashboard: a prism under the windshield plus binnacle, vents, center stack, glovebox
  // and the static parts of the instrument cluster.
  const section = [[-1.4, 0.6], [-1.4, 0.93], [-1.58, 0.87], [-1.7, 0.8], [-1.7, 0.6]];
  const dashFaces = [-1, 1].map((s) => ({ color: dash,
    points: section.map(([z, y]) => [s * 0.78, y, z]) }));
  for (let i = 0; i < section.length; i++) {
    const [za, ya] = section[i], [zb, yb] = section[(i + 1) % section.length];
    dashFaces.push({ color: dash, points: [[-0.78, ya, za], [0.78, ya, za], [0.78, yb, zb], [-0.78, yb, zb]] });
  }
  const cluster = [eyeX, 0.885, -1.395];
  const dial = [cluster[0], cluster[1], cluster[2] + 0.006];
  const dialParts = [];
  for (let i = 0; i <= 12; i++) {
    const angle = (120 - i * 20) * Math.PI / 180;
    const r = i % 3 === 0 ? 0.034 : 0.037;
    dialParts.push(part([0.004, i % 3 === 0 ? 0.012 : 0.007, 0.002],
      [dial[0] - Math.sin(angle) * r, dial[1] + Math.cos(angle) * r, dial[2]], mark, [0, 0, angle]));
  }
  const arrow = (side, color, z) => {
    const x = cluster[0] + side * 0.115, y = cluster[1] + 0.025;
    return mergeGeometry([facesGeometry([{ color, points: [[x + side * 0.03, y, z],
      [x + side * 0.012, y - 0.016, z], [x + side * 0.012, y + 0.016, z]] }]),
    part([0.022, 0.012, 0.002], [x + side * 0.001, y, z], color)]);
  };
  const parkLamp = (color, z) => {
    const x = cluster[0] - 0.115, y = cluster[1] - 0.022;
    return mergeGeometry([part([0.006, 0.026, 0.002], [x - 0.007, y, z], color),
      part([0.016, 0.006, 0.002], [x, y + 0.01, z], color), part([0.016, 0.006, 0.002], [x, y - 0.001, z], color),
      part([0.006, 0.016, 0.002], [x + 0.007, y + 0.0045, z], color)]);
  };
  const dimZ = cluster[2] + 0.006, litZ = cluster[2] + 0.008;
  const dashParts = [facesGeometry(dashFaces),
    part([0.44, 0.05, 0.13], [eyeX, 0.955, -1.445], dashDark),
    part([0.38, 0.11, 0.01], cluster, face),
    transformGeometry(torusGeometry(0.042, 0.003, mark, 20, 4), dial),
    ...dialParts, arrow(-1, [0.1, 0.22, 0.12], dimZ), arrow(1, [0.1, 0.22, 0.12], dimZ),
    parkLamp([0.28, 0.08, 0.07], dimZ),
    part([0.03, 0.016, 0.002], [cluster[0] + 0.115, cluster[1] - 0.022, dimZ], [0.1, 0.16, 0.24]),
    part([0.28, 0.32, 0.06], [0, 0.69, -1.385], dashDark),
    part([0.18, 0.05, 0.008], [0, 0.765, -1.352], light),
    ...[-0.05, 0, 0.05].map((x) => part([0.03, 0.018, 0.01], [x, 0.71, -1.352], panel)),
    ...[-0.07, 0.07].map((x) => transformGeometry(cylinderXGeometry(0.022, 0.02, panel, 10),
      [x, 0.63, -1.35], [0, Math.PI / 2, 0])),
    part([0.36, 0.13, 0.01], [0.42, 0.72, -1.397], panel),
    part([0.1, 0.018, 0.012], [0.42, 0.765, -1.392], light)];
  for (const x of [-0.68, -0.07, 0.07, 0.68]) {
    dashParts.push(part([x === -0.68 || x === 0.68 ? 0.12 : 0.11, 0.06, 0.01], [x, 0.865, -1.397], face));
    for (const dy of [-0.015, 0, 0.015]) {
      dashParts.push(part([x === -0.68 || x === 0.68 ? 0.11 : 0.1, 0.005, 0.012], [x, 0.865 + dy, -1.394], panel));
    }
  }
  addMesh('Dashboard', cockpit, mergeGeometry(dashParts), dash);
  addMesh('SpeedometerNeedle', cockpit, mergeGeometry([part([0.004, 0.036, 0.002], [0, 0.016, 0], [0.95, 0.4, 0.18]),
    part([0.012, 0.012, 0.003], [0, 0, 0.001], face)]), face, [dial[0], dial[1], dial[2] + 0.002]);
  addMesh('IndicatorLeftLamp', cockpit, arrow(-1, [0.3, 1, 0.42], litZ), [0.3, 1, 0.42]);
  addMesh('IndicatorRightLamp', cockpit, arrow(1, [0.3, 1, 0.42], litZ), [0.3, 1, 0.42]);
  addMesh('ParkingBrakeLamp', cockpit, parkLamp([1, 0.22, 0.16], litZ), [1, 0.22, 0.16]);

  // Steering: raked column; the pivot turns about the column axis.
  // Center height/distance keep the eye's 0.35-down sightline on the rim and the dial
  // visible above it.
  const rake = -0.44, wheelCenter = [eyeX, 0.76, eyeZ - 0.5];
  const column = addNode('SteeringColumn', cockpit, { translation: wheelCenter, rotation: quat([1, 0, 0], rake) });
  const pivot = addNode('SteeringWheelPivot', column);
  addMesh('SteeringWheel', pivot, mergeGeometry([torusGeometry(0.16, 0.026, dashDark, 20, 6),
    part([0.12, 0.09, 0.05], [0, -0.01, -0.01], dash), part([0.065, 0.045, 0.012], [0, 0, 0.02], light),
    ...[-1, 1].map((s) => part([0.1, 0.045, 0.025], [s * 0.09, -0.005, -0.005], dash)),
    ...[-1, 1].map((s) => part([0.035, 0.03, 0.01], [s * 0.09, -0.005, 0.01], light)),
    part([0.045, 0.1, 0.025], [0, -0.09, -0.005], dash)]), dashDark);

  // Pedals hang from hinges under the dash; positive X rotation pushes the pad forward.
  addMesh('BrakePedal', cockpit, mergeGeometry([part([0.025, 0.25, 0.025], [0, -0.125, 0], panel),
    part([0.1, 0.07, 0.022], [0, -0.26, 0.012], light)]), panel, [eyeX - 0.04, 0.6, -1.6]);
  addMesh('AcceleratorPedal', cockpit, mergeGeometry([part([0.02, 0.22, 0.02], [0, -0.11, 0], panel),
    part([0.06, 0.13, 0.018], [0, -0.23, 0.01], light)]), panel, [eyeX + 0.16, 0.6, -1.62]);

  // Static cabin: floor, firewall, console/storage, seats, rear bench, door trims, headliner.
  const cabin = [
    part([wellX * 2, 0.04, frontArch[1] + 1.72], [0, floorY - 0.02, (frontArch[1] - 1.72) / 2], floorColor),
    part([trimX * 2, 0.04, rearArchStart - frontArch[1]], [0, floorY - 0.02, (rearArchStart + frontArch[1]) / 2], floorColor),
    part([wellX * 2, 0.04, 1.55 - rearArchStart], [0, floorY - 0.02, (1.55 + rearArchStart) / 2], floorColor),
    // Firewall and kick panels close the footwell ahead of the front wheel arches.
    part([trimX * 2, 0.38, 0.02], [0, 0.42, -1.71], floorColor),
    ...[-1, 1].map((s) => part([0.03, 0.46, frontArch[0] + 1.72], [s * trimX, 0.47, (frontArch[0] - 1.72) / 2], panel)),
    ...[-1, 1].map((s) => part([trimX - wellX, 0.04, frontArch[0] + 1.72],
      [s * (trimX + wellX) / 2, floorY - 0.02, (frontArch[0] - 1.72) / 2], floorColor)),
    part([0.1, 0.03, 0.14], [eyeX - 0.2, 0.3, -1.6], panel, [0.5, 0, 0]),
    transformGeometry(boxGeometry([0.08, 0.08, 0.24], dashDark), [eyeX, wheelCenter[1] - 0.14 * Math.sin(-rake),
      wheelCenter[2] - 0.14 * Math.cos(rake)], [rake, 0, 0]),
    part([0.24, 0.18, 0.77], [0, 0.33, -0.995], dashDark),
    part([0.14, 0.015, 0.18], [0, 0.428, -1.12], panel),
    part([0.02, 0.11, 0.02], [0, 0.49, -1.12], light),
    part([0.045, 0.055, 0.06], [0, 0.565, -1.12], dashDark),
    ...[-0.05, 0.05].map((x) => transformGeometry(cylinderXGeometry(0.03, 0.012, face, 10),
      [x, 0.43, -0.93], [0, 0, Math.PI / 2])),
    part([0.22, 0.16, 0.32], [0, 0.5, -0.45], dash),
    part([0.22, 0.025, 0.32], [0, 0.592, -0.45], panel),
    part([1.4, 0.04, roofRear - roofFront], [0, headliner + 0.02, (roofRear + roofFront) / 2], panel),
    ...[-1, 1].map((s) => part([0.34, 0.015, 0.15], [s * 0.38, headliner - 0.01, -1.12], panel)),
    part([1.42, 0.03, 0.75], [0, 0.95, 1.125], dashDark),
    part([1.42, 0.71, 0.02], [0, floorY + 0.355, 0.76], floorColor),
  ];
  // Front seats: cushion under the hip just behind the eye, backrest reclined 15 degrees.
  const cushionZ = eyeZ + 0.045, backZ = cushionZ + 0.25, recline = 0.26;
  const along = (base, distance, angle) => [0.5 + distance * Math.cos(angle), base + distance * Math.sin(angle)];
  for (const x of [-0.31, 0.31]) {
    cabin.push(part([0.3, 0.16, 0.36], [x, 0.32, cushionZ], floorColor));
    cabin.push(part([0.38, 0.1, 0.5], [x, 0.45, cushionZ], seat));
    for (const side of [-1, 1]) {
      cabin.push(part([0.06, 0.06, 0.48], [x + side * 0.17, 0.52, cushionZ], seatDark));
      const [y, z] = along(backZ + 0.02, 0.27, recline);
      cabin.push(part([0.06, 0.5, 0.12], [x + side * 0.17, y, z], seatDark, [recline, 0, 0]));
    }
    const [backY, backCenterZ] = along(backZ, 0.3, recline);
    cabin.push(part([0.38, 0.6, 0.1], [x, backY, backCenterZ], seat, [recline, 0, 0]));
    const [topY, topZ] = along(backZ, 0.6, recline);
    cabin.push(part([0.03, 0.08, 0.03], [x, topY - 0.02, topZ], panel));
    cabin.push(part([0.24, 0.16, 0.09], [x, topY + 0.08, topZ + 0.03], seat, [recline, 0, 0]));
  }
  // Rear bench with two headrests; knee room behind the reclined front backrests.
  const benchZ = 0.28, benchBackZ = benchZ + 0.25, benchRecline = 0.3;
  cabin.push(part([1.2, 0.14, 0.46], [0, 0.31, benchZ], floorColor));
  cabin.push(part([1.3, 0.12, 0.5], [0, 0.44, benchZ], seat));
  const [benchY, benchCenterZ] = along(benchBackZ, 0.275, benchRecline);
  cabin.push(part([1.3, 0.55, 0.12], [0, benchY, benchCenterZ], seat, [benchRecline, 0, 0]));
  const [benchTopY, benchTopZ] = along(benchBackZ, 0.55, benchRecline);
  for (const x of [-0.42, 0.42]) {
    cabin.push(part([0.22, 0.12, 0.08], [x, benchTopY + 0.06, benchTopZ + 0.02], seat, [benchRecline, 0, 0]));
  }
  for (const s of [-1, 1]) {
    cabin.push(part([0.03, 0.59, rearArchStart - frontArch[1]], [s * trimX, 0.535, (rearArchStart + frontArch[1]) / 2], panel));
    cabin.push(part([0.03, 0.13, frontArch[1] + 1.7], [s * trimX, 0.765, (frontArch[1] - 1.7) / 2], panel));
    cabin.push(part([0.03, 0.13, 1.6 - rearArchStart], [s * trimX, 0.765, (1.6 + rearArchStart) / 2], panel));
    for (const [z, length] of [[-0.4, 0.36], [0.55, 0.3]]) {
      cabin.push(part([0.07, 0.05, length], [s * (trimX - 0.05), 0.62, z], dash));
      cabin.push(part([0.04, 0.08, length], [s * (trimX - 0.03), 0.36, z], dashDark));
      cabin.push(part([0.02, 0.03, 0.1], [s * (trimX - 0.02), 0.72, z - length / 2 - 0.08], light));
    }
    for (const z of [-0.83, 0.1, 0.95]) cabin.push(part([0.035, 0.55, 0.012], [s * (trimX - 0.005), 0.55, z], dashDark));
  }
  addMesh('SeatsAndInterior', cockpit, mergeGeometry(cabin), seat);
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

// Inferred: the sedan roof covers the rear bench; exterior and cabin headliner share it.
const sedanRoofRearZ = 0.85;
// The CUV roof and headliner end above the cargo area, ahead of the raked hatch.
const cuvRoofRearZ = 1.15;
const shellWell = [0.09, 0.09, 0.1], shellSeam = [0.12, 0.11, 0.13];

// Closed exterior shell shared by both vehicles: one lofted lower body (hood, belt ledges,
// rear deck, fascias, floor and lined wheel wells) plus a greenhouse whose glass and pillar
// panels share edges, so no interior cavity shows from outside. `shape` carries the
// vehicle-specific outline; bolt-on details are authored by the caller on the returned Body.
function authorClosedShell({ addNode, addMesh }, data, s, shape) {
  const { exterior, paint, frontZ, rearZ, half, belt, roofY, roofFront } = s;
  const { roofRear, wsFoot, rearFoot, glassBase, glassTop, hoodNose, crown, wellInner, railH,
    quarterZ, pillarB, widthAt, sections: outline, cLine: cLineAt } = shape;
  const sill = data.clearanceM, tire = data.tireRadiusM;
  const archRadius = tire + 0.075;
  const well = shellWell;
  const hoodT = (z) => Math.min(1, Math.max(0, (z + half) / (wsFoot + half)));
  const topAt = (z) => z < wsFoot ? hoodNose + (belt - hoodNose) * (1 - (1 - hoodT(z)) ** 2) : belt;
  const crownAt = (z) => z < wsFoot ? crown * (1 - hoodT(z)) : 0;
  const axles = [frontZ, rearZ];
  const archAxle = (z) => axles.find((axle) => Math.abs(z - axle) < archRadius);
  const archY = (z, axle) => tire + Math.sqrt(Math.max(0, archRadius ** 2 - (z - axle) ** 2));
  const archPoints = (axle) => Array.from({ length: 13 }, (_, i) =>
    [axle + archRadius * Math.cos(i * Math.PI / 12), tire + archRadius * Math.sin(i * Math.PI / 12)]);

  const sections = new Set(outline);
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
  const shell = shape.bodyParts ? mergeGeometry([facesGeometry(faces), ...shape.bodyParts]) : facesGeometry(faces);
  const body = addMesh('Body', exterior, shell, paint, [0, -data.comHeightM, 0]);
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
  const cLine = (y) => cLineAt(y, { tY, railY, rearEdge });
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
  return { body, sill, archRadius, railY, sidePoint, rearEdge };
}

// Sedan exterior (issue #12 sedan exterior subtask) on the shared closed shell.
// Inferred from a two-view reference: windshield foot is limited by the unchanged
// dashboard, so the hood/trunk ratio is approximate. The roof front stays on the
// cockpit headliner; physical profile, eye and mirror anchors are unchanged.
function authorSedanExterior({ addNode, addMesh }, data, s) {
  const { paint, part, frontZ, half, belt } = s;
  const wsFoot = -1.68, rearFoot = 1.75;
  const quarterZ = -1.0, pillarB = 0.1, doorRearZ = 0.95, cPillarTopZ = 0.72;
  const seam = shellSeam;
  const amber = [0.86, 0.46, 0.06], lampRed = [0.65, 0.06, 0.09];
  const widthAt = (z) => data.bodySizeM[0] / 2 - Math.max(0, -z - (half - 0.3)) * 0.2 -
    Math.max(0, z - (half - 0.2)) * 0.2;
  const { body, sill, archRadius } = authorClosedShell({ addNode, addMesh }, data, s, {
    roofRear: sedanRoofRearZ, wsFoot, rearFoot, glassBase: 0.81, glassTop: 0.72,
    hoodNose: 0.74, crown: 0.03, wellInner: 0.5, railH: 0.045, quarterZ, pillarB, widthAt,
    sections: [-half, -half + 0.1, -half + 0.3, -half + 0.5, -1.95, wsFoot, rearFoot, half - 0.2, half],
    cLine: (y, { tY, railY }) => doorRearZ + (cPillarTopZ - doorRearZ) * tY(y) / tY(railY),
  });

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

// CUV exterior (issue #12 CUV exterior subtask) on the shared closed shell: a two-box
// wagon with chamfered nose, long raked hatch glass over a short tailgate ledge, thick
// D-pillars, flared arches and roof rails on feet.
// Inferred from two three-quarter views: the reference windshield foot sits further back,
// but the unchanged dashboard/headliner limit it, so the hood is shorter than pictured.
// A fixed quarter pane puts the unchanged side-mirror anchor at the front door corner.
// Physical profile, eye, mirror anchors/cameras and cockpit geometry are unchanged.
function authorCuvExterior({ addNode, addMesh }, data, s) {
  const { paint, part, frontZ, rearZ, half, belt, roofY } = s;
  const wsFoot = -1.62, rearFoot = half - 0.2;
  const quarterZ = -0.88, pillarB = 0.15, dPillar = 0.17;
  const seam = shellSeam, flare = [0.2, 0.19, 0.21], lamp = [0.98, 0.89, 0.69];
  const lampRed = [0.72, 0.07, 0.11], marker = [0.36, 0.35, 0.4];
  const frontTaper = 0.38, rearTaper = 0.22;
  const widthAt = (z) => data.bodySizeM[0] / 2 - Math.max(0, -z - (half - 0.45)) * frontTaper -
    Math.max(0, z - (half - 0.2)) * rearTaper;
  // Roof rails on front and rear feet; they are part of Body, whose bounds reach full height.
  const rails = [];
  for (const side of [-1, 1]) {
    rails.push(part([0.05, 0.04, 1.6], [side * 0.6, data.bodySizeM[1] - 0.02, 0.3], palette.trim));
    for (const z of [-0.45, 1.05]) rails.push(part([0.06, 0.05, 0.1], [side * 0.6, roofY + 0.025, z], palette.trim));
  }
  const { body, sill, archRadius } = authorClosedShell({ addNode, addMesh }, data, s, {
    bodyParts: rails, roofRear: cuvRoofRearZ, wsFoot, rearFoot, glassBase: 0.82, glassTop: 0.74,
    hoodNose: 0.86, crown: 0.03, wellInner: 0.5, railH: 0.045, quarterZ, pillarB, widthAt,
    sections: [-half, -half + 0.12, -half + 0.3, -half + 0.45, -half + 0.6, wsFoot, rearFoot, half],
    cLine: (y, { rearEdge }) => rearEdge(y) - dPillar,
  });

  const detail = [];
  const sideOf = (z) => widthAt(z) + 0.004;
  const seamBar = (side, z1, y1, z2, y2) => part([0.01, Math.hypot(y2 - y1, z2 - z1), 0.012],
    [side * sideOf((z1 + z2) / 2), (y1 + y2) / 2, (z1 + z2) / 2], seam,
    [Math.atan2(z2 - z1, y2 - y1), 0, 0]);
  // Chunky bumpers wrap the chamfered corners; the tapered faces carry lamp wraps.
  const bumperY = 0.36, bumperH = 0.17;
  for (const [z, wrapZ, wrapLength, taper, sign] of [[-half, -half + 0.2, 0.42, frontTaper, 1],
    [half, half - 0.1, 0.22, rearTaper, -1]]) {
    detail.push(part([2 * widthAt(z) + 0.04, bumperH, 0.1], [0, bumperY, z], palette.trim));
    for (const side of [-1, 1]) {
      detail.push(part([0.07, bumperH, wrapLength], [side * widthAt(wrapZ), bumperY, wrapZ], palette.trim,
        [0, side * sign * Math.atan(taper), 0]));
    }
  }
  // Front: headlamps across the upper corners and wrapping the chamfer; dark grille between.
  const noseTop = 0.86;
  detail.push(part([0.78, 0.17, 0.03], [0, 0.66, -half - 0.005], [0.2, 0.19, 0.22]));
  detail.push(part([0.78, 0.014, 0.035], [0, 0.73, -half - 0.006], [0.62, 0.6, 0.6]));
  detail.push(part([0.5, 0.04, 0.03], [0, 0.48, -half - 0.03], [0.2, 0.19, 0.22]));
  // Rear: tailgate seam and garnish under the hatch glass, plate, exhaust.
  detail.push(part([1.5, 0.012, 0.012], [0, belt - 0.035, half + 0.005], seam));
  detail.push(part([0.5, 0.05, 0.02], [0, 0.82, half + 0.008], palette.trim));
  detail.push(part([0.34, 0.11, 0.015], [0, 0.66, half + 0.008], [0.84, 0.8, 0.71]));
  detail.push(transformGeometry(cylinderXGeometry(0.035, 0.16, palette.metal, 10),
    [-0.5, 0.25, half + 0.03], [0, Math.PI / 2, 0]));
  const lampZ = -half + 0.09, tailZ = half - 0.05;
  for (const side of [-1, 1]) {
    detail.push(part([0.24, 0.12, 0.04], [side * 0.55, noseTop - 0.08, -half - 0.005], lamp));
    detail.push(part([0.03, 0.12, 0.2], [side * (widthAt(lampZ) + 0.003), noseTop - 0.08, lampZ], lamp,
      [0, side * Math.atan(frontTaper), 0]));
    detail.push(part([0.02, 0.05, 0.14], [side * sideOf(-1.62), 0.8, -1.62], marker));
    // Tall tail lamps on the rear corners, wrapping onto the quarter panels.
    detail.push(part([0.12, 0.36, 0.04], [side * (widthAt(half) - 0.055), 0.78, half + 0.005], lampRed));
    detail.push(part([0.03, 0.36, 0.11], [side * (widthAt(tailZ) + 0.003), 0.78, tailZ], lampRed,
      [0, -side * Math.atan(rearTaper), 0]));
    detail.push(part([0.012, belt - 0.485, 0.012], [side * 0.64, (belt + 0.415) / 2, half + 0.005], seam));
    // Fender flares follow each arch.
    for (const axle of [frontZ, rearZ]) {
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
        const point = (angle, radius) => {
          const z = axle + radius * Math.cos(angle);
          return [side * (widthAt(z) + 0.012), data.tireRadiusM + radius * Math.sin(angle), z];
        };
        const face = { color: flare, points: [point(a, archRadius), point(b, archRadius),
          point(b, archRadius + 0.055), point(a, archRadius + 0.055)] };
        detail.push(facesGeometry([face]));
      }
    }
    // Doors: front door clears the arch then rises to the quarter-pane divider; rear door
    // ends ahead of the rear arch. Handles sit just under the belt.
    const frontArchEnd = frontZ + archRadius + 0.03, rearDoorZ = rearZ - archRadius - 0.03;
    detail.push(seamBar(side, frontArchEnd, sill + 0.04, frontArchEnd, 0.8));
    detail.push(seamBar(side, frontArchEnd, 0.8, quarterZ, belt - 0.005));
    detail.push(seamBar(side, pillarB, sill + 0.04, pillarB, belt - 0.005));
    detail.push(seamBar(side, rearDoorZ, sill + 0.04, rearDoorZ, belt - 0.005));
    for (const z of [pillarB - 0.22, rearDoorZ - 0.16]) {
      detail.push(part([0.02, 0.03, 0.14], [side * 0.91, belt - 0.12, z], palette.metal));
    }
  }
  addMesh('ExteriorDetails', body, mergeGeometry(detail), paint);
}

function authorMirrors({ root, addNode, addMesh }, data, exterior, style) {
  const eye = data.contract.driverEyeLocalM;
  addNode('DriverEye', root, { translation: eye });
  for (const [id, pose] of Object.entries(data.contract.mirrors)) {
    const name = id[0].toUpperCase() + id.slice(1);
    const position = pose.positionM;
    addNode(`Mirror${name}`, root, { translation: position, rotation: pose.rotation });
    const display = name === 'Rear'
      ? data.contract.rearDisplayM : position;
    // Sedan rearview is a 4:1 display matching its 512x128 RenderTarget.
    const size = name === 'Rear' ? (style === 'sedan' ? [0.18, 0.045, 0.025] : [0.12, 0.05, 0.025])
      : [0.18, 0.1, 0.035];
    const surface = {
      positions: [-size[0] / 2, -size[1] / 2, 0, size[0] / 2, -size[1] / 2, 0,
        size[0] / 2, size[1] / 2, 0, -size[0] / 2, size[1] / 2, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      colors: Array(12).fill(1), indices: [0, 1, 2, 0, 2, 3], uvs: [0, 0, 1, 0, 1, 1, 0, 1],
    };
    // Sedan faces follow the reflection law: the normal bisects the direction to the fixed
    // eye and the virtual camera's view direction, so the driver sees the face obliquely
    // and the shell behind it stays out of that camera's view.
    const cameraYaw = 2 * Math.atan2(pose.rotation[1], pose.rotation[3]);
    const toEye = [eye[0] - display[0], eye[2] - display[2]];
    const eyeLength = Math.hypot(...toEye);
    const faceYaw = Math.atan2(toEye[0] / eyeLength - Math.sin(cameraYaw),
      toEye[1] / eyeLength - Math.cos(cameraYaw));
    const faceRotation = [0, Math.sin(faceYaw / 2), 0, Math.cos(faceYaw / 2)];
    if (style === 'sedan' && name === 'Rear') {
      // Display hangs from the headliner on a short stem; shell sits ahead of the face.
      addMesh(`MirrorSurface${name}`, root, surface, [1, 1, 1], display, faceRotation);
      const headlinerY = data.bodySizeM[1] - 0.065 - data.comHeightM;
      const bottom = [size[1] / 2 + 0.0125, -0.03], top = [headlinerY - display[1], 0.045];
      const rise = top[0] - bottom[0], run = top[1] - bottom[1];
      addMesh(`MirrorHousing${name}`, exterior, mergeGeometry([
        transformGeometry(transformGeometry(
          boxGeometry([size[0] + 0.025, size[1] + 0.025, 0.035], palette.trim), [0, 0, -0.03]), [0, 0, 0], [0, faceYaw, 0]),
        transformGeometry(boxGeometry([0.025, Math.hypot(rise, run), 0.025], palette.trim),
          [0, (top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2], [Math.atan2(run, rise), 0, 0]),
      ]), palette.trim, display);
      continue;
    }
    if (style === 'sedan') {
      const side = Math.sign(position[0]);
      addMesh(`MirrorSurface${name}`, root, surface, [1, 1, 1], display, faceRotation);
      const shell = transformGeometry(transformGeometry(
        boxGeometry([size[0] + 0.025, size[1] + 0.025, 0.05], palette.trim), [0, 0, -0.033]),
      [0, 0, 0], [0, faceYaw, 0]);
      const doorX = data.bodySizeM[0] / 2 - 0.02;
      const armLength = Math.abs(position[0]) - doorX;
      const arm = transformGeometry(boxGeometry([armLength, 0.035, 0.05], palette.trim),
        [-side * armLength / 2, -0.08, 0]);
      const foot = transformGeometry(boxGeometry([0.05, 0.05, 0.07], palette.trim),
        [-side * armLength, -0.105, 0]);
      addMesh(`MirrorHousing${name}`, exterior, mergeGeometry([shell, arm, foot]), palette.trim, display);
      continue;
    }
    addMesh(`MirrorSurface${name}`, root, surface, [1, 1, 1], display);
    const shell = boxGeometry(size.map((v) => v + 0.025), palette.trim);
    if (style === 'cuv' && name !== 'Rear') {
      // CUV exterior subtask: same face and shell placement, plus an arm and foot down
      // to the door belt so the housing no longer floats. Anchors and cameras unchanged.
      const side = Math.sign(position[0]);
      const doorX = data.bodySizeM[0] / 2 - 0.02;
      const armLength = Math.abs(position[0]) - doorX;
      const beltDrop = position[1] + data.comHeightM - 0.99;
      addMesh(`MirrorHousing${name}`, exterior, mergeGeometry([
        transformGeometry(shell, [0, 0, 0.04]),
        transformGeometry(boxGeometry([armLength, 0.035, 0.04], palette.trim), [-side * armLength / 2, -0.06, 0.065]),
        transformGeometry(boxGeometry([0.05, beltDrop, 0.06], palette.trim),
          [-side * armLength, -beltDrop / 2, 0.065]),
      ]), palette.trim, display);
      continue;
    }
    addMesh(`MirrorHousing${name}`, exterior, shell,
      palette.trim, [display[0], display[1], display[2] + (name === 'Rear' ? -0.04 : 0.04)]);
  }
}
