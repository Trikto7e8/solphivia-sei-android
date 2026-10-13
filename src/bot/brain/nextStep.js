// 261008: the "next time" hook a companion can attach to its goodbye
// (retention fix 2(c), ~/suisei/reports/retention-2026-10-05.md).
//
// Every goodbye tool (game quit_game / end_call, chat-surface quit_game /
// end_call) takes an optional `next_time` field: a few words naming something
// real to pick up next session ("finish the roof"). The model writes its own
// goodbye around it; nothing here touches what it says. This module only
// turns the FIELD into the MEMORY.md line the next greeting reads back, and
// tells the host whether one was given (analytics counts the field, never the
// spoken text).
//
// Import-free on purpose: the bot (raw ESM) and main (bundled TS) both use it.

/** A stored note, not speech: bounded so one runaway field cannot bloat MEMORY.md. */
export const NEXT_STEP_MAX_CHARS = 200

/**
 * The tool's `next_time` input as a clean single line, or null when the model
 * left it out (missing, not a string, or only whitespace).
 */
export function normalizeNextStep(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.replace(/\s+/g, ' ').trim()
  if (!s) return null
  if (s.length <= NEXT_STEP_MAX_CHARS) return s
  const cut = s.slice(0, NEXT_STEP_MAX_CHARS)
  const space = cut.lastIndexOf(' ')
  return (space > NEXT_STEP_MAX_CHARS / 2 ? cut.slice(0, space) : cut).trim()
}

/**
 * The MEMORY.md entry for a saved hook. The prefix is what the greeting
 * prompts point at (promptLibrary NEXT_TIME_GREETING), so keep them in sync.
 */
export function nextStepMemoryLine(step) {
  return `Plan for next time: ${step}`
}

// 261014: the player-facing line for the Home "up next" strip.
//
// The plan above is the companion's private note ("ask Alex what the vet says
// about Pepper's leg on Thursday"): good for her memory and her greeting, wrong
// on the player's own screen. So the plan can carry a second line written TO
// the player ("Tell Roger what the vet said about Pepper"). It never goes into
// MEMORY.md (the model would read it as a second plan); main keeps it in the
// NEXT_STEP.json sidecar next to the plan's tag (src/main/homeNextStep.ts). A
// plan without one shows the note, as before.

/** About one clause. Longer lines are cut at a clause break when one fits. */
export const PLAYER_LINE_MAX_CHARS = 60
/** Past this the line is cut at a word and marked with an ellipsis. */
export const PLAYER_LINE_HARD_MAX_CHARS = 90

// Read on a later day, a relative day goes stale ("raid the village tomorrow"
// shown the next evening). "tomorrow"/"tonight" are dropped wherever they
// stand (adverbs, so the rest still reads); the softer ones only at the end
// or the start, where removing them cannot break the clause.
const RELATIVE_ANYWHERE = /(?:\s*,)?\s*\b(?:(?:by|for|until|on)\s+)?(?:tomorrow|tonight|tmrw?)\b(?:\s+(?:morning|night|evening))?/gi
const RELATIVE_EDGE_END = /(?:\s*,)?\s+(?:(?:later\s+)?today|later|next time|this (?:morning|afternoon|evening|weekend))\s*$/i
const RELATIVE_EDGE_START = /^(?:next time|later|today|this (?:morning|afternoon|evening|weekend))\s*[,:]?\s+/i

/**
 * Cut at the first clause break ("; ", ", then ", " - ") that leaves a
 * readable head. A plain comma is not a break: it is usually a list
 * ("blaze powder, pufferfish and a brewing stand").
 */
function firstClause(s) {
  const m = /(?:\s*;\s+|,?\s+(?:and then|then)\s+|\s+[-–—]\s+)/.exec(s.slice(12))
  return m ? s.slice(0, 12 + m.index).replace(/[\s,]+$/, '').trim() : s
}

/**
 * The model's player-facing line as strip text, or null when it gave none.
 * One line, no wrapping quotes, no trailing period, no relative day, first
 * letter up, about PLAYER_LINE_MAX_CHARS long.
 */
export function normalizePlayerLine(raw) {
  if (typeof raw !== 'string') return null
  let s = raw.replace(/\s+/g, ' ').trim()
  s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim()
  s = s
    .replace(RELATIVE_ANYWHERE, '')
    .replace(RELATIVE_EDGE_END, '')
    .replace(RELATIVE_EDGE_START, '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/[\s,;:.。-]+$/, '')
    .replace(/^[\s,;:-]+/, '')
    .trim()
  if (!s) return null
  if (s.length > PLAYER_LINE_MAX_CHARS) s = firstClause(s)
  if (s.length > PLAYER_LINE_HARD_MAX_CHARS) {
    const cut = s.slice(0, PLAYER_LINE_HARD_MAX_CHARS)
    const space = cut.lastIndexOf(' ')
    s = (space > PLAYER_LINE_HARD_MAX_CHARS / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:-]+$/, '').replace(/\s+(?:and|or|with|to|the|a|an|of|for)$/i, '').trim() + '…'
  }
  if (/^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1)
  return s || null
}
