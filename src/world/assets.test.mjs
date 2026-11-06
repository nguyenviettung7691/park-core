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
      const visibleMeshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) visibleMeshes.push(node); });
      for (const x of [0, -0.35, 0.35]) {
        const ray = new Raycaster(new Vector3(...profiles[id].driverEyeLocalM),
          new Vector3(x, 0, -1).normalize(), 0.1, 3);
        ray.layers.enable(1);
        expect(ray.intersectObjects(visibleMeshes, false).map((hit) => hit.object.name)).toEqual([]);
      }
      expect(assets.vehicle.getObjectByName('Exterior')).toBeTruthy();
      const bounds = new Box3().setFromObject(assets.vehicle.getObjectByName('Body'));
      expect(bounds.max.y + profiles[id].centerOfMassHeightM).toBeCloseTo(profiles[id].bodySizeM[1], 4);
      const hood = new Box3().setFromObject(assets.vehicle.getObjectByName('Hood'));
      expect(hood.max.y).toBeLessThan(profiles[id].driverEyeLocalM[1]);
      const down = new Raycaster(new Vector3(...profiles[id].driverEyeLocalM),
        new Vector3(0, -0.35, -1).normalize(), 0.1, 2);
      down.layers.enable(1);
      expect(down.intersectObjects(visibleMeshes, false).map((hit) => hit.object.name)).toContain('SteeringWheel');
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('exports usable %s mirror UVs and outward-only window glazing', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      for (const name of ['Rear', 'Left', 'Right']) {
        const surface = assets.vehicle.getObjectByName(`MirrorSurface${name}`);
        const uv = surface.geometry.getAttribute('uv');
        expect(uv, `${name} mirror needs texture coordinates`).toBeDefined();
        expect(uv.count).toBe(surface.geometry.getAttribute('position').count);
      }
      assets.vehicle.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(0.3, 1.18 - profiles[id].centerOfMassHeightM, -4),
        new Vector3(0, 0, 1), 0.1, 5);
      ray.layers.enable(1);
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      expect(ray.intersectObjects(meshes, false)[0]?.object.name).toBe('ExteriorWindowFaces');
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('encloses %s cockpit controls and rearview display behind the windshield', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      for (const name of ['Dashboard', 'SteeringWheel', 'MirrorSurfaceRear', 'MirrorHousingRear']) {
        const bounds = new Box3().setFromObject(assets.vehicle.getObjectByName(name));
        const point = bounds.getCenter(new Vector3());
        point.y = bounds.max.y;
        const ray = new Raycaster(new Vector3(point.x, point.y, -4), new Vector3(0, 0, 1));
        ray.layers.enable(1);
        const hit = ray.intersectObjects(meshes, false)[0];
        expect(hit?.object.name, `${name} target=${point.toArray()} hit=${hit?.point.toArray()}`)
          .toBe('ExteriorWindowFaces');
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('keeps both %s side-mirror faces visible from the fixed driver eye', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      const eye = new Vector3(...profiles[id].driverEyeLocalM);
      for (const side of ['Left', 'Right']) {
        const surface = assets.vehicle.getObjectByName(`MirrorSurface${side}`);
        surface.geometry.computeBoundingBox();
        const size = surface.geometry.boundingBox.getSize(new Vector3());
        for (let x = -4; x <= 4; x++) {
          for (let y = -4; y <= 4; y++) {
            const point = new Vector3(x * size.x / 10, y * size.y / 10, 0).applyMatrix4(surface.matrixWorld);
            const ray = new Raycaster(eye, point.clone().sub(eye).normalize(), 0, eye.distanceTo(point) + 0.001);
            ray.layers.enable(1);
            const hit = ray.intersectObjects(meshes, false)[0];
            expect(hit?.object.name,
              `${side} sample ${x},${y} target=${point.toArray()} hit=${hit?.point.toArray()}`)
              .toBe(surface.name);
          }
        }
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('keeps %s side-mirror housings visible from exterior three-quarter views', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      for (const side of [-1, 1]) {
        const name = side < 0 ? 'Left' : 'Right';
        const stem = assets.vehicle.getObjectByName(`MirrorStem${name}`);
        const housing = assets.vehicle.getObjectByName(`MirrorHousing${name}`);
        expect(stem, `${name} mirror stem`).toBeTruthy();
        expect(housing, `${name} mirror housing`).toBeTruthy();
        if (!housing) continue;

        const eye = assets.vehicle.getObjectByName('DriverEye').getWorldPosition(new Vector3());
        const housingBounds = new Box3().setFromObject(housing);
        const center = housingBounds.getCenter(new Vector3());
        expect(center.y, `${name} housing height`).toBeGreaterThan(eye.y - 0.12);
        if (stem) {
          expect(new Box3().setFromObject(stem).getSize(new Vector3()).length())
            .toBeGreaterThan(0.1);
        }

        housing.geometry.computeBoundingBox();
        const bounds = housing.geometry.boundingBox;
        const back = new Vector3(0, 0, -1).transformDirection(housing.matrixWorld);
        const origin = center.clone().addScaledVector(back, 1.5).add(new Vector3(0, 0.3, -0.5));
        for (let x = 0; x <= 2; x++) {
          for (let y = 0; y <= 2; y++) {
            const xFraction = 0.2 + x * 0.3;
            const yFraction = 0.2 + y * 0.3;
            const point = new Vector3(
              bounds.min.x + (bounds.max.x - bounds.min.x) * xFraction,
              bounds.min.y + (bounds.max.y - bounds.min.y) * yFraction,
              bounds.min.z,
            ).applyMatrix4(housing.matrixWorld);
            const direction = point.clone().sub(origin);
            const distance = direction.length();
            const ray = new Raycaster(origin, direction.normalize(), 0, distance + 0.001);
            ray.layers.enable(1);
            const hit = ray.intersectObjects(meshes, false)[0];
            expect(['MirrorHousing' + name, 'MirrorSurface' + name, 'MirrorReflectiveFace' + name],
              `${name} exterior sample ${x},${y}`).toContain(hit?.object.name);
          }
        }
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('shows exterior-facing reflectors on the %s side mirrors', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      for (const side of ['Left', 'Right']) {
        const face = assets.vehicle.getObjectByName(`MirrorReflectiveFace${side}`);
        expect(face, `${side} exterior reflector`).toBeTruthy();
        if (!face) continue;
        const center = new Box3().setFromObject(face).getCenter(new Vector3());
        const outward = new Vector3(0, 0, -1).transformDirection(face.matrixWorld);
        const origin = center.clone().addScaledVector(outward, 0.25);
        const direction = center.clone().sub(origin);
        const ray = new Raycaster(origin, direction.normalize(), 0, 0.5);
        ray.layers.enable(1);
        expect(ray.intersectObjects(meshes, false)[0]?.object.name, `${side} reflector exterior face`)
          .toBe(face.name);
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('keeps both %s door-side shells covered at representative samples', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const exterior = assets.vehicle.getObjectByName('Exterior');
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      for (const side of [-1, 1]) {
        for (const z of [-0.8, -0.4, 0, 0.4, 0.8]) {
          const ray = new Raycaster(new Vector3(side * 1.2, 0.2, z), new Vector3(-side, 0, 0), 0, 2.4);
          const hit = ray.intersectObjects(meshes, false)[0];
          let object = hit?.object;
          while (object && object !== exterior) object = object.parent;
          expect(object, `${side} side at z=${z}`).toBe(exterior);
        }
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('closes the %s cabin window line from the exterior', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const exterior = assets.vehicle.getObjectByName('Exterior');
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      const assertExteriorHit = (origin, direction, label) => {
        const ray = new Raycaster(origin, direction.normalize(), 0, 3);
        ray.layers.enable(1);
        let object = ray.intersectObjects(meshes, false)[0]?.object;
        while (object && object !== exterior) object = object.parent;
        expect(object, label).toBe(exterior);
      };
      const heights = id === 'sedan' ? [0.25, 0.4, 0.55, 0.7, 0.85] : [0.31, 0.45, 0.6, 0.75, 0.88];
      for (const side of [-1, 1]) {
        for (const z of [-0.5, 0, 0.5]) {
          for (const y of heights) {
            assertExteriorHit(new Vector3(side * 1.2, y, z), new Vector3(-side, 0, 0),
              `${side} side ray at ${y},${z}`);
            assertExteriorHit(new Vector3(side * 0.84, 1.5, z), new Vector3(0, -1, 0),
              `${side} top ray at ${z}`);
          }
        }
        for (const z of id === 'sedan' ? [-1.5, 1] : [-1.4, 1.5]) {
          assertExteriorHit(new Vector3(side * 0.84, 1.5, z), new Vector3(0, -1, 0),
            `${side} front/rear glass ray at ${z}`);
        }
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('closes the %s rear deck from side, rear and oblique views', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const exterior = assets.vehicle.getObjectByName('Exterior');
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      const assertExteriorHit = (origin, target, label) => {
        const direction = target.clone().sub(origin);
        const distance = direction.length();
        const ray = new Raycaster(origin, direction.normalize(), 0, distance + 0.05);
        ray.layers.enable(1);
        let object = ray.intersectObjects(meshes, false)[0]?.object;
        while (object && object !== exterior) object = object.parent;
        expect(object, label).toBe(exterior);
      };
      const rearEdge = id === 'sedan' ? 2.3 : 2.175;
      const sideZ = id === 'sedan' ? [2.1, 2.2] : [2.0, 2.1];
      const heights = id === 'sedan' ? [0.19, 0.22, 0.25, 0.28] : [0.25, 0.26, 0.275, 0.28];
      for (const side of [-1, 1]) {
        for (const z of sideZ) {
          for (const y of heights) {
            assertExteriorHit(new Vector3(side * 1.2, y, z), new Vector3(side * 0.7, y, z),
              `${side} side at ${y},${z}`);
          }
        }
        for (const y of heights) {
          assertExteriorHit(new Vector3(0, y, rearEdge + 0.5), new Vector3(0, y, rearEdge - 0.1),
            `rear at ${y}`);
          assertExteriorHit(new Vector3(side * 1.2, y, rearEdge + 0.5),
            new Vector3(side * 0.7, y, rearEdge - 0.1), `${side} rear corner at ${y}`);
        }
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('keeps %s cockpit details inside the body bounds', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const bodyBounds = new Box3().setFromObject(assets.vehicle.getObjectByName('Body'));
      for (const name of ['InstrumentCluster', 'PedalSet', 'CenterConsole', 'DoorPanels', 'Floor', 'SeatsAndInterior']) {
        const detail = assets.vehicle.getObjectByName(name);
        expect(detail, name).toBeTruthy();
        if (!detail) continue;
        const bounds = new Box3().setFromObject(detail);
        expect(bounds.min.x, `${name} left`).toBeGreaterThanOrEqual(bodyBounds.min.x - 0.001);
        expect(bounds.max.x, `${name} right`).toBeLessThanOrEqual(bodyBounds.max.x + 0.001);
        expect(bounds.min.y, `${name} bottom`).toBeGreaterThanOrEqual(bodyBounds.min.y - 0.001);
        expect(bounds.max.y, `${name} top`).toBeLessThanOrEqual(bodyBounds.max.y + 0.001);
        expect(bounds.min.z, `${name} front`).toBeGreaterThanOrEqual(bodyBounds.min.z - 0.001);
        expect(bounds.max.z, `${name} rear`).toBeLessThanOrEqual(bodyBounds.max.z + 0.001);
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('keeps the %s rearview display smaller and above the driver eye', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const display = new Box3().setFromObject(assets.vehicle.getObjectByName('MirrorSurfaceRear'));
      const size = display.getSize(new Vector3());
      const center = display.getCenter(new Vector3());
      const eye = assets.vehicle.getObjectByName('DriverEye').getWorldPosition(new Vector3());
      expect(size.x).toBeLessThan(0.12);
      expect(size.y).toBeLessThan(0.05);
      expect(Math.abs(center.x)).toBeLessThan(0.1);
      expect(center.y).toBeGreaterThan(eye.y + 0.15);
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('shows all three instrument dials from the %s driver eye', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const cluster = assets.vehicle.getObjectByName('InstrumentCluster');
      const bounds = new Box3().setFromObject(cluster);
      const eye = assets.vehicle.getObjectByName('DriverEye').getWorldPosition(new Vector3());
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      for (const offset of [-0.14, 0, 0.14]) {
        const target = new Vector3(eye.x + offset, eye.y - 0.05, bounds.max.z - 0.006);
        const direction = target.clone().sub(eye);
        expect(Math.atan2(direction.y, Math.hypot(direction.x, direction.z))).toBeGreaterThan(-Math.PI / 6);
        expect(Math.abs(Math.atan2(direction.x, -direction.z))).toBeLessThan(Math.PI / 4);
        const ray = new Raycaster(eye, direction.clone().normalize(), 0.1, direction.length() + 0.1);
        ray.layers.enable(1);
        const hit = ray.intersectObjects(meshes, false)[0];
        expect(hit?.object.name).toBe('InstrumentCluster');
        expect(hit?.face).toBeDefined();
        if (!hit?.face) continue;
        const colors = hit.object.geometry.getAttribute('color');
        const brightness = [hit.face.a, hit.face.b, hit.face.c]
          .reduce((sum, index) => sum + colors.getX(index), 0) / 3;
        expect(brightness).toBeGreaterThan(0.5);
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('keeps the full %s steering-wheel ring visible from the driver eye', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const eye = assets.vehicle.getObjectByName('DriverEye').getWorldPosition(new Vector3());
      const wheel = assets.vehicle.getObjectByName('SteeringWheel');
      const wheelCenter = wheel.getWorldPosition(new Vector3());
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      const obstructedSamples = [];
      for (let index = 0; index < 16; index++) {
        const angle = index * Math.PI / 8;
        const target = new Vector3(
          wheelCenter.x + Math.cos(angle) * 0.17,
          wheelCenter.y + Math.sin(angle) * 0.17,
          wheelCenter.z + 0.02,
        );
        const direction = target.clone().sub(eye);
        const ray = new Raycaster(eye, direction.clone().normalize(), 0.01, direction.length() + 0.04);
        ray.layers.enable(1);
        const hit = ray.intersectObjects(meshes, false)[0];
        if (hit?.object.name !== 'SteeringWheel') obstructedSamples.push({
          index, hit: hit?.object.name, point: hit?.point.toArray(),
        });
      }
      expect(obstructedSamples, 'wheel ring samples must not be obstructed').toEqual([]);
      const dashboardBounds = new Box3().setFromObject(assets.vehicle.getObjectByName('Dashboard'));
      expect(dashboardBounds.getSize(new Vector3()).x).toBeLessThanOrEqual(1.15);
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('keeps the %s dial face ahead of the steering-wheel hub', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const cluster = assets.vehicle.getObjectByName('InstrumentCluster');
      const bounds = new Box3().setFromObject(cluster);
      const eye = assets.vehicle.getObjectByName('DriverEye').getWorldPosition(new Vector3());
      const target = new Vector3(eye.x, eye.y - 0.05, bounds.max.z - 0.006);
      const direction = target.clone().sub(eye);
      const ray = new Raycaster(eye, direction.normalize(), 0.1, direction.length() + 0.1);
      ray.layers.enable(1);
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      const hits = ray.intersectObjects(meshes, false);
      const dial = hits.find((hit) => hit.object.name === 'InstrumentCluster');
      const wheel = hits.find((hit) => hit.object.name === 'SteeringWheel');
      expect(dial).toBeDefined();
      if (wheel && dial) expect(wheel.distance - dial.distance).toBeGreaterThan(0.002);
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('leaves a visible gap between adjacent %s instrument dials', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const cluster = assets.vehicle.getObjectByName('InstrumentCluster');
      const bounds = new Box3().setFromObject(cluster);
      const eye = assets.vehicle.getObjectByName('DriverEye').getWorldPosition(new Vector3());
      const target = new Vector3(eye.x - 0.07, eye.y - 0.05, bounds.max.z - 0.006);
      const direction = target.clone().sub(eye);
      const ray = new Raycaster(eye, direction.clone().normalize(), 0.1, direction.length() + 0.1);
      ray.layers.enable(1);
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      const hit = ray.intersectObjects(meshes, false)[0];
      expect(hit?.object.name).toBe('InstrumentCluster');
      expect(hit?.face).toBeDefined();
      if (!hit?.face) return;
      const colors = hit.object.geometry.getAttribute('color');
      const brightness = [hit.face.a, hit.face.b, hit.face.c]
        .reduce((sum, index) => sum + colors.getX(index), 0) / 3;
      expect(brightness).toBeGreaterThan(0.1);
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('shows %s indicator lamps in the default driver view', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const cluster = assets.vehicle.getObjectByName('InstrumentCluster');
      const bounds = new Box3().setFromObject(cluster);
      const eye = assets.vehicle.getObjectByName('DriverEye').getWorldPosition(new Vector3());
      const meshes = [];
      assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
      for (const x of [-0.53, -0.41, -0.29, -0.17]) {
        const target = new Vector3(x, eye.y - 0.16, bounds.max.z - 0.006);
        const direction = target.clone().sub(eye);
        const angle = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
        expect(angle).toBeGreaterThan(-Math.PI / 6);
        expect(Math.abs(Math.atan2(direction.x, -direction.z))).toBeLessThan(Math.PI / 4);
        const ray = new Raycaster(eye, direction.clone().normalize(), 0.1, direction.length() + 0.1);
        ray.layers.enable(1);
        const hit = ray.intersectObjects(meshes, false)[0];
        expect(hit?.object.name).toBe('InstrumentCluster');
        expect(hit?.face).toBeDefined();
        if (!hit?.face) continue;
        const colors = hit.object.geometry.getAttribute('color');
        const brightness = [hit.face.a, hit.face.b, hit.face.c]
          .reduce((sum, index) => sum + colors.getX(index), 0) / 3;
        expect(brightness).toBeGreaterThan(0.5);
      }
    } finally { assets.dispose(); }
  });

  it.each(['sedan', 'cuv'])('faces %s side mirrors toward the driver', async (id) => {
    mockedFetch();
    const assets = await loadSceneAssets('garage', id, new AbortController().signal);
    try {
      assets.vehicle.updateMatrixWorld(true);
      const eye = new Vector3(...profiles[id].driverEyeLocalM);
      for (const side of ['Left', 'Right']) {
        const surface = assets.vehicle.getObjectByName(`MirrorSurface${side}`);
        const center = surface.getWorldPosition(new Vector3());
        const normal = new Vector3(0, 0, 1).transformDirection(surface.matrixWorld);
        const towardEye = eye.clone().sub(center).normalize();
        expect(normal.dot(towardEye), `${side} mirror face angle`).toBeGreaterThan(0.5);
        surface.geometry.computeBoundingBox();
        const bounds = surface.geometry.boundingBox;
        const left = new Vector3(bounds.min.x, 0, 0).applyMatrix4(surface.matrixWorld);
        const right = new Vector3(bounds.max.x, 0, 0).applyMatrix4(surface.matrixWorld);
        const angularWidth = eye.clone().sub(left).angleTo(eye.clone().sub(right));
        expect(angularWidth, `${side} mirror projected width`).toBeGreaterThan(0.06);
      }
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
