// goTo() orphaned navigate() retry loop (Finding 6).
//
// navigate() races a wall-clock timeout against bot.pathfinder.goto(goal).
// When the timeout wins, goTo() has already returned to its caller — but the
// navigate() loop was still alive: if a reflex flee (bot._seiReflexActive)
// happened to be active at the moment the timeout rejected the in-flight
// goto, the old code treated that rejection as "flee took the goal" and
// looped back around to wait for the flee to clear, then re-issued
// `bot.pathfinder.goto(goal)` with the STALE destination — long after goTo
// already resolved and some other consumer (e.g. the follow tick) may have
// installed a different goal. The `settled` flag added in pathfind.js must
// stop that: once the race is settled, the orphaned loop exits without
// touching pathfinder again.

import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'module'
import { goTo } from './pathfind.js'

const require = createRequire(import.meta.url)
const VERSION = '1.21.1'
const mcData = require('minecraft-data')(VERSION)

// Real minecraft-data registry (same pattern as craft.test.js) — Movements'
// constructor reads real block tables (registry.blocksByName.chest, etc.), so
// a bare stub object is not enough.
function makeBot() {
  const bot = {}
  bot.entity = { position: { x: 0, y: 0, z: 0 } }
  bot.registry = mcData

  // Reflex mutex flag the reflex micro-controller (reflex.js) sets while a
  // creeper-flee owns the pathfinder goal. Starts clear.
  bot._seiReflexActive = false

  // Fake pathfinder: goto() returns a controllable pending promise; stop()
  // rejects whichever goto is currently in flight, mirroring mineflayer-
  // pathfinder's behavior of throwing out of goto() when stop() is called.
  const pending = []
  bot.pathfinder = {
    setMovements: () => {},
    goto: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          pending.push({ resolve, reject })
        })
    ),
    stop: vi.fn(() => {
      const p = pending.pop()
      if (p) p.reject(new Error('stopped'))
    }),
  }
  return bot
}

