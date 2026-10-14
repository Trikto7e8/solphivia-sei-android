/**
 * In-flight action tracker.
 *
 * Snapshot of "what is the bot doing right now" — populated when an action
 * starts, cleared when it ends. composeSnapshot renders an `in_flight:` line
 * so the LLM knows not to fire duplicate or competing actions.
 *
 * Single-flight is enforced inside individual action handlers (e.g. dig's
 * `bot.targetDigBlock` guard). This tracker only captures the most recent
 * action so the snapshot reflects ground truth.
 */

let _nextId = 1

export function createInflightTracker() {
  /** @type {{ id:number, name:string, args:any, startedAt:number, progress:any } | null} */
  let entry = null
  // 261014: the last few finished actions, so the snapshot can tell her own
  // haul (a gather's logs, a craft's output) apart from a gift. An action that
  // starts and ends between two snapshots never shows up in current().
  /** @type {Array<{ name:string, args:any, startedAt:number, endedAt:number, progress:any }>} */
  const history = []
  const HISTORY_CAP = 8

  function start({ name, args }) {
    const handle = { id: _nextId++, name, args, startedAt: Date.now(), progress: null }
    entry = handle
    return handle
  }

  function end(handle) {
    if (!handle) return
    if (!history.some(h => h.id === handle.id)) {
      history.push({ id: handle.id, name: handle.name, args: handle.args, startedAt: handle.startedAt, endedAt: Date.now(), progress: handle.progress })
      if (history.length > HISTORY_CAP) history.shift()
    }
    if (entry && entry.id === handle.id) entry = null
  }

  // Finished actions (newest last) plus the running one, if any. Running
  // entries carry endedAt null.
  function recent() {
    const out = history.map(h => ({ ...h }))
    if (entry) out.push({ id: entry.id, name: entry.name, args: entry.args, startedAt: entry.startedAt, endedAt: null, progress: entry.progress })
    return out
  }

  function current() {
    return entry
  }

  // Cuboid actions push progress ticks via this
  // setter so the next snapshot's `in_flight:` line includes a `placed/total`
  // (or `dug/total`) suffix. Stale handles (different id) are ignored to
  // avoid late ticks from a previous action overwriting fresh state.
  function updateProgress(handle, progress) {
    if (entry && handle && entry.id === handle.id) {
      entry.progress = progress
    }
  }

  return { start, end, current, updateProgress, recent }
}

/**
 * Compact human-readable arg blurb for the in_flight: snapshot line.
 * Picks the most identifying fields and truncates the rest so a long
 * arg blob doesn't blow context.
 */
export function describeArgs(name, args) {
  if (!args || typeof args !== 'object') return ''
  const parts = []
  if (typeof args.block === 'string') parts.push(args.block)
  else if (typeof args.target === 'string') parts.push(args.target)
  else if (typeof args.item === 'string') parts.push(args.item)
  else if (typeof args.entity === 'string') parts.push(args.entity)
  // gather({name}) rendered as a bare "gather()" in the in_flight line.
  else if (typeof args.name === 'string') parts.push(args.name)

  if (typeof args.x === 'number' && typeof args.y === 'number' && typeof args.z === 'number') {
    parts.push(`@${args.x},${args.y},${args.z}`)
  }
  return parts.join(' ').slice(0, 64)
}

/**
 * 260513-wkd: render the snapshot's `in_flight:` line from a tracker entry.
 *
 * Format: `in_flight: <name>(<argblurb>) started=<X.X>s ago[ — <completed>/<total>[, y=<currentY>]]`
 *
 * Preserves the em-dash separator AND the `y=<currentY>` channel
 * exactly as snapshot.js rendered them; the ONLY visible delta vs the prior
 * `(Xs)` trailer is the new `started=Xs ago` form (locked in CONTEXT.md
 * "Snapshot mid-flight enrichment").
 *
 * When `entry.progress` carries either `placed/total` (cuboid build) or
 * `dug/total` (cuboid dig + gather, both via the same onProgress channel),
 * a suffix is appended. `y=<currentY>` is preserved when present on the
 * progress payload (cuboid build/dig emit it; gather does not).
 *
 * 261014: a gather that reports its drop items (`items` + `before`) is
 * rendered from the CURRENT inventory when the caller passes it: how many it
 * has picked up, how many are left, and what she holds now. The progress tick
 * itself lags one pickup behind, and she quoted the requested number ("already
 * at 6") or the stale tick instead of what she held.
 *
 * @param {{ id:number, name:string, args:any, startedAt:number, progress:any } | null} entry
 * @param {number} [now=Date.now()] — injected for deterministic tests.
 * @param {{ inventory?: Record<string, number> | null }} [opts] — the item
 *   counts the same snapshot shows on its inventory line.
 * @returns {string} empty string when entry is null/undefined; otherwise the
 *   formatted line.
 */
export function getInFlightLineForSnapshot(entry, now = Date.now(), opts = {}) {
  if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') return ''
  const elapsed = Math.max(0, (now - (entry.startedAt ?? now)) / 1000).toFixed(1)
  const argblurb = describeArgs(entry.name, entry.args)
  let suffix = ''
  const p = entry.progress
  const gatherLine = p ? heldGatherSuffix(p, opts?.inventory) : null
  if (gatherLine) {
    suffix = gatherLine
  } else if (p && typeof p.total === 'number') {
    const completed = (typeof p.placed === 'number') ? p.placed
                    : (typeof p.dug === 'number') ? p.dug
                    : null
    if (completed != null) {
      const yPart = (typeof p.currentY === 'number') ? `, y=${p.currentY}` : ''
      // 261012: a dug count is blocks broken, not items held. Drops can still
      // be on the ground, and in the scripted-convo eval she told the player
      // "6 logs done" off a 5/6 here while her inventory held 4.
      // 261012 (pass 4a): "1/6 dug" was read as "the 6th log" in a later
      // line, so the progress is spelled out.
      suffix = (typeof p.placed !== 'number' && typeof p.dug === 'number')
        ? ` — broke ${completed} of the ${p.total} blocks asked for so far (what you hold is on your inventory line)${yPart}`
        : ` — placed ${completed} of ${p.total} so far${yPart}`
    }
  }
  return `in_flight: ${entry.name}(${argblurb}) started=${elapsed}s ago${suffix}`
}

// Gather progress from what is in the inventory right now. Returns null when
// the payload has no drop items or the caller has no inventory to read.
function heldGatherSuffix(p, inventory) {
  if (!inventory || typeof inventory !== 'object') return null
  if (!Array.isArray(p.items) || p.items.length === 0 || typeof p.total !== 'number') return null
  if (typeof p.before !== 'number') return null
  let held = 0
  for (const name of p.items) held += Number(inventory[name]) || 0
  const picked = Math.max(0, held - p.before)
  const left = Math.max(0, p.total - picked)
  const label = p.items.length === 1 ? p.items[0] : p.items.join(' or ')
  return ` — picked up ${picked} of the ${p.total} ${label} asked for so far, ${left} to go; you hold ${held} ${label} right now`
}
