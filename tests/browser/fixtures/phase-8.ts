import {
  Box3, Box3Helper, BufferGeometry, Color, Group, LineBasicMaterial, LineLoop,
  Mesh, MeshBasicMaterial, OrthographicCamera,
  PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster, Scene,
  Vector3, WebGLRenderer, type Object3D, type WebGLRenderTarget,
} from 'three';
import type { StageId } from '../../../src/contracts';
import { scenarios } from '../../../src/lessons/scenarios';
import { createAssetScene } from '../../../src/render/asset-scene';
import { createLessonScene } from '../../../src/render/lesson-scene';
import { profiles } from '../../../src/vehicle/profiles';
import { deriveVehicleAssetContract, type MirrorId } from '../../../src/vehicle/asset-contract';
import { deriveGeometry, vehicleFootprint } from '../../../src/vehicle/geometry';
import { createVehicleRig } from '../../../src/vehicle/rig';
import { createViews } from '../../../src/views/cameras';
import { loadSceneAssets } from '../../../src/world/assets';
import {
  addColliderBoxes, collidersForEnvironment, collidersForScenario, createWorld, prototypeSpawn,
} from '../../../src/world/colliders';

export type Shot = 'front' | 'rear' | 'side' | 'driver' | 'driver-neutral' |
  'driver-left' | 'driver-right' | 'overhead' | 'environment' | 'props' | 'alignment' |
  'mirror-rear' | 'mirror-left' | 'mirror-right' | 'steering';
interface Pass {
  name: string;
  calls: number;
  triangles: number;
  ceilingVisible: boolean;
}
interface CaptureReport {
  passes: Pass[];
  frames: Pass[][];
  parkedTriangles: number[];
  renderer: string | null;
  mirrorVisibility: Record<MirrorId, number>;
}
declare global {
  interface Window {
    phase8Capture: {
      ready: boolean;
      setShot(shot: Shot): void;
      checkMirror(id: MirrorId, flipFault?: boolean): { left: number[]; right: number[] };
      setOcclusionFault(enabled: boolean): void;
      report(): CaptureReport;
    };
  }
}

