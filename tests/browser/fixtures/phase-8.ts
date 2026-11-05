import {
  Color, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, PlaneGeometry,
  Vector3, WebGLRenderer, type Object3D,
} from 'three';
import type { StageId } from '../../../src/contracts';
import { scenarios } from '../../../src/lessons/scenarios';
import { createAssetScene } from '../../../src/render/asset-scene';
import { createLessonScene } from '../../../src/render/lesson-scene';
import { profiles } from '../../../src/vehicle/profiles';
import { createVehicleRig } from '../../../src/vehicle/rig';
import { createViews } from '../../../src/views/cameras';
import { loadSceneAssets } from '../../../src/world/assets';
import {
  addColliderBoxes, collidersForEnvironment, collidersForScenario, createWorld, prototypeSpawn,
} from '../../../src/world/colliders';

type Shot = 'front' | 'rear' | 'driver' | 'overhead' | 'environment' | 'props';
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
}
declare global {
  interface Window {
    phase8Capture: {
      ready: boolean;
      setShot(shot: Shot): void;
      report(): CaptureReport;
    };
  }
}

async function setup() {
  const params = new URLSearchParams(location.search);
  const vehicle = params.get('vehicle') ?? 'sedan';
  const environment = params.get('environment') ?? 'garage';
  if (vehicle !== 'sedan' && vehicle !== 'cuv') throw new Error('Invalid capture vehicle');
  if (environment !== 'garage' && environment !== 'roadside') throw new Error('Invalid capture environment');
  const stage = params.has('stage') ? Number(params.get('stage')) : null;
  if (stage !== null && ![1, 2, 3, 4, 5].includes(stage)) throw new Error('Invalid capture stage');
  const scenario = stage === null ? null : scenarios[stage as StageId];
  if (scenario && scenario.environmentId !== environment) throw new Error('Capture stage/environment mismatch');
  const assets = await loadSceneAssets(environment, vehicle, new AbortController().signal);
  const canvas = document.querySelector<HTMLCanvasElement>('#asset-renderer')!;
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 720, false);
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
  const views = createViews(renderer, content.scene, assets, profiles[vehicle], boxes);
  views.resize(1280, 720, 1);
  views.setOverhead(true);
  views.setTrajectory(true);
  const ceilingMeshes: Object3D[] = [];
  assets.environment.getObjectByName('Ceiling')?.traverse((node) => {
    if (node instanceof Mesh) ceilingMeshes.push(node);
  });
  const frames: Pass[][] = [];
  let recording = true, passes: Pass[] = [], mirrorIndex = 0;
  const render = renderer.render.bind(renderer);
  renderer.info.autoReset = false;
  renderer.render = (scene, camera) => {
    renderer.info.reset();
    render(scene, camera);
    if (recording) {
      const target = renderer.getRenderTarget();
      const name = target ? target.width === 320 ? 'overhead' : `mirror-${mirrorIndex++}`
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
    renderer: typeof gpu === 'string' ? gpu : null };
  const studioFloor = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial({ color: '#b8b0a5' }));
  studioFloor.rotation.x = -Math.PI / 2;
  studioFloor.position.y = -0.01;
  studioFloor.visible = false;
  content.scene.add(studioFloor);
  const camera = new PerspectiveCamera(40, 1280 / 720, 0.05, 200);
  camera.layers.enable(1);
  const overhead = new OrthographicCamera(-9.6, 9.6, 5.4, -5.4, 0.1, 100);
  let time = 150;
  window.phase8Capture = {
    ready: true,
    report: () => report,
    setShot(shot) {
      const studio = shot === 'front' || shot === 'rear';
      assets.environment.visible = !studio;
      if (lesson) lesson.group.visible = !studio;
      studioFloor.visible = studio;
      content.scene.background = new Color(studio ? '#b8b0a5' : environment === 'roadside' ? '#b7b3af' : '#211e25');
      if (shot === 'driver') {
        views.setCamera('driver');
        views.recenter();
        views.look(0, 80);
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
        camera.position.copy(origin).add(new Vector3(4.1, 2.2, shot === 'front' ? -5.8 : 5.8));
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
