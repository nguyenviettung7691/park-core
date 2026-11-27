import { createHash } from 'node:crypto';
import type { Buffer } from 'node:buffer';
import process from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { LampState, Shot } from './fixtures/phase-8';
import type { MirrorId } from '../../src/vehicle/asset-contract';

const requested = process.env.PARK_CORE_REVIEW_VEHICLE;
const vehicles = requested ? [requested] : ['sedan', 'cuv'];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const shots: Shot[] = ['front', 'rear', 'side', 'driver-neutral', 'driver', 'driver-left',
  'driver-right', 'mirror-rear', 'mirror-left', 'mirror-right', 'overhead', 'alignment', 'steering'];
const mirrorIds: MirrorId[] = ['rear', 'left', 'right'];

function assertLandmarks(result: { left: number[]; right: number[] }) {
  expect(result.left.slice(0, 3), 'mirrored left landmark must be yellow').toEqual([255, 255, 0]);
  expect(result.right.slice(0, 3), 'mirrored right landmark must be red').toEqual([255, 0, 0]);
}

for (const vehicle of vehicles) for (const environment of ['garage', 'roadside']) {
  test(`${vehicle}-${environment} candidate review @assets`, async ({ page, browser }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 720 });
    const output = process.env.PARK_CORE_REVIEW_OUTPUT
      ? join(resolve(process.env.PARK_CORE_REVIEW_OUTPUT), `${vehicle}-${environment}`)
      : info.outputPath('review');
    mkdirSync(output, { recursive: true });
    const results: object[] = [];
    let baselineCompatible = true;
    for (const variant of ['baseline', 'candidate']) {
      const root = variant === 'candidate' && process.env.PARK_CORE_REVIEW_CANDIDATE
        ? resolve(process.env.PARK_CORE_REVIEW_CANDIDATE) : process.cwd();
      const bytes = readFileSync(join(root, 'public', 'assets', 'vehicles', `${vehicle}.glb`));
      let served = 0;
      const errors: string[] = [];
      const onError = (error: Error) => errors.push(error.message);
      page.on('pageerror', onError);
      await page.unrouteAll();
      await page.route(`**/assets/vehicles/${vehicle}.glb`, async (route) => {
        served++;
        await route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: bytes });
      });
      await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=${vehicle}&environment=${environment}`);
      await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready
        ? 'ready' : document.querySelector('#failure')?.textContent || 'loading')).not.toBe('loading');
      const ready = await page.evaluate(() => Boolean(window.phase8Capture?.ready));
      if (!ready && variant === 'baseline') {
        baselineCompatible = false;
        results.push({ variant, sha256: hash(bytes), status: 'incompatible-with-current-contract', errors });
        page.off('pageerror', onError);
        continue;
      }
      expect(ready, errors.join('\n')).toBe(true);
      expect(served).toBe(1);
      const report = await page.evaluate(() => window.phase8Capture.report());
      for (const id of mirrorIds) expect(report.mirrorVisibility[id], `${id} sightlines`).toBe(9);
      for (const frame of report.frames) {
        expect(frame.find((pass) => pass.name === 'main')!.calls).toBeLessThanOrEqual(100);
      }
      expect(report.frames[1].some((pass) => pass.name.startsWith('mirror'))).toBe(false);
      const captures: { shot: string; sha256: string }[] = [];
      for (const shot of shots) {
        await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
        const screenshot = await page.screenshot({ path: join(output, `${variant}-${shot}.png`) });
        captures.push({ shot, sha256: hash(screenshot) });
        if (variant === 'candidate' && process.env.PARK_CORE_ASSET_BASELINES) {
          expect(screenshot).toMatchSnapshot(`${vehicle}-${environment}-${shot}.png`);
        }
      }
      for (const id of mirrorIds) {
        const result = await page.evaluate((value) => window.phase8Capture.checkMirror(value), id);
        assertLandmarks(result);
        await page.screenshot({ path: join(output, `${variant}-landmarks-${id}.png`) });
      }
      expect(errors).toEqual([]);
      page.off('pageerror', onError);
      results.push({ variant, status: 'automated-passed', sha256: hash(bytes),
        browser: browser.version(), ...report,
        fullFrameCalls: report.frames.map((frame) => frame.reduce((sum, pass) => sum + pass.calls, 0)),
        captures });
    }
    const evidence = { vehicle, environment, visualApproval: 'pending',
      approvedSnapshots: process.env.PARK_CORE_ASSET_BASELINES ? 'checked' : 'not-established',
      note: 'Reference images stay in the request workspace; inferred details and developer approval belong in the brief.',
      results };
    writeFileSync(join(output, 'captures.json'), JSON.stringify(evidence, null, 2) + '\n');
    writeFileSync(join(output, 'review.html'), `<!doctype html><meta charset="utf-8">