async function setup() {
  const params = new URLSearchParams(location.search);
  const vehicle = params.get('vehicle') ?? 'sedan';
  const environment = params.get('environment') ?? 'garage';
  const quality = params.get('quality') ?? 'high';
  const fov = Number(params.get('fov') ?? 60);
  if (quality !== 'high' && quality !== 'low') throw new Error('Invalid capture quality');
  if (![50, 60, 80].includes(fov)) throw new Error('Invalid capture FOV');
  if (vehicle !== 'sedan' && vehicle !== 'cuv') throw new Error('Invalid capture vehicle');
  if (environment !== 'garage' && environment !== 'roadside') throw new Error('Invalid capture environment');
  const stage = params.has('stage') ? Number(params.get('stage')) : null;
  if (stage !== null && ![1, 2, 3, 4, 5].includes(stage)) throw new Error('Invalid capture stage');
  const scenario = stage === null ? null : scenarios[stage as StageId];
  if (scenario && scenario.environmentId !== environment) throw new Error('Capture stage/environment mismatch');
  const assets = await loadSceneAssets(environment, vehicle, new AbortController().signal);
  const canvas = document.querySelector<HTMLCanvasElement>('#asset-renderer')!;
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  const width = window.innerWidth, height = window.innerHeight;
  renderer.setSize(width, height, false);
  const content = createAssetScene(assets);
  const boxes = scenario ? collidersForScenario(scenario) : collidersForEnvironment(environment);
  const world = createWorld();
  const removeColliders = addColliderBoxes(world, boxes);
  const rig = createVehicleRig(world, profiles[vehicle], removeColliders.idForBody);
  rig.settle(scenario ? scenario.spawnByVehicle[vehicle] : prototypeSpawn(profiles[vehicle]));
  const current = rig.snapshot(0);
  const frame = { previous: current, current, alpha: 1 };
  content.apply(frame);
  const lesson = scenario ? createLessonScene(scenario, assets.vehicle) : null;
  if (lesson) {
    content.scene.add(lesson.group);
    lesson.update({ stageId: scenario!.stageId, stepIndex: 0, stepDwellS: 0,
      parkingDwellS: 0, acknowledgedStepIds: [] });
    assets.environment.getObjectByName('ParkingMarkings')!.visible = false;
  }
  const views = createViews(renderer, content.scene, assets, profiles[vehicle], boxes, {
    mirrorQuality: quality,
    overheadQuality: 'high',
  });
  views.resize(width, height, 1);
  views.setFov(fov);
  views.setOverhead(true);
  views.setTrajectory(true);
  const ceilingMeshes: Object3D[] = [];
  assets.environment.getObjectByName('Ceiling')?.traverse((node) => {
    if (node instanceof Mesh) ceilingMeshes.push(node);
  });
  const frames: Pass[][] = [];
  let recording = true, passes: Pass[] = [], mirrorIndex = 0;
  const mirrorTargets = new Map<string, WebGLRenderTarget>();
  const render = renderer.render.bind(renderer);
  renderer.info.autoReset = false;
  renderer.render = (scene, camera) => {
    renderer.info.reset();
    render(scene, camera);
    const target = renderer.getRenderTarget();
    if (target && camera.name.startsWith('mirror-')) mirrorTargets.set(camera.name, target);
    if (recording) {
      const name = target ? camera.name === 'overhead-camera' ? 'overhead' : `mirror-${mirrorIndex++}`
        : scene === content.scene ? 'main' : 'inset-composite';
      passes.push({ name, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        ceilingVisible: ceilingMeshes.some((node) => node.layers.test(camera.layers)) });
    }
  };
  for (const now of [0, 20, 80]) {
    passes = [];
    mirrorIndex = 0;
    views.render(frame, now);
    frames.push(passes);
  }
  recording = false;
  const triangles = (root: Object3D) => {
    let count = 0;
    root.traverseVisible((node) => {
      if (node instanceof Mesh) count += (node.geometry.index?.count ??
        node.geometry.getAttribute('position').count) / 3;
    });
    return count;
  };
  const parkedTriangles = scenario?.obstacles.map((box) => triangles(lesson!.group.getObjectByName(box.id)!)) ?? [];
  const context = renderer.getContext();
  const debug = context.getExtension('WEBGL_debug_renderer_info');
  const gpu: unknown = debug ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  const report: CaptureReport = { passes: frames[2]!, frames, parkedTriangles,
    renderer: typeof gpu === 'string' ? gpu : null,
    mirrorVisibility: { rear: 0, left: 0, right: 0 } };
  const contract = deriveVehicleAssetContract(profiles[vehicle]);
  function mirrorVisibility() {
    assets.vehicle.updateMatrixWorld(true);
    const eye = new Vector3(...contract.driverEyeLocalM).applyMatrix4(assets.vehicle.matrixWorld);
    const meshes: Object3D[] = [];
    assets.vehicle.traverseVisible((node) => { if (node instanceof Mesh) meshes.push(node); });
    const visibility = { rear: 0, left: 0, right: 0 };
    for (const id of ['rear', 'left', 'right'] as const) {
      const name = `MirrorSurface${id[0]!.toUpperCase()}${id.slice(1)}`;
      const surface = assets.vehicle.getObjectByName(name);
      if (!(surface instanceof Mesh)) throw new Error(`Missing ${name}`);
      surface.geometry.computeBoundingBox();
      const bounds = surface.geometry.boundingBox;
      if (!bounds) throw new Error(`Missing ${name} bounds`);
      for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) {
        const point = new Vector3(
          bounds.min.x + (bounds.max.x - bounds.min.x) * x / 4,
          bounds.min.y + (bounds.max.y - bounds.min.y) * y / 4, 0,
        ).applyMatrix4(surface.matrixWorld);
        const ray = new Raycaster(eye, point.clone().sub(eye).normalize(), 0, eye.distanceTo(point) + 0.001);
        ray.layers.enable(1);
        if (ray.intersectObjects(meshes, false)[0]?.object === surface) visibility[id]++;
      }
    }
    return visibility;
  }
  const occluder = new Mesh(new PlaneGeometry(4, 4), new MeshBasicMaterial({ color: '#ff0000' }));
  occluder.name = 'test-only-cockpit-occluder';
  occluder.position.set(...contract.driverEyeLocalM);
  occluder.position.z -= 0.05;
  occluder.visible = false;
  assets.vehicle.add(occluder);
  const alignment = new Group();
  const geometry = deriveGeometry(profiles[vehicle]);
  for (const box of [geometry.chassis, ...geometry.mirrors]) {
    const center = new Vector3(...box.centerLocalM), half = new Vector3(...box.halfExtentsM);
    alignment.add(new Box3Helper(new Box3(center.clone().sub(half), center.clone().add(half)), 0xff0000));
  }
  const body = assets.vehicle.getObjectByName('Body');
  if (!(body instanceof Mesh)) throw new Error('Missing Body mesh');
  body.geometry.computeBoundingBox();
  const bodyLocal = assets.vehicle.matrixWorld.clone().invert().multiply(body.matrixWorld);
  alignment.add(new Box3Helper(body.geometry.boundingBox!.clone().applyMatrix4(bodyLocal), 0xffff00));
  const footprint = vehicleFootprint({ positionM: [0, 0, 0], rotation: [0, 0, 0, 1] }, profiles[vehicle])
    .map(([x, , z]) => new Vector3(x, 0.035 - profiles[vehicle].centerOfMassHeightM, z));
  const footprintLine = new LineLoop(new BufferGeometry().setFromPoints(footprint),
    new LineBasicMaterial({ color: '#9b59b6', depthTest: false }));
  alignment.add(footprintLine);
  alignment.visible = false;
  content.scene.add(alignment);
  const mirrorScene = new Scene();
  const mirrorMaterial = new MeshBasicMaterial({ depthTest: false, depthWrite: false });
  const mirrorPlane = new Mesh(new PlaneGeometry(2, 2), mirrorMaterial);
  mirrorScene.add(mirrorPlane);
  const mirrorCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  mirrorCamera.position.z = 1;
  function showMirror(id: MirrorId) {
    const target = mirrorTargets.get(`mirror-${id}-camera`);
    if (!target) throw new Error(`Missing mirror target ${id}`);
    mirrorMaterial.map = target.texture;
    mirrorMaterial.needsUpdate = true;
    renderer.render(mirrorScene, mirrorCamera);
  }
  const studioFloor = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial({ color: '#b8b0a5' }));
  studioFloor.rotation.x = -Math.PI / 2;
  studioFloor.position.y = -0.01;
  studioFloor.visible = false;
  content.scene.add(studioFloor);
  const camera = new PerspectiveCamera(40, width / height, 0.05, 200);
  camera.layers.enable(1);
  const overhead = new OrthographicCamera(-5.4 * width / height, 5.4 * width / height, 5.4, -5.4, 0.1, 100);
  let time = 150;
  window.phase8Capture = {
    ready: true,
    report: () => ({ ...report, mirrorVisibility: mirrorVisibility() }),
    setOcclusionFault(enabled) { occluder.visible = enabled; },
    checkMirror(id, flipFault = false) {
      const markers = new Group();
      const pose = contract.mirrors[id];
      const rotation = assets.vehicle.quaternion.clone().multiply(new Quaternion(...pose.rotation));
      const origin = new Vector3(...pose.positionM).applyMatrix4(assets.vehicle.matrixWorld);
      const halfHeight = 1.5 * Math.tan((id === 'rear' ? 50 : 75) * Math.PI / 360);
      const halfWidth = halfHeight * (id === 'rear' ? 4 : 1);
      for (const [side, color] of [[-1, 0xff0000], [1, 0xffff00]]) {
        const marker = new Mesh(new PlaneGeometry(halfWidth * 0.3, halfHeight * 0.3),
          new MeshBasicMaterial({ color }));
        marker.position.set(side! * halfWidth * 0.4, 0, -1.5).applyQuaternion(rotation).add(origin);
        marker.quaternion.copy(rotation);
        markers.add(marker);
      }
      const environmentVisible = assets.environment.visible;
      const vehicleVisible = assets.vehicle.visible;
      assets.environment.visible = false;
      assets.vehicle.visible = false;
      studioFloor.visible = false;
      alignment.visible = false;
      content.scene.add(markers);
      views.render(frame, time += 100);
      const target = mirrorTargets.get(`mirror-${id}-camera`)!;
      target.texture.repeat.x = flipFault ? 1 : -1;
      target.texture.offset.x = flipFault ? 0 : 1;
      showMirror(id);
      const sample = (x: number) => {
        const pixel = new Uint8Array(4);
        context.readPixels(x, Math.floor(height / 2), 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
        return Array.from(pixel);
      };
      const result = { left: sample(Math.floor(width * 0.3)), right: sample(Math.floor(width * 0.7)) };
      target.texture.repeat.x = -1;
      target.texture.offset.x = 1;
      assets.environment.visible = environmentVisible;
      assets.vehicle.visible = vehicleVisible;
      markers.removeFromParent();
      markers.traverse((node) => {
        if (node instanceof Mesh) { node.geometry.dispose(); node.material.dispose(); }
      });
      return result;
    },
    setShot(shot) {
      const studio = shot === 'front' || shot === 'rear' || shot === 'side' ||
        shot === 'alignment' || shot === 'steering';
      assets.environment.visible = !studio;
      if (lesson) lesson.group.visible = !studio;
      studioFloor.visible = studio;
      alignment.visible = shot === 'alignment';
      alignment.position.copy(assets.vehicle.position);
      alignment.quaternion.copy(assets.vehicle.quaternion);
      content.scene.background = new Color(studio ? '#b8b0a5' : environment === 'roadside' ? '#b7b3af' : '#211e25');
      if (shot.startsWith('mirror-')) {
        views.render(frame, time += 100);
        showMirror(shot.slice(7) as MirrorId);
        return;
      }
      if (shot === 'driver' || shot.startsWith('driver-')) {
        views.setCamera('driver');
        views.recenter();
        if (shot === 'driver') views.look(0, 80);
        if (shot === 'driver-left') views.look(550, 0);
        if (shot === 'driver-right') views.look(-550, 0);
        views.render(frame, time += 100);
        return;
      }
      const origin = assets.vehicle.position;
      if (shot === 'overhead') {
        overhead.position.copy(origin).add(new Vector3(0, 25, 0.01));
        overhead.lookAt(origin);
        renderer.render(content.scene, overhead);
        return;
      }
      if (studio) {
        if (shot === 'steering') {
          rig.applyInput({ source: 'gamepad', steering: 1, throttle: 0, brake: 1 }, [], 1 / 120);
          world.step(1 / 120);
          const steered = rig.snapshot(1 / 120);
          content.apply({ previous: steered, current: steered, alpha: 1 });
        } else content.apply(frame);
        camera.position.copy(origin).add(shot === 'side' || shot === 'alignment'
          ? new Vector3(7, 1, 0) : new Vector3(4.1, 2.2, shot === 'rear' ? 5.8 : -5.8));
        camera.lookAt(origin.clone().add(new Vector3(0, 0.1, 0)));
      } else if (shot === 'props') {
        camera.position.set(environment === 'garage' ? -5.8 : 3.8, 2.4, environment === 'garage' ? -4.8 : 4);
        camera.lookAt(environment === 'garage' ? new Vector3(-9, 1.4, -8) : new Vector3(7, 0.6, 0));
      } else {
        const target = scenario ? new Vector3(...scenario.target.region.centerM) : new Vector3(0, 0, 0);
        camera.position.copy(target).add(new Vector3(environment === 'garage' ? 15 : -12, 14, 17));
        camera.lookAt(target);
      }
      renderer.render(content.scene, camera);
    },
  };
  window.addEventListener('beforeunload', () => {
    views.dispose();
    lesson?.dispose();
    studioFloor.geometry.dispose();
    studioFloor.material.dispose();
    occluder.geometry.dispose();
    occluder.material.dispose();
    occluder.removeFromParent();
    alignment.traverse((node) => { if (node instanceof Box3Helper) node.dispose(); });
    footprintLine.geometry.dispose();
    footprintLine.material.dispose();
    mirrorPlane.geometry.dispose();
    mirrorMaterial.dispose();
    rig.dispose();
    removeColliders();
    content.dispose();
    renderer.dispose();
  }, { once: true });
}

void setup().catch((error: unknown) => {
  document.querySelector('#failure')!.textContent = error instanceof Error ? error.message : String(error);
  throw error;
});
