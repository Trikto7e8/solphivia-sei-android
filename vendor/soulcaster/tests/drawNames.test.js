import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NAME_POOL,
  buildExcludeSet,
  drawNameCandidates,
  nameMatchesCandidates,
  normalizeName,
} from '../src/drawNames.js';
import { HERITAGES } from '../src/tables.js';

test('pool covers every rolled heritage with deep per-gender lists', () => {
  let total = 0;
  for (const { value } of HERITAGES) {
    const e = NAME_POOL[value];
    assert.ok(e, value);
    assert.ok(e.female.length >= 80 && e.male.length >= 80 && e.unisex.length >= 8, value);
    total += e.female.length + e.male.length + e.unisex.length;
  }
  assert.deepEqual(Object.keys(NAME_POOL).sort(), HERITAGES.map((h) => h.value).sort());
  assert.ok(total > 2500);
});

test('no name twice within a heritage; single given names only', () => {
  for (const [h, e] of Object.entries(NAME_POOL)) {
    const all = [...e.female, ...e.male, ...e.unisex];
    assert.equal(new Set(all.map(normalizeName)).size, all.length, h);
    for (const n of all) assert.doesNotMatch(n, /\s|—/);
  }
});

test('draws 8 distinct names from the heritage and gender lists', () => {
  for (const { value: h } of HERITAGES) {
    for (const g of ['female', 'male', 'other']) {
      const names = drawNameCandidates({ heritage: h, gender: g });
      assert.equal(names.length, 8);
      assert.equal(new Set(names).size, 8);
      const e = NAME_POOL[h];
      const allowed = new Set(g === 'female' ? [...e.female, ...e.unisex] : g === 'male' ? [...e.male, ...e.unisex] : e.unisex);
      for (const n of names) assert.ok(allowed.has(n), `${h}/${g}: ${n}`);
    }
  }
});

test('public names are never offered; first word of a full name blocks too', () => {
  const blocked = buildExcludeSet(['Chen Wei']);
  assert.ok(blocked.has('chen') && blocked.has('chenwei'));
  for (let i = 0; i < 200; i++) {
    const names = drawNameCandidates({ heritage: 'chinese', gender: 'other', exclude: ['Chen Wei', 'Wei'] });
    assert.ok(!names.includes('Chen') && !names.includes('Wei'));
  }
});

test('own names are dropped only when the pool would run dry', () => {
  const pool = { tiny: { female: ['Ana', 'Bea', 'Cora', 'Dina', 'Eva'], male: ['Abe'], unisex: ['Kit'] } };
  const names = drawNameCandidates({ pool, heritage: 'tiny', gender: 'female', count: 5, softExclude: ['Ana', 'Bea', 'Cora'] });
  assert.equal(names.length, 5);
  for (const n of ['Dina', 'Eva', 'Kit']) assert.ok(names.includes(n));
  const few = drawNameCandidates({ pool, heritage: 'tiny', gender: 'female', count: 3, softExclude: ['Ana', 'Bea', 'Cora'] });
  assert.deepEqual(few.sort(), ['Dina', 'Eva', 'Kit']);
});

test('falls back across heritages when exclusions leave too few', () => {
  const e = NAME_POOL.nordic;
  const all = [...e.male, ...e.unisex];
  const names = drawNameCandidates({ heritage: 'nordic', gender: 'male', exclude: all.slice(3) });
  assert.equal(names.length, 8);
  for (const n of all.slice(0, 3)) assert.ok(names.includes(n));
  assert.equal(drawNameCandidates({ heritage: 'martian', gender: 'female' }).length, 8);
});

test('draws are really random', () => {
  const draws = new Set();
  for (let i = 0; i < 20; i++) draws.add(drawNameCandidates({ heritage: 'japanese', gender: 'female' }).join(','));
  assert.ok(draws.size > 15);
});

test('nameMatchesCandidates accepts picks and robot suffixes, rejects inventions', () => {
  const c = ['Sigrid', 'Seo-yeon'];
  assert.ok(nameMatchesCandidates('Sigrid-7', c));
  assert.ok(nameMatchesCandidates('seoyeon', c));
  assert.ok(!nameMatchesCandidates('Akane', c));
});

test('data matches the proxy copy shape (spot check)', () => {
  assert.ok(NAME_POOL.korean.female.includes('Seo-yeon'));
  assert.ok(NAME_POOL['fantasy-invented'].unisex.includes('Ember'));
});
