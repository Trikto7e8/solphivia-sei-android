// scripts/quality-eval/companion.mjs: runs the REAL Sei companion bot
// (src/bot/index.js, same code path as the app) against the eval server.
//
// Run under Electron-as-node so the render natives match their ABI:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/quality-eval/companion.mjs
//
// The app forks the bot as an Electron utilityProcess and hands it a
// MessagePort carrying {type:'init', ...}. Here a fake parentPort + port stand
// in for the supervisor, so the bot boots exactly as it does in the app.
//
// Env:
//   QE_KEY_FILE     Anthropic key file (default ~/.sei-dev/anthropic-test-key)
//   QE_CHARACTER    character row JSON (id, name, username, persona_expanded, metadata)
//   QE_PORT         server port (25590)
//   QE_PLAYER       the human player's MC username
//   QE_USERDATA     fresh userData dir for this session (memory lands here)
//   QE_RAW_LOG      raw bot log file (every console line)
//   QE_EVENTS       structured JSONL events file
//
// Structured events are also written to stdout as `@@QE <json>` lines so the
// orchestrator sees them live. SIGTERM / SIGINT sends the bot {type:'stop'},
// which flushes its final action-stats snapshot and exits.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseSnapshot, makeSnapshotGate } from './snapshot.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')

const keyFile = process.env.QE_KEY_FILE || path.join(os.homedir(), '.sei-dev', 'anthropic-test-key')
const apiKey = fs.readFileSync(keyFile, 'utf8').trim()
if (!apiKey) { console.error('[qe-companion] empty key file'); process.exit(2) }

const charFile = process.env.QE_CHARACTER
if (!charFile) { console.error('[qe-companion] QE_CHARACTER is required'); process.exit(2) }
let row = JSON.parse(fs.readFileSync(charFile, 'utf8'))
if (Array.isArray(row)) row = row[0]
const character = {
  id: row.id,
  name: row.name,
  username: row.username,
  persona: { source: row.persona_source ?? '', expanded: row.persona_expanded ?? row.persona?.expanded ?? '' },
  metadata: row.metadata ?? {},
}

const port = Number(process.env.QE_PORT || 25590)
const player = process.env.QE_PLAYER || 'Alex'
const userDataDir = process.env.QE_USERDATA || fs.mkdtempSync(path.join(os.tmpdir(), 'qe-userdata-'))
// The app's characterStore creates memory/<id> when the character is saved;
// the bot assumes it exists.
fs.mkdirSync(path.join(userDataDir, 'memory', character.id), { recursive: true })

const rawLog = process.env.QE_RAW_LOG ? fs.createWriteStream(process.env.QE_RAW_LOG, { flags: 'a' }) : null
const eventsOut = process.env.QE_EVENTS ? fs.createWriteStream(process.env.QE_EVENTS, { flags: 'a' }) : null

function emit(ev) {
  const line = JSON.stringify({ t: Date.now(), ...ev })
  eventsOut?.write(line + '\n')
  try { process.stdout.write('@@QE ' + line + '\n') } catch {}
}

// ── log tap ─────────────────────────────────────────────────────────────
// Every bot log event is ONE console.log call (src/bot/brain/log.js
// emitBlock): "[ts] [tag] begin\n  label: body...\n[ts] [tag] end". Parse the
// tags the eval needs into structured events; keep everything in the raw log.
const WANT = new Set(['[chat->]', '[chat<-]', '[haiku!]', '[haiku✗]', '[act!]'])

function parseBlock(s) {
  const lines = s.split('\n')
  const m = /^\[[\d:.]+\] (\[[^\]]+\]) begin$/.exec(lines[0] || '')
  if (!m || !WANT.has(m[1])) return null
  const fields = {}
  let cur = null
  for (const ln of lines.slice(1, -1)) {
    const fm = /^ {2}([a-z_]+): ?(.*)$/.exec(ln)
    if (fm) { cur = fm[1]; fields[cur] = fm[2]; continue }
    if (cur) fields[cur] += (fields[cur] ? '\n' : '') + ln.replace(/^ {4}/, '')
  }
  return { tag: m[1], fields }
}

function parseCalls(body) {
  if (!body || body === '(none)') return []
  const out = []
  for (const ln of body.split('\n')) {
    const m = /^([A-Za-z_][\w]*)\((.*)\)$/s.exec(ln.trim())
    if (!m) continue
    let input = null
    try { input = JSON.parse(m[2]) } catch { input = m[2] }
    out.push({ name: m[1], input })
  }
  return out
}

