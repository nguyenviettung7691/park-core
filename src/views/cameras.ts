import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Scene,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { CameraMode, Vec3Data, VehicleProfile, VehicleTelemetry } from '../contracts';
import type { ColliderBox, RenderFrame, SceneAssets } from '../runtime-types';
import { MIRROR_EXCLUDED_LAYER, OVERHEAD_EXCLUDED_LAYER } from '../runtime-types';
import { sampleTrajectory, type TrajectorySample } from './trajectory';
import { renderAuxiliaryPass, type RendererPort } from './auxiliary';
import { getOverheadInset } from './layout';

const MIRROR_INTERVAL_MS = 1000 / 15;
const OVERHEAD_INTERVAL_MS = 1000 / 30;
const CAMERA_COLLISION_MARGIN_M = 0.2;
const CHASE_RESTORE_SECONDS = 0.4;
const CHASE_OFFSET_LOCAL = new Vector3(0, 2.5, 5);
const VIEW_LAYERS = (1 << 0) | (1 << MIRROR_EXCLUDED_LAYER) | (1 << OVERHEAD_EXCLUDED_LAYER);
const MIRROR_LAYERS = VIEW_LAYERS & ~(1 << MIRROR_EXCLUDED_LAYER);
const OVERHEAD_LAYERS = VIEW_LAYERS & ~(1 << OVERHEAD_EXCLUDED_LAYER);
const MIRROR_SPECS = {
  rear: { width: 512, height: 128, fov: 50 },
  left: { width: 256, height: 256, fov: 75 },
  right: { width: 256, height: 256, fov: 75 },
} as const;
const MIRROR_IDS = ['rear', 'left', 'right'] as const;
type MirrorId = typeof MIRROR_IDS[number];

export interface ViewSystem {
  render(frame: RenderFrame, nowMs: number): void;
  look(deltaX: number, deltaY: number): void;
  setCamera(mode: CameraMode): void;
  setOverhead(enabled: boolean): void;
  setTrajectory(enabled: boolean): void;
  setFov(degrees: number): void;
  resize(widthCss: number, heightCss: number, pixelRatio: number): void;
  recenter(): void;
  dispose(): void;
}

interface DynamicLine {
  readonly line: Line | LineSegments;
  update(points: readonly Vec3Data[]): void;
}

function createLine(
  name: string,
  material: LineBasicMaterial,
  segmented: boolean,
  maxVertices: number,
): DynamicLine {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(maxVertices * 3);
  const attribute = new BufferAttribute(positions, 3);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const line = segmented ? new LineSegments(geometry, material) : new Line(geometry, material);
  line.name = name;
  line.frustumCulled = false;
  return {
    line,
    update(points) {
      const count = Math.min(points.length, maxVertices);
      for (let i = 0; i < count; i++) {
        const point = points[i];
        if (!point) continue;
        positions[i * 3] = point[0];
        positions[i * 3 + 1] = point[1];
        positions[i * 3 + 2] = point[2];
      }
      attribute.needsUpdate = true;
      geometry.setDrawRange(0, count);
    },
  };
}

function intersectAxis(
  origin: number,
  direction: number,
  halfExtent: number,
  range: [number, number],
): boolean {
  if (Math.abs(direction) < 1e-9) return Math.abs(origin) <= halfExtent;
  const first = (-halfExtent - origin) / direction;
  const second = (halfExtent - origin) / direction;
  range[0] = Math.max(range[0], Math.min(first, second));
  range[1] = Math.min(range[1], Math.max(first, second));
  return range[0] <= range[1];
}

