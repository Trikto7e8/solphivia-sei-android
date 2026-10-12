// src/bot/brain/goalLink.js: link a free-text setGoal to the progression spine
// so JS can clear it when it is really finished (261012).
//
// The first version (260618) linked a goal to ONE node: the longest spine key
// found anywhere in the text, among the CURRENT FRONTIER only. Goals are
// written as a direction plus a finish condition ("Get from wood to iron with
// Alex. Finish when I hold an iron pickaxe"), and the only frontier node such
// a text names is its FIRST rung, so finishing that rung deleted the whole
// goal. Measured over the Minecraft eval transcripts: 124 of 125 auto-clears
// fired before the goal's own finish condition, and the bot re-set the goal a
// turn later, over and over.
//
// Now a goal links to EVERY spine node its finish condition names (the text
// after "finish when", "done when", "until", ...), or, when there is no
// recognizable finish clause, every node the whole text names. It is cleared
// only once ALL of them are done. Nodes that are already done when the goal is
// set are dropped, and a goal whose named nodes are all done already is not
// linked at all (it would otherwise be deleted on the very next turn). A
// finish clause that names no spine node ("finish when the hut has a roof")
// means no link: the model clears that goal itself.
//
// Matching is whole-word ("wood" does not match "wooden"), case-insensitive.

const FINISH_CUE = /\b(?:finish(?:ed)?|done|complete(?:d)?|success)\s*(?:when|once|if|after|:|=)|\buntil\b/i

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The finish clause of a goal text, or null when it has none. */
export function finishClause(text) {
  const t = String(text ?? '')
  const m = FINISH_CUE.exec(t)
  if (!m) return null
  const rest = t.slice(m.index + m[0].length).trim()
  return rest || null
}

/** Spine nodes whose key appears as a whole word in `text`, in spine order. */
export function nodesNamedIn(text, spine) {
  const t = String(text ?? '')
  if (!t) return []
  const out = []
  for (const n of spine ?? []) {
    const k = String(n?.key ?? '').trim()
    if (!k) continue
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(k)}(?=$|[^a-z0-9])`, 'i').test(t)) out.push(n)
  }
  return out
}

/**
 * Link a goal text to the spine nodes it is finished by.
 *
 * @param {string} text  the setGoal text
 * @param {{ spine?: object[], frontier?: object[], done?: Set<string> }} prog
 *        an adapter.getProgression() result; `spine` is the full node list
 *        (falls back to the frontier for an adapter that does not expose it)
 * @returns {{ ids: string[], primary: object }|null} the unfinished nodes that
 *          must all be done for the goal to count as finished, plus the
 *          deepest of them (its label and procedure feed the progress note)
 */
export function linkGoalToSpine(text, prog) {
  const spine = Array.isArray(prog?.spine) && prog.spine.length ? prog.spine : (prog?.frontier ?? [])
  if (!spine.length) return null
  const clause = finishClause(text)
  const named = nodesNamedIn(clause ?? text, spine)
  const done = prog?.done instanceof Set ? prog.done : new Set()
  const open = named.filter((n) => !done.has(n.id))
  if (!open.length) return null
  return { ids: open.map((n) => n.id), primary: open[open.length - 1] }
}

/** True once every linked node is done. */
export function linkFinished(link, prog) {
  const done = prog?.done
  if (!link?.ids?.length || !(done instanceof Set)) return false
  return link.ids.every((id) => done.has(id))
}
