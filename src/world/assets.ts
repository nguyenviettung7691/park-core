import {
  Box3, BufferGeometry, Group, Material, Mesh, Quaternion, Texture, Vector3, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type {
  BodyPose,
  EnvironmentId,
  QuatData,
  Vec3Data,
  VehicleId,
} from '../contracts';
import { profiles } from '../vehicle/profiles';
import { deriveGeometry } from '../vehicle/geometry';
import {
  MIRROR_EXCLUDED_LAYER,
  OVERHEAD_EXCLUDED_LAYER,
  type AssetLoadProgress,
  type SceneAssets,
  type VehicleAnchors,
} from '../runtime-types';

type AssetResource = 'vehicle' | 'environment';
export type AssetFailureCategory = AssetResource;
type AssetFailureReason = 'aborted' | 'network' | 'invalid-glb' | 'invalid-contract';

interface GlbDocument {
  readonly asset?: { readonly version?: unknown };
  readonly buffers?: readonly { readonly uri?: unknown }[];
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly {
    readonly name?: unknown;
    readonly children?: readonly number[];
    readonly translation?: readonly number[];
    readonly rotation?: readonly number[];
    readonly scale?: readonly number[];
    readonly mesh?: number;
    readonly extras?: { readonly dimensionsM?: unknown; readonly origin?: unknown };
  }[];
  readonly meshes?: readonly {
    readonly primitives?: readonly { readonly attributes?: { readonly POSITION?: number } }[];
  }[];
  readonly accessors?: readonly { readonly min?: readonly number[]; readonly max?: readonly number[] }[];
}

const environmentDimensions: Readonly<Record<EnvironmentId, Vec3Data>> = {
  garage: [30, 6, 30],
  roadside: [50, 3, 32],
};

const vehicleNodeNames = [
  'Exterior', 'ParkedGlazing',
  'Body', 'WheelFL', 'WheelFR', 'WheelRL', 'WheelRR', 'DriverEye',
  'MirrorRear', 'MirrorLeft', 'MirrorRight',
  'MirrorSurfaceRear', 'MirrorSurfaceLeft', 'MirrorSurfaceRight',
  'Dashboard', 'SteeringWheel',
] as const;

export class AssetLoadError extends Error {
  constructor(
    readonly resource: AssetResource,
    readonly reason: AssetFailureReason,
    options?: ErrorOptions,
  ) {
    super(`Unable to load ${resource} asset: ${reason}`, options);
    this.name = 'AssetLoadError';
  }
}

function failure(
  resource: AssetResource,
  reason: AssetFailureReason,
  cause?: unknown,
): AssetLoadError {
  return new AssetLoadError(resource, reason, cause === undefined ? undefined : { cause });
}

function parseGlbDocument(bytes: ArrayBuffer, resource: AssetResource): GlbDocument {
  if (bytes.byteLength < 28) throw failure(resource, 'invalid-glb');
  const view = new DataView(bytes);
  if (view.getUint32(0, true) !== 0x46546c67 ||
      view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== bytes.byteLength) {
    throw failure(resource, 'invalid-glb');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a ||
      jsonLength < 2 || 20 + jsonLength + 8 > bytes.byteLength) {
    throw failure(resource, 'invalid-glb');
  }
  const binaryHeader = 20 + jsonLength;
  const binaryLength = view.getUint32(binaryHeader, true);
  if (view.getUint32(binaryHeader + 4, true) !== 0x004e4942 ||
      binaryHeader + 8 + binaryLength !== bytes.byteLength) {
    throw failure(resource, 'invalid-glb');
  }
  try {
    const text = new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength));
    const document = JSON.parse(text) as GlbDocument;
    if (document.asset?.version !== '2.0' || !Array.isArray(document.nodes) ||
        !Array.isArray(document.scenes) || document.buffers?.length !== 1 ||
        document.buffers.some((buffer) => buffer.uri !== undefined)) {
      throw failure(resource, 'invalid-glb');
    }
    return document;
  } catch (error) {
    if (error instanceof AssetLoadError) throw error;
    throw failure(resource, 'invalid-glb', error);
  }
}

