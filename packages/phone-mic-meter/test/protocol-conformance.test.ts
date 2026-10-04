import { describe, expect, it } from 'vitest';
import { quantizeCoverage as protocolQuantizeCoverage, quantizeDb as protocolQuantizeDb, validateMessageObject } from '@atr/protocol';
import { frameSamples } from '../src/frame.js';
import type { Frame } from '../src/frame.js';
import { SampleFramer } from '../src/framer.js';
import { summarizePrecheck } from '../src/precheck.js';
import { quantizeCoverage, quantizeDb } from '../src/quantize.js';
import type { PrecheckPurpose, WindowKind } from '../src/types.js';
import { WindowAccumulator } from '../src/window.js';
import type { WindowFinishReason } from '../src/window.js';
import { dbFrame, mulberry32, nonfiniteFrame } from './helpers.js';

/**
 * The package's output, wrapped in a phone envelope, must pass the shared @atr/protocol validators
 * (revision 4: quantisation grids, integer milliseconds, per-purpose reason sets and the
 * cross-field invariants of PROTOCOL.md section 3.3). The scenarios are generated from seeded
 * randomness; the validators are the independent judge.
 */

const NOW = 1_790_000_000_000;

function envelope(type: 'level' | 'precheck.result' | 'window.result', payload: unknown): Record<string, unknown> {
  return {
    protocol_version: 1,
    type,
    message_id: 'm_0123456789abcdefghijkl',
    room_id: 'r_ABCDEFGHIJKLMNOPQRSTUV',
    session_id: 's_session01',
    window_id: 'w_window001',
    attempt_id: 'a_attempt001',
    sender_role: 'phone',
    producer_generation: 1,
    sequence: 0,
    event_timestamp: NOW,
    payload,
  };
}

function expectAccepted(type: 'level' | 'precheck.result' | 'window.result', payload: unknown, label: string): void {
  const result = validateMessageObject(envelope(type, payload), { now: NOW });
  if (!result.ok) {
    throw new Error(`${label}: validator rejected ${type} (${result.code}: ${result.detail}) payload ${JSON.stringify(payload)}`);
  }
  // The returned copy carries canonical grid values; ours must already be canonical, so nothing changes.
  expect((result.message as { payload: unknown }).payload, label).toEqual(payload);
}

describe('local quantisers behave exactly like @atr/protocol', () => {
  it('quantizeDb and quantizeCoverage agree on 20000 random values, ties and edge values included', () => {
    const rand = mulberry32(777);
    const values: number[] = [-140, 20, 0, -0, 0.05, -0.05, 0.25, -0.25, -42.25, -43.25, 0.04, -0.04, 12.345, -12.345];
    for (let i = 0; i < 20000; i++) values.push((rand() * 2 - 1) * 160);
    for (let k = -1400; k <= 200; k++) values.push(k / 10 + 0.05, k / 10 - 0.05, k / 100);
    for (const v of values) {
      expect(Object.is(quantizeDb(v), protocolQuantizeDb(v)), `quantizeDb(${v})`).toBe(true);
    }
    const coverages: number[] = [0, 1, 0.9, 0.8999, 0.89983, 0.9996, 1.0004, -0.0004];
    for (let i = 0; i < 20000; i++) coverages.push(rand() * 1.2 - 0.1);
    for (let n = 0; n <= 700; n++) coverages.push(n / 700, n / 600, n / 160);
    for (const v of coverages) {
      expect(Object.is(quantizeCoverage(v), protocolQuantizeCoverage(v)), `quantizeCoverage(${v})`).toBe(true);
    }
  });
});

describe('level payloads pass the protocol validators', () => {
  it('3000 random frames, including silence, clipping and non-finite frames', () => {
    const rand = mulberry32(31);
    const acc = new WindowAccumulator({ kind: 'vowel', maxDurationMs: 35000, sessionFloorDbfs: -70, sampleRate: 48000 });
    let accepted = 0;
    for (let i = 0; i < 700; i++) {
      const r = rand();
      const frame =
        r < 0.03
          ? nonfiniteFrame(i)
          : dbFrame(i, r < 0.1 ? -140 : -100 + rand() * 118, { clipped: r > 0.97 });
      const level = acc.push(frame);
      if (level !== null) {
        expectAccepted('level', level, `level ${i}`);
        accepted += 1;
      }
    }
    expect(accepted).toBe(700);
  });
});

