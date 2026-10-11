import pkg from 'mineflayer-pathfinder'
const { Movements, goals } = pkg

/** @typedef {'reached' | 'cant_reach' | 'timeout' | 'no_bot' | 'aborted'} PathfindResult */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// After this many 'stuck' path resets inside one goTo, give up and say where
// the bot is stuck instead of burning the rest of the wall-clock budget.
// mineflayer-pathfinder resets a path after 3.5s without reaching the next
// node and then re-plans the SAME path, so a wedged bot loops until timeout.
export const STUCK_RESETS_TO_GIVE_UP = 2

/**
 * The Movements every companion walk uses (goTo, follow, attack pursuit).
 *
 * 261011 quality pass 2: sprinting is OFF. The pathfinder's sprint-jump
 * executor wedges the bot mid-air against block corners: on a one-block step
 * up next to a second block (a hillside, a hole's rim) the bot froze at
 * y+0.4 with forward+jump+sprint held, the pathfinder reset the path every
 * 3.5s and re-planned the same jump, and goTo ran out its 12s as a bare
 * "timeout" (4 in a row in the combat_night eval, while the player begged
 * her to make the pickaxe). Measured on the eval world: 25 random walks of
 * 6-16 blocks on hilly ground, sprint 22/24 reached with 2 wedged, no sprint
 * 24/24 reached and faster on average (2.9s vs 3.6s), because a sprint jump
 * overshoots the node and re-plans. The wedge reproduces from
 * (195.5,67,2.5) to (196,68,-1) on the eval seed.
 *
 * digCost stays high so an existing route wins over tunnelling (260617), and
 * `canDig: false` is for walks that must never break anything (the walk onto
 * a tree's drop after a dig, see dropWalkOpts).
 *
 * @param {object} bot
 * @param {{ canDig?: boolean }} [opts]
 */
export function companionMovements(bot, opts = {}) {
  const m = new Movements(bot)
  m.allowSprinting = false
  m.digCost = 8
  m.maxDropDown = 4
  if (opts.canDig === false) m.canDig = false
  return m
}

/**
 * Goal: stand anywhere the block at (x,y,z) is within dig reach, measured the
 * way dig.js measures it (eyes to block center). GoalNear(x,y,z,3) asked for
 * the FEET to be within 3 of the block, which for a log five up a trunk means
 * climbing the tree; the 6s walk timed out on the ground right under a log the
 * bot could already reach.
 */
export class GoalDigReach extends goals.GoalNear {
  constructor(x, y, z, reach) {
    super(x, y, z, reach)
    this.reach = reach
  }

  isEnd(node) {
    const dx = this.x + 0.5 - (node.x + 0.5)
    const dy = this.y + 0.5 - (node.y + 1.62)
    const dz = this.z + 0.5 - (node.z + 0.5)
    return Math.hypot(dx, dy, dz) <= this.reach
  }
}

/**
 * Walk options for a walk onto a dropped item. Only a TREE forbids digging:
 * entering a dug trunk's cell means breaking the log above it, which is how a
 * drop walk used to start chopping the tree on its own. Everything else may
 * dig, because a block mined from the surface drops into the hole it leaves,
 * and with digging off the walk could not get in (261011 pass 2 eval: pickup
 * success fell from 92% to 25%, "pickup walk did not reach" doubled).
 * @param {string|undefined} name block or item name the drop came from
 */
export function dropWalkOpts(name) {
  return TREE_BLOCK.test(String(name ?? '')) ? { canDig: false } : {}
}
const TREE_BLOCK = /(_log|_wood|_stem|_hyphae|leaves|_wart_block)$/

/**
 * Cancel a dig the PATHFINDER started (a route that breaks a block) when the
 * walk that owned it ends. pathfinder.stop() does not cancel an in-progress
 * bot.dig, so a walk that timed out mid-dig left `bot.targetDigBlock` set and
 * the next dig action answered "busy digging" (gather then dropped the rest of
 * the tree). Our own dig actions mark `bot._seiDigActive`, and those are left
 * alone.
 */
export function stopPathfinderDig(bot) {
  try {
    if (bot?.targetDigBlock != null && !(bot._seiDigActive > 0)) bot.stopDigging?.()
  } catch {}
}

/**
 * Yield to a reflex-owned pathfinder goal (Plan 01 mutex). While
 * `bot._seiReflexActive` is true a creeper flee owns the goal; installing our
 * own goal would race it tick-for-tick. Park here — non-destructively, we never
 * stop()/abort the action — until the flee releases the goal, the abort signal
 * fires, or the wall-clock budget elapses. The flee restores `bot._seiSavedGoal`
 * (this action's goal) on exit, so the caller resumes its original destination.
 *
 * @param {object} bot
 * @param {AbortSignal} [signal]
 * @param {number} [budgetMs]
 * @returns {Promise<'clear'|'aborted'|'timeout'>}
 */