function rootDocument(document: GlbDocument, resource: AssetResource) {
  const sceneIndex = document.scene ?? 0;
  const roots = document.scenes?.[sceneIndex]?.nodes;
  if (!roots || roots.length !== 1 || !document.nodes?.[roots[0]]) {
    throw failure(resource, 'invalid-contract');
  }
  return document.nodes[roots[0]]!;
}

function closeVector(
  actual: unknown,
  expected: Vec3Data,
  tolerance = 0.02,
): actual is readonly number[] {
  return Array.isArray(actual) && actual.length === 3 &&
    actual.every((value, index) => typeof value === 'number' &&
      Number.isFinite(value) && Math.abs(value - expected[index]!) <= tolerance);
}

function nodeMap(document: GlbDocument, resource: AssetResource): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const [index, node] of document.nodes!.entries()) {
    if (typeof node.name !== 'string') continue;
    const matches = result.get(node.name) ?? [];
    matches.push(index);
    result.set(node.name, matches);
  }
  return result;
}

function validateDimensions(
  root: NonNullable<GlbDocument['nodes']>[number],
  expected: Vec3Data,
  resource: AssetResource,
) {
  if (!closeVector(root.extras?.dimensionsM, expected)) {
    throw failure(resource, 'invalid-contract');
  }
}

function validateRootTransform(
  root: NonNullable<GlbDocument['nodes']>[number],
  resource: AssetResource,
) {
  if (!closeVector(root.translation ?? [0, 0, 0], [0, 0, 0], 1e-6) ||
      !closeVector(root.scale ?? [1, 1, 1], [1, 1, 1], 1e-6) ||
      !nodeRotationMatches(root.rotation, 0)) {
    throw failure(resource, 'invalid-contract');
  }
}

function nodeRotationMatches(
  value: readonly number[] | undefined,
  yaw: number,
): boolean {
  const actual = value ?? [0, 0, 0, 1];
  if (actual.length !== 4 || !actual.every(Number.isFinite)) return false;
  const expected: QuatData = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const length = Math.hypot(...actual);
  if (length === 0) return false;
  const dot = Math.abs(actual.reduce((sum, component, index) =>
    sum + component * expected[index]!, 0) / length);
  return dot >= 1 - 1e-5;
}

function validateVehicle(
  document: GlbDocument,
  vehicle: VehicleId,
  root: NonNullable<GlbDocument['nodes']>[number],
) {
  const names = nodeMap(document, 'vehicle');
  for (const name of vehicleNodeNames) {
    if (names.get(name)?.length !== 1) throw failure('vehicle', 'invalid-contract');
  }
  const dimensions = profiles[vehicle].bodySizeM;
  validateDimensions(root, dimensions, 'vehicle');
  if (root.extras?.origin !== 'center-of-mass') {
    throw failure('vehicle', 'invalid-contract');
  }
}

function vectorTuple(vector: Vector3): Vec3Data {
  return [vector.x, vector.y, vector.z];
}

