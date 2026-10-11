/**
 * Short-term conversation memory — player-said / self-said ring buffers.
 *
 * Two split sub-buffers, capacity 40 each, 240-char per-line truncation.
 * They are STORED split (the say() gates ask "what did I last say" and "has
 * the player spoken since" separately) and, since 260921, RENDERED as one
 * chronological exchange (formatConversationBlock). The two-list rendering
 * (formatPlayerBlock / formatSelfBlock, kept for callers that want one side)
 * hid the ORDER, and the order is the information: measured on a Stardew
 * session, the player asked a question, the companion's next line was about
 * something else, and when told "answer my question" she asked "what
 * question" twice, with the question sitting in her prompt the whole time.
 * In two lists a question with no answer looks the same as an answered one.
 * Own lines stay marked "you:" and the header says they are not new input,
 * which is what the split was protecting.
 *
 * Cross-loop continuity / long-term memory lives in MEMORY.md (written via
 * the remember() tool, read in the seed turn each loop). This module is
 * intra-session only.
 */

import { SEED_HEADERS } from './prompts.js'

const RECENT_CHAT_CAPACITY = 40
const RECENT_CHAT_LINE_TRUNC = 240
// 261012: the merged transcript shows the newest CONVERSATION_TURNS turns of
// the combined exchange, where a player message is one turn and a run of her
// lines with nothing from them in between is one turn. Each ring used to
// hold 10 and both were rendered in full, but her lines are stored per
// sentence (a turn is 2-4 entries) and the player's per message, so her 10
// covered the last three or four turns while the player's 10 reached back a
// minute or more. The transcript then showed a run of older player lines
// with none of her answers between them (questions that read as unanswered)
// and dropped the lines she was about to repeat ("still getting you that
// cobble", said four times in the scripted-convo eval). Counting turns keeps
// both sides over the same stretch of time, and 24 reaches about twelve
// player lines back ("what was i scared of earlier?" asked ten lines on).
const CONVERSATION_TURNS = 24

/** The newest `turns` turns of a merged, oldest-first transcript. */
export function lastTurns(merged, turns = CONVERSATION_TURNS) {
  let n = 0
  let i = merged.length
  while (i > 0) {
    const l = merged[i - 1]
    const startsTurn = !l.self || !(merged[i]?.self)
    if (startsTurn) {
      if (n === turns) break
      n += 1
    }
    i -= 1
  }
  return merged.slice(i)
}

function pushRing(arr, item, cap) {
  arr.push(item)
  while (arr.length > cap) arr.shift()
}

// 260925: a player line is labelled by ROLE first and name second. The
// player's name is whatever they typed as their preferred name, and on the
// v0.6.5-beta.2 playtest it was "Sei": the app's name, which the companion's
// own persona is built around. The transcript read "Sei: hey sui, ask me a
// question..." and, 20 s after asking that question herself, she answered it
// herself, her scratchpad attributing her own line to "them". A role tag no
// name can collide with ("player (Sei)") keeps who spoke unambiguous.
const GENERIC_PLAYER_NAMES = new Set(['', '?', 'player', 'the player', 'someone'])

/** "player (name)", or bare "player" when there is no real name. */
export function playerLabel(who) {
  const name = String(who ?? '').trim()
  return GENERIC_PLAYER_NAMES.has(name.toLowerCase()) ? 'player' : `player (${name})`
}

function speakerLabel({ who, companion }) {
  return companion ? String(who || '?') : playerLabel(who)
}

function fmtAgo(now, at) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return `${h}h ago`
}

/**
 * @param {{ onLine?: (who: 'player'|'you'|'other', text: string) => void }} [opts]
 *   onLine (261011): every recorded line is also handed here, for the
 *   session digest main reads after a player-ended session (sessionDigest.js).
 */
export function createConvoMemory({ onLine = null } = {}) {
  const playerLines = []
  const selfLines = []
  const tap = (who, text) => {
    if (typeof onLine !== 'function') return
    try { onLine(who, text) } catch {}
  }

  /**
   * @param {string} who
   * @param {string} text
   * @param {{ companion?: boolean }} [opts]  companion: a sibling AI's line
   *   (labelled with its own name); anything else is the human player's.
   */
  function pushPlayer(who, text, opts = {}) {
    if (!text) return
    const line = String(text).trim()
    if (!line) return
    pushRing(playerLines, {
      at: Date.now(),
      who: String(who || '?'),
      companion: opts?.companion === true,
      text: line.slice(0, RECENT_CHAT_LINE_TRUNC),
    }, RECENT_CHAT_CAPACITY)
    tap(opts?.companion === true ? 'other' : 'player', line)
  }

  // Called when the line is DECIDED, not when the paced chat send fires: with
  // realistic typing a line reaches the socket 1-6s after the turn that wrote
  // it, and a turn composed inside that gap did not know the line existed
  // (260921: a question answered twice, two different answers, 8s apart).
  function pushSelf(who, text) {
    if (!text) return
    const line = String(text).trim()
    if (!line) return
    pushRing(selfLines, { at: Date.now(), who: String(who), text: line.slice(0, RECENT_CHAT_LINE_TRUNC) }, RECENT_CHAT_CAPACITY)
    tap('you', line)
  }

  function formatPlayerBlock() {
    if (playerLines.length === 0) return null
    const now = Date.now()
    const body = playerLines.map((l) => `[${fmtAgo(now, l.at)}] ${speakerLabel(l)}: ${l.text}`).join('\n')
    return `${SEED_HEADERS.playerRecent}\n${body}`
  }

  function formatSelfBlock() {
    if (selfLines.length === 0) return null
    const now = Date.now()
    const body = selfLines.map(({ at, text }) => `[${fmtAgo(now, at)}] you: ${text}`).join('\n')
    return `${SEED_HEADERS.selfRecent}\n${body}`
  }

  /** Both sides as ONE exchange, oldest first. null when nobody has spoken. */
  function formatConversationBlock() {
    if (playerLines.length === 0 && selfLines.length === 0) return null
    const now = Date.now()
    // Stable merge: equal timestamps keep the player's line first, since a
    // reply recorded in the same millisecond still came after what it answers.
    const merged = [
      ...playerLines.map((l, i) => ({ ...l, self: false, i })),
      ...selfLines.map((l, i) => ({ ...l, self: true, i })),
    ].sort((a, b) => (a.at - b.at) || (Number(a.self) - Number(b.self)) || (a.i - b.i))
    const body = lastTurns(merged)
      .map((l) => `[${fmtAgo(now, l.at)}] ${l.self ? 'you' : speakerLabel(l)}: ${l.text}`)
      .join('\n')
    return `${SEED_HEADERS.conversation}\n${body}`
  }

  return {
    recentChat: {
      pushPlayer,
      pushSelf,
      formatPlayerBlock,
      formatSelfBlock,
      formatConversationBlock,
      lastSelf: () => selfLines.length > 0 ? selfLines[selfLines.length - 1] : null,
      // 260730: the pair of these two answers "has the player said anything
      // since I last spoke?", which is what separates a reply from talking to
      // yourself. See shouldSuppressIdleSay in orchestrator.js.
      lastPlayer: () => playerLines.length > 0 ? playerLines[playerLines.length - 1] : null,
      get playerSize() { return playerLines.length },
      get selfSize() { return selfLines.length },
      _internal: { playerLines, selfLines },
    },
  }
}