describe('precheck.result payloads pass the protocol validators', () => {
  const purposes: Array<[PrecheckPurpose, number]> = [
    ['quiet_check', 5000],
    ['pre_window', 2000],
  ];

  it('hand-made scenarios covering every reason, for both purposes', () => {
    const flat = (db: number, n: number, extra: Frame[] = []) => [
      ...Array.from({ length: n }, (_, i) => dbFrame(i, db)),
      ...extra.map((f, k) => ({ ...f, frameIndex: n + k })),
    ];
    for (const [purpose, ms] of purposes) {
      const n = ms / 50;
      const scenarios: Array<[string, Frame[], boolean]> = [
        ['valid flat', flat(-62.3, n), false],
        ['silent_input', flat(-140, n), false],
        ['silent boundary', flat(-110.1, n), false],
        ['low coverage', flat(-55, Math.floor(n / 2)), false],
        ['clipped', flat(-55, n - 1, [dbFrame(0, -2, { clipped: true })]), false],
        ['nonfinite', flat(-55, n - 6, Array.from({ length: 6 }, (_, k) => nonfiniteFrame(k))), false],
        ['burst', [...flat(-60, n - 6), ...Array.from({ length: 6 }, (_, k) => dbFrame(n - 6 + k, -30))], false],
        ['too loud', flat(-20, n), false],
        ['interrupted', flat(-60, n), true],
        ['empty', [], false],
      ];
      for (const [label, frames, interrupted] of scenarios) {
        const payload = summarizePrecheck(frames, { purpose, durationMs: ms, interrupted });
        expectAccepted('precheck.result', payload, `${purpose} ${label}`);
      }
    }
  });

  it('1000 seeded random prechecks', () => {
    const rand = mulberry32(2026);
    for (let t = 0; t < 1000; t++) {
      const [purpose, nominalMs] = purposes[t % 2] as [PrecheckPurpose, number];
      // durations within the protocol's +-50 ms tolerance of the nominal one give expected_frames of
      // 99 or 39 as well, so coverage values such as 98/99 are off the 0.001 grid before quantising
      const ms = nominalMs - Math.floor(rand() * 50);
      const n = Math.floor(ms / 50);
      const mu = -130 + rand() * 120;
      const sigma = rand() * 8;
      const count = rand() < 0.15 ? Math.floor(rand() * n) : n;
      const frames: Frame[] = [];
      for (let i = 0; i < count; i++) {
        const r = rand();
        if (r < 0.02) frames.push(nonfiniteFrame(i));
        else frames.push(dbFrame(i, Math.max(-140, Math.min(20, mu + sigma * (rand() * 2 - 1))), { clipped: r > 0.995 }));
      }
      const payload = summarizePrecheck(frames, { purpose, durationMs: ms, interrupted: rand() < 0.02 });
      expectAccepted('precheck.result', payload, `random precheck ${t}`);
    }
  });
});