function quaternionTuple(quaternion: Quaternion): QuatData {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

function hasUnitWorldScale(object: Object3D): boolean {
  return closeVector(vectorTuple(object.getWorldScale(new Vector3())), [1, 1, 1], 1e-5);
}

function meshWorldBounds(mesh: Object3D, resource: AssetResource): Box3 {
  if (!(mesh instanceof Mesh)) throw failure(resource, 'invalid-contract');
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox?.clone().applyMatrix4(mesh.matrixWorld);
  if (!bounds) throw failure(resource, 'invalid-contract');
  return bounds;
}

function validateMeshBounds(
  mesh: Object3D,
  expectedCenter: Vec3Data,
  expectedSize: Vec3Data,
  resource: AssetResource,
): Box3 {
  const bounds = meshWorldBounds(mesh, resource);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  if (!closeVector(vectorTuple(center), expectedCenter) ||
      !closeVector(vectorTuple(size), expectedSize)) {
    throw failure(resource, 'invalid-contract');
  }
  return bounds;
}

function validateVehicleScene(root: Group, vehicle: VehicleId) {
  const profile = profiles[vehicle];
  const geometry = deriveGeometry(profile);
  root.updateMatrixWorld(true);
  const eye = requiredObject(root, 'DriverEye', 'vehicle');
  if (!hasUnitWorldScale(eye) ||
      !closeVector(vectorTuple(eye.getWorldPosition(new Vector3())), profile.driverEyeLocalM) ||
      !nodeRotationMatches(quaternionTuple(eye.getWorldQuaternion(new Quaternion())), 0)) {
    throw failure('vehicle', 'invalid-contract');
  }
  const expectedMirrors: readonly [string, Vec3Data, number][] = [
    ['MirrorRear', [0, profile.driverEyeLocalM[1] + 0.12,
      profile.driverEyeLocalM[2] - 0.75], Math.PI],
    ['MirrorLeft', geometry.mirrors[0].centerLocalM, 105 * Math.PI / 180],
    ['MirrorRight', geometry.mirrors[1].centerLocalM, -105 * Math.PI / 180],
  ];
  for (const [name, position, yaw] of expectedMirrors) {
    const node = requiredObject(root, name, 'vehicle');
    if (!hasUnitWorldScale(node) ||
        !closeVector(vectorTuple(node.getWorldPosition(new Vector3())), position) ||
        !nodeRotationMatches(quaternionTuple(node.getWorldQuaternion(new Quaternion())), yaw)) {
      throw failure('vehicle', 'invalid-contract');
    }
  }
  const bodyCenterY = (profile.groundClearanceM + profile.bodySizeM[1]) / 2 -
    profile.centerOfMassHeightM;
  const body = requiredObject(root, 'Body', 'vehicle');
  if (!hasUnitWorldScale(body)) throw failure('vehicle', 'invalid-contract');
  const bodyBounds = validateMeshBounds(body, [0, bodyCenterY, 0],
    [profile.bodySizeM[0], profile.bodySizeM[1] - profile.groundClearanceM,
      profile.bodySizeM[2]], 'vehicle');
  if (!nodeRotationMatches(quaternionTuple(body.getWorldQuaternion(new Quaternion())), 0)) {
    throw failure('vehicle', 'invalid-contract');
  }
  for (const name of ['Cabin', 'Windshield', 'RearWindow']) {
    const bounds = meshWorldBounds(requiredObject(root, name, 'vehicle'), 'vehicle');
    if (bounds.min.x < bodyBounds.min.x - 0.02 || bounds.max.x > bodyBounds.max.x + 0.02 ||
        bounds.min.y < bodyBounds.min.y - 0.02 || bounds.max.y > bodyBounds.max.y + 0.02 ||
        bounds.min.z < bodyBounds.min.z - 0.02 || bounds.max.z > bodyBounds.max.z + 0.02) {
      throw failure('vehicle', 'invalid-contract');
    }
  }
}

function validateEnvironment(
  document: GlbDocument,
  environment: EnvironmentId,
  root: NonNullable<GlbDocument['nodes']>[number],
) {
  const names = nodeMap(document, 'environment');
  for (const name of ['Ground', 'ParkingMarkings', 'WallsAndCurbs']) {
    if (names.get(name)?.length !== 1) throw failure('environment', 'invalid-contract');
  }
  if (environment === 'garage') {
    const ceiling = names.get('Ceiling');
    const pillars = names.get('Pillars');
    if (ceiling?.length !== 1 || pillars?.length !== 1 ||
        !document.nodes![ceiling[0]!]!.children?.length) {
      throw failure('environment', 'invalid-contract');
    }
  }
  validateDimensions(root, environmentDimensions[environment], 'environment');
}

function validateEnvironmentScene(root: Group, environment: EnvironmentId) {
  root.updateMatrixWorld(true);
  const dimensions = environmentDimensions[environment];
  const ground = requiredObject(root, 'Ground', 'environment');
  validateMeshBounds(ground, [0, -0.12, 0],
    [dimensions[0], 0.24, dimensions[2]], 'environment');
  if (!closeVector(vectorTuple(ground.getWorldPosition(new Vector3())), [0, -0.12, 0], 1e-4) ||
      !nodeRotationMatches(quaternionTuple(ground.getWorldQuaternion(new Quaternion())), 0) ||
      !hasUnitWorldScale(ground)) {
    throw failure('environment', 'invalid-contract');
  }
}

function parseScene(bytes: ArrayBuffer, resource: AssetResource): Promise<Group> {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(bytes, '', (gltf) => {
      const loadedRoot = gltf.scene.children[0];
      if (gltf.scene.children.length !== 1 || !loadedRoot) {
        reject(failure(resource, 'invalid-contract'));
        return;
      }
      const root = new Group();
      root.name = loadedRoot.name;
      root.add(loadedRoot);
      resolve(root);
    }, (error) => reject(failure(resource, 'invalid-glb', error)));
  });
}