export async function waitForReflexClear(bot, signal, budgetMs = 12000) {
  if (!bot?._seiReflexActive) return 'clear'
  const deadline = Date.now() + budgetMs
  while (bot._seiReflexActive) {
    if (signal?.aborted) return 'aborted'
    if (Date.now() >= deadline) return 'timeout'
    await sleep(120)
  }
  return 'clear'
}

/**
 * D-09: append `unreachable — try build to Y=N` when pathfinder failure
 * (cant_reach or timeout) is plausibly caused by elevation. Heuristic:
 * target.y > bot.y + 2 (vanilla jump tops at ~1.25 blocks, so >2 above bot
 * is definitively unreachable without scaffolding).
 *
 * 260513-wkd: `aborted` short-circuits too — the LLM gets a clean abort
 * string; vertical hints would be noise on a deliberate interrupt.
 */
export function composeVerticalHint(bot, x, y, z, result) {
  if (result === 'reached' || result === 'no_bot' || result === 'aborted') return result
  const bp = bot?.entity?.position
  if (!bp || typeof bp.y !== 'number') return result
  if (y > bp.y + 2) {
    return `${result} — unreachable — try build to Y=${y}`
  }
  return result
}

/**
 * Navigate bot to (x, y, z) within `range` blocks.
 * Returns a PathfindResult — never throws or hangs.
 * @param {object} bot - mineflayer bot instance
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} range - acceptable distance from target
 * @param {number} timeoutMs - wall-clock timeout in ms
 * @param {AbortSignal} [signal] - 260513-wkd: optional abort signal. On abort
 *   we call `bot.pathfinder.stop()` and resolve to `'aborted'`. Distinct from
 *   `timeout` so the orchestrator can tell deliberate interrupts (loop preempt
 *   / stop tool) from natural wall-clock timeouts.
 * @returns {Promise<PathfindResult>}
 */
