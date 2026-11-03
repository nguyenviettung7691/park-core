import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SensorBand, SensorId, SensorReading, SensorSnapshot } from '../contracts';
import { createAudio } from './audio';
import { selectMostSevereWarning } from './warnings';

class FakeAudioContext {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly destination = {};
  readonly gain = {
    value: 0,
    setValueAtTime: vi.fn((value: number) => { this.gain.value = value; }),
    cancelScheduledValues: vi.fn(),
  };
  readonly oscillator = {
    frequency: { value: 880, setValueAtTime: vi.fn() },
    type: 'sine',
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  readonly gainNode = {
    gain: this.gain,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  readonly resume = vi.fn(async () => { this.state = 'running'; });
  readonly suspend = vi.fn(async () => { this.state = 'suspended'; });
  readonly close = vi.fn(async () => { this.state = 'closed'; });
  readonly createOscillator = vi.fn(() => this.oscillator);
  readonly createGain = vi.fn(() => this.gainNode);

  constructor() { audioContexts.push(this); }
}

const audioContexts: FakeAudioContext[] = [];

afterEach(() => {
  audioContexts.length = 0;
  vi.unstubAllGlobals();
});

function reading(id: SensorId, distanceM: number | null, band: SensorBand): SensorReading {
  return { id, distanceM, obstacleId: null, band };
}

function snapshot(readings: readonly SensorReading[]): SensorSnapshot {
  return { sampledAtS: 0, readings };
}

function audioForBand(band: SensorBand, distanceM: number): SensorSnapshot {
  return snapshot([reading('front-center', distanceM, band)]);
}

describe('accessible warning audio', () => {
  it('uses one stream for the most severe warning and prefers travel direction on a tie', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const output = createAudio();
    expect(await output.unlock()).toBe('ready');
    const context = audioContexts[0]!;
    output.update(snapshot([
      reading('front-center', 1, 'green'),
      reading('rear-center', 0.2, 'stop'),
    ]), 1, 0);
    expect(context.createOscillator).toHaveBeenCalledOnce();
    expect(context.oscillator.start).toHaveBeenCalledOnce();
    expect(context.gain.value).toBeGreaterThan(0);
    output.update(snapshot([
      reading('front-center', 1, 'green'),
      reading('rear-center', 0.2, 'stop'),
    ]), 1, 0.21);
    expect(context.gain.value).toBeGreaterThan(0);
    output.dispose();

    const tied = createAudio();
    expect(await tied.unlock()).toBe('ready');
    const tiedContext = audioContexts[1]!;
    const readings = [
      reading('front-center', 0.5, 'red'),
      reading('rear-center', 0.5, 'red'),
    ];
    expect(selectMostSevereWarning(readings, 1)?.id).toBe('front-center');
    expect(selectMostSevereWarning(readings, -1)?.id).toBe('rear-center');
    tied.update(snapshot(readings), 1, 0);
    tied.update(snapshot(readings), 1, 0.21);
    expect(tiedContext.gain.value).toBeGreaterThan(0);
    tied.dispose();

    const reverse = createAudio();
    expect(await reverse.unlock()).toBe('ready');
    const reverseContext = audioContexts[2]!;
    reverse.update(snapshot(readings), -1, 0);
    reverse.update(snapshot(readings), -1, 0.21);
    expect(reverseContext.gain.value).toBeGreaterThan(0);
    reverse.suspend();
    reverse.dispose();
  });

  it('keeps the most severe warning audible when a closer sensor has a lower band', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const output = createAudio();
    expect(await output.unlock()).toBe('ready');
    const context = audioContexts[0]!;
    const sensors = snapshot([
      reading('front-center', 0.2, 'red'),
      reading('front-left', 0.3, 'stop'),
    ]);
    output.update(sensors, 0, 0);
    output.update(sensors, 0, 0.1);
    expect(context.gain.value).toBeGreaterThan(0);
    output.dispose();
  });

  it.each([
    ['green', 1.01],
    ['yellow', 0.51],
    ['red', 0.21],
  ] as const)('uses the %s warning interval', async (band, interval) => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const output = createAudio();
    expect(await output.unlock()).toBe('ready');
    const context = audioContexts[0]!;
    const sensors = audioForBand(band, 1);
    output.update(sensors, 0, 0);
    expect(context.gain.value).toBeGreaterThan(0);
    output.update(sensors, 0, interval - 0.02);
    expect(context.gain.value).toBe(0);
    output.update(sensors, 0, interval + 0.01);
    expect(context.gain.value).toBeGreaterThan(0);
    output.dispose();
  });

  it('keeps STOP continuous, honors volume and mute, suspends, and disposes resources', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const output = createAudio();
    expect(await output.unlock()).toBe('ready');
    const context = audioContexts[0]!;
    const sensors = audioForBand('stop', 0.2);
    output.update(sensors, 0, 0);
    const fullVolume = context.gain.value;
    output.setVolume(0.25);
    output.update(sensors, 0, 0.3);
    expect(context.gain.value).toBeCloseTo(fullVolume / 2);
    output.setMuted(true);
    output.update(sensors, 0, 0.4);
    expect(context.gain.value).toBe(0);
    output.setMuted(false);
    output.suspend();
    expect(context.suspend).toHaveBeenCalledOnce();
    expect(context.gain.value).toBe(0);
    output.dispose();
    expect(context.oscillator.stop).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it('reports unavailable audio without affecting a live sensor snapshot', async () => {
    vi.stubGlobal('AudioContext', undefined);
    const output = createAudio();
    const sensors = audioForBand('red', 0.5);
    expect(await output.unlock()).toBe('unavailable');
    output.update(sensors, 0, 0);
    expect(sensors.readings[0]?.band).toBe('red');
    output.dispose();
  });
});
