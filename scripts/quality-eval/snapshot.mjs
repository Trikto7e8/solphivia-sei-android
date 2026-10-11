// scripts/quality-eval/snapshot.mjs: pull a compact ground-truth slice out of
// one `[haiku?]` prompt dump (src/bot/brain/log.js): the bot's own snapshot of
// hp, held item, inventory, time, nearby blocks and entities. The judge uses
// it to check what the companion claims.
import fs from 'node:fs'

export function parseSnapshot(s) {
  const i0 = s.indexOf('snapshot:')
  if (i0 < 0) return null
  const body = s.slice(i0)
  const pick = (re) => (re.exec(body)?.[1] ?? '').trim()
  const list = (header, n) => {
    const i = body.indexOf(header)
    if (i < 0) return []
    const out = []
    for (const ln of body.slice(i + header.length).split('\n').slice(1)) {
      const m = /^\s+#\d+ (.*)$/.exec(ln)
      if (!m) break
      out.push(m[1].trim())
      if (out.length >= n) break
    }
    return out
  }
  const snap = {
    pos: pick(/\bpos: ([^\n]+)/),
    time: pick(/\btime: ([^\n]+)/),
    hp: pick(/\n\s+hp: ([^\n]+)/),
    holding: pick(/\n\s+holding: ([^\n]+)/),
    inventory: pick(/\n\s+inventory \(([^\n]+)/),
    blocks: list('nearby blocks:', 10),
    entities: list('nearby entities:', 8),
  }
  return snap.pos || snap.hp ? snap : null
}

// Rate limit: emit when the view changed, at most every 20s, and at least
// once a minute.
export function makeSnapshotGate() {
  let last = { t: 0, key: '' }
  return (t, snap) => {
    const key = JSON.stringify({ ...snap, pos: undefined })
    if (last.key && t - last.t < 20000) return false
    if (key === last.key && t - last.t < 60000) return false
    last = { t, key }
    return true
  }
}

// Backfill for sessions whose events have no snapshots: read them from the
// raw bot log. Block timestamps are UTC HH:MM:SS.mmm; anchor them on the day
// of `refEpoch` (and the neighbouring days, picking the closest).
export function snapshotsFromRawLog(rawPath, refEpoch) {
  if (!fs.existsSync(rawPath)) return []
  const raw = fs.readFileSync(rawPath, 'utf8')
  const out = []
  const gate = makeSnapshotGate()
  const day = new Date(refEpoch); day.setUTCHours(0, 0, 0, 0)
  const re = /^\[(\d\d):(\d\d):(\d\d)\.(\d{3})\] \[haiku\?\] begin$/gm
  let m
  while ((m = re.exec(raw))) {
    const end = raw.indexOf('[haiku?] end', m.index)
    const block = raw.slice(m.index, end < 0 ? undefined : end)
    const ms = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4]
    let t = day.getTime() + ms
    for (const d of [-86400000, 86400000]) if (Math.abs(t + d - refEpoch) < Math.abs(t - refEpoch)) t += d
    const snap = parseSnapshot(block)
    if (snap && gate(t, snap)) out.push({ t, kind: 'snapshot', ...snap })
  }
  return out
}
