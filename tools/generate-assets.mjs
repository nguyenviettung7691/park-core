import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const profile = {
  sedan: {
    bodySizeM: [1.8, 1.45, 4.6],
    clearanceM: 0.15,
    comHeightM: 0.52,
    tireRadiusM: 0.31,
    trackM: 1.56,
    wheelbaseM: 2.7,
    frontWeightFraction: 0.55,
    eyeHeightM: 1.12,
    mirrorWidthM: 2.04,
    mirrorHeightM: 0.95,
  },
  cuv: {
    bodySizeM: [1.8, 1.62, 4.35],
    clearanceM: 0.18,
    comHeightM: 0.62,
    tireRadiusM: 0.33,
    trackM: 1.55,
    wheelbaseM: 2.61,
    frontWeightFraction: 0.58,
    eyeHeightM: 1.3,
    mirrorWidthM: 2.06,
    mirrorHeightM: 1.1,
  },
};

const palette = {
  body: [0.56, 0.3, 0.66],
  glass: [0.24, 0.23, 0.28],
  trim: [0.16, 0.15, 0.18],
  tire: [0.07, 0.07, 0.08],
  metal: [0.48, 0.45, 0.51],
  concrete: [0.32, 0.3, 0.34],
  marking: [0.78, 0.72, 0.8],
  target: [0.63, 0.36, 0.72],
  light: [0.9, 0.78, 0.55],
};