function rayBoxDistance(
  origin: Vector3,
  direction: Vector3,
  maxDistance: number,
  box: ColliderBox,
): number | null {
  if (box.kind === 'ground') return null;
  const dx = origin.x - box.centerM[0];
  const dz = origin.z - box.centerM[2];
  const cos = Math.cos(box.yawRad);
  const sin = Math.sin(box.yawRad);
  const localOriginX = dx * cos - dz * sin;
  const localOriginZ = dx * sin + dz * cos;
  const localDirectionX = direction.x * cos - direction.z * sin;
  const localDirectionZ = direction.x * sin + direction.z * cos;
  const range: [number, number] = [0, maxDistance];
  if (!intersectAxis(localOriginX, localDirectionX, box.halfExtentsM[0], range) ||
      !intersectAxis(origin.y - box.centerM[1], direction.y, box.halfExtentsM[1], range) ||
      !intersectAxis(localOriginZ, localDirectionZ, box.halfExtentsM[2], range)) {
    return null;
  }
  return range[0];
}

function closestChaseHit(
  target: Vector3,
  desired: Vector3,
  boxes: readonly ColliderBox[],
): number | null {
  const arm = desired.clone().sub(target);
  const armLength = arm.length();
  if (armLength === 0) return null;
  const direction = arm.multiplyScalar(1 / armLength);
  const right = new Vector3(direction.z, 0, -direction.x);
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  const up = new Vector3().crossVectors(direction, right).normalize();
  const offsets = [
    new Vector3(),
    right.clone().multiplyScalar(0.15),
    right.clone().multiplyScalar(-0.15),
    up.clone().multiplyScalar(0.15),
    up.clone().multiplyScalar(-0.15),
  ];
  let closest = Infinity;
  for (const offset of offsets) {
    const rayOrigin = target.clone().add(offset);
    for (const box of boxes) {
      const hit = rayBoxDistance(rayOrigin, direction, armLength, box);
      if (hit !== null) closest = Math.min(closest, hit);
    }
  }
  return Number.isFinite(closest) ? closest : null;
}

function bodyPoseCamera(
  camera: PerspectiveCamera,
  vehicle: SceneAssets['vehicle'],
  positionM: Vec3Data,
  rotation: readonly [number, number, number, number],
): void {
  camera.position.set(...positionM).applyQuaternion(vehicle.quaternion).add(vehicle.position);
  camera.quaternion.copy(vehicle.quaternion).multiply(
    new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]),
  );
  camera.updateMatrixWorld(true);
}

function onGround(point: Vec3Data): Vec3Data {
  return [point[0], 0.03, point[2]];
}

function rearWheelPath(
  sample: TrajectorySample,
  profile: VehicleProfile,
  side: -1 | 1,
): Vec3Data {
  const right = sample.envelope[2];
  const left = sample.envelope[3];
  const rightX = (right[0] - left[0]) / profile.mirrorWidthM;
  const rightZ = (right[2] - left[2]) / profile.mirrorWidthM;
  return [
    sample.rearAxleM[0] + side * rightX * profile.trackM / 2,
    0.03,
    sample.rearAxleM[2] + side * rightZ * profile.trackM / 2,
  ];
}

function envelopeLines(samples: readonly TrajectorySample[]): Vec3Data[] {
  const points: Vec3Data[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample) continue;
    for (let corner = 0; corner < 4; corner++) {
      const start = sample.envelope[corner];
      const end = sample.envelope[(corner + 1) % 4];
      if (start && end) points.push(onGround(start), onGround(end));
      const next = samples[i + 1];
      const nextCorner = next?.envelope[corner];
      if (nextCorner && start) points.push(onGround(start), onGround(nextCorner));
    }
  }
  return points;
}