// Ground truth for the judge: a compact slice of the bot's own snapshot at
// each LLM turn (snapshot.mjs), rate limited.
const snapGate = makeSnapshotGate()
function grabSnapshot(s) {
  const snap = parseSnapshot(s)
  if (snap && snapGate(Date.now(), snap)) emit({ kind: 'snapshot', ...snap })
}

function onLogString(s) {
  rawLog?.write(s + '\n')
  if (!s.includes('] begin')) return
  if (s.includes('[haiku?] begin')) { try { grabSnapshot(s) } catch {} return }
  const b = parseBlock(s)
  if (!b) return
  const f = b.fields
  switch (b.tag) {
    case '[chat->]': emit({ kind: 'chat_out', text: f.text ?? '' }); break
    case '[chat<-]': emit({ kind: 'chat_in', from: f.from ?? f.username ?? '', text: f.text ?? f.message ?? '' }); break
    case '[haiku!]': {
      let usage = null
      try { usage = JSON.parse(f.usage) } catch {}
      emit({
        kind: 'llm_turn',
        stop: f.stop ?? '',
        elapsed_ms: f.elapsed ? parseInt(f.elapsed, 10) : null,
        scratchpad: f.text === '(empty)' ? '' : (f.text ?? ''),
        calls: parseCalls(f.calls),
        usage,
      })
      break
    }
    case '[haiku✗]': emit({ kind: 'llm_error', error: f.error ?? '' }); break
    case '[act!]': emit({ kind: 'action_result', action: f.action ?? '', result: f.result ?? '' }); break
  }
}

for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = console[level].bind(console)
  console[level] = (...args) => {
    let s
    try { s = args.map(a => (typeof a === 'string' ? a : (a instanceof Error ? a.stack : JSON.stringify(a)))).join(' ') } catch { s = String(args[0]) }
    try { onLogString(s) } catch {}
    if (process.env.QE_ECHO === '1') orig(...args)
  }
}

// ── fake supervisor ─────────────────────────────────────────────────────
class FakePort extends EventEmitter {
  start() {}
  close() {}
  // bot -> main
  postMessage(data) {
    if (!data || typeof data !== 'object') return
    switch (data.type) {
      case 'action': emit({ kind: 'action_call', name: data.name, args: data.args ?? null }); break
      case 'action-stats': emit({ kind: 'action_stats', stats: data.stats }); break
      case 'boot-timing': case 'dashboard': case 'request-jwt': case 'vision-capability': break
      default: emit({ kind: 'lifecycle', data })
    }
  }
  // main -> bot
  send(data) { this.emit('message', { data }) }
}

const botPort = new FakePort()
const parentPort = new EventEmitter()
process.parentPort = parentPort

let stopping = false
function requestStop(sig) {
  if (stopping) { process.exit(0); return }
  stopping = true
  emit({ kind: 'stop_requested', signal: sig })
  botPort.send({ type: 'stop' })
  // gracefulShutdown exits on its own; this is the backstop.
  setTimeout(() => { rawLog?.end(); eventsOut?.end(); process.exit(0) }, 8000).unref()
}
process.on('SIGTERM', () => requestStop('SIGTERM'))
process.on('SIGINT', () => requestStop('SIGINT'))
// Orchestrator may also send a line on stdin: {"type":"game-mode",...} etc.
process.stdin.setEncoding('utf8')
let stdinBuf = ''
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk
  let i
  while ((i = stdinBuf.indexOf('\n')) >= 0) {
    const ln = stdinBuf.slice(0, i).trim(); stdinBuf = stdinBuf.slice(i + 1)
    if (!ln) continue
    try {
      const msg = JSON.parse(ln)
      if (msg.type === 'stop') requestStop('stdin'); else botPort.send(msg)
    } catch {}
  }
})
process.stdin.on('error', () => {})

emit({ kind: 'companion_boot', character: character.name, username: character.username, model: 'claude-haiku-5-5', userDataDir })

await import(pathToFileURL(path.join(repo, 'src', 'bot', 'index.js')).href)

// Same field set the supervisor ships (src/main/botSupervisor.ts, type:'init'),
// BYOK path with the dev test key. App defaults: vision on-demand, realistic
// typing on, English.
parentPort.emit('message', {
  data: {
    type: 'init',
    character,
    apiKey,
    game: 'minecraft',
    joinTarget: { port, motd: 'Sei Quality Eval', mc_username: player, skinServerBaseUrl: null },
    worldLabel: 'Sei Quality Eval',
    userDataDir,
    mc_username: player,
    preferred_name: player,
    visionMode: 'on-demand',
    realisticTyping: true,
    chatLanguage: 'en',
    companions: [],
    continuity: null,
    knowledge: '',
    readyBudgetMs: 120000,
  },
  ports: [botPort],
})
