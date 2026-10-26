// Random candidate-name draw (BYOK/local copy).
//
// The model used to pick names freely and collapsed onto a few favourites, so
// castSoul now draws a short list of candidates at random and the model picks
// the best fit among them. Randomness comes from crypto.getRandomValues, never
// from the seeded rng that rollFields accepts, so identical questionnaires
// still get different candidates.
//
// KEEP IN SYNC: JS port of sei-proxy src/anthropic/names/drawNames.ts, which
// serves the cloud /free/soulcast path.

import { NAME_POOL_SOURCE } from './namePool.js';

function parseList(s) {
  return s.split(/\s+/).filter(Boolean);
}

/** @type {Record<string, { female: string[], male: string[], unisex: string[] }>} */
export const NAME_POOL = Object.fromEntries(
  Object.entries(NAME_POOL_SOURCE).map(([heritage, e]) => [
    heritage,
    { female: parseList(e.female), male: parseList(e.male), unisex: parseList(e.unisex) },
  ]),
);

export const DEFAULT_CANDIDATE_COUNT = 8;

/** Comparison key: lowercase, diacritics stripped, letters only. */
export function normalizeName(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/[łŀ]/g, 'l')
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}]/gu, '');
}

/** Keys a stored name blocks: the whole name and its first word. */
export function nameKeys(name) {
  const keys = new Set();
  const whole = normalizeName(name);
  if (whole) keys.add(whole);
  const first = normalizeName(String(name).trim().split(/\s+/)[0] ?? '');
  if (first) keys.add(first);
  return [...keys];
}

export function buildExcludeSet(names) {
  const set = new Set();
  for (const n of names ?? []) {
    if (typeof n !== 'string') continue;
    for (const k of nameKeys(n)) set.add(k);
  }
  return set;
}

/** Uniform integer in [0, max) from crypto.getRandomValues (rejection sampling). */
export function cryptoRandomInt(max) {
  if (!(max > 0)) return 0;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / max) * max;
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

function sample(items, count, rng) {
  const a = items.slice();
  const n = Math.min(count, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + rng(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function poolGenderLists(gender) {
  if (gender === 'female') return ['female', 'unisex'];
  if (gender === 'male') return ['male', 'unisex'];
  return ['unisex'];
}

function toKeySet(v) {
  if (!v) return new Set();
  return v instanceof Set ? v : buildExcludeSet(v);
}

/**
 * Draw candidate names for one character. Same cascade as the proxy:
 *  1. heritage names for this gender (female/male plus unisex; "other" draws
 *     unisex), minus hard and soft excludes
 *  2. same, ignoring soft excludes (own library)
 *  3. "other" only: the heritage's female and male names
 *  4. the same gender lists across every heritage
 * Hard excludes (public names) are never relaxed; no name appears twice.
 *
 * @param {{ heritage?: string|null, gender?: string|null, count?: number,
 *   exclude?: Iterable<string>|Set<string>, softExclude?: Iterable<string>|Set<string>,
 *   rng?: (maxExclusive: number) => number, pool?: typeof NAME_POOL }} opts
 * @returns {string[]}
 */
export function drawNameCandidates(opts = {}) {
  const pool = opts.pool ?? NAME_POOL;
  const count = Math.max(1, Math.floor(opts.count ?? DEFAULT_CANDIDATE_COUNT));
  const rng = opts.rng ?? cryptoRandomInt;
  const gender = opts.gender ?? 'other';
  const hard = toKeySet(opts.exclude);
  const soft = toKeySet(opts.softExclude);
  const heritagePool = opts.heritage ? pool[opts.heritage] : undefined;

  const picked = [];
  const seen = new Set();
  const take = (names, useSoft) => {
    if (picked.length >= count) return;
    const eligible = names.filter((n) => {
      const k = normalizeName(n);
      return !seen.has(k) && !hard.has(k) && !(useSoft && soft.has(k));
    });
    for (const n of sample(eligible, count - picked.length, rng)) {
      seen.add(normalizeName(n));
      picked.push(n);
    }
  };

  const lists = poolGenderLists(gender);
  const neutral = gender !== 'female' && gender !== 'male';
  if (heritagePool) {
    const local = lists.flatMap((g) => heritagePool[g]);
    take(local, true);
    take(local, false);
    if (neutral) take([...heritagePool.female, ...heritagePool.male], false);
  }
  const everywhere = Object.values(pool).flatMap((h) => lists.flatMap((g) => h[g]));
  take(everywhere, true);
  take(everywhere, false);
  if (neutral) take(Object.values(pool).flatMap((h) => [...h.female, ...h.male]), false);
  return picked;
}

/** True when the model's name uses one of the candidates as its base (a robot
 *  may add a short designation such as "-7"). */
export function nameMatchesCandidates(name, candidates) {
  if (typeof name !== 'string' || !name.trim()) return false;
  const words = name.split(/[\s\-_.]+/).map(normalizeName).filter(Boolean);
  const whole = normalizeName(name);
  return candidates.some((c) => {
    const k = normalizeName(c);
    return k === whole || words.includes(k) || whole.startsWith(k);
  });
}
