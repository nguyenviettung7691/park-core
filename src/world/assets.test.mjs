import { Box3, BufferGeometry, Mesh, Raycaster, Vector3 } from 'three';
import { profiles } from '../vehicle/profiles.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGlb } from '../../tools/generate-assets.mjs';
import { AssetLoadError, loadSceneAssets } from './assets.ts';
import { collidersForEnvironment, prototypeYard } from './colliders.ts';

const assetBytes = {
  '/assets/vehicles/sedan.glb': buildGlb('sedan'),
  '/assets/vehicles/cuv.glb': buildGlb('cuv'),
  '/assets/environments/roadside.glb': buildGlb('roadside'),
  '/assets/environments/garage.glb': buildGlb('garage'),
};

function rewriteJson(bytes, mutate) {
  const source = Buffer.from(bytes);
  const jsonLength = source.readUInt32LE(12);
  const json = JSON.parse(source.toString('utf8', 20, 20 + jsonLength));
  mutate(json);
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadding = (4 - jsonBytes.length % 4) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPadding, 0x20)]);
  const binaryHeaderOffset = 20 + jsonLength;
  const binaryLength = source.readUInt32LE(binaryHeaderOffset);
  const binaryChunk = source.subarray(binaryHeaderOffset, binaryHeaderOffset + 8 + binaryLength);
  const totalLength = 12 + 8 + jsonChunk.length + binaryChunk.length;
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, jsonChunk, binaryChunk]);
}

function mockedFetch(records = assetBytes, knownLengths = true) {
  const calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const path = new URL(String(url), 'https://park-core.test').pathname;
    calls.push({ path, signal: init?.signal });
    const bytes = records[path];
    if (!bytes) return new Response(null, { status: 404 });
    const headers = knownLengths ? { 'content-length': String(bytes.byteLength) } : {};
    return new Response(bytes, { status: 200, headers });
  }));
  return calls;
}

function disposalEvents(assets) {
  const disposed = [];
  const seen = new Set();
  for (const root of [assets.environment, assets.vehicle]) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      for (const resource of [object.geometry, ...[].concat(object.material)]) {
        if (seen.has(resource)) continue;
        seen.add(resource);
        resource.addEventListener('dispose', () => disposed.push(resource));
      }
    });
  }
  return { disposed, expected: seen.size };
}

afterEach(() => vi.unstubAllGlobals());

