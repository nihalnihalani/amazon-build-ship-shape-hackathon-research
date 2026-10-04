import { describe, expect, it } from 'vitest';
import { createDisplaySmoother, smoothStep } from '../src/index.js';

describe('smoothStep', () => {
  it('covers 1 - 1/e of the gap after one time constant', () => {
    // 10 * (1 - e^-1) = 6.3212056
    expect(smoothStep(0, 10, 100, 100)).toBeCloseTo(6.3212056, 6);
  });

  it('covers 1 - e^-2 after two time constants', () => {
    expect(smoothStep(0, 10, 200, 100)).toBeCloseTo(8.6466472, 6);
  });

  it('is invariant to how a duration is split (time based, not frame based)', () => {
    let v = 0;
    for (let i = 0; i < 4; i++) v = smoothStep(v, 10, 25, 100);
    expect(v).toBeCloseTo(smoothStep(0, 10, 100, 100), 9);
  });

  it('leaves the value unchanged for dt <= 0 and snaps for tau <= 0', () => {
    expect(smoothStep(3, 10, 0, 100)).toBe(3);
    expect(smoothStep(3, 10, -50, 100)).toBe(3);
    expect(smoothStep(3, 10, 100, 0)).toBe(10);
    expect(smoothStep(3, 10, 100, -1)).toBe(10);
  });
});

describe('createDisplaySmoother', () => {
  it('starts empty and takes the first finite frame as is', () => {
    const s = createDisplaySmoother();
    expect(s.current()).toBeNull();
    expect(s.push(Number.NaN, 0)).toBeNull();
    expect(s.push(4, Number.NaN)).toBeNull();
    expect(s.push(4, 1000)).toBe(4);
    expect(s.current()).toBe(4);
  });

  it('rises with the attack constant and falls with the release constant', () => {
    const s = createDisplaySmoother({ attackTauMs: 120, releaseTauMs: 250 });
    s.push(0, 0);
    expect(s.push(10, 120)).toBeCloseTo(6.3212056, 6); // one attack tau toward 10
    // Falling for one release tau: 6.3212056 * e^-1 = 10 (e^-1 - e^-2) = 2.3254416
    expect(s.push(0, 120 + 250)).toBeCloseTo(2.3254416, 6);
  });

  it('ignores frames that are not newer (never rewinds)', () => {
    const s = createDisplaySmoother();
    s.push(0, 100);
    const v = s.push(10, 150);
    expect(s.push(99, 150)).toBe(v); // duplicate timestamp
    expect(s.push(99, 120)).toBe(v); // older timestamp
    expect(s.current()).toBe(v);
  });

  it('snaps to the target after a long gap instead of gliding through stale values', () => {
    const s = createDisplaySmoother({ maxGapMs: 1000 });
    s.push(0, 0);
    expect(s.push(20, 1500)).toBe(20);
  });

  it('reset forgets the previous value', () => {
    const s = createDisplaySmoother();
    s.push(5, 0);
    s.reset();
    expect(s.current()).toBeNull();
    expect(s.push(-3, 10)).toBe(-3);
  });

  it('is deterministic: the same frames give the same output', () => {
    const run = (): Array<number | null> => {
      const s = createDisplaySmoother();
      return [0, 1, 2, 3, 4].map((i) => s.push(i * i, i * 50));
    };
    expect(run()).toEqual(run());
  });
});