function disposeTree(root: Object3D) {
  const resources = new Set<BufferGeometry | Material | Texture>();
  root.traverse((object) => {
    if ('geometry' in object && object.geometry instanceof BufferGeometry) {
      resources.add(object.geometry);
    }
    if ('material' in object) {
      const material = object.material;
      for (const item of Array.isArray(material) ? material : [material]) {
        if (!(item instanceof Material)) continue;
        resources.add(item);
        for (const value of Object.values(item)) {
          if (value instanceof Texture) resources.add(value);
        }
      }
    }
  });
  for (const resource of resources) resource.dispose();
}

function requiredObject(root: Group, name: string, resource: AssetResource): Object3D {
  const object = root.getObjectByName(name);
  if (!object) throw failure(resource, 'invalid-contract');
  return object;
}

function tuple3(object: Object3D, root: Group): Vec3Data {
  const position = root.worldToLocal(object.getWorldPosition(new Vector3()));
  return [position.x, position.y, position.z];
}

function pose(object: Object3D, root: Group): BodyPose {
  const rootRotation = root.getWorldQuaternion(new Quaternion()).invert();
  const rotation = rootRotation.multiply(object.getWorldQuaternion(new Quaternion()));
  return {
    positionM: tuple3(object, root),
    rotation: quaternionTuple(rotation),
  };
}

