/**
 * Session events: what actually happened in the game this session, written
 * as short factual lines for the conversation transcript (convoMemory).
 *
 * 261014 (quality pass 7b). Asked "what was i scared of earlier?", the
 * companion answered "the zombie specifically, you hid behind me like i was a
 * wall", then built "you hide behind me when scared" into her next answer.
 * The player never hid. Measured over 50 recall turns of the night_social
 * scripted convo: the player's own line ("its getting dark im kinda scared of
 * mobs") was in her prompt in 49, so nothing had been dropped. What the
 * prompt did NOT hold was anything that happened in the world: each player
 * line opens a fresh loop whose history is only its seed, so the
 * attackEntity result ("killed zombie (4 hits)") was in 5 of the 50. The only
 * trace of the fight was her own lines ("coming at it now, stay behind me"),
 * and she filled in what the player did from them. In the 68 night_social
 * runs on record, 15 of the 136 recall answers credited the player with
 * something they never did or said ("hid behind me", "you said creepers").
 *
 * So the transcript now carries the events too, as "game:" lines in time
 * order, kept apart from both speakers: what she did (a finished action and
 * its result), what hit her or the player, and her deaths. Nothing she says
 * is filtered; she just has the record to answer from. Pure; no I/O.
 */

import { classifyActionOutcome } from './actionStats.js'

/** Events kept per session (oldest dropped first). Each renders as one line. */
export const SESSION_EVENT_CAPACITY = 12
const EVENT_TEXT_MAX = 140
/** Repeated hits from the same attacker within this window are one line. */
export const HIT_COALESCE_MS = 30_000

// Actions that only look, move, or get ready are not events worth recalling
// ("you used goTo"), and in a busy session they would push out the ones that
// are. The finished result of everything else is recorded.
const QUIET_ACTIONS = new Set([
  'look', 'find', 'explore', 'readSign', 'equip', 'goTo', 'follow', 'unfollow',
  'setPvp', 'openContainer', 'openFurnace', 'stop', 'visualize',
])

function clip(s, n = EVENT_TEXT_MAX) {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim()
  // A result's first clause is the fact; what follows a ';' is advice for the
  // next step ("it is in your inventory, not placed yet (placeBlock ...)").
  const semi = t.indexOf(';')
  if (semi > 0) t = t.slice(0, semi).trim()
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

function resultText(result) {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    if (typeof result.text === 'string') return result.text
    if (typeof result.reason === 'string') return result.reason
  }
  return ''
}

/**
 * The event line for one finished world action, or null when it is not worth
 * keeping: a quiet action (looking, walking, equipping), a failure that
 * changed nothing, or an abort before anything was done. A partial result or
 * an abort with progress ("aborted after 1/10 oak_log") is kept: it is what
 * actually happened.
 *
 * @param {string} name   tool name
 * @param {unknown} result  the action's return value
 * @returns {string|null}
 */
export function describeActionEvent(name, result) {
  if (!name || QUIET_ACTIONS.has(name)) return null
  const text = clip(resultText(result))
  if (!text) return null
  const reason = classifyActionOutcome({ result })
  const kept = reason === null || reason === 'partial' ||
    (reason === 'aborted_by_preempt' && /\b[1-9]\d*\/\d+\b/.test(text))
  if (!kept) return null
  return `you used ${name}: ${text}`
}

function mobName(label) {
  const s = String(label ?? '').replace(/_/g, ' ').trim()
  if (!s || s === 'unknown' || s === 'a mob' || s === 'something') return 'a mob'
  return /^(a|an|the)\s/i.test(s) ? s : `a ${s}`
}

/**
 * The event line for an attack the brain was told about (the onAttacked
 * route), or null for the kinds that are not a hit: a reflex warning or a
 * survival heads-up.
 *
 * @param {object} evt  { attackerKind, attackerLabel, ownerLabel, threat, engaged }
 * @returns {{text:string, key:string}|null}
 */
export function describeAttackEvent(evt) {
  if (!evt || typeof evt !== 'object') return null
  const kind = evt.attackerKind ?? 'mob'
  const label = evt.attackerLabel ?? null
  if (kind === 'player') {
    const who = String(label ?? '').trim() || 'a player'
    return { text: `${who} hit you`, key: `hit:${who}` }
  }
  if (kind === 'defend') {
    const owner = String(evt.ownerLabel ?? '').trim() || 'the player'
    const mob = mobName(label)
    if (evt.threat === true) return { text: `${mob} came at ${owner}`, key: `owner:${mob}` }
    return { text: `${mob} attacked ${owner}`, key: `owner:${mob}` }
  }
  if (kind === 'hostile_mob' || kind === 'mob' || kind === 'other') {
    const mob = mobName(label)
    return { text: `${mob} hit you`, key: `hit:${mob}` }
  }
  return null
}

/**
 * @param {object} evt  sei:death payload ({ lastAttack? })
 * @returns {string}
 */
export function describeDeathEvent(evt) {
  const la = evt?.lastAttack
  if (la && la.label) {
    const by = la.kind === 'player' ? String(la.label) : mobName(la.label)
    return `you died (last hit by ${by})`
  }
  return 'you died'
}

/**
 * Ring of event lines. `key` + `windowMs` fold a repeat into the entry
 * before it ("a zombie hit you (3 times)") instead of filling the ring.
 */
export function createSessionEventLog({ capacity = SESSION_EVENT_CAPACITY, now = () => Date.now() } = {}) {
  /** @type {Array<{at:number, lastAt:number, text:string, key:string|null, n:number}>} */
  const entries = []

  function record(text, { key = null, windowMs = 0 } = {}) {
    const t = clip(text)
    if (!t) return false
    const at = now()
    if (key && windowMs > 0) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]
        if (e.key !== key) continue
        if (at - e.lastAt <= windowMs) {
          e.n += 1
          e.lastAt = at
          return true
        }
        break
      }
    }
    entries.push({ at, lastAt: at, text: t, key, n: 1 })
    while (entries.length > capacity) entries.shift()
    return true
  }

  /** Oldest first: [{at, text}] with repeat counts folded into the text. */
  function list() {
    return entries.map((e) => ({ at: e.at, text: e.n > 1 ? `${e.text} (${e.n} times)` : e.text }))
  }

  return { record, list, get size() { return entries.length }, _internal: { entries } }
}
