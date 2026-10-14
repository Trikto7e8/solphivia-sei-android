// 261014: quality pass 7a, wrong counts and announced-but-not-taken actions.
//  - the gather in_flight line says what she holds now and how many are left,
//    read from the same inventory as the inventory line
//  - the gather tick carries its drop items and the starting count
//  - inventory changes her own actions explain are stated as hers and as
//    already counted, not under the "the player handed you something" banner
//  - a player line that arrives while nothing runs says so, instead of telling
//    her a say() "keeps the current action going"
//  - say() asks for the count on this turn's inventory line

import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { Vec3 } from 'vec3'
import { createInflightTracker, describeArgs, getInFlightLineForSnapshot } from './inflight.js'
import { createSnapshotComposer, splitOwnInventoryChanges } from '../adapter/minecraft/observers/snapshot.js'
import { NUDGES, PERSONALITY_TOOL_DESCRIPTIONS } from './promptLibrary.js'
import { createOrchestrator, _setTickIntervalForTests } from './orchestrator.js'

describe('gather in_flight line from the live inventory', () => {
  const gather = (progress) => ({ name: 'gather', args: { name: 'oak_log', count: 6 }, startedAt: 0, progress })

  it('names the gathered block', () => {
    expect(describeArgs('gather', { name: 'oak_log', count: 6 })).toBe('oak_log')
    expect(getInFlightLineForSnapshot(gather(null), 1000)).toBe('in_flight: gather(oak_log) started=1.0s ago')
  })

  it('counts what she holds now, not the lagging tick', () => {
    // The tick still says 1 picked up; the inventory already has the second.
    const line = getInFlightLineForSnapshot(
      gather({ dug: 1, total: 6, items: ['oak_log'], before: 2 }), 3000, { inventory: { oak_log: 4, dirt: 3 } })
    expect(line).toBe('in_flight: gather(oak_log) started=3.0s ago — picked up 2 of the 6 oak_log asked for so far, 4 to go; you hold 4 oak_log right now')
  })

  it('never goes below zero to go, or below zero picked up', () => {
    expect(getInFlightLineForSnapshot(gather({ dug: 6, total: 6, items: ['oak_log'], before: 0 }), 0, { inventory: { oak_log: 7 } }))
      .toContain('picked up 7 of the 6 oak_log asked for so far, 0 to go; you hold 7 oak_log right now')
    expect(getInFlightLineForSnapshot(gather({ dug: 0, total: 6, items: ['oak_log'], before: 3 }), 0, { inventory: {} }))
      .toContain('picked up 0 of the 6 oak_log asked for so far, 6 to go; you hold 0 oak_log right now')
  })

  it('keeps the blocks-broken wording without an inventory or drop items', () => {
    expect(getInFlightLineForSnapshot(gather({ dug: 1, total: 6, items: ['oak_log'], before: 0 }), 0))
      .toContain('broke 1 of the 6 blocks asked for so far')
    expect(getInFlightLineForSnapshot(gather({ dug: 1, total: 6 }), 0, { inventory: { oak_log: 1 } }))
      .toContain('broke 1 of the 6 blocks asked for so far')
  })
})

describe('inflight tracker history', () => {
  it('keeps finished actions with their last progress, plus the running one', () => {
    const t = createInflightTracker()
    const a = t.start({ name: 'gather', args: { name: 'oak_log' } })
    t.updateProgress(a, { dug: 3, total: 3, items: ['oak_log'], before: 0 })
    t.end(a)
    const b = t.start({ name: 'craft', args: { item: 'oak_planks' } })
    const r = t.recent()
    expect(r.map(e => e.name)).toEqual(['gather', 'craft'])
    expect(r[0].endedAt).toEqual(expect.any(Number))
    expect(r[0].progress.items).toEqual(['oak_log'])
    expect(r[1].endedAt).toBeNull()
    t.end(b)
    t.end(b)
    expect(t.recent().length).toBe(2)
  })

  it('is bounded', () => {
    const t = createInflightTracker()
    for (let i = 0; i < 20; i++) t.end(t.start({ name: 'goTo', args: {} }))
    expect(t.recent().length).toBe(8)
  })
})

