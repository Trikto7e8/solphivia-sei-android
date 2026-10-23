/**
 * The voice-call transcript window (261024). The window's first row is the
 * start of the cached transcript prefix, so it must stay put across turns and
 * only move in whole steps.
 */
import { describe, it, expect } from 'vitest';
import { voiceWindowStart } from './transcript';

describe('voiceWindowStart', () => {
  it('sends everything while the history is within the cap', () => {
    for (let n = 0; n <= 10; n++) expect(voiceWindowStart(n, 10, 10)).toBe(0);
  });

  it('keeps between cap and cap + step - 1 rows', () => {
    for (let n = 10; n < 200; n++) {
      const kept = n - voiceWindowStart(n, 10, 10);
      expect(kept).toBeGreaterThanOrEqual(10);
      expect(kept).toBeLessThanOrEqual(19);
    }
  });

  it('holds the same first row for step rows in a row, then jumps by step', () => {
    const starts = Array.from({ length: 40 }, (_, i) => voiceWindowStart(10 + i, 10, 10));
    expect(starts.slice(0, 10).every((s) => s === 0)).toBe(true);
    expect(starts.slice(10, 20).every((s) => s === 10)).toBe(true);
    expect(starts.slice(20, 30).every((s) => s === 20)).toBe(true);
  });

  it('stays on the same absolute row when a fold drops a 50-row batch from the front', () => {
    for (let n = 60; n < 150; n++) {
      expect(voiceWindowStart(n - 50, 10, 10) + 50).toBe(voiceWindowStart(n, 10, 10));
    }
  });

  it('treats a step below 1 as 1 (the old sliding window)', () => {
    expect(voiceWindowStart(25, 10, 0)).toBe(15);
  });
});
