import { expect, type Page } from '@playwright/test';
import type { AppObservation } from '../../src/app-observation';
import type {
  AttemptSummary, LessonRuntime, StageId, Vec3Data, VehicleId, VehicleProfile, VehicleTelemetry,
} from '../../src/contracts';
import { scenarios } from '../../src/lessons/scenarios';
import { profiles } from '../../src/vehicle/profiles';
import { rearAxleCenter } from '../../src/vehicle/geometry';

export const STAGE_DRIVE_DEADLINE_MS = 90_000;
const STALE_MS = 2000;
const FIRST_SAMPLE_MS = 10_000;
const TARGET_SPEED_MPS = 0.7;
const ROUTE_RADIUS_M = 5;
const ROUTE_SPACING_M = 0.04;
const LOOKAHEAD_SAMPLES = 30;
const STEERING_DEAD_ZONE = 0.02;

interface PadState { axes: number[]; buttons: { value: number; pressed: boolean; touched: boolean }[] }

export interface ObservationSnapshot {
  readonly session: { readonly generation: number; readonly stageId: StageId | null; readonly vehicleId: VehicleId } | null;
  readonly telemetry: VehicleTelemetry | null;
  readonly lesson: LessonRuntime | null;
  readonly outcome: AttemptSummary | null;
  readonly paused: string | null;
  readonly closed: boolean;
  readonly telemetryAgeMs: number | null;
  readonly sinceStartMs: number;
  readonly telemetryCount: number;
  readonly ignored: number;
}

declare global {
  interface Window {
    lessonPad: PadState & { id: string; index: number; connected: boolean; mapping: string; timestamp: number };
    parkObs: {
      poll(input: { steering: number; throttle: number; brake: number }): Promise<ObservationSnapshot>;
    };
  }
}

export async function installObservationAndPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.lessonPad = {
      id: 'Lesson journey wheel', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0], buttons: Array.from({ length: 8 }, () => ({ value: 0, pressed: false, touched: false })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.lessonPad] });

    let session: ObservationSnapshot['session'] = null;
    let telemetry: { t: VehicleTelemetry; at: number } | null = null;
    let lesson: LessonRuntime | null = null;
    let outcome: AttemptSummary | null = null;
    let paused: string | null = null;
    let closed = false;
    let lastSeq = -1;
    let startedAt = performance.now();
    let telemetryCount = 0;
    let ignored = 0;
    let waiter: (() => void) | null = null;

    window.addEventListener('park-core:observation', (raw) => {
      const event = (raw as CustomEvent<AppObservation>).detail;
      if (!Number.isFinite(event.sequence) || event.sequence <= lastSeq) { ignored++; return; }
      lastSeq = event.sequence;
      if (event.kind === 'session') {
        session = { generation: event.generation, stageId: event.stageId, vehicleId: event.vehicleId };
        telemetry = null; lesson = null; outcome = null; paused = null; closed = false;
        startedAt = performance.now();
        return;
      }
      if (event.kind === 'closed') {
        session = null; telemetry = null; lesson = null; outcome = null; paused = null; closed = true;
        return;
      }
      if (!session || event.generation !== session.generation) { ignored++; return; }
      switch (event.kind) {
        case 'telemetry':
          telemetry = { t: event.telemetry, at: event.capturedAtMs };
          telemetryCount++;
          waiter?.();
          break;
        case 'lesson': lesson = event.lesson; break;
        case 'outcome': outcome = event.summary; break;
        case 'paused': paused = event.reason; break;
        case 'resumed': paused = null; telemetry = null; startedAt = performance.now(); break;
      }
    });

    window.parkObs = {
      async poll({ steering, throttle, brake }) {
        const pad = window.lessonPad;
        const set = (index: number, value: number) => {
          pad.buttons[index] = { value, pressed: value > 0.5, touched: value > 0 };
        };
        pad.axes[0] = steering;
        set(7, throttle);
        set(6, brake);
        await new Promise<void>((resolve) => {
          waiter = resolve;
          setTimeout(resolve, 150);
        });
        waiter = null;
        const now = performance.now();
        return {
          session, telemetry: telemetry?.t ?? null, lesson, outcome, paused, closed,
          telemetryAgeMs: telemetry ? now - telemetry.at : null,
          sinceStartMs: now - startedAt, telemetryCount, ignored,
        };
      },
    };
  });
}

