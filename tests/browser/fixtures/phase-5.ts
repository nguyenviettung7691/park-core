import * as THREE from 'three';
import { loadSceneAssets } from '../../../src/world/assets';

const canvas = document.querySelector<HTMLCanvasElement>('#asset-renderer')!;
const output = document.querySelector<HTMLOutputElement>('#asset-results')!;

async function renderAssets() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(640, 480, false);
  const camera = new THREE.PerspectiveCamera(45, 640 / 480, 0.1, 200);
  camera.position.set(38, 34, 42);
  camera.lookAt(0, 0, 0);

  for (const environment of ['garage', 'roadside'] as const) {
    for (const vehicle of ['sedan', 'cuv'] as const) {
      const item = document.createElement('span');
      item.dataset.pair = `${vehicle}-${environment}`;
      try {
        const assets = await loadSceneAssets(environment, vehicle, new AbortController().signal);
        const scene = new THREE.Scene();
        scene.add(assets.environment, assets.vehicle);
        renderer.info.reset();
        renderer.render(scene, camera);
        item.dataset.status = 'ready';
        item.dataset.renderCalls = String(renderer.info.render.calls);
        item.textContent = `${vehicle}-${environment}: ready`;
        assets.dispose();
      } catch (error) {
        item.dataset.status = 'failed';
        item.textContent = error instanceof Error ? error.message : String(error);
      }
      output.append(item);
    }
  }

  renderer.dispose();
  document.body.dataset.complete = 'true';
}

void renderAssets();