describe('phase 5 scene asset loading', () => {
  it.each(['sedan', 'cuv'])('keeps %s forward cockpit sightlines open in the real exported shell', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      for (const x of [0, -0.35, 0.35]) {
        const ray = new Raycaster(new Vector3(...profiles[id].driverEyeLocalM),
          new Vector3(x, 0, -1).normalize(), 0.1, 3);
        expect(ray.intersectObject(assets.vehicle, true).map((hit) => hit.object.name)).toEqual([]);
      }
      expect(assets.vehicle.getObjectByName('Exterior')).toBeTruthy();
      const bounds = new Box3().setFromObject(assets.vehicle.getObjectByName('Body'));
      expect(bounds.max.y + profiles[id].centerOfMassHeightM).toBeCloseTo(profiles[id].bodySizeM[1], 4);
      const hood = new Box3().setFromObject(assets.vehicle.getObjectByName('Hood'));
      expect(hood.max.y).toBeLessThan(profiles[id].driverEyeLocalM[1]);
    } finally { assets.dispose(); }
  });

  it.each(['garage', 'roadside'])('keeps %s details on the appropriate camera layers', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets(id, 'sedan', new AbortController().signal);
    try {
      if (id === 'garage') {
        expect(assets.environment.getObjectByName('GarageWallDetails')).toBeTruthy();
        const fixtures = assets.environment.getObjectByName('CeilingFixtures');
        expect(fixtures).toBeTruthy();
        assets.environment.getObjectByName('Ceiling').traverse((node) => {
          expect(node.layers.isEnabled(2)).toBe(true);
          expect(node.layers.isEnabled(0)).toBe(false);
        });
      } else {
        expect(assets.environment.getObjectByName('RoadSurfaceDetails')).toBeTruthy();
        expect(assets.environment.getObjectByName('FenceDetails')).toBeTruthy();
      }
      for (const name of ['Ground', 'WallsAndCurbs']) {
        assets.environment.getObjectByName(name).traverse((node) =>
          expect(node.layers.isEnabled(0)).toBe(true));
      }
    } finally { assets.dispose(); }
  });

  it('loads only the selected vehicle/environment pair and disposes resources once', async () => {
    const calls = mockedFetch();
    const progress = [];
    const assets = await loadSceneAssets('garage', 'sedan', new AbortController().signal,
      (value) => progress.push(value));

    expect(new Set(calls.map((call) => call.path))).toEqual(new Set([
      '/assets/vehicles/sedan.glb', '/assets/environments/garage.glb',
    ]));
    expect(assets.vehicle.getObjectByName('Body')).toBeTruthy();
    expect(assets.environment.getObjectByName('Ground')).toBeTruthy();
    expect(assets.vehicle.isGroup).toBe(true);
    expect(assets.environment.isGroup).toBe(true);
    expect(assets.wheelNodes.map((node) => node.name)).toEqual([
      'WheelFL', 'WheelFR', 'WheelRL', 'WheelRR',
    ]);
    expect(assets.anchors.driverEyeLocalM[0]).toBeCloseTo(-0.36, 4);
    expect(assets.anchors.mirrors.left.rotation[1]).toBeCloseTo(Math.sin(105 * Math.PI / 360), 4);
    expect(assets.environment.getObjectByName('Ceiling').layers.isEnabled(2)).toBe(true);
    expect(assets.vehicle.getObjectByName('MirrorSurfaceRear').layers.isEnabled(1)).toBe(true);
    expect(progress).toHaveLength(2);
    expect(progress.every((item) => item.totalBytes === item.loadedBytes)).toBe(true);

    const tracked = disposalEvents(assets);
    assets.dispose();
    assets.dispose();
    expect(tracked.disposed).toHaveLength(tracked.expected);
  });

  it('reports an indeterminate transfer when content length is unavailable', async () => {
    const progress = [];
    mockedFetch(assetBytes, false);
    const assets = await loadSceneAssets('roadside', 'cuv', new AbortController().signal,
      (value) => progress.push(value));
    expect(progress).toHaveLength(2);
    expect(progress.every((item) => item.totalBytes === null)).toBe(true);
    assets.dispose();
  });

  it('rejects a vehicle with a missing required wheel node as a vehicle failure', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        json.nodes.find((node) => node.name === 'WheelRR').name = 'WheelMissing';
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({
        name: AssetLoadError.name, resource: 'vehicle', reason: 'invalid-contract',
      });
  });

  it('rejects a vehicle whose declared dimensions exceed the metadata tolerance', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        json.nodes[0].extras.dimensionsM[0] += 0.021;
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'vehicle', reason: 'invalid-contract' });
  });

  it('rejects a translated vehicle body that would disagree with its collider profile', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        json.nodes.find((node) => node.name === 'Body').translation[2] += 0.03;
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'vehicle', reason: 'invalid-contract' });
  });

  it('rejects cabin geometry extending beyond the vehicle body bounds', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        json.nodes.find((node) => node.name === 'Cabin').translation[1] += 0.2;
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'vehicle', reason: 'invalid-contract' });
  });

  it('rejects a scaled asset root despite matching declared dimensions', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        json.nodes[0].scale = [1.1, 1, 1];
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'vehicle', reason: 'invalid-contract' });
  });

  it('rejects a scaled driver-eye anchor despite matching local position', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        json.nodes.find((node) => node.name === 'DriverEye').scale = [1.1, 1, 1];
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'vehicle', reason: 'invalid-contract' });
  });

  it('rejects a mismatched driver-eye anchor transform', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        json.nodes.find((node) => node.name === 'DriverEye').translation[0] += 0.03;
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'vehicle', reason: 'invalid-contract' });
  });

  it('returns driver-eye coordinates relative to the vehicle root', async () => {
    const records = {
      ...assetBytes,
      '/assets/vehicles/sedan.glb': rewriteJson(assetBytes['/assets/vehicles/sedan.glb'], (json) => {
        const eyeIndex = json.nodes.findIndex((node) => node.name === 'DriverEye');
        const eye = json.nodes[eyeIndex];
        eye.translation[0] -= 0.03;
        json.nodes[0].children = json.nodes[0].children.filter((index) => index !== eyeIndex);
        json.nodes.push({ name: 'TranslatedAnchorParent', translation: [0.03, 0, 0], children: [eyeIndex] });
        json.nodes[0].children.push(json.nodes.length - 1);
      }),
    };
    mockedFetch(records);
    const assets = await loadSceneAssets('garage', 'sedan', new AbortController().signal);
    assets.anchors.driverEyeLocalM.forEach((value, index) =>
      expect(value).toBeCloseTo([-0.36, 0.6, -0.965][index], 6));
    assets.dispose();
  });

  it('rejects a translated environment floor that would disagree with its collider', async () => {
    const records = {
      ...assetBytes,
      '/assets/environments/garage.glb': rewriteJson(assetBytes['/assets/environments/garage.glb'], (json) => {
        json.nodes.find((node) => node.name === 'Ground').translation[0] += 0.03;
      }),
    };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'environment', reason: 'invalid-contract' });
  });

  it('disposes the loaded vehicle when the selected environment is malformed', async () => {
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const records = { ...assetBytes, '/assets/environments/garage.glb': new Uint8Array([0, 1, 2]) };
    mockedFetch(records);
    await expect(loadSceneAssets('garage', 'sedan', new AbortController().signal))
      .rejects.toMatchObject({ resource: 'environment', reason: 'invalid-glb' });
    expect(dispose).toHaveBeenCalled();
  });

  it('honors abort before starting network work', async () => {
    const controller = new AbortController();
    const calls = mockedFetch();
    controller.abort();
    await expect(loadSceneAssets('garage', 'sedan', controller.signal))
      .rejects.toMatchObject({ name: 'AssetLoadError', reason: 'aborted' });
    expect(calls).toHaveLength(0);
  });

  it('keeps physics colliders explicit and environment-specific', () => {
    const garage = collidersForEnvironment('garage');
    const roadside = collidersForEnvironment('roadside');
    expect(garage.find((box) => box.id === 'garage-ground')).toMatchObject({
      kind: 'ground', centerM: [0, -0.125, 0], halfExtentsM: [15, 0.125, 15],
    });
    expect(garage.some((box) => box.id.startsWith('garage-pillar'))).toBe(true);
    expect(roadside.some((box) => box.kind === 'curb')).toBe(true);
    expect(garage).not.toBe(prototypeYard);
    expect(roadside).not.toBe(prototypeYard);
  });
});