export async function setPad(page: Page, steering: number, throttle: number, brake: number): Promise<void> {
  await page.evaluate(({ steering, throttle, brake }) => {
    const pad = window.lessonPad;
    pad.axes[0] = steering;
    pad.buttons[7] = { value: throttle, pressed: throttle > 0.5, touched: throttle > 0 };
    pad.buttons[6] = { value: brake, pressed: brake > 0.5, touched: brake > 0 };
  }, { steering, throttle, brake });
}

async function setButton(page: Page, index: number, value: number) {
  await page.evaluate(({ index, value }) => {
    window.lessonPad.buttons[index] = { value, pressed: value > 0.5, touched: value > 0 };
  }, { index, value });
}

export async function selectGamepadDevice(page: Page): Promise<void> {
  await page.getByLabel('Nguồn điều khiển', { exact: true }).selectOption('gamepad');
  await page.getByLabel('Thiết bị', { exact: true }).selectOption('0');
}

export async function calibrateThroughUi(page: Page): Promise<void> {
  await selectGamepadDevice(page);
  await page.getByRole('button', { name: 'Hiệu chuẩn thiết bị', exact: true }).click();
  for (const [value, label] of [[-1, 'Ghi hết lái trái'], [0, 'Ghi chính giữa'], [1, 'Ghi hết lái phải']] as const) {
    await page.evaluate((value) => { window.lessonPad.axes[0] = value; }, value);
    await page.getByRole('button', { name: label, exact: true }).click();
  }
  for (const [index, label] of [[7, 'Chân ga'], [6, 'Phanh chân']] as const) {
    await setButton(page, index, 0);
    await page.getByRole('button', { name: `${label} — Ghi đã nhả`, exact: true }).click();
    await setButton(page, index, 1);
    await page.getByRole('button', { name: `${label} — Ghi đã nhấn hết`, exact: true }).click();
  }
  await setButton(page, 4, 1);
  await page.getByRole('button', { name: 'Xác minh nút R', exact: true }).click();
  await setButton(page, 5, 1);
  await page.getByRole('button', { name: 'Xác minh nút D', exact: true }).click();
  await releasePad(page);
  await page.getByRole('button', { name: 'Lưu hiệu chuẩn', exact: true }).click();
}

export async function releasePad(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pad = window.lessonPad;
    pad.axes[0] = 0;
    for (let index = 0; index < pad.buttons.length; index++) {
      pad.buttons[index] = { value: 0, pressed: false, touched: false };
    }
  });
}

// After a reload the saved calibration must be re-verified through the normal UI button.
export async function ensureGamepadReady(page: Page): Promise<void> {
  if (await page.locator('#input-source').inputValue() !== 'gamepad') {
    await page.getByLabel('Nguồn điều khiển', { exact: true }).selectOption('gamepad');
  }
  await page.getByRole('button', { name: 'Tìm thiết bị', exact: true }).click();
  await expect(page.locator('#input-device option[value="0"]')).toHaveCount(1, { timeout: 5000 });
  if (await page.locator('#input-device').inputValue() !== '0') {
    await page.getByLabel('Thiết bị', { exact: true }).selectOption('0', { timeout: 5000 });
  }
  const verify = page.locator('#verify-saved-calibration');
  if (await verify.count() > 0) await verify.click();
  await expect(page.locator('#start-stage')).toBeEnabled();
}