<title>${vehicle} ${environment} asset review</title>
<style>body{font:16px sans-serif;background:#19161d;color:#eee;margin:24px}section{display:flex;gap:12px}figure{width:48%;margin:0}img{width:100%}pre{white-space:pre-wrap}h2{color:#c698d9}</style>
<h1>${vehicle} / ${environment}</h1><p>Developer visual approval pending. Compare the supplied reference separately; these are actual runtime renders.</p>
${shots.map((shot) => `<h2>${shot}</h2><section>${['baseline', 'candidate'].map((variant) =>
    `<figure><figcaption>${variant}</figcaption>${variant === 'baseline' && !baselineCompatible
      ? '<p>Old GLB is incompatible with the current contract. Use the pre-edit baseline review; no before image is available in this run.</p>'
      : `<img src="${variant}-${shot}.png" alt="${variant} ${shot}">`}</figure>`).join('')}</section>`).join('')}
<h2>Mirror orientation check</h2><p>Isolated landmarks: yellow must appear left, red right. This is not optical calibration.</p>
${mirrorIds.map((id) => `<img width="400" src="candidate-landmarks-${id}.png" alt="${id} landmarks">`).join('')}
<pre>${escape(JSON.stringify(evidence, null, 2))}</pre>`);
    await info.attach('asset-review', { path: join(output, 'captures.json'), contentType: 'application/json' });
  });
}

test('review gates expose deliberate mirror flipping and cockpit occlusion @assets', async ({ page }) => {
  const vehicle = requested ?? 'sedan';
  if (process.env.PARK_CORE_REVIEW_CANDIDATE) {
    const bytes = readFileSync(join(resolve(process.env.PARK_CORE_REVIEW_CANDIDATE),
      'public', 'assets', 'vehicles', `${vehicle}.glb`));
    await page.route(`**/assets/vehicles/${vehicle}.glb`, (route) =>
      route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: bytes }));
  }
  await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=${vehicle}&environment=garage`);
  await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready)).toBe(true);
  const wrong = await page.evaluate(() => window.phase8Capture.checkMirror('rear', true));
  expect(() => assertLandmarks(wrong)).toThrow();
  await page.evaluate(() => window.phase8Capture.setOcclusionFault(true));
  const report = await page.evaluate(() => window.phase8Capture.report());
  expect(report.mirrorVisibility.rear).toBe(0);
});

