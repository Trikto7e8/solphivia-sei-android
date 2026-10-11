#!/usr/bin/env node
// scripts/quality-eval/persona/report.mjs: numbers for the persona eval.
//
//   node scripts/quality-eval/persona/report.mjs <runDir>                 -> <runDir>/report.md
//   node scripts/quality-eval/persona/report.mjs <beforeDir> <afterDir>   -> <afterDir>/compare.md
//
// Rates carry 95% Wilson intervals (stats.mjs); before/after differences carry
// Newcombe intervals. Reps inside one (character, situation) cell are
// independent model samples of a fixed prompt, so items are treated as
// independent draws within fixed strata, for which the plain binomial interval
// is the conservative one.
import fs from 'node:fs'
import path from 'node:path'
import { wilson, newcombe, mean, sd } from '../lib/stats.mjs'
import { loadCharacters } from './characters.mjs'
import { SITUATIONS } from './situations.mjs'
import os from 'node:os'

const PRICES = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50, cw: 0.125, cr: 0.01 },
  'claude-opus-5-5': { in: 4, out: 20, cw: 5, cr: 0.20 },
}
export function costOf(model, u = {}) {
  const p = PRICES[model]
  return ((u.input_tokens || 0) * p.in + (u.output_tokens || 0) * p.out +
    (u.cache_creation_input_tokens || 0) * p.cw + (u.cache_read_input_tokens || 0) * p.cr) / 1e6
}

const pct = (x) => `${(100 * x).toFixed(0)}%`
const ci = ([a, b]) => `[${pct(a)}, ${pct(b)}]`
const rate = (k, n) => `${pct(n ? k / n : 0)} ${ci(wilson(k, n))} (${k}/${n})`
const usd = (x) => `$${x.toFixed(2)}`