async function loadAsset(
  resource: AssetResource,
  id: VehicleId | EnvironmentId,
  signal: AbortSignal,
  onProgress?: (progress: AssetLoadProgress) => void,
): Promise<Group> {
  if (signal.aborted) throw failure(resource, 'aborted');
  const folder = resource === 'vehicle' ? 'vehicles' : 'environments';
  const url = `/assets/${folder}/${id}.glb`;
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    throw failure(resource, signal.aborted ? 'aborted' : 'network', error);
  }
  if (!response.ok) throw failure(resource, 'network');

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch (error) {
    throw failure(resource, signal.aborted ? 'aborted' : 'network', error);
  }
  if (signal.aborted) throw failure(resource, 'aborted');
  const contentLength = Number(response.headers.get('content-length'));
  onProgress?.({
    resource,
    loadedBytes: bytes.byteLength,
    totalBytes: Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : null,
  });

  const document = parseGlbDocument(bytes, resource);
  const rootSpec = rootDocument(document, resource);
  if (rootSpec.name !== `${id} asset`) throw failure(resource, 'invalid-contract');
  validateRootTransform(rootSpec, resource);
  if (resource === 'vehicle') {
    if (id !== 'sedan' && id !== 'cuv') throw failure(resource, 'invalid-contract');
    validateVehicle(document, id, rootSpec);
  } else {
    if (id !== 'garage' && id !== 'roadside') throw failure(resource, 'invalid-contract');
    validateEnvironment(document, id, rootSpec);
  }

  let root: Group;
  try {
    root = await parseScene(bytes, resource);
  } catch (error) {
    throw error instanceof AssetLoadError ? error : failure(resource, 'invalid-glb', error);
  }
  try {
    root.removeFromParent();
    if (resource === 'vehicle') {
      if (id !== 'sedan' && id !== 'cuv') throw failure(resource, 'invalid-contract');
      validateVehicleScene(root, id);
      requiredObject(root, 'ParkedGlazing', resource).visible = false;
      for (const name of ['WheelFL', 'WheelFR', 'WheelRL', 'WheelRR',
        'DriverEye', 'MirrorRear', 'MirrorLeft', 'MirrorRight',
        'MirrorSurfaceRear', 'MirrorSurfaceLeft', 'MirrorSurfaceRight']) {
        requiredObject(root, name, resource);
      }
      const names = new Set<string>();
      for (const name of ['WheelFL', 'WheelFR', 'WheelRL', 'WheelRR']) {
        const wheel = requiredObject(root, name, resource);
        if (names.has(wheel.name)) throw failure(resource, 'invalid-contract');
        names.add(wheel.name);
      }
    } else {
      if (id !== 'garage' && id !== 'roadside') throw failure(resource, 'invalid-contract');
      validateEnvironmentScene(root, id);
      requiredObject(root, 'Ground', resource);
      requiredObject(root, 'ParkingMarkings', resource);
      requiredObject(root, 'WallsAndCurbs', resource);
      if (id === 'garage') {
        requiredObject(root, 'Pillars', resource);
        const ceiling = requiredObject(root, 'Ceiling', resource);
        ceiling.traverse((object) => object.layers.set(OVERHEAD_EXCLUDED_LAYER));
      }
    }
    if (resource === 'vehicle') {
      for (const name of ['MirrorSurfaceRear', 'MirrorSurfaceLeft', 'MirrorSurfaceRight']) {
        requiredObject(root, name, resource).layers.set(MIRROR_EXCLUDED_LAYER);
      }
    }
    return root;
  } catch (error) {
    disposeTree(root);
    throw error;
  }
}

export async function loadSceneAssets(
  environment: EnvironmentId,
  vehicle: VehicleId,
  signal: AbortSignal,
  onProgress?: (progress: AssetLoadProgress) => void,
): Promise<SceneAssets> {
  let vehicleRoot: Group | null = null;
  let environmentRoot: Group | null = null;
  try {
    vehicleRoot = await loadAsset('vehicle', vehicle, signal, onProgress);
    environmentRoot = await loadAsset('environment', environment, signal, onProgress);
  } catch (error) {
    if (vehicleRoot) disposeTree(vehicleRoot);
    if (environmentRoot) disposeTree(environmentRoot);
    throw error;
  }

  if (!vehicleRoot || !environmentRoot) {
    throw new Error('Scene asset loader completed without both selected resources');
  }
  const eye = requiredObject(vehicleRoot, 'DriverEye', 'vehicle');
  vehicleRoot.updateMatrixWorld(true);
  const anchors: VehicleAnchors = {
    driverEyeLocalM: tuple3(eye, vehicleRoot),
    mirrors: {
      rear: pose(requiredObject(vehicleRoot, 'MirrorRear', 'vehicle'), vehicleRoot),
      left: pose(requiredObject(vehicleRoot, 'MirrorLeft', 'vehicle'), vehicleRoot),
      right: pose(requiredObject(vehicleRoot, 'MirrorRight', 'vehicle'), vehicleRoot),
    },
  };
  const wheelNodes = [
    requiredObject(vehicleRoot, 'WheelFL', 'vehicle'),
    requiredObject(vehicleRoot, 'WheelFR', 'vehicle'),
    requiredObject(vehicleRoot, 'WheelRL', 'vehicle'),
    requiredObject(vehicleRoot, 'WheelRR', 'vehicle'),
  ] as const;
  let disposed = false;
  return {
    environment: environmentRoot,
    vehicle: vehicleRoot,
    wheelNodes,
    anchors,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeTree(environmentRoot);
      disposeTree(vehicleRoot);
    },
  };
}