describe('goTo — orphaned navigate() retry loop after timeout (Finding 6)', () => {
  it('does not re-issue pathfinder.goto when a reflex yield resumes after the timeout already won the race', async () => {
    vi.useFakeTimers()
    try {
      const bot = makeBot()

      // y stays equal to the bot's own y so composeVerticalHint doesn't
      // append an "unreachable" suffix — irrelevant to this test.
      const resultPromise = goTo(bot, 10, 0, 10, 1, 1000)

      // The goto call happens synchronously inside navigate() before its
      // first await, so by now bot.pathfinder.goto has already been called
      // once and is pending. Simulate a reflex creeper-flee kicking in while
      // that goto is in flight.
      bot._seiReflexActive = true

      // Advance past the wall-clock timeout: the timeout handler sets
      // `settled = true`, calls pathfinder.stop() (which rejects the
      // in-flight goto), and resolves the race with 'timeout'.
      await vi.advanceTimersByTimeAsync(1000)

      expect(await resultPromise).toBe('timeout')
      expect(bot.pathfinder.goto).toHaveBeenCalledTimes(1)

      // The reflex flee now clears, as it eventually does in real play. The
      // orphaned navigate() loop (still alive in the background) must NOT
      // wake up from waitForReflexClear and re-issue a stale goto — goTo
      // already returned to its caller, who may have installed a different
      // goal by now.
      bot._seiReflexActive = false
      await vi.advanceTimersByTimeAsync(500) // past waitForReflexClear's 120ms poll

      expect(bot.pathfinder.goto).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

// 261011 quality pass 2: the walk body, stuck bail, dig reach goal.
import { EventEmitter } from 'events'
import { companionMovements, GoalDigReach, stopPathfinderDig, STUCK_RESETS_TO_GIVE_UP, dropWalkOpts } from './pathfind.js'

function makeEmitterBot() {
  const bot = Object.assign(new EventEmitter(), makeBot())
  bot.on = EventEmitter.prototype.on.bind(bot)
  bot.off = EventEmitter.prototype.off.bind(bot)
  bot.emit = EventEmitter.prototype.emit.bind(bot)
  bot.entity.position = { x: 3.5, y: 0, z: 2.5 }
  return bot
}

describe('companionMovements (261011)', () => {
  it('never sprints, keeps digging a last resort, and can forbid digging', () => {
    const bot = makeBot()
    const m = companionMovements(bot)
    expect(m.allowSprinting).toBe(false)
    expect(m.digCost).toBe(8)
    expect(m.canDig).toBe(true)
    expect(companionMovements(bot, { canDig: false }).canDig).toBe(false)
  })

  it('goTo installs the no-sprint movements', async () => {
    const bot = makeBot()
    let installed = null
    bot.pathfinder.setMovements = (m) => { installed = m }
    bot.pathfinder.goto = vi.fn(async () => {})
    expect(await goTo(bot, 1, 0, 1, 1, 1000, undefined, { canDig: false })).toBe('reached')
    expect(installed.allowSprinting).toBe(false)
    expect(installed.canDig).toBe(false)
  })
})

describe('dropWalkOpts (261011)', () => {
  it('forbids digging only on the way to a tree drop', () => {
    for (const n of ['oak_log', 'birch_wood', 'crimson_stem', 'warped_hyphae', 'oak_leaves']) {
      expect(dropWalkOpts(n)).toEqual({ canDig: false })
    }
    for (const n of ['stone', 'cobblestone', 'iron_ore', 'raw_iron', 'dirt', undefined]) {
      expect(dropWalkOpts(n)).toEqual({})
    }
  })
})

describe('goTo stuck bail (261011)', () => {
  it('stops after repeated stuck resets and says where, instead of a bare timeout', async () => {
    const bot = makeEmitterBot()
    const p = goTo(bot, 10, 0, 10, 1, 60000)
    bot.emit('path_reset', 'chunk_loaded') // not a stuck reset, ignored
    for (let i = 0; i < STUCK_RESETS_TO_GIVE_UP; i++) bot.emit('path_reset', 'stuck')
    const r = await p
    expect(r).toMatch(/^stuck at 3,0,2, 9\.9m from 10,0,10: the path kept failing/)
    expect(bot.pathfinder.stop).toHaveBeenCalled()
    expect(bot.listenerCount('path_reset')).toBe(0)
  })

  it('one stuck reset is not enough to give up', async () => {
    vi.useFakeTimers()
    try {
      const bot = makeEmitterBot()
      const p = goTo(bot, 10, 0, 10, 1, 1000)
      bot.emit('path_reset', 'stuck')
      await vi.advanceTimersByTimeAsync(1000)
      expect(await p).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('stopPathfinderDig (261011)', () => {
  it('a timed-out walk cancels the dig the pathfinder started', async () => {
    vi.useFakeTimers()
    try {
      const bot = makeEmitterBot()
      bot.stopDigging = vi.fn()
      const p = goTo(bot, 10, 0, 10, 1, 1000)
      bot.targetDigBlock = { name: 'oak_log' } // pathfinder began breaking a block on the route
      await vi.advanceTimersByTimeAsync(1000)
      expect(await p).toBe('timeout')
      expect(bot.stopDigging).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves our own dig actions alone', () => {
    const bot = { targetDigBlock: { name: 'stone' }, _seiDigActive: 1, stopDigging: vi.fn() }
    stopPathfinderDig(bot)
    expect(bot.stopDigging).not.toHaveBeenCalled()
    bot._seiDigActive = 0
    stopPathfinderDig(bot)
    expect(bot.stopDigging).toHaveBeenCalledTimes(1)
  })
})

describe('GoalDigReach (261011)', () => {
  it('ends where the EYES reach the block, so a log five up the trunk needs no climb', () => {
    const g = new GoalDigReach(0, 68, 0, 4.2)
    // Standing on the ground next to the trunk: feet at y=64, eyes ~65.6,
    // block center 68.5. Distance ~3.1 from x=1.
    expect(g.isEnd({ x: 1, y: 64, z: 0 })).toBe(true)
    // GoalNear(…,3) would demand the feet within 3 of y=68, i.e. a climb.
    expect(g.isEnd({ x: 6, y: 64, z: 0 })).toBe(false)
  })
})