export async function goTo(bot, x, y, z, range = 1, timeoutMs = 12000, signal = undefined, opts = {}) {
  if (!bot) return 'no_bot'
  // 260513-wkd: fast-path — if signal is already aborted at entry, do not
  // even call into pathfinder. Avoids burning a setMovements + goal allocation
  // on a guaranteed-abort dispatch.
  if (signal && signal.aborted) return 'aborted'

  // 260617 anti-stuck navigation tuning. The bare defaults trap a pickaxe-less
  // bot: digCost=1 lets the planner route THROUGH stone, which the bot cannot
  // mine bare-handed — every such dig times out and the bot reads as frozen (the
  // 260617 "stuck underground" log). Raise digCost so digging is a last resort
  // and an existing route (walk / parkour / drop) wins. maxDropDown already
  // defaults to 4 (a 4-block drop costs ~1 dmg; 1-3 are free), so a "drop down to
  // get out" route was ALWAYS allowed — pathfinder was never the blocker. Set it
  // explicitly and keep it permissive so dropping to escape beats tunnelling.
  // 261011: no sprinting (see companionMovements).
  bot.pathfinder.setMovements(companionMovements(bot, opts))
  // opts.reach: walk until the block at x,y,z is within dig reach (gather,
  // dig cuboids) instead of within `range` of the feet.
  const goal = Number.isFinite(opts.reach)
    ? new GoalDigReach(x, y, z, opts.reach)
    : new goals.GoalNear(x, y, z, range)

  // Closest-distance hint on cant_reach. The LLM was getting bare
  // 'cant_reach' and either retrying identically or
  // giving up; a one-number hint ("closest=8.4m to target X,Y,Z") tells it
  // whether the destination is plausibly reachable from a different angle or
  // genuinely walled off.
  function cantReachWithDistance() {
    try {
      const bp = bot.entity?.position
      if (!bp || typeof bp.x !== 'number') return 'cant_reach'
      const dx = bp.x - x, dy = bp.y - y, dz = bp.z - z
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz).toFixed(1)
      return `cant_reach (closest=${dist}m to target ${x},${y},${z})`
    } catch {
      return 'cant_reach'
    }
  }

  let timeoutHandle = null
  let abortListener = null

  // Honest "stuck" result: count the pathfinder's own 'stuck' resets (no new
  // node for 3.5s). Two in one walk means it is re-planning a route the body
  // cannot execute; stop and say where, so the model picks another approach
  // instead of re-issuing the same goTo ("timeout" x4 in the eval).
  let stuckResets = 0
  let resolveStuck = null
  const stuckPromise = new Promise((resolve) => { resolveStuck = resolve })
  const onPathReset = (reason) => {
    if (reason !== 'stuck' || settled) return
    stuckResets++
    if (stuckResets >= STUCK_RESETS_TO_GIVE_UP) {
      settled = true
      try { bot.pathfinder.stop() } catch {}
      resolveStuck(stuckWithPosition())
    }
  }
  try { bot.on?.('path_reset', onPathReset) } catch {}

  function stuckWithPosition() {
    try {
      const bp = bot.entity?.position
      if (!bp || typeof bp.x !== 'number') return 'stuck'
      const dist = Math.hypot(bp.x - x, bp.y - y, bp.z - z).toFixed(1)
      const here = `${Math.floor(bp.x)},${Math.floor(bp.y)},${Math.floor(bp.z)}`
      return `stuck at ${here}, ${dist}m from ${x},${y},${z}: the path kept failing at the same spot. Try a different spot nearby, or dig or build through`
    } catch {
      return 'stuck'
    }
  }

  // Finding 6: once the race below has settled (timeout or abort won), the
  // navigate() loop must exit cleanly instead of continuing to run — a late
  // reflex-clear resume must never re-issue `bot.pathfinder.goto(goal)` after
  // goTo already returned to its caller (same yank hazard as the orphan-timer
  // fix below, just via the retry loop instead of the setTimeout). Set on the
  // timeout handler, the abort listener, and immediately once the race
  // settles (covers the navigate-wins case too; a redundant set there is
  // harmless).
  let settled = false

  // 17-02: yield to a reflex creeper-flee that owns the goal. We don't install
  // (or re-install, after the flee preempts our goto) our goal while
  // `bot._seiReflexActive` is true — we park and resume rather than race or
  // abort. A GoalChanged rejection while the reflex is active is the flee taking
  // over, NOT a cant_reach: loop and re-issue once it clears so an in-flight
  // goTo pauses and then continues to its original destination.
  const navigate = async () => {
    while (true) {
      if (settled) return 'aborted' // goTo already resolved — don't touch pathfinder again
      if (signal?.aborted) return 'aborted'
      if (bot._seiReflexActive) {
        const w = await waitForReflexClear(bot, signal, timeoutMs)
        if (settled) return 'aborted' // race settled while we were parked
        if (w === 'aborted') return 'aborted'
        if (w === 'timeout') return cantReachWithDistance()
      }
      try {
        await bot.pathfinder.goto(goal)
        return 'reached'
      } catch {
        if (settled) return 'aborted' // race already settled — do not re-issue goto
        if (bot._seiReflexActive) continue // flee took the goal — yield & resume
        return cantReachWithDistance()
      }
    }
  }
  const navigationPromise = navigate()

  const timeoutPromise = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      settled = true
      bot.pathfinder.stop()
      resolve('timeout')
    }, timeoutMs)
  })

  // 260513-wkd: abort race. On signal.abort, call pathfinder.stop() and
  // resolve to 'aborted'. The race with timeoutPromise + navigationPromise
  // stays as-is; whichever resolves first wins.
  const abortPromise = signal
    ? new Promise((resolve) => {
        abortListener = () => {
          settled = true
          try { bot.pathfinder.stop() } catch {}
          resolve('aborted')
        }
        signal.addEventListener('abort', abortListener, { once: true })
      })
    : null

  // Clear the timer when navigation resolves first; otherwise the orphan
  // setTimeout fires `pathfinder.stop()` later and yanks whatever goto the
  // follow tick (or any other consumer) started in the meantime. The same
  // `settled` flag also guards the navigate() retry loop above: without it, a
  // late reflex-clear resume after the timeout/abort already won the race
  // would re-issue the stale `pathfinder.goto(goal)` and yank the bot away
  // from whatever goal a later consumer installed — the exact hazard this
  // comment originally described, just reached via the retry path instead of
  // the timer.
  const racers = abortPromise
    ? [navigationPromise, timeoutPromise, stuckPromise, abortPromise]
    : [navigationPromise, timeoutPromise, stuckPromise]
  const result = await Promise.race(racers)
  settled = true
  if (timeoutHandle != null) clearTimeout(timeoutHandle)
  try { bot.off?.('path_reset', onPathReset) } catch {}
  if (signal && abortListener) {
    try { signal.removeEventListener('abort', abortListener) } catch {}
  }
  if (result !== 'reached') stopPathfinderDig(bot)
  return composeVerticalHint(bot, x, y, z, result)
}

export const PathfindResult = /** @type {const} */ ({
  REACHED: 'reached',
  CANT_REACH: 'cant_reach',
  TIMEOUT: 'timeout',
  NO_BOT: 'no_bot',
  ABORTED: 'aborted',
})