// Rear-axle route: straight when the target is laterally aligned, otherwise two radius-5 arcs.
export function rearAxleRoute(stageId: StageId, profile: VehicleProfile): Vec3Data[] {
  const scenario = scenarios[stageId];
  const spawn = scenario.spawnByVehicle[profile.id];
  const startRear = rearAxleCenter({
    positionM: spawn.positionM,
    rotation: [0, Math.sin(spawn.yawRad / 2), 0, Math.cos(spawn.yawRad / 2)],
  }, profile);
  const region = scenario.target.region;
  const targetRear = rearAxleCenter({
    positionM: [region.centerM[0], profile.centerOfMassHeightM, region.centerM[2]],
    rotation: [0, Math.sin(region.headingRad / 2), 0, Math.cos(region.headingRad / 2)],
  }, profile);
  const lateral = targetRear[0] - startRear[0];
  const route: Vec3Data[] = [startRear];
  if (Math.abs(lateral) < 0.01) {
    const distance = Math.hypot(targetRear[0] - startRear[0], targetRear[2] - startRear[2]);
    const samples = Math.ceil(distance / ROUTE_SPACING_M);
    for (let index = 1; index <= samples; index++) {
      const f = index / samples;
      route.push([startRear[0] + (targetRear[0] - startRear[0]) * f, startRear[1],
        startRear[2] + (targetRear[2] - startRear[2]) * f]);
    }
    return route;
  }
  const turn = Math.acos(1 - Math.abs(lateral) / (2 * ROUTE_RADIUS_M));
  const arc = ROUTE_RADIUS_M * turn;
  const direction = Math.sign(lateral);
  const rear = [...startRear] as [number, number, number];
  let yaw = spawn.yawRad;
  for (const curvature of [direction / ROUTE_RADIUS_M, -direction / ROUTE_RADIUS_M]) {
    const count = Math.ceil(arc / ROUTE_SPACING_M);
    for (let index = 0; index < count; index++) {
      const old = yaw;
      yaw += curvature * Math.min(ROUTE_SPACING_M, arc - index * ROUTE_SPACING_M);
      rear[0] += (Math.cos(old) - Math.cos(yaw)) / curvature;
      rear[2] += (Math.sin(yaw) - Math.sin(old)) / curvature;
      route.push([rear[0], rear[1], rear[2]]);
    }
  }
  return route;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const fmt = (values: readonly number[]) => values.map((v) => v.toFixed(2)).join(',');

function describe(stageId: StageId, vehicleId: VehicleId, phase: string, snap: ObservationSnapshot, extra = ''): string {
  const tel = snap.telemetry;
  const step = scenarios[stageId].steps[snap.lesson?.stepIndex ?? -1]?.id ?? 'none';
  return `stage=${stageId} vehicle=${vehicleId} phase=${phase} step=${step}` +
    (tel ? ` simT=${tel.simulationTimeS.toFixed(1)} pos=${fmt(tel.pose.positionM)} heading=${tel.headingRad.toFixed(3)}` +
      ` speed=${tel.signedSpeedMps.toFixed(2)} gear=${tel.gear} PB=${tel.parkingBrake} ind=${tel.indicator}` : ' telemetry=none') +
    ` age=${snap.telemetryAgeMs?.toFixed(0) ?? 'n/a'}ms ${extra}`;
}

export interface DriveResult { readonly summary: AttemptSummary; readonly wallMs: number; readonly simulationS: number }

// Drives the active lesson through the normal gamepad axis/pedals and keyboard discrete keys.
export async function driveLesson(
  page: Page, stageId: StageId, vehicleId: VehicleId,
  log: (line: string) => void = () => undefined,
): Promise<DriveResult> {
  const profile = profiles[vehicleId];
  const scenario = scenarios[stageId];
  const route = rearAxleRoute(stageId, profile);
  const lastStep = scenario.steps.length - 1;
  const gear = stageId === 1 ? 'D' : 'R';
  const gearKey = gear === 'D' ? 'Digit4' : 'Digit2';
  const started = Date.now();
  let phase: 'prepare' | 'drive' | 'stop' | 'secure' = 'prepare';
  let near = 0;
  let input = { steering: 0, throttle: 0, brake: 1 };
  let lastKeyAt = 0;
  let stoppedSinceSimS: number | null = null;
  let lastLogAt = 0;
  let firstSimS: number | null = null;

  const press = async (code: string, now: number, gapMs = 700) => {
    if (now - lastKeyAt < gapMs) return;
    lastKeyAt = now;
    await page.keyboard.press(code);
  };

  for (;;) {
    const now = Date.now();
    const snap = await page.evaluate((value) => window.parkObs.poll(value), input);
    const where = (extra = '') => describe(stageId, vehicleId, phase, snap, extra);
    if (now - started > STAGE_DRIVE_DEADLINE_MS) throw new Error(`90s drive deadline exceeded: ${where()}`);
    if (snap.outcome) {
      if (snap.outcome.outcome === 'success') {
        await releasePad(page);
        return { summary: snap.outcome, wallMs: Date.now() - started,
          simulationS: (snap.telemetry?.simulationTimeS ?? 0) - (firstSimS ?? 0) };
      }
      throw new Error(`lesson failed (${snap.outcome.failureReason}, obstacle=${snap.outcome.obstacleId}): ${where()}`);
    }
    if (snap.closed) throw new Error(`session closed unexpectedly: ${where()}`);
    if (!snap.session) throw new Error(`no session observed: ${where()}`);
    if (snap.session.stageId !== stageId || snap.session.vehicleId !== vehicleId) {
      throw new Error(`wrong session identity ${snap.session.stageId}/${snap.session.vehicleId}: ${where()}`);
    }
    if (snap.paused) throw new Error(`session paused (${snap.paused}): ${where()}`);
    const tel = snap.telemetry;
    if (!tel || !snap.lesson) {
      if (snap.sinceStartMs > FIRST_SAMPLE_MS) throw new Error(`no telemetry/lesson within 10s: ${where()}`);
      continue;
    }
    if (snap.telemetryAgeMs !== null && snap.telemetryAgeMs > STALE_MS) {
      throw new Error(`stale telemetry ${snap.telemetryAgeMs.toFixed(0)}ms: ${where()}`);
    }
    const flat = [...tel.pose.positionM, ...tel.pose.rotation, tel.headingRad, tel.signedSpeedMps, tel.totalSpeedMps];
    if (!flat.every(Number.isFinite)) throw new Error(`non-finite telemetry: ${where()}`);
    firstSimS ??= tel.simulationTimeS;
    if (now - lastLogAt > 5000) { lastLogAt = now; log(where()); }

    const step = scenario.steps[snap.lesson.stepIndex];
    const speed = Math.abs(tel.signedSpeedMps);
    const rear = rearAxleCenter(tel.pose, profile);
    input = { steering: 0, throttle: 0, brake: 1 };

    if (phase === 'prepare') {
      const needsAck = step?.required.some((c) => c.kind === 'acknowledgement') === true
        && !snap.lesson.acknowledgedStepIds.includes(step.id);
      if (needsAck && speed < 0.05) await press('KeyF', now, 1000);
      else if (step?.required.some((c) => c.kind === 'indicator' && c.value === 'right')
        && tel.indicator !== 'right') await press('KeyE', now);
      else if (snap.lesson.stepIndex >= lastStep - 1 && speed < 0.05) {
        if (tel.gear !== gear) await press(gearKey, now);
        else if (tel.parkingBrake) await press('Space', now);
        else if (snap.lesson.stepIndex === lastStep) phase = 'drive';
      }
      continue;
    }

    while (near < route.length - 1 &&
      Math.hypot(route[near + 1][0] - rear[0], route[near + 1][2] - rear[2])
      <= Math.hypot(route[near][0] - rear[0], route[near][2] - rear[2])) near++;
    const look = route[Math.min(route.length - 1, near + LOOKAHEAD_SAMPLES)];
    const dx = look[0] - rear[0], dz = look[2] - rear[2];
    const lateral = dx * Math.cos(tel.headingRad) - dz * Math.sin(tel.headingRad);
    const delta = Math.atan(profile.wheelbaseM * 2 * lateral / Math.max(dx * dx + dz * dz, 0.25));
    const wheel = clamp(delta * profile.steeringRatio / profile.steeringWheelLockRad, -1, 1);
    // Calibrated axis: +1 steers right; normalisation removes a 2% dead zone.
    const axis = Math.abs(wheel) < 1e-3 ? 0 : Math.sign(wheel) * (STEERING_DEAD_ZONE + (1 - STEERING_DEAD_ZONE) * Math.abs(wheel));

    if (phase === 'drive') {
      if (near >= route.length - 3) phase = 'stop';
      else {
        input = { steering: axis, throttle: speed < TARGET_SPEED_MPS ? 0.3 : 0, brake: speed > 0.9 ? 0.2 : 0 };
        continue;
      }
    }
    if (phase === 'stop') {
      input = { steering: axis, throttle: 0, brake: 1 };
      if (speed < 0.05) {
        stoppedSinceSimS ??= tel.simulationTimeS;
        if (tel.simulationTimeS - stoppedSinceSimS > 0.5) phase = 'secure';
      } else stoppedSinceSimS = null;
      continue;
    }
    input = { steering: 0, throttle: 0, brake: 0.5 };
    if (tel.gear !== 'P') await press('Digit1', now);
    else if (!tel.parkingBrake) await press('Space', now);
  }
}
