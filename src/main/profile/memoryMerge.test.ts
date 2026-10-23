import { describe, it, expect } from 'vitest';
import {
  mergeJsonlByTs,
  mergeMemoryMarkdown,
  mergeWorldRegistries,
  renumberWorldHeaders,
} from './memoryMerge';

const HEADER = '# Memory\n\nAppend-only record. One line per entry. Written via remember(); removed via forget().\n\n';

describe('mergeMemoryMarkdown', () => {
  it('keeps the account text byte for byte and appends only new local lines', () => {
    const target = HEADER + '- [2026-10-01T00:00:00.000Z] a\n\n## World 1 — Base\n- [2026-10-01T01:00:00.000Z] b\n';
    const local = HEADER + '- [2026-10-01T00:00:00.000Z] a\n\n## World 1 — Base\n- [2026-10-01T01:00:00.000Z] b\n- [2026-09-01T00:00:00.000Z] c\n';
    const out = mergeMemoryMarkdown(target, local);
    expect(out.startsWith(target.trimEnd())).toBe(true);
    expect(out.endsWith('## World 1 — Base\n- [2026-09-01T00:00:00.000Z] c\n')).toBe(true);
    expect(mergeMemoryMarkdown(out, local)).toBe(out);
  });

  it('puts local entries from before any section ahead of the account sections', () => {
    const target = HEADER + '## World 1 — Base\n- [2026-10-01T01:00:00.000Z] b\n';
    const local = HEADER + '- [2026-09-01T00:00:00.000Z] loose\n';
    const out = mergeMemoryMarkdown(target, local);
    expect(out.indexOf('loose')).toBeLessThan(out.indexOf('## World 1'));
  });

  it('takes the local file whole when the account has none', () => {
    const local = HEADER + '- [2026-09-01T00:00:00.000Z] only\n';
    expect(mergeMemoryMarkdown('', local)).toBe(local);
  });
});

describe('world numbering', () => {
  it('maps known worlds by fingerprint and gives new ones the next free number', () => {
    const { merged, map } = mergeWorldRegistries(
      { version: 1, worlds: [{ num: 1, fingerprint: 'a' }] },
      { version: 1, worlds: [{ num: 1, fingerprint: 'b' }, { num: 2, fingerprint: 'a' }] },
      3,
    );
    expect(map.get(1)).toBe(4);
    expect(map.get(2)).toBe(1);
    expect(merged.worlds.map((w) => [w.fingerprint, w.num])).toEqual([['a', 1], ['b', 4]]);
  });

  it('renumbers headers in one pass (a swap does not chain)', () => {
    const text = '## World 1 — X\n- e1\n## World 2 — Y\n- e2\n## World 12 — Z\n';
    const out = renumberWorldHeaders(text, new Map([[1, 2], [2, 1]]));
    expect(out).toBe('## World 2 — X\n- e1\n## World 1 — Y\n- e2\n## World 12 — Z\n');
  });
});

describe('mergeJsonlByTs', () => {
  it('unions rows and orders them by ts, keeping ts-less rows next to their neighbour', () => {
    const t = '{"ts":2,"text":"t2"}\n{"ts":4,"text":"t4"}\n';
    const l = '{"ts":1,"text":"l1"}\n{"text":"no-ts"}\n{"ts":2,"text":"t2"}\n{"ts":3,"text":"l3"}\n';
    const out = mergeJsonlByTs(t, l)
      .trim()
      .split('\n')
      .map((x) => JSON.parse(x).text);
    expect(out).toEqual(['l1', 'no-ts', 't2', 'l3', 't4']);
    expect(mergeJsonlByTs(mergeJsonlByTs(t, l), l)).toBe(mergeJsonlByTs(t, l));
  });
});