export function load(dir) {
  const rows = fs.readFileSync(path.join(dir, 'judgments.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const samples = fs.readFileSync(path.join(dir, 'samples.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const ju = JSON.parse(fs.readFileSync(path.join(dir, 'judge-usage.json'), 'utf8'))
  const genCost = samples.reduce((a, s) => a + (s.usage ? costOf(s.model ?? 'claude-haiku-5-5', s.usage) : 0), 0)
  const judgeCost = costOf(ju.model, ju.usage.attribution) + costOf(ju.model, ju.usage.consistency)
  return { rows, samples, genCost, judgeCost, errors: samples.filter((s) => s.error).length }
}

export function metrics(rows) {
  const n = rows.length
  const correct = rows.filter((r) => r.attribution?.guess === r.char).length
  const spoken = rows.filter((r) => !r.silent)
  const spokenCorrect = spoken.filter((r) => r.attribution?.guess === r.char).length
  const judged = rows.filter((r) => r.consistency?.score)
  const off = judged.filter((r) => r.consistency.off).length
  const generic = spoken.filter((r) => r.consistency?.generic).length
  const scores = judged.map((r) => r.consistency.score)
  return {
    n, correct, spokenN: spoken.length, spokenCorrect, judgedN: judged.length, off, generic, scores,
    silent: rows.filter((r) => r.silent).length,
  }
}

function scoreLine(scores) {
  const m = mean(scores), s = sd(scores), h = 1.96 * s / Math.sqrt(scores.length)
  return `${m.toFixed(2)} [${(m - h).toFixed(2)}, ${(m + h).toFixed(2)}]`
}

function confusion(rows, chars) {
  const keys = chars.map((c) => c.key)
  const L = ['| true \\ guessed | ' + keys.join(' | ') + ' | none | accuracy |', '|' + '---|'.repeat(keys.length + 3)]
  for (const t of keys) {
    const mine = rows.filter((r) => r.char === t)
    const cells = keys.map((g) => mine.filter((r) => r.attribution?.guess === g).length)
    const none = mine.filter((r) => !r.attribution?.guess).length
    const k = mine.filter((r) => r.attribution?.guess === t).length
    L.push(`| **${t}** | ${cells.join(' | ')} | ${none} | ${rate(k, mine.length)} |`)
  }
  return L.join('\n')
}

export function single(dir, charsDir) {
  const chars = loadCharacters(charsDir)
  const { rows, genCost, judgeCost, errors } = load(dir)
  const M = metrics(rows)
  const chance = 1 / chars.length
  const L = []
  L.push(`Samples: ${M.n} (${chars.length} characters x ${SITUATIONS.length} situations x reps), generation errors: ${errors}. Chance for attribution: ${pct(chance)}.`)
  L.push('')
  L.push('| metric | value [95% CI] |', '|---|---|')
  L.push(`| Attribution accuracy (blind, all items) | ${rate(M.correct, M.n)} |`)
  L.push(`| Attribution accuracy (items with speech) | ${rate(M.spokenCorrect, M.spokenN)} |`)
  L.push(`| In-character rate (not flagged off) | ${rate(M.judgedN - M.off, M.judgedN)} |`)
  L.push(`| Off-character rate | ${rate(M.off, M.judgedN)} |`)
  L.push(`| Consistency score, mean 1-5 | ${scoreLine(M.scores)} |`)
  L.push(`| Generic-assistant rate (items with speech) | ${rate(M.generic, M.spokenN)} |`)
  L.push(`| Silent (no say) | ${rate(M.silent, M.n)} |`)
  L.push('')
  L.push('Confusion matrix (rows = true character, columns = judge guess):', '', confusion(rows, chars), '')
  L.push('Per character:', '', '| char | attribution | in-character | mean score | generic | silent |', '|---|---|---|---|---|---|')
  for (const c of chars) {
    const m = metrics(rows.filter((r) => r.char === c.key))
    L.push(`| ${c.key} | ${rate(m.correct, m.n)} | ${rate(m.judgedN - m.off, m.judgedN)} | ${scoreLine(m.scores)} | ${rate(m.generic, m.spokenN)} | ${rate(m.silent, m.n)} |`)
  }
  L.push('', 'Per situation (all characters pooled):', '', '| situation | attribution | in-character | mean score | generic |', '|---|---|---|---|---|')
  for (const s of SITUATIONS) {
    const m = metrics(rows.filter((r) => r.situation === s.id))
    if (!m.n) continue
    L.push(`| ${s.id} | ${rate(m.correct, m.n)} | ${rate(m.judgedN - m.off, m.judgedN)} | ${scoreLine(m.scores)} | ${rate(m.generic, m.spokenN)} |`)
  }
  // What they DID: how often each character took initiative tools.
  L.push('', 'Actions per character (share of items with at least one call):', '', '| char | any action | setGoal | follow/come | attack | remember |', '|---|---|---|---|---|---|')
  for (const c of chars) {
    const mine = rows.filter((r) => r.char === c.key)
    const has = (f) => mine.filter((r) => r.actions.some(f)).length
    L.push(`| ${c.key} | ${rate(has(() => true), mine.length)} | ${rate(has((a) => a === 'setGoal'), mine.length)} | ${rate(has((a) => a === 'follow' || a === 'come'), mine.length)} | ${rate(has((a) => /attack/i.test(a)), mine.length)} | ${rate(has((a) => a === 'remember'), mine.length)} |`)
  }
  L.push('', `Cost: generation ${usd(genCost)} (Haiku 5.5), judging ${usd(judgeCost)} (Opus 5.5), total ${usd(genCost + judgeCost)}.`)
  return { text: L.join('\n'), M, cost: genCost + judgeCost }
}

export function compare(beforeDir, afterDir, charsDir) {
  const chars = loadCharacters(charsDir)
  const A = load(beforeDir), B = load(afterDir)
  const a = metrics(A.rows), b = metrics(B.rows)
  const diff = (k1, n1, k2, n2) => {
    const [lo, hi] = newcombe(k1, n1, k2, n2)
    const d = (n2 ? k2 / n2 : 0) - (n1 ? k1 / n1 : 0)
    return `${d >= 0 ? '+' : ''}${(100 * d).toFixed(0)} pts [${(100 * lo).toFixed(0)}, ${(100 * hi).toFixed(0)}]`
  }
  const sdiff = (x, y) => {
    const d = mean(y) - mean(x)
    const h = 1.96 * Math.sqrt(sd(x) ** 2 / x.length + sd(y) ** 2 / y.length)
    return `${d >= 0 ? '+' : ''}${d.toFixed(2)} [${(d - h).toFixed(2)}, ${(d + h).toFixed(2)}]`
  }
  const L = ['| metric | before | after | change [95% CI] |', '|---|---|---|---|']
  L.push(`| Attribution accuracy | ${rate(a.correct, a.n)} | ${rate(b.correct, b.n)} | ${diff(a.correct, a.n, b.correct, b.n)} |`)
  L.push(`| Attribution (speech only) | ${rate(a.spokenCorrect, a.spokenN)} | ${rate(b.spokenCorrect, b.spokenN)} | ${diff(a.spokenCorrect, a.spokenN, b.spokenCorrect, b.spokenN)} |`)
  L.push(`| In-character rate | ${rate(a.judgedN - a.off, a.judgedN)} | ${rate(b.judgedN - b.off, b.judgedN)} | ${diff(a.judgedN - a.off, a.judgedN, b.judgedN - b.off, b.judgedN)} |`)
  L.push(`| Consistency score | ${scoreLine(a.scores)} | ${scoreLine(b.scores)} | ${sdiff(a.scores, b.scores)} |`)
  L.push(`| Generic-assistant rate | ${rate(a.generic, a.spokenN)} | ${rate(b.generic, b.spokenN)} | ${diff(a.generic, a.spokenN, b.generic, b.spokenN)} |`)
  L.push(`| Silent | ${rate(a.silent, a.n)} | ${rate(b.silent, b.n)} | ${diff(a.silent, a.n, b.silent, b.n)} |`)
  L.push('', 'Per character attribution / in-character:', '', '| char | attribution before | after | in-character before | after |', '|---|---|---|---|---|')
  for (const c of chars) {
    const x = metrics(A.rows.filter((r) => r.char === c.key)), y = metrics(B.rows.filter((r) => r.char === c.key))
    L.push(`| ${c.key} | ${rate(x.correct, x.n)} | ${rate(y.correct, y.n)} | ${rate(x.judgedN - x.off, x.judgedN)} | ${rate(y.judgedN - y.off, y.judgedN)} |`)
  }
  L.push('', 'After-run confusion matrix:', '', confusion(B.rows, chars))
  return L.join('\n')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const charsDir = path.join(os.homedir(), 'suisei/eval/characters')
  const [x, y] = process.argv.slice(2)
  if (y) {
    const t = compare(x, y, charsDir)
    fs.writeFileSync(path.join(y, 'compare.md'), t + '\n')
    console.log(t)
  } else {
    const { text } = single(x, charsDir)
    fs.writeFileSync(path.join(x, 'report.md'), text + '\n')
    console.log(text)
  }
}