for (const vehicle of vehicles) {
  test(`${vehicle} neutral and look views support FOV and quality limits @assets`, async ({ page }, info) => {
    test.setTimeout(90000);
    const output = process.env.PARK_CORE_REVIEW_OUTPUT
      ? join(resolve(process.env.PARK_CORE_REVIEW_OUTPUT), `${vehicle}-view-limits`)
      : info.outputPath('view-limits');
    mkdirSync(output, { recursive: true });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    if (process.env.PARK_CORE_REVIEW_CANDIDATE) {
      const bytes = readFileSync(join(resolve(process.env.PARK_CORE_REVIEW_CANDIDATE),
        'public', 'assets', 'vehicles', `${vehicle}.glb`));
      await page.route(`**/assets/vehicles/${vehicle}.glb`, (route) =>
        route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: bytes }));
    }
    const captures: string[] = [];
    for (const width of [1280, 960]) for (const quality of ['high', 'low']) for (const fov of [50, 80]) {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=${vehicle}&environment=garage&quality=${quality}&fov=${fov}`);
      await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready)).toBe(true);
      const report = await page.evaluate(() => window.phase8Capture.report());
      expect(Object.values(report.mirrorVisibility)).toEqual([9, 9, 9]);
      for (const id of mirrorIds) {
        assertLandmarks(await page.evaluate((value) => window.phase8Capture.checkMirror(value), id));
      }
      for (const shot of ['driver-neutral', 'driver-left', 'driver-right'] as const) {
        await page.evaluate((value) => window.phase8Capture.setShot(value), shot);
        const name = `${width}-${quality}-${fov}-${shot}.png`;
        await page.screenshot({ path: join(output, name) });
        captures.push(name);
      }
    }
    expect(errors).toEqual([]);
    writeFileSync(join(output, 'review.html'), `<!doctype html><meta charset="utf-8">
<title>${vehicle} view limits</title><h1>${vehicle}: aspect, FOV and quality limits</h1>
<p>Actual candidate renders. Developer inspection pending; sightline and mirror landmark checks passed.</p>
${captures.map((name) => `<h2>${name}</h2><img width="640" src="${name}" alt="${name}">`).join('')}`);
  });
}

const lampStates: LampState[] = ['unlit', 'brake', 'reverse', 'left', 'right', 'all-lit'];
const lampExpected: Record<LampState, readonly [boolean, boolean, boolean, boolean]> = {
  unlit: [false, false, false, false],
  brake: [true, false, false, false],
  reverse: [false, true, false, false],
  left: [false, false, true, false],
  right: [false, false, false, true],
  'all-lit': [true, true, true, true],
};

for (const vehicle of vehicles) {
  test(`${vehicle} exterior lamp states @assets`, async ({ page }, info) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1280, height: 720 });
    const candidate = process.env.PARK_CORE_REVIEW_CANDIDATE;
    const root = candidate ? resolve(candidate) : process.cwd();
    const bytes = readFileSync(join(root, 'public', 'assets', 'vehicles', `${vehicle}.glb`));
    await page.route(`**/assets/vehicles/${vehicle}.glb`, (route) =>
      route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: bytes }));
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/tests/browser/fixtures/phase-8.html?vehicle=${vehicle}&environment=garage`);
    await expect.poll(() => page.evaluate(() => window.phase8Capture?.ready
      ? 'ready' : document.querySelector('#failure')?.textContent || 'loading')).toBe('ready');
    const probe = await page.evaluate(() => window.phase8Capture.setLamps('unlit'));
    const hasLamps = Object.values(probe).every((visible) => visible !== null);
    // The approved lamps are promoted (issue #11): public and candidate GLBs both carry them.
    expect(hasLamps, 'served GLB must have all four lit lamp nodes').toBe(true);
    const output = process.env.PARK_CORE_REVIEW_OUTPUT
      ? join(resolve(process.env.PARK_CORE_REVIEW_OUTPUT), `${vehicle}-lamps`)
      : info.outputPath('lamps');
    mkdirSync(output, { recursive: true });
    const captures: { state: LampState; view: string; file: string; sha256: string }[] = [];
    for (const state of lampStates) {
      const visible = await page.evaluate((value) => window.phase8Capture.setLamps(value), state);
      expect(Object.values(visible), `${state} lit nodes`).toEqual([...lampExpected[state]]);
      for (const view of ['rear', 'front'] as const) {
        await page.evaluate((value) => window.phase8Capture.setShot(value), `lamps-${view}` as const);
        const file = `${vehicle}-${view}-${state}.png`;
        const screenshot = await page.screenshot({ path: join(output, file) });
        captures.push({ state, view, file, sha256: hash(screenshot) });
      }
    }
    expect(errors).toEqual([]);
    const evidence = { vehicle, glbSha256: hash(bytes), source: candidate ? 'candidate' : 'public',
      visualApproval: 'pending', captures };
    writeFileSync(join(output, 'lamps.json'), JSON.stringify(evidence, null, 2) + '\n');
    writeFileSync(join(output, 'review.html'), `<!doctype html><meta charset="utf-8">
<title>${vehicle} exterior lamps</title>
<style>body{font:16px sans-serif;background:#19161d;color:#eee;margin:24px}section{display:flex;gap:12px}figure{width:48%;margin:0}img{width:100%}h2{color:#c698d9}</style>
<h1>${vehicle}: exterior lamp states</h1><p>GLB sha256 ${evidence.glbSha256} (${evidence.source}). Lit states come from overridden telemetry (all-lit also shows both indicators). Developer visual approval pending.</p>
${lampStates.map((state) => `<h2>${state}</h2><section>${['rear', 'front'].map((view) =>
    `<figure><figcaption>${view}</figcaption><img src="${vehicle}-${view}-${state}.png" alt="${vehicle} ${view} ${state}"></figure>`).join('')}</section>`).join('')}`);
    await info.attach('lamp-review', { path: join(output, 'lamps.json'), contentType: 'application/json' });
  });
}
