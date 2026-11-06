import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const generator = join(projectRoot, 'tools', 'generate-assets.mjs');
const assetIds = ['sedan', 'cuv', 'roadside', 'garage'];
const temporaryRoots = [];

function generate(root) {
  const result = spawnSync(process.execPath, [generator, root], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
}

function readGlb(path) {
  const bytes = readFileSync(path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(bytes.toString('ascii', 0, 4)).toBe('glTF');
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(8, true)).toBe(bytes.byteLength);

  const jsonLength = view.getUint32(12, true);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  expect(view.getUint32(binaryHeader + 4, true)).toBe(0x004e4942);
  expect(binaryHeader + 8 + binaryLength).toBe(bytes.byteLength);
  return json;
}

function assetPath(root, assetId) {
  const kind = assetId === 'sedan' || assetId === 'cuv' ? 'vehicles' : 'environments';
  return join(root, 'public', 'assets', kind, `${assetId}.glb`);
}

describe('phase 5 original GLB generator', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it.each(assetIds)('writes a valid deterministic GLB for %s', (assetId) => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'park-core-assets-a-'));
    const secondRoot = mkdtempSync(join(tmpdir(), 'park-core-assets-b-'));
    temporaryRoots.push(firstRoot, secondRoot);
    generate(firstRoot);
    generate(secondRoot);

    const first = readFileSync(assetPath(firstRoot, assetId));
    const second = readFileSync(assetPath(secondRoot, assetId));
    expect(first).toEqual(second);
    const json = readGlb(assetPath(firstRoot, assetId));
    expect(json.asset.version).toBe('2.0');
    expect(json.asset.extras).toMatchObject({
      license: 'CC-BY-NC-4.0',
      copyright: '2026 Park-Core contributors',
    });
    expect(json.scenes).toHaveLength(1);
    expect(json.nodes.length).toBeGreaterThan(0);
    expect(json.meshes.length).toBeGreaterThan(0);
    expect(json.materials.every((material) => material.pbrMetallicRoughness)).toBe(true);
    expect(json.materials.every((material) => material.extensions.KHR_materials_unlit)).toBe(true);
    expect(json.images).toBeUndefined();
    expect(json.buffers[0].uri).toBeUndefined();

    const triangles = json.meshes.reduce((sum, mesh) =>
      sum + mesh.primitives.reduce((part, primitive) =>
        part + json.accessors[primitive.indices].count / 3, 0), 0);
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(assetId === 'sedan' || assetId === 'cuv' ? 10_000 : 30_000);
  });

  it('keeps every selected pair below the five MB payload budget', () => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-payload-'));
    temporaryRoots.push(root);
    generate(root);
    for (const vehicle of ['sedan', 'cuv']) {
      for (const environment of ['roadside', 'garage']) {
        expect(readFileSync(assetPath(root, vehicle)).length +
          readFileSync(assetPath(root, environment)).length).toBeLessThanOrEqual(5_000_000);
      }
    }
  });

  it.each(['sedan', 'cuv'])('includes named vehicle nodes and dimensions for %s', (assetId) => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-vehicle-'));
    temporaryRoots.push(root);
    generate(root);
    const json = readGlb(assetPath(root, assetId));
    const nodes = json.nodes;
    const names = nodes.map((node) => node.name);
    const requiredNodes = [
      'Body', 'WheelFL', 'WheelFR', 'WheelRL', 'WheelRR',
      'DriverEye', 'MirrorRear', 'MirrorLeft', 'MirrorRight',
      'MirrorSurfaceRear', 'MirrorSurfaceLeft', 'MirrorSurfaceRight',
    ];

    for (const name of requiredNodes) expect(names).toContain(name);
    expect(new Set(['WheelFL', 'WheelFR', 'WheelRL', 'WheelRR'].map((name) =>
      names.indexOf(name))).size).toBe(4);
    expect(nodes.find((node) => node.name === 'DriverEye').translation).toHaveLength(3);
    expect(nodes[0].extras.dimensionsM).toEqual(
      assetId === 'sedan' ? [1.8, 1.45, 4.6] : [1.8, 1.62, 4.35],
    );
    expect(nodes[0].extras.origin).toBe('center-of-mass');
    expect(names).toContain('Dashboard');
    expect(names).toContain('SteeringWheel');
  });

  it('includes a named Trunk node for sedan', () => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-trunk-'));
    temporaryRoots.push(root);
    generate(root);
    expect(readGlb(assetPath(root, 'sedan')).nodes.map((node) => node.name)).toContain('Trunk');
  });

  it('exports a rebalanced sedan hood and trunk within the body envelope', () => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-hood-trunk-'));
    temporaryRoots.push(root);
    generate(root);
    const { nodes, meshes, accessors } = readGlb(assetPath(root, 'sedan'));
    const parents = new Map();
    nodes.forEach((node, parentIndex) =>
      node.children?.forEach((childIndex) => parents.set(childIndex, parentIndex)));
    const boundsFor = (name) => {
      const index = nodes.findIndex((node) => node.name === name);
      if (index < 0) return null;
      const primitive = meshes[nodes[index].mesh].primitives[0];
      const bounds = accessors[primitive.attributes.POSITION];
      const offset = [0, 0, 0];
      for (let parentIndex = index; parentIndex !== undefined; parentIndex = parents.get(parentIndex)) {
        for (let axis = 0; axis < 3; axis++) {
          offset[axis] += nodes[parentIndex].translation?.[axis] ?? 0;
        }
      }
      return {
        min: bounds.min.map((value, axis) => value + offset[axis]),
        max: bounds.max.map((value, axis) => value + offset[axis]),
      };
    };
    const hood = boundsFor('Hood');
    const trunk = boundsFor('Trunk');

    expect(hood).not.toBeNull();
    expect(trunk).not.toBeNull();
    if (!hood || !trunk) return;
    expect(hood.max[2] - hood.min[2]).toBeGreaterThan(0);
    expect(trunk.max[2] - trunk.min[2]).toBeGreaterThan(0);
    expect(trunk.max[1] - trunk.min[1]).toBeGreaterThan(0.01);
    expect(hood.max[2] - hood.min[2]).toBeGreaterThan(trunk.max[2] - trunk.min[2]);
    for (const bounds of [hood, trunk]) {
      expect(bounds.min[2]).toBeGreaterThanOrEqual(-2.3);
      expect(bounds.max[2]).toBeLessThanOrEqual(2.3);
    }
  });

  it.each(['sedan', 'cuv'])('includes the complete static cockpit node set for %s', (assetId) => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-cockpit-nodes-'));
    temporaryRoots.push(root);
    generate(root);
    const names = readGlb(assetPath(root, assetId)).nodes.map((node) => node.name);
    expect(names).toEqual(expect.arrayContaining([
      'InstrumentCluster', 'PedalSet', 'CenterConsole', 'DoorPanels', 'Floor',
      'SeatsAndInterior', 'Dashboard', 'SteeringWheel',
    ]));
  });

  it.each(['sedan', 'cuv'])('keeps the hood below the driver eye for %s', (assetId) => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-cockpit-'));
    temporaryRoots.push(root);
    generate(root);
    const json = readGlb(assetPath(root, assetId));
    const parents = new Map();
    json.nodes.forEach((node, parentIndex) =>
      node.children?.forEach((childIndex) => parents.set(childIndex, parentIndex)));
    const worldY = (nodeIndex) => {
      let y = 0;
      for (let index = nodeIndex; index !== undefined; index = parents.get(index)) {
        y += json.nodes[index].translation?.[1] ?? 0;
      }
      return y;
    };
    const hoodIndex = json.nodes.findIndex((node) => node.name === 'Hood');
    const hood = json.nodes[hoodIndex];
    const primitive = json.meshes[hood.mesh].primitives[0];
    const bounds = json.accessors[primitive.attributes.POSITION];
    const hoodTop = worldY(hoodIndex) + bounds.max[1];
    const eye = json.nodes.find((node) => node.name === 'DriverEye');

    expect(hoodTop).toBeLessThan(eye.translation[1]);
  });

  it.each(['sedan', 'cuv'])('keeps cockpit shell geometry inside the body bounds for %s', (assetId) => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-cockpit-bounds-'));
    temporaryRoots.push(root);
    generate(root);
    const json = readGlb(assetPath(root, assetId));
    const parents = new Map();
    json.nodes.forEach((node, parentIndex) =>
      node.children?.forEach((childIndex) => parents.set(childIndex, parentIndex)));
    const worldY = (nodeIndex) => {
      let y = 0;
      for (let index = nodeIndex; index !== undefined; index = parents.get(index)) {
        y += json.nodes[index].translation?.[1] ?? 0;
      }
      return y;
    };
    const meshTop = (name) => {
      const nodeIndex = json.nodes.findIndex((node) => node.name === name);
      const primitive = json.meshes[json.nodes[nodeIndex].mesh].primitives[0];
      return worldY(nodeIndex) + json.accessors[primitive.attributes.POSITION].max[1];
    };

    expect(meshTop('Cabin')).toBeLessThanOrEqual(meshTop('Body'));
    expect(meshTop('Windshield')).toBeLessThanOrEqual(meshTop('Body'));
    expect(meshTop('RearWindow')).toBeLessThanOrEqual(meshTop('Body'));
  });

  it.each(['roadside', 'garage'])('includes authored environment geometry for %s', (assetId) => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-environment-'));
    temporaryRoots.push(root);
    generate(root);
    const json = readGlb(assetPath(root, assetId));
    const names = json.nodes.map((node) => node.name);
    expect(names).toContain('Ground');
    expect(names).toContain('ParkingMarkings');
    expect(names).toContain('WallsAndCurbs');
    expect(json.nodes[0].extras.dimensionsM.every((value) => value > 0)).toBe(true);
    if (assetId === 'garage') {
      expect(names).toContain('Pillars');
      expect(names).toContain('Ceiling');
      expect(json.nodes.find((node) => node.name === 'Ceiling').children.length).toBeGreaterThan(0);
    }
  });
});