describe('splitOwnInventoryChanges', () => {
  const now = 100_000
  const since = 90_000
  const running = (name, progress) => ({ name, startedAt: 80_000, endedAt: null, progress })

  it('credits a gather with its own drop items only', () => {
    const r = splitOwnInventoryChanges(
      [{ item: 'oak_log', n: 2 }, { item: 'bread', n: 1 }],
      [running('gather', { items: ['oak_log'] })], since, now)
    expect(r.own).toEqual([{ item: 'oak_log', n: 2 }])
    expect(r.ownNames).toEqual(['gather'])
    expect(r.other).toEqual([{ item: 'bread', n: 1 }])
  })

  it('credits a craft with its output and the ingredients it used', () => {
    const r = splitOwnInventoryChanges(
      [{ item: 'oak_planks', n: 4 }, { item: 'oak_log', n: -1 }],
      [{ name: 'craft', startedAt: 91_000, endedAt: 92_000 }], since, now)
    expect(r.own.length).toBe(2)
    expect(r.other).toEqual([])
  })

  it('does not credit a walk or a follow with what she picked up', () => {
    const r = splitOwnInventoryChanges([{ item: 'oak_log', n: 3 }], [running('follow'), running('goTo')], since, now)
    expect(r.own).toEqual([])
    expect(r.other).toEqual([{ item: 'oak_log', n: 3 }])
  })

  it('ignores an action that finished well before the last tick', () => {
    const r = splitOwnInventoryChanges([{ item: 'oak_log', n: 1 }],
      [{ name: 'gather', startedAt: 50_000, endedAt: 60_000, progress: { items: ['oak_log'] } }], since, now)
    expect(r.own).toEqual([])
  })

  it('handles no actions', () => {
    expect(splitOwnInventoryChanges([{ item: 'dirt', n: 1 }], undefined, since, now).other.length).toBe(1)
  })
})

describe('snapshot composer: her own haul vs. a gift', () => {
  function fakeBot(inv) {
    const bot = new EventEmitter()
    Object.assign(bot, {
      version: '1.21.1', username: 'Sui', health: 20, food: 20, experience: { level: 0 },
      entity: { id: 1, position: new Vec3(0, 64, 0), yaw: 0, pitch: 0 },
      entities: {}, players: {}, time: { timeOfDay: 6000, day: 1 },
      inventory: { items: () => inv, slots: [] },
      blockAt: () => ({ name: 'air' }), findBlocks: () => [],
      game: { dimension: 'overworld' },
    })
    return bot
  }

  it('states a gather\'s logs as hers and already counted', () => {
    const inv = [{ name: 'oak_log', count: 2 }]
    const c = createSnapshotComposer({ bot: fakeBot(inv) })
    c.next({})
    inv[0].count = 4
    const now = Date.now()
    const progress = { dug: 1, total: 6, items: ['oak_log'], before: 2 }
    const snap = c.next({
      inFlight: { id: 1, name: 'gather', args: { name: 'oak_log', count: 6 }, startedAt: now - 5000, progress },
      recentActions: [{ name: 'gather', startedAt: now - 5000, endedAt: null, progress }],
    })
    expect(snap).toContain('picked up 2 of the 6 oak_log asked for so far, 4 to go; you hold 4 oak_log right now')
    expect(snap).toContain('since last tick your own gather changed your inventory: +2 oak_log (already counted on the inventory line above)')
    expect(snap).not.toContain('INVENTORY JUST CHANGED')
    const lines = snap.split('\n')
    const i = lines.findIndex(l => l.startsWith('inventory ('))
    expect(lines[i + 1]).toMatch(/^since last tick your own gather/)
  })

  it('keeps the banner for a change no action of hers explains', () => {
    const inv = [{ name: 'oak_log', count: 2 }]
    const c = createSnapshotComposer({ bot: fakeBot(inv) })
    c.next({})
    inv.push({ name: 'bread', count: 3 })
    inv[0].count = 3
    const now = Date.now()
    const snap = c.next({ recentActions: [{ name: 'gather', startedAt: now - 3000, endedAt: null, progress: { items: ['oak_log'], before: 2 } }] })
    expect(snap).toContain('your own gather changed your inventory: +1 oak_log')
    expect(snap).toMatch(/INVENTORY JUST CHANGED \*\*\*: \+3 bread {2}<-/)
    const lines = snap.split('\n')
    const i = lines.findIndex(l => l.startsWith('inventory ('))
    expect(lines[i + 1]).toMatch(/^since last tick your own gather/)
    expect(lines[i + 2]).toMatch(/^\*\*\* INVENTORY JUST CHANGED/)
  })
})

