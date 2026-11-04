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
    expect(triangles).toBeLessThanOrEqual(assetId === 'sedan' || assetId === 'cuv' ? 50_000 : 150_000);
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
