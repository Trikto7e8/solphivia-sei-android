// scripts/quality-eval/pass29-judge.mjs: label pass29-probe.mjs replies with
// the scorecard judge (judge.mjs judgeSystem, Opus), so a probe arm is scored
// the way the scripted conversations are. Per case, the transcript up to the
// measured line comes from the first captured request (it is the same for
// every rep and arm, since the history is stubbed) and the arm's replies are
// labelled together as independent alternatives.
//
//   node scripts/quality-eval/pass29-judge.mjs DIR [DIR...] [--requests BASEDIR]
//
// Writes DIR/judged.json and prints off / repetitive counts per case.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { judgeSystem, JUDGE_MODEL } from './judge.mjs'
import { loadCharacters } from './persona/characters.mjs'
import { PRICES } from './report.mjs'

const args = process.argv.slice(2)
const ri = args.indexOf('--requests')
const reqBase = ri >= 0 ? args.splice(ri, 2)[1] : null
const KEY = (process.env.ANTHROPIC_API_KEY || fs.readFileSync(path.join(os.homedir(), '.sei-dev/anthropic-test-key'), 'utf8')).trim()
const anthropic = new Anthropic({ apiKey: KEY })
const sui = loadCharacters(path.join(os.homedir(), 'suisei/eval/characters'), ['sui'])[0]
const system = judgeSystem(sui.expanded)

function transcriptFor(dir, cid) {
  for (const d of [reqBase, dir].filter(Boolean)) {
    const f = path.join(d, 'requests', `${cid}-1.json`)
    if (!fs.existsSync(f)) continue
    const req = JSON.parse(fs.readFileSync(f, 'utf8'))
    const blocks = req.messages.at(-1).content.map((b) => b.text ?? '')
    const convo = blocks.find((t) => t.startsWith('Your recent conversation')) ?? ''
    const lines = convo.split('\n').filter((l) => /^\[[^\]]+\] (you|player \(|game:)/.test(l))
    const snap = blocks.find((t) => t.startsWith('world:')) ?? ''
    return { lines: lines.map((l) => l.replace(/^\[([^\]]+)\] you:/, '[$1] Sui says:')), snap }
  }
  return null
}

const usage = {}
for (const dir of args) {
  const rows = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.error)
  const byCase = {}
  for (const r of rows) (byCase[r.case] ??= []).push(r)
  const out = {}
  for (const [cid, rs] of Object.entries(byCase)) {
    const t = transcriptFor(dir, cid)
    if (!t) { console.log(`${cid}: no transcript`); continue }
    const last = t.lines.at(-1)
    const block = [
      'Session so far (oldest first). The last line is the player line being answered.',
      ...t.lines,
      '',
      '(what her sensors showed her when she answered)',
      t.snap,
    ].join('\n')
    const ask = [
      `Below are ${rs.length} alternative replies she might have sent to the last player line (${last}). Each is independent: judge each one as if it were the only reply, in this session. A reply of "(no reply)" means she said nothing.`,
      ...rs.map((r, i) => `[R${i + 1}] ${r.says.length ? r.says.join(' / ') : '(no reply)'}`),
      '',
      'Label every item R1..Rn.',
    ].join('\n')
    const stream = anthropic.messages.stream({
      model: JUDGE_MODEL, max_tokens: 8000, output_config: { effort: 'medium' },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: block }, { type: 'text', text: ask }] }],
    })
    const msg = await stream.finalMessage()
    for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) usage[k] = (usage[k] || 0) + (msg.usage?.[k] || 0)
    const text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('')
    const labels = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1))
    out[cid] = rs.map((r, i) => ({ rep: r.rep, says: r.says, ...(labels.find((l) => String(l.id) === `R${i + 1}`) ?? {}) }))
    const off = out[cid].filter((l) => l.label === 'off').length
    const rep = out[cid].filter((l) => l.category === 'repetitive').length
    console.log(`${path.basename(dir)} ${cid}: off ${off}/${rs.length}, repetitive ${rep}`)
  }
  fs.writeFileSync(path.join(dir, 'judged.json'), JSON.stringify(out, null, 1))
}
const P = PRICES[JUDGE_MODEL]
const usd = ((usage.input_tokens || 0) * P.in + (usage.output_tokens || 0) * P.out + (usage.cache_creation_input_tokens || 0) * P.cw + (usage.cache_read_input_tokens || 0) * P.cr) / 1e6
console.log('usage', JSON.stringify(usage), `judge $${usd.toFixed(2)}`)
