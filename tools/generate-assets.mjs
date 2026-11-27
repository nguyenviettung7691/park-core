import { boxGeometry } from './asset-geometry.mjs';
import { authorVehicle } from './asset-designs/vehicles.mjs';
import { authorEnvironment } from './asset-designs/environments.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { profiles } from '../src/vehicle/profiles.ts';
import { deriveVehicleAssetContract, MIRROR_HOUSING } from '../src/vehicle/asset-contract.ts';

function authoringProfile(id) {
  const profile = profiles[id];
  return { ...profile, clearanceM: profile.groundClearanceM,
    comHeightM: profile.centerOfMassHeightM,
    contract: deriveVehicleAssetContract(profile), mirrorHousing: MIRROR_HOUSING };
}

const vehicleNames = new Set(['sedan', 'cuv']);
const allAssetIds = ['sedan', 'cuv', 'roadside', 'garage'];
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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
    const count = values.length / (type === 'VEC3' ? 3 : type === 'VEC2' ? 2 : 1);
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

  function addMesh(name, parent, geometry, materialColor, translation = [0, 0, 0], rotation) {
    const positionAccessor = addFloatAccessor(geometry.positions, 'VEC3', 34962, true);
    const normalAccessor = addFloatAccessor(geometry.normals, 'VEC3', 34962);
    const colorAccessor = addFloatAccessor(geometry.colors, 'VEC3', 34962);
    const indexAccessor = addIndexAccessor(geometry.indices);
    const materialIndex = materials.length;
    materials.push({
      name: `${name} vertex-color`,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: !geometry.singleSided,
      extensions: { KHR_materials_unlit: {} },
    });
    const meshIndex = meshes.length;
    const attributes = { POSITION: positionAccessor, NORMAL: normalAccessor, COLOR_0: colorAccessor };
    if (geometry.uvs) attributes.TEXCOORD_0 = addFloatAccessor(geometry.uvs, 'VEC2', 34962);
    meshes.push({ name, primitives: [{
      attributes,
      indices: indexAccessor, material: materialIndex, mode: 4,
    }] });
    return addNode(name, parent, rotation
      ? { mesh: meshIndex, translation, rotation } : { mesh: meshIndex, translation });
  }

  function box(name, parent, center, size, color) {
    return addMesh(name, parent, boxGeometry(size, color), color, center);
  }

  const root = addNode(`${assetId} asset`, null, { extras: { dimensionsM, origin } });
  const writer = { root, addNode, addMesh, box };
  if (vehicleNames.has(assetId)) authorVehicle(writer, assetId, authoringProfile(assetId));
  else authorEnvironment(writer, assetId);

  const binary = Buffer.concat(binaryParts);
  const json = {
    asset: { version: '2.0', generator: 'Park-Core deterministic original asset generator',
      extras: { license: 'CC-BY-NC-4.0', copyright: '2026 Park-Core contributors',
        licenseUrl: 'https://creativecommons.org/licenses/by-nc/4.0/' } },
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
    ? profiles[assetId].bodySizeM
    : assetId === 'garage' ? [30, 6, 30] : [50, 3, 32];
  return createGltf(assetId, dimensionsM,
    vehicleNames.has(assetId) ? 'center-of-mass' : 'world-ground');
}

/** @param {string} outputRoot
 * @param {readonly string[]} assetIds */
export function writeAssets(outputRoot, assetIds = allAssetIds) {
  for (const assetId of assetIds) {
    if (!allAssetIds.includes(assetId)) throw new RangeError(`Unknown asset: ${assetId}`);
    const folder = vehicleNames.has(assetId) ? 'vehicles' : 'environments';
    const path = join(outputRoot, 'public', 'assets', folder, `${assetId}.glb`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buildGlb(assetId));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { vehicle: { type: 'string' }, out: { type: 'string' } },
  });
  if (positionals.length > 1 || (positionals.length && values.out)) {
    throw new Error('Use one output root: --out <directory> or the legacy positional directory');
  }
  if (values.vehicle && !vehicleNames.has(values.vehicle)) {
    throw new RangeError('--vehicle must be sedan or cuv');
  }
  writeAssets(resolve(values.out ?? positionals[0] ?? projectRoot),
    values.vehicle ? [values.vehicle] : allAssetIds);
}
