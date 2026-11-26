import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildGlb } from './generate-assets.mjs';
import { profiles } from '../src/vehicle/profiles.ts';
import { deriveVehicleAssetContract } from '../src/vehicle/asset-contract.ts';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ids = ['sedan', 'cuv', 'roadside', 'garage'];
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const assetPath = (root, id) => join(root, 'public', 'assets',
  id === 'sedan' || id === 'cuv' ? 'vehicles' : 'environments', `${id}.glb`);

export function inspectAsset(id, bytes) {
  if (bytes.length < 28 || bytes.toString('ascii', 0, 4) !== 'glTF' ||
      bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`${id}: invalid GLB header`);
  }
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength + 8 > bytes.length) {
    throw new Error(`${id}: invalid GLB JSON chunk`);
  }
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
  const triangles = document.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce(
    (part, primitive) => part + document.accessors[primitive.indices].count / 3, 0), 0);
  const vehicle = id === 'sedan' || id === 'cuv';
  if (!Number.isFinite(triangles) || triangles <= 0 || triangles > (vehicle ? 10000 : 30000)) {
    throw new Error(`${id}: triangle budget exceeded or invalid (${triangles})`);
  }
  const contract = vehicle ? deriveVehicleAssetContract(profiles[id]) : null;
  const misaligned = contract && contract.bodyVisualZ.some((value, i) =>
    Math.abs(value - contract.bodyPhysicalZ[i]) > 0.02);
  return { id, bytes: bytes.length, sha256: sha256(bytes), triangles,
    nodes: document.nodes.length, materials: document.materials.length,
    attribution: document.asset.extras,
    contract,
    warnings: misaligned ? [
      `Visual/physical body Z extents differ: ${contract.bodyVisualZ.join(', ')} vs ${contract.bodyPhysicalZ.join(', ')} m; review dimensional edits explicitly.`,
    ] : [] };
}

export function checkAssets(root = projectRoot, selected = ids) {
  const reports = selected.map((id) => {
    if (!ids.includes(id)) throw new RangeError(`Unknown asset: ${id}`);
    const bytes = readFileSync(assetPath(root, id));
    if (!bytes.equals(Buffer.from(buildGlb(id)))) {
      throw new Error(`${id}: stale or foreign GLB; output does not match current authoring source`);
    }
    return inspectAsset(id, bytes);
  });
  for (const vehicle of reports.filter((report) => ['sedan', 'cuv'].includes(report.id))) {
    for (const environment of ['roadside', 'garage']) {
      const environmentBytes = reports.find((report) => report.id === environment)?.bytes
        ?? readFileSync(assetPath(projectRoot, environment)).length;
      if (vehicle.bytes + environmentBytes > 5000000) {
        throw new Error(`${vehicle.id}/${environment}: selected pair exceeds 5,000,000 bytes`);
      }
    }
  }
  return reports;
}

