import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { checkAssets, reviewAssets } from '../../tools/asset-workflow.mjs';
import { EXTERIOR_LAMPS_DEFAULT, buildGlb } from '../../tools/generate-assets.mjs';
import { profiles } from '../vehicle/profiles.ts';

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

function readGlbBytes(bytes) {
  const buffer = Buffer.from(bytes);
  return JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)));
}

function assetPath(root, assetId) {
  const kind = assetId === 'sedan' || assetId === 'cuv' ? 'vehicles' : 'environments';
  return join(root, 'public', 'assets', kind, `${assetId}.glb`);
}

describe('phase 5 original GLB generator', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('generates only the selected vehicle and detects stale output without rewriting it', () => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-selected-'));
    temporaryRoots.push(root);
    const result = spawnSync(process.execPath, [generator, '--vehicle', 'sedan', '--out', root],
      { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(checkAssets(root, ['sedan'])[0].id).toBe('sedan');
    for (const id of ['cuv', 'garage', 'roadside']) expect(existsSync(assetPath(root, id))).toBe(false);
    const path = assetPath(root, 'sedan');
    const stale = readFileSync(path);
    stale[stale.length - 1] ^= 1;
    writeFileSync(path, stale);
    expect(() => checkAssets(root, ['sedan'])).toThrow('stale or foreign');
    expect(readFileSync(path)).toEqual(stale);
  });

  it('keeps checked-in GLBs in sync with their editable source', () => {
    expect(checkAssets(projectRoot)).toHaveLength(4);
  });

  it('refuses to mix a new review with existing evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-review-existing-'));
    temporaryRoots.push(root);
    const report = join(root, 'report.json');
    writeFileSync(report, '{"automated":"passed"}');
    expect(() => reviewAssets({ vehicle: 'sedan', out: root })).toThrow('fresh directory');
    expect(readFileSync(report, 'utf8')).toBe('{"automated":"passed"}');
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

  it.each(['sedan', 'cuv'])('gives the %s cockpit named, transformable instrument and control parts', (id) => {
    const controls = ['SteeringColumn', 'SteeringWheelPivot', 'SpeedometerNeedle',
      'IndicatorLeftLamp', 'IndicatorRightLamp', 'ParkingBrakeLamp', 'BrakePedal', 'AcceleratorPedal'];
    const glb = readGlbBytes(buildGlb(id));
    const names = glb.nodes.map((node) => node.name);
    for (const name of controls) expect(names).toContain(name);
    // Only the CUV console has a hand lever (issue #12 CUV interior subtask).
    expect(names.includes('ParkingBrakeLever')).toBe(id === 'cuv');
    const node = (name) => glb.nodes.find((candidate) => candidate.name === name);
    const pivot = glb.nodes.indexOf(node('SteeringWheelPivot'));
    expect(node('SteeringColumn').children).toContain(pivot);
    expect(node('SteeringWheelPivot').children.map((index) => glb.nodes[index].name)).toEqual(['SteeringWheel']);
    expect(node('SteeringColumn').rotation[0]).toBeLessThan(0);
    for (const name of [...controls.slice(2), ...(id === 'cuv' ? ['ParkingBrakeLever'] : [])]) {
      expect(node(name).mesh, name).toBeTypeOf('number');
    }
    // asset-scene sets driven rotations outright, so every driven node must rest at identity.
    for (const name of ['SteeringWheelPivot', 'SpeedometerNeedle', 'BrakePedal', 'AcceleratorPedal',
      ...(id === 'cuv' ? ['ParkingBrakeLever'] : [])]) {
      expect(node(name).rotation, name).toBeUndefined();
    }
    if (id === 'cuv') {
      // The lever grip extends forward (-Z) from its rear hinge, so +X rotation lifts it.
      const lever = node('ParkingBrakeLever');
      const accessor = glb.accessors[glb.meshes[lever.mesh].primitives[0].attributes.POSITION];
      expect(accessor.min[2]).toBeLessThan(-0.2);
      expect(accessor.max[2]).toBeLessThan(0.01);
    }
  });

  it.each(['sedan', 'cuv'])('adds batched exterior lit-lamp nodes under Exterior for %s by default', (id) => {
    // The lamps were approved and promoted (issue #11), so default generation authors them.
    expect(EXTERIOR_LAMPS_DEFAULT).toBe(true);
    const glb = readGlbBytes(buildGlb(id));
    const index = (name) => glb.nodes.findIndex((node) => node.name === name);
    const ancestors = (name) => {
      const chain = [];
      let current = index(name);
      while (current >= 0) {
        chain.push(glb.nodes[current].name);
        current = glb.nodes.findIndex((node) => node.children?.includes(current));
      }
      return chain;
    };
    for (const name of ['BrakeLampsLit', 'ReverseLampsLit', 'TurnSignalLeftLit', 'TurnSignalRightLit']) {
      expect(glb.nodes[index(name)]?.mesh, name).toBeTypeOf('number');
      expect(ancestors(name), name).toContain('Exterior');
    }
    expect(buildGlb(id, { lamps: true })).toEqual(buildGlb(id));
  });

  it.each(['sedan', 'cuv'])('leaves the lit-lamp nodes out of %s with the lamps: false opt-out', (id) => {
    const names = readGlbBytes(buildGlb(id, { lamps: false })).nodes.map((node) => node.name);
    for (const name of ['BrakeLampsLit', 'ReverseLampsLit', 'TurnSignalLeftLit', 'TurnSignalRightLit']) {
      expect(names).not.toContain(name);
    }
  });

  it('no longer accepts the retired --lamps candidate flag', () => {
    const root = mkdtempSync(join(tmpdir(), 'park-core-lamps-'));
    temporaryRoots.push(root);
    const result = spawnSync(process.execPath, [generator, '--lamps', '--vehicle', 'sedan', '--out', root],
      { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(existsSync(assetPath(root, 'sedan'))).toBe(false);
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

  it.each(['sedan', 'cuv'])('offsets the %s cabin by the eye shift and keeps it inside the body', (assetId) => {
    const json = readGlbBytes(buildGlb(assetId));
    const parents = new Map();
    json.nodes.forEach((node, parentIndex) =>
      node.children?.forEach((childIndex) => parents.set(childIndex, parentIndex)));
    // Translations only: the cabin meshes checked here sit under unrotated nodes.
    const origin = (nodeIndex) => {
      const sum = [0, 0, 0];
      for (let index = nodeIndex; index !== undefined; index = parents.get(index)) {
        json.nodes[index].translation?.forEach((value, axis) => { sum[axis] += value; });
      }
      return sum;
    };
    const named = (name) => json.nodes.findIndex((node) => node.name === name);
    const bounds = (name) => {
      const index = named(name);
      const accessor = json.accessors[json.meshes[json.nodes[index].mesh].primitives[0].attributes.POSITION];
      const offset = origin(index);
      return { min: accessor.min.map((v, axis) => v + offset[axis]), max: accessor.max.map((v, axis) => v + offset[axis]) };
    };
    const profile = profiles[assetId];
    const designEye = [1.12, -0.665];
    const cockpit = json.nodes[named('Cockpit')].translation;
    // Cockpit = ground plane (-COM) shifted up by the eye height difference.
    expect(cockpit[1]).toBeCloseTo(profile.driverEyeLocalM[1] - designEye[0], 6);
    expect(cockpit[2]).toBeCloseTo(profile.driverEyeLocalM[2] - designEye[1], 6);
    const body = bounds('Body');
    for (const name of ['SeatsAndInterior', 'Dashboard']) {
      const cabin = bounds(name);
      for (const axis of [0, 1, 2]) {
        expect(cabin.min[axis], `${name} min ${axis}`).toBeGreaterThanOrEqual(body.min[axis] - 1e-6);
        expect(cabin.max[axis], `${name} max ${axis}`).toBeLessThanOrEqual(body.max[axis] + 1e-6);
      }
    }
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