describe('window.result payloads pass the protocol validators', () => {
  const kinds: Array<[WindowKind, number]> = [
    ['calibration', 6000],
    ['phrase', 8000],
    ['vowel', 30000],
  ];

  it('3000 seeded random windows: speech bursts, dropouts, non-finite and clipped frames, early stops, interruptions', () => {
    const rand = mulberry32(4242);
    const reasons = new Set<string>();
    for (let t = 0; t < 3000; t++) {
      const [kind, maxMs] = kinds[t % 3] as [WindowKind, number];
      const maxFrames = maxMs / 50;
      const floor = Math.round((-100 + rand() * 65) * 10) / 10;
      const acc = new WindowAccumulator({ kind, maxDurationMs: maxMs, sessionFloorDbfs: floor, sampleRate: 48000 });

      // speech bursts at random positions
      const bursts = Array.from({ length: Math.floor(rand() * 4) }, () => {
        const start = Math.floor(rand() * maxFrames);
        return { start, length: 1 + Math.floor(rand() * 40), rel: 5 + rand() * 30 };
      });
      const lastFrame = rand() < 0.3 ? Math.floor(rand() * maxFrames) : maxFrames - 1;
      const dropRate = rand() < 0.2 ? rand() * 0.2 : 0;
      const nonfiniteRate = rand() < 0.15 ? rand() * 0.1 : 0;
      const clipRate = rand() < 0.15 ? rand() * 0.1 : 0;
      for (let i = 0; i <= lastFrame; i++) {
        if (rand() < dropRate) continue;
        if (rand() < nonfiniteRate) {
          acc.push(nonfiniteFrame(i));
          continue;
        }
        const burst = bursts.find((b) => i >= b.start && i < b.start + b.length);
        const db = Math.max(-140, Math.min(20, floor + (burst ? burst.rel : -1 + rand() * 3)));
        const base = dbFrame(i, db, { clipped: rand() < clipRate });
        acc.push({ ...base, peak: base.peak * (1 + rand() * 3) });
      }
      const reason: WindowFinishReason = rand() < 0.05 ? 'interrupted' : rand() < 0.4 ? 'early_stop' : 'complete';
      const override = rand() < 0.3 ? { durationMs: Math.floor(rand() * maxMs) } : {};
      const payload = acc.finish(reason, override);
      reasons.add(String(payload.invalid_reason));
      expectAccepted('window.result', payload, `random window ${t} (${kind})`);
    }
    // the generator really exercised the invalid paths
    for (const r of ['null', 'no_voice', 'low_coverage', 'clipped', 'nonfinite', 'interrupted']) {
      expect(reasons.has(r), `reason ${r} seen`).toBe(true);
    }
  });

  it('windows built from real samples through the framer, at 48 kHz, 44.1 kHz and 22.05 kHz (frames are not exactly 50 ms)', () => {
    const rand = mulberry32(99);
    for (const sampleRate of [48000, 44100, 22050]) {
      for (let t = 0; t < 20; t++) {
        const framer = new SampleFramer(sampleRate);
        const acc = new WindowAccumulator({ kind: 'phrase', maxDurationMs: 8000, sessionFloorDbfs: -60, sampleRate });
        // a whole number of frames covering at least 8 s: 160 frames (at 22.05 kHz that is 8003.6 ms of frame time)
        const total = Math.ceil((sampleRate * 8) / frameSamples(sampleRate)) * frameSamples(sampleRate);
        const signal = new Float32Array(total);
        const bg = 0.001;
        for (let i = 0; i < total; i++) signal[i] = (rand() * 2 - 1) * bg;
        // every fourth window is loud from the start to the end (activity as long as the window)
        const loudThroughout = t % 4 === 0;
        const start = loudThroughout ? 0 : Math.floor(rand() * sampleRate * 3);
        const length = loudThroughout ? total : Math.floor(rand() * sampleRate * 3);
        for (let i = start; i < Math.min(total, start + length); i++) signal[i] = (rand() * 2 - 1) * 0.05;
        for (let i = 0; i < total; i += 128) {
          for (const f of framer.push(signal.subarray(i, Math.min(total, i + 128)))) {
            const level = acc.push(f);
            if (level !== null) expectAccepted('level', level, `sample level ${sampleRate}`);
          }
        }
        expectAccepted('window.result', acc.finish('complete'), `sample window ${sampleRate} #${t}`);
      }
    }
  });
});

describe('the harness itself rejects unquantised or inconsistent payloads', () => {
  it('rejects a dB value off the 0.1 grid, a coverage off the 0.001 grid and a fractional millisecond field', () => {
    const acc = new WindowAccumulator({ kind: 'phrase', maxDurationMs: 8000, sessionFloorDbfs: -60, sampleRate: 48000 });
    for (let i = 0; i < 40; i++) acc.push(dbFrame(i, i >= 10 && i < 30 ? -45 : -62));
    const good = acc.finish('complete');
    expect(validateMessageObject(envelope('window.result', good), { now: NOW }).ok).toBe(true);
    expect(validateMessageObject(envelope('window.result', { ...good, p95_active_dbfs: -45.34 }), { now: NOW }).ok).toBe(false);
    expect(validateMessageObject(envelope('window.result', { ...good, coverage: 0.9996 }), { now: NOW }).ok).toBe(false);
    expect(validateMessageObject(envelope('window.result', { ...good, active_ms: 1000.5 }), { now: NOW }).ok).toBe(false);
    const level = { frame_index: 1, t_audio_ms: 50, dbfs: -42.34, active: false, clipped: false };
    expect(validateMessageObject(envelope('level', level), { now: NOW }).ok).toBe(false);
  });
});