export function createViews(
  renderer: RendererPort,
  scene: Scene,
  assets: SceneAssets,
  profile: VehicleProfile,
  boxes: readonly ColliderBox[],
): ViewSystem {
  const driverCamera = new PerspectiveCamera(60, 1, 0.1, 100);
  driverCamera.name = 'driver-camera';
  driverCamera.layers.mask = VIEW_LAYERS;
  const chaseCamera = new PerspectiveCamera(60, 1, 0.1, 100);
  chaseCamera.name = 'chase-camera';
  chaseCamera.layers.mask = VIEW_LAYERS;
  const overheadCamera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  overheadCamera.name = 'overhead-camera';
  overheadCamera.layers.mask = OVERHEAD_LAYERS;
  const overlayCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  overlayCamera.name = 'overhead-composite';
  overlayCamera.position.z = 1;
  overlayCamera.layers.mask = 1;

  const mirrorTargets = {} as Record<MirrorId, WebGLRenderTarget>;
  const mirrorCameras = {} as Record<MirrorId, PerspectiveCamera>;
  for (const id of MIRROR_IDS) {
    const spec = MIRROR_SPECS[id];
    const target = new WebGLRenderTarget(spec.width, spec.height);
    target.texture.wrapS = RepeatWrapping;
    target.texture.repeat.x = -1;
    target.texture.offset.x = 1;
    target.texture.generateMipmaps = false;
    mirrorTargets[id] = target;

    const camera = new PerspectiveCamera(spec.fov, spec.width / spec.height, 0.05, 100);
    camera.name = `mirror-${id}-camera`;
    camera.layers.mask = MIRROR_LAYERS;
    mirrorCameras[id] = camera;

    const authoredName = `MirrorSurface${id[0]!.toUpperCase()}${id.slice(1)}`;
    const surface = assets.vehicle.getObjectByName(authoredName) ??
      assets.vehicle.getObjectByName(`mirror-surface-${id}`);
    if (!(surface instanceof Mesh) || !(surface.material instanceof MeshBasicMaterial)) {
      throw new Error(`Missing prototype mirror surface: ${id}`);
    }
    surface.material.map = target.texture;
    surface.material.needsUpdate = true;
  }

  const overheadTarget = new WebGLRenderTarget(320, 320);
  overheadTarget.texture.generateMipmaps = false;
  const overlayScene = new Scene();
  const overlayGeometry = new PlaneGeometry(2, 2);
  const overlayMaterial = new MeshBasicMaterial({
    map: overheadTarget.texture,
    depthTest: false,
    depthWrite: false,
  });
  const overlay = new Mesh(overlayGeometry, overlayMaterial);
  overlay.name = 'overhead-composite-surface';
  overlayScene.add(overlay);

  const trajectoryGroup = new Group();
  trajectoryGroup.name = 'trajectory-estimate';
  const pathMaterial = new LineBasicMaterial({ color: '#9b59b6', depthWrite: false });
  const envelopeMaterial = new LineBasicMaterial({ color: '#d5b1e3', depthWrite: false });
  const leftPath = createLine('trajectory-left-rear-wheel', pathMaterial, false, 32);
  const rightPath = createLine('trajectory-right-rear-wheel', pathMaterial, false, 32);
  const envelope = createLine('trajectory-body-envelope', envelopeMaterial, true, 600);
  trajectoryGroup.add(leftPath.line, rightPath.line, envelope.line);
  scene.add(trajectoryGroup);
  trajectoryGroup.visible = false;

  const target = new Vector3();
  const desired = new Vector3();
  const offset = new Vector3();
  const overheadOffset = new Vector3(0, 20, 0);
  const forward = new Vector3();
  const yawRotation = new Quaternion();
  const pitchRotation = new Quaternion();
  const upAxis = new Vector3(0, 1, 0);
  const rightAxis = new Vector3(1, 0, 0);
  const driverEye = new Vector3();
  let cameraMode: CameraMode = 'driver';
  let overheadEnabled = false;
  let trajectoryEnabled = false;
  let driverFov = 60;
  let yaw = 0;
  let pitch = 0;
  let chaseArmM = CHASE_OFFSET_LOCAL.length();
  let lastChaseTime = Number.NaN;
  let lastMirrorTime = Number.NEGATIVE_INFINITY;
  let lastOverheadTime = Number.NEGATIVE_INFINITY;
  let insetViewport: readonly [number, number, number, number] = [0, 0, 0, 0];
  let disposed = false;

  function updateDriverCamera() {
    driverEye.set(...assets.anchors.driverEyeLocalM)
      .applyQuaternion(assets.vehicle.quaternion)
      .add(assets.vehicle.position);
    driverCamera.position.copy(driverEye);
    yawRotation.setFromAxisAngle(upAxis, yaw);
    pitchRotation.setFromAxisAngle(rightAxis, pitch);
    driverCamera.quaternion.copy(assets.vehicle.quaternion)
      .multiply(yawRotation)
      .multiply(pitchRotation);
    driverCamera.updateMatrixWorld(true);
  }

  function updateChaseCamera(nowMs: number) {
    target.copy(assets.vehicle.position);
    yawRotation.setFromAxisAngle(upAxis, yaw);
    pitchRotation.setFromAxisAngle(rightAxis, pitch);
    offset.copy(CHASE_OFFSET_LOCAL)
      .applyQuaternion(yawRotation)
      .applyQuaternion(pitchRotation)
      .applyQuaternion(assets.vehicle.quaternion);
    desired.copy(target).add(offset);
    const hit = closestChaseHit(target, desired, boxes);
    const desiredArmM = hit === null
      ? offset.length()
      : Math.max(0, hit - CAMERA_COLLISION_MARGIN_M);
    const elapsedS = Number.isFinite(lastChaseTime)
      ? Math.min(0.1, Math.max(0, (nowMs - lastChaseTime) / 1000))
      : 0;
    lastChaseTime = nowMs;
    if (desiredArmM < chaseArmM) chaseArmM = desiredArmM;
    else if (elapsedS > 0) {
      const blend = 1 - Math.exp(-elapsedS / CHASE_RESTORE_SECONDS);
      chaseArmM += (desiredArmM - chaseArmM) * blend;
    }
    chaseCamera.position.copy(target).addScaledVector(offset.normalize(), chaseArmM);
    chaseCamera.lookAt(target);
    chaseCamera.updateMatrixWorld(true);
  }

  function updateMirrorCameras() {
    for (const id of MIRROR_IDS) {
      const anchor = assets.anchors.mirrors[id];
      bodyPoseCamera(mirrorCameras[id], assets.vehicle, anchor.positionM, anchor.rotation);
    }
  }

  function updateOverheadCamera() {
    overheadCamera.position.copy(assets.vehicle.position).add(overheadOffset);
    forward.set(0, 0, -1).applyQuaternion(assets.vehicle.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    overheadCamera.up.copy(forward.normalize());
    overheadCamera.lookAt(assets.vehicle.position);
    overheadCamera.updateMatrixWorld(true);
  }

  function updateTrajectory(telemetry: VehicleTelemetry) {
    const samples = sampleTrajectory(telemetry, profile, boxes);
    leftPath.update(samples.map((sample) => rearWheelPath(sample, profile, -1)));
    rightPath.update(samples.map((sample) => rearWheelPath(sample, profile, 1)));
    envelope.update(envelopeLines(samples));
  }

  return {
    render(frame, nowMs) {
      if (disposed) return;
      assets.vehicle.updateMatrixWorld(true);
      updateDriverCamera();
      updateChaseCamera(nowMs);
      updateMirrorCameras();
      if (trajectoryEnabled) updateTrajectory(frame.current.telemetry);

      if (nowMs - lastMirrorTime >= MIRROR_INTERVAL_MS) {
        for (const id of MIRROR_IDS) {
          const spec = MIRROR_SPECS[id];
          renderAuxiliaryPass(renderer, {
            scene,
            camera: mirrorCameras[id],
            target: mirrorTargets[id],
            viewport: [0, 0, spec.width, spec.height],
            scissor: null,
            scissorTest: false,
            layerMask: MIRROR_LAYERS,
          });
        }
        lastMirrorTime = nowMs;
      }

      const mainCamera = cameraMode === 'driver' ? driverCamera : chaseCamera;
      renderer.render(scene, mainCamera);

      if (overheadEnabled) {
        updateOverheadCamera();
        if (nowMs - lastOverheadTime >= OVERHEAD_INTERVAL_MS) {
          renderAuxiliaryPass(renderer, {
            scene,
            camera: overheadCamera,
            target: overheadTarget,
            viewport: [0, 0, 320, 320],
            scissor: null,
            scissorTest: false,
            layerMask: OVERHEAD_LAYERS,
          });
          lastOverheadTime = nowMs;
        }
        if (insetViewport[2] > 0 && insetViewport[3] > 0) {
          renderAuxiliaryPass(renderer, {
            scene: overlayScene,
            camera: overlayCamera,
            target: null,
            viewport: insetViewport,
            scissor: insetViewport,
            scissorTest: true,
            layerMask: 1,
          });
        }
      }
    },
    look(deltaX, deltaY) {
      if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
        throw new RangeError('Mouse-look deltas must be finite');
      }
      yaw = Math.max(-110 * Math.PI / 180, Math.min(110 * Math.PI / 180, yaw - deltaX * 0.002));
      pitch = Math.max(-45 * Math.PI / 180, Math.min(35 * Math.PI / 180, pitch - deltaY * 0.002));
    },
    setCamera(mode) {
      cameraMode = mode;
    },
    setOverhead(enabled) {
      if (enabled && !overheadEnabled) lastOverheadTime = Number.NEGATIVE_INFINITY;
      overheadEnabled = enabled;
    },
    setTrajectory(enabled) {
      trajectoryEnabled = enabled;
      trajectoryGroup.visible = enabled;
    },
    setFov(degrees) {
      if (!Number.isFinite(degrees)) throw new RangeError('FOV must be finite');
      driverFov = Math.max(50, Math.min(80, degrees));
      driverCamera.fov = driverFov;
      driverCamera.updateProjectionMatrix();
    },
    resize(widthCss, heightCss, pixelRatio) {
      if (!Number.isFinite(widthCss) || !Number.isFinite(heightCss) ||
          !Number.isFinite(pixelRatio) || widthCss < 0 || heightCss < 0 || pixelRatio <= 0) {
        throw new RangeError('Invalid view dimensions or pixel ratio');
      }
      if (widthCss === 0 || heightCss === 0) {
        insetViewport = [0, 0, 0, 0];
        return;
      }
      driverCamera.aspect = widthCss / heightCss;
      chaseCamera.aspect = widthCss / heightCss;
      driverCamera.updateProjectionMatrix();
      chaseCamera.updateProjectionMatrix();
      const { x: insetX, size: insetCss } = getOverheadInset(widthCss, heightCss);
      if (insetCss < 1) {
        insetViewport = [0, 0, 0, 0];
        return;
      }
      const insetPx = Math.round(insetCss * pixelRatio);
      const marginPx = Math.round(16 * pixelRatio);
      const bufferHeight = Math.round(heightCss * pixelRatio);
      const x = Math.round(insetX * pixelRatio);
      const y = marginPx;
      insetViewport = [x, y, insetPx, insetPx];
    },
    recenter() {
      yaw = 0;
      pitch = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of MIRROR_IDS) {
        const surface = assets.vehicle.getObjectByName(`mirror-surface-${id}`);
        if (surface instanceof Mesh && surface.material instanceof MeshBasicMaterial &&
            surface.material.map === mirrorTargets[id].texture) {
          surface.material.map = null;
          surface.material.needsUpdate = true;
        }
        mirrorTargets[id].dispose();
      }
      overheadTarget.dispose();
      overlayGeometry.dispose();
      overlayMaterial.dispose();
      pathMaterial.dispose();
      envelopeMaterial.dispose();
      leftPath.line.geometry.dispose();
      rightPath.line.geometry.dispose();
      envelope.line.geometry.dispose();
      scene.remove(trajectoryGroup);
      overlayScene.clear();
    },
  };
}