const vehicleNames = new Set(['sedan', 'cuv']);
const allAssetIds = ['sedan', 'cuv', 'roadside', 'garage'];
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function boxGeometry(sizeM, color) {
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

function cylinderXGeometry(radiusM, widthM, color, segments = 16) {
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

function torusGeometry(radiusM, tubeM, color, segments = 18, tubeSegments = 6) {
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

function createGltf(assetId, dimensionsM, origin) {
  const binaryParts = [];
  const nodes = [];
  const meshes = [];
  const materials = [];
  const accessors = [];
  const bufferViews = [];
  let binaryLength = 0;

  function pushBinary(buffer, target) {
    while (binaryLength % 4 !== 0) {
      binaryParts.push(Buffer.alloc(1));
      binaryLength++;
    }
    const byteOffset = binaryLength;
    binaryParts.push(buffer);
    binaryLength += buffer.byteLength;
    const index = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: buffer.byteLength, target });
    return index;
  }

  function floatBuffer(values) {
    const buffer = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
    return buffer;
  }

  function addFloatAccessor(values, type, target, withBounds = false) {
    const view = pushBinary(floatBuffer(values), target);
    const count = values.length / (type === 'VEC3' ? 3 : 1);
    const accessor = { bufferView: view, componentType: 5126, count, type };
    if (withBounds) {
      const triples = Array.from({ length: count }, (_, index) =>
        values.slice(index * 3, index * 3 + 3));
      accessor.min = [0, 1, 2].map((axis) => Math.min(...triples.map((point) => point[axis])));
      accessor.max = [0, 1, 2].map((axis) => Math.max(...triples.map((point) => point[axis])));
    }
    accessors.push(accessor);
    return accessors.length - 1;
  }

  function addIndexAccessor(values) {
    while (binaryLength % 4 !== 0) {
      binaryParts.push(Buffer.alloc(1));
      binaryLength++;
    }
    const buffer = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
    const view = pushBinary(buffer, 34963);
    accessors.push({
      bufferView: view, componentType: 5123, count: values.length,
      type: 'SCALAR', min: [Math.min(...values)], max: [Math.max(...values)],
    });
    return accessors.length - 1;
  }

  function addNode(name, parent, fields = {}) {
    const nodeIndex = nodes.length;
    nodes.push({ name, ...fields });
    if (parent !== null) (nodes[parent].children ??= []).push(nodeIndex);
    return nodeIndex;
  }

  function addMesh(name, parent, geometry, materialColor, translation = [0, 0, 0]) {
    const positionAccessor = addFloatAccessor(geometry.positions, 'VEC3', 34962, true);
    const normalAccessor = addFloatAccessor(geometry.normals, 'VEC3', 34962);
    const colorAccessor = addFloatAccessor(geometry.colors, 'VEC3', 34962);
    const indexAccessor = addIndexAccessor(geometry.indices);
    const materialIndex = materials.length;
    materials.push({
      name: `${name} vertex-color`,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true,
      extensions: { KHR_materials_unlit: {} },
    });
    const meshIndex = meshes.length;
    meshes.push({ name, primitives: [{
      attributes: { POSITION: positionAccessor, NORMAL: normalAccessor, COLOR_0: colorAccessor },
      indices: indexAccessor, material: materialIndex, mode: 4,
    }] });
    return addNode(name, parent, { mesh: meshIndex, translation });
  }

  function box(name, parent, center, size, color) {
    return addMesh(name, parent, boxGeometry(size, color), color, center);
  }

  const root = addNode(`${assetId} asset`, null, { extras: { dimensionsM, origin } });

  if (vehicleNames.has(assetId)) {
    const data = profile[assetId];
    const [width, height, length] = data.bodySizeM;
    const bodyCenterY = (data.clearanceM + height) / 2 - data.comHeightM;
    const body = box('Body', root, [0, bodyCenterY, 0],
      [width, height - data.clearanceM, length], palette.body);
    box('Hood', body, [0, bodyCenterY + 0.04, -length * 0.31],
      [width * 0.93, 0.22, length * 0.3], palette.body);
    box('Cabin', body, [0, bodyCenterY + height * 0.43, -0.02],
      [width * 0.78, height * 0.52, length * 0.43], palette.trim);
    box('Windshield', body, [0, bodyCenterY + height * 0.51, -0.68],
      [width * 0.7, 0.045, 0.64], palette.glass);
    box('RearWindow', body, [0, bodyCenterY + height * 0.5, 0.88],
      [width * 0.68, 0.04, 0.48], palette.glass);
    box('Dashboard', body, [-0.08, bodyCenterY + 0.27, -0.62],
      [1.1, 0.16, 0.38], palette.trim);
    box('DriverSeat', body, [-0.36, bodyCenterY + 0.05, 0.12],
      [0.5, 0.62, 0.58], palette.trim);
    addMesh('SteeringWheel', body, torusGeometry(0.17, 0.025, palette.metal), palette.metal,
      [-0.36, bodyCenterY + 0.46, -0.68]);
    box('FrontBumper', body, [0, bodyCenterY - 0.06, -length * 0.49],
      [width * 0.97, 0.16, 0.12], palette.trim);
    box('RearBumper', body, [0, bodyCenterY - 0.06, length * 0.49],
      [width * 0.97, 0.16, 0.12], palette.trim);
    for (const side of [-1, 1]) {
      box(`Headlight${side < 0 ? 'Left' : 'Right'}`, body,
        [side * width * 0.34, bodyCenterY + 0.03, -length * 0.47],
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
    addNode('MirrorRear', root, { translation: [0, eye[1] + 0.12, eye[2] - 0.75] });
    box('MirrorSurfaceRear', root, [0, eye[1] + 0.12, eye[2] - 0.75],
      [0.24, 0.1, 0.025], palette.metal);
    for (const side of [-1, 1]) {
      const sideName = side < 0 ? 'Left' : 'Right';
      const mirrorX = side * (data.mirrorWidthM + width) / 4;
      addNode(`Mirror${sideName}`, root, { translation: [mirrorX, mirrorY, mirrorZ] });
      box(`MirrorSurface${sideName}`, root, [mirrorX, mirrorY, mirrorZ],
        [0.18, 0.1, 0.035], palette.metal);
    }
  } else {
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

  const binary = Buffer.concat(binaryParts);
  const json = {
    asset: { version: '2.0', generator: 'Park-Core deterministic original asset generator' },
    extensionsUsed: ['KHR_materials_unlit'],
    extensionsRequired: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binaryLength }],
  };
  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - jsonBuffer.length % 4) % 4;
  const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryPadding = (4 - binary.length % 4) % 4;
  const binaryChunk = Buffer.concat([binary, Buffer.alloc(binaryPadding)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binaryChunk.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]);
}

/**
 * @param {'sedan' | 'cuv' | 'roadside' | 'garage'} assetId
 * @returns {Uint8Array}
 */
export function buildGlb(assetId) {
  if (!allAssetIds.includes(assetId)) throw new RangeError(`Unknown asset: ${assetId}`);
  const dimensionsM = vehicleNames.has(assetId)
    ? profile[assetId].bodySizeM
    : assetId === 'garage' ? [30, 6, 30] : [50, 3, 32];
  return createGltf(assetId, dimensionsM,
    vehicleNames.has(assetId) ? 'center-of-mass' : 'world-ground');
}

/** @param {string} outputRoot */
export function writeAssets(outputRoot) {
  for (const assetId of allAssetIds) {
    const folder = vehicleNames.has(assetId) ? 'vehicles' : 'environments';
    const path = join(outputRoot, 'public', 'assets', folder, `${assetId}.glb`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buildGlb(assetId));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeAssets(resolve(process.argv[2] ?? projectRoot));
}