describe('prompt text', () => {
  it('the player-line hints no longer claim an action is running', () => {
    for (const k of ['playerInterruptHint', 'playerInterruptHintGroupVoice', 'playerInterruptHintGreetCrossed']) {
      expect(NUDGES[k]).not.toContain('keeps the current action going')
    }
    expect(NUDGES.replyWhileRunning).toContain('keeps the current action going')
    expect(NUDGES.replyWhileIdle).toContain('No action is running right now')
  })

  it('say() points at this turn\'s inventory line for counts', () => {
    expect(PERSONALITY_TOOL_DESCRIPTIONS.say).toContain('use the count on your inventory line this turn')
  })
})

describe('orchestrator: a player line while nothing runs', () => {
  function makeProvider(script) {
    let i = 0
    const calls = []
    return {
      calls,
      buildCachedSystem: (blocks) => blocks,
      setAuthToken() {},
      setBackend() {},
      async call(args) {
        calls.push(args)
        const r = script[Math.min(i, script.length - 1)]
        i += 1
        return typeof r === 'function' ? r(args) : r
      },
    }
  }
  function makeAdapter() {
    const ACTIONS = ['follow', 'unfollow', 'goTo', 'gather', 'dig']
    return {
      listActions: () => ACTIONS,
      getActionSchema: () => z.object({ player: z.string().optional(), name: z.string().optional() }),
      getActionDescription: (n) => `do ${n}`,
      capabilityParagraph: () => 'caps',
      worldPrimer: () => 'world',
      actionRules: () => 'rules',
      eventAddendum: () => '',
      createSnapshotComposer: () => ({ next: () => 'SNAPSHOT' }),
      chat: vi.fn(),
      closeAnySessions: async () => {},
      executeAction: (name) => (name === 'follow' ? new Promise(() => {}) : Promise.resolve('done')),
    }
  }
  const config = () => ({
    player_username: 'Steve',
    preferred_name: 'Steve',
    persona: { name: 'Sei', expanded: 'You are a sharp little companion.' },
    anthropic: { model: 'claude-haiku-4-5', timeout_ms: 20_000, max_retries: 1 },
    llm: { provider: 'anthropic', rate_limit_per_min: 30, debounce_ms: 0, max_hops: 5 },
    memory: { memory_md_path: path.join(os.tmpdir(), `sei-p7a-test-${process.pid}-${Date.now()}.md`), iteration_cap: 30 },
  })

  it('tells her nothing is running, so a promise needs its action this turn', async () => {
    _setTickIntervalForTests(10_000_000)
    const provider = makeProvider([{ text: '', toolUses: [{ id: 's1', name: 'say', input: { text: 'yo' } }] }])
    const orch = createOrchestrator({ adapter: makeAdapter(), config: config(), reenqueue: () => {}, _anthropicOverride: provider })
    await orch.handleDispatch('sei:chat_received', { text: 'can you get wood', username: 'Steve', playerSpoke: true, ts: Date.now() })
    const turn = JSON.stringify(provider.calls[0].messages ?? provider.calls[0])
    expect(turn).toContain('can you get wood')
    expect(turn).toContain(NUDGES.replyWhileIdle)
    expect(turn).not.toContain('keeps the current action going')
  })
})