function run(script, args, env = process.env) {
  const result = spawnSync(process.execPath, [join(projectRoot, script), ...args],
    { cwd: projectRoot, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (exit ${result.status}, signal ${result.signal})`);
}

export function reviewAssets({ vehicle, candidate = projectRoot, out, baseline }) {
  const output = resolve(out);
  const outputRelative = relative(projectRoot, output);
  const outputParent = outputRelative.split(/[\\/]/)[0];
  if (!isAbsolute(outputRelative) && outputParent !== '..' && outputParent !== 'test-results') {
    throw new Error('Review output must be outside the repository or inside test-results');
  }
  if (existsSync(output) && readdirSync(output).length > 0) {
    throw new Error('Review output must be empty; choose a fresh directory to avoid stale evidence');
  }
  mkdirSync(output, { recursive: true });
  const sourceFiles = ['src/vehicle/profiles.ts', 'src/vehicle/asset-contract.ts',
    'tools/asset-designs/vehicles.mjs', 'tools/asset-designs/palette.mjs',
    'tools/asset-geometry.mjs', 'tools/generate-assets.mjs', 'tools/asset-workflow.mjs',
    'src/world/assets.ts', 'src/views/cameras.ts', 'src/render/asset-scene.ts',
    'src/vehicle/geometry.ts', 'src/vehicle/rig.ts', 'src/contracts.ts', 'tests/browser/fixtures/phase-8.ts',
    'tests/browser/asset-review.spec.ts', 'playwright.config.ts', 'package-lock.json'];
  const report = { version: 1, vehicle, automated: 'running', visualApproval: 'pending',
    performance: 'unverified', opticalCalibration: 'unverified',
    sourceHashes: Object.fromEntries(sourceFiles.map((path) =>
      [path, sha256(readFileSync(join(projectRoot, ...path.split('/'))))])),
    assets: [], error: null };
  try {
    report.assets = checkAssets(resolve(candidate), [vehicle]);
    // The checked-in sync test compares public GLBs with the source, so it cannot pass
    // before an approved candidate is promoted; `assets:check` covers it after promotion.
    run('node_modules/vitest/vitest.mjs', ['run', 'src/world/generate-assets.test.mjs',
      'src/world/assets.test.mjs', 'src/vehicle/asset-contract.test.ts',
      'src/views/views.test.ts', 'src/render/parked-vehicle.test.ts',
      '--testNamePattern', '^(?!.*keeps checked-in GLBs in sync)']);
    run('node_modules/@playwright/test/cli.js', ['test', 'asset-review.spec.ts',
      '--output', join(output, 'browser')], {
      ...process.env, PARK_CORE_REVIEW_VEHICLE: vehicle,
      PARK_CORE_REVIEW_CANDIDATE: resolve(candidate), PARK_CORE_REVIEW_OUTPUT: output,
      ...(baseline ? { PARK_CORE_ASSET_BASELINES: resolve(baseline) } : {}),
    });
    for (const [path, expected] of Object.entries(report.sourceHashes)) {
      if (sha256(readFileSync(join(projectRoot, ...path.split('/')))) !== expected) {
        throw new Error(`Source changed during review: ${path}; rerun before approval`);
      }
    }
    if (checkAssets(resolve(candidate), [vehicle])[0].sha256 !== report.assets[0].sha256) {
      throw new Error('Candidate changed during review; rerun before approval');
    }
    report.automated = 'passed';
  } catch (error) {
    report.automated = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const text = JSON.stringify(report, null, 2).replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    writeFileSync(join(output, 'index.html'), `<!doctype html><meta charset="utf-8">
<title>${vehicle} asset review</title><h1>${vehicle} asset review</h1>
<p>Automated: ${report.automated}. Developer visual approval: pending. Hardware and optical validation: unverified.</p>
<ul>${['garage', 'roadside', 'view-limits'].map((view) =>
    `<li><a href="${vehicle}-${view}/review.html">${view}</a></li>`).join('')}</ul>
<p>Links may be unavailable when validation failed; see report.json and browser artifacts.</p><pre>${text}</pre>`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true,
    options: { vehicle: { type: 'string' }, candidate: { type: 'string' }, out: { type: 'string' },
      baseline: { type: 'string' } } });
  const [command] = positionals;
  if (positionals.length !== 1 || !['check', 'review'].includes(command)) {
    throw new Error('Usage: asset-workflow.mjs check|review [--vehicle sedan|cuv] [--candidate root] [--out directory]');
  }
  if (values.vehicle && !['sedan', 'cuv'].includes(values.vehicle)) {
    throw new RangeError('--vehicle must be sedan or cuv');
  }
  if (command === 'check') {
    console.log(JSON.stringify(checkAssets(resolve(values.candidate ?? projectRoot),
      values.vehicle ? [values.vehicle] : ids), null, 2));
  } else {
    if (!values.vehicle || !values.out) throw new Error('review requires --vehicle and --out');
    reviewAssets({ vehicle: values.vehicle, candidate: values.candidate, out: values.out, baseline: values.baseline });
  }
}
