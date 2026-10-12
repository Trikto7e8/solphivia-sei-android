/**
 * 261012: words and short phrases the companion keeps putting in its OWN
 * recent lines, so the next turn can be told about them.
 *
 * Why this exists: a persona whose sample lines carry a verbal tic (a sound at
 * the end of a line, a pet name for the player, a favorite topic) gets that tic
 * in nearly every line. Measured in the persona eval (Haiku 5.5): Lyra's card
 * has "nya" in three example lines and she said it in 40 of 40 lines, Roger
 * said "big brother" in 38 of 44. Over a session that reads as a parody.
 * General guidance in the prompt ("use it now and then") did not move it, and
 * neither did "your last line already used your catchphrase" at the tail. What
 * did move it was naming the actual word: 100% -> 39% on Lyra. So this module
 * finds the word from her own lines, the same move as backseat's
 * recentOpeners: data about what she said, never a fixed list of phrases.
 *
 * Nothing here touches what the model says. It only feeds a note into the
 * next turn's prompt; the model still decides.
 */

// A turn is the say() line of one model call. emitChatMessages splits it into
// several chat messages and records each with Date.now() in the same
// synchronous pass, so entries of one turn sit within a few ms of each other,
// while two turns are at least one model call (seconds) apart.
const TURN_GAP_MS = 250

// Function words and fillers that every voice repeats. Kept to grammar words
// on purpose: "lol" or "ok" opening every line is a habit worth naming too.
const STOP = new Set((
  'a an the and or but so to of in on at for with by from up down out off over into onto about as than then ' +
  'is are was were be been being am do does did done have has had having will would can could should shall may might must ' +
  "i i'm im i'll i've i'd me my mine you you're youre you'll you've your yours we we're us our it it's its " +
  "they they're them their he him his she her this that these those there here what who how why when where which " +
  "not no yes just too very really all some any more most much one two " +
  "let let's get got go going gonna if like oh um uh"
).split(/\s+/))

function tokensOf(text) {
  return String(text ?? '').toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean)
}

const isContent = (w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)

/** Single content words plus two-word phrases with at least one content word. */
function termsOf(text) {
  const t = tokensOf(text)
  const out = new Set()
  t.forEach((w, i) => {
    if (isContent(w)) out.add(w)
    const n = t[i + 1]
    if (n && (isContent(w) || isContent(n)) && w.length > 1 && n.length > 1) out.add(`${w} ${n}`)
  })
  return out
}

/** Group self lines ({at, text}, oldest first) into turns. */
export function groupTurns(selfLines, gapMs = TURN_GAP_MS) {
  const turns = []
  let last = null
  for (const l of selfLines ?? []) {
    if (!l?.text) continue
    if (last && Number.isFinite(l.at) && Number.isFinite(last.at) && l.at - last.at <= gapMs) {
      turns[turns.length - 1].text += ` ${l.text}`
    } else {
      turns.push({ at: l.at, text: String(l.text) })
    }
    last = l
  }
  return turns
}

/**
 * Terms the companion used in at least `minTurns` of its last `window` turns.
 * Terms the player also used in their recent lines are left out: a shared
 * topic ("the villager", "wood") is the conversation, not a habit.
 *
 * @param {Array<{at:number,text:string}>} selfLines   oldest first
 * @param {Array<{text:string}>} [playerLines]         oldest first
 * @returns {Array<{term:string, count:number, of:number}>} at most `max`, most repeated first
 */
export function repeatedOwnTerms(selfLines, playerLines = [], { window = 4, minTurns = 3, max = 2, playerWindow = 8 } = {}) {
  const turns = groupTurns(selfLines).slice(-window)
  if (turns.length < minTurns) return []
  const heard = new Set()
  for (const l of (playerLines ?? []).slice(-playerWindow)) for (const t of termsOf(l?.text)) heard.add(t)
  const counts = new Map()
  for (const turn of turns) for (const t of termsOf(turn.text)) counts.set(t, (counts.get(t) ?? 0) + 1)
  const hits = [...counts]
    .filter(([t, c]) => c >= minTurns && !heard.has(t))
    .map(([term, count]) => ({ term, count, of: turns.length }))
    // Most repeated first; among ties the phrase before the words inside it.
    .sort((a, b) => b.count - a.count || b.term.split(' ').length - a.term.split(' ').length)
  const out = []
  for (const h of hits) {
    // One term per habit: "big brother" covers "brother" when they tie, and
    // "nya" covers "alex nya" when the word alone is the more repeated one.
    const within = (a, b) => ` ${b} `.includes(` ${a} `)
    if (out.some((o) => o.count >= h.count && (within(h.term, o.term) || within(o.term, h.term)))) continue
    out.push(h)
    if (out.length >= max) break
  }
  return out
}

/** The prompt note for the next turn, or null when nothing repeats. */
export function ownRepeatsNote(selfLines, playerLines = [], opts) {
  const hits = repeatedOwnTerms(selfLines, playerLines, opts)
  if (!hits.length) return null
  const quoted = hits.map((h) => `"${h.term}"`).join(' and ')
  const n = hits[0].of
  return `Your own recent lines keep using ${quoted} (in ${hits[0].count} of your last ${n}). ` +
    'A signature word or catchphrase wears thin when it is in every line, so leave it out of this one unless the moment really calls for it. ' +
    'You still sound like yourself without it.'
}
