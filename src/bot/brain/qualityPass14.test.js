// 261017: quality pass 14, player orders beat her own project.
//  - "follow me" / "come here" cuts the running foreground action at once
//  - a stop ("stop moving", "stay here") holds her: the turn that answered it
//    ends once its unfollow settles, and a later turn the player did not
//    start cannot walk her off
//  - every player line a reply deferred comes back in the completion turn
//  - the snapshot leaves out her own `next:` while the player is owed work
//  - items she gave the player are not picked back up
//  - a placed furnace / crafting table counts for the progression spine

import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { NUDGES } from './promptLibrary.js'
import { createOrchestrator, _setTickIntervalForTests, isHoldLine, isMovementOrder } from './orchestrator.js'
import { recordGivenDrop, givenDropFor } from '../adapter/minecraft/observers/givenDrops.js'
import { pickupAction } from '../adapter/minecraft/behaviors/pickup.js'
import { readProgressionState, nextMilestone } from '../adapter/minecraft/observers/progression.js'

describe('isHoldLine', () => {
  it('matches lines that ask her to stay put', () => {
    for (const t of ['stop moving', 'ok stop moving', 'stay here', 'stay here pls', 'sui stay here', "don't move", 'dont move', 'hold still', 'wait here', 'freeze', 'stay put', 'stop following me', 'stop', 'STAY HERE!']) {
      expect(isHoldLine(t), t).toBe(true)
    }
  })
  it('does not match questions, negations or work orders', () => {
    for (const t of ['why did you stop moving?', 'dont stop moving', 'stay here?', 'stay here and mine some stone', "why'd you stay there", 'keep mining', 'can you stop moving around so much while you mine']) {
      expect(isHoldLine(t), t).toBe(false)
    }
  })
})

describe('isMovementOrder', () => {
  it('matches a call to the player', () => {
    for (const t of ['follow me', 'ok follow me', 'come here', 'come over here pls', 'sui come with me', 'get over here', 'meet me at the house', 'can you come here', 'come back here']) {
      expect(isMovementOrder(t), t).toBe(true)
    }
  })
  it('does not match negations, questions or orders for later', () => {
    for (const t of ['dont follow me', "don't come here", 'why did you follow me', 'grab the logs then come back', 'come here when youre done', 'once you finish come here', 'no need to follow me', 'thanks for the help']) {
      expect(isMovementOrder(t), t).toBe(false)
    }
  })
})

// ─── orchestrator harness ───────────────────────────────────────────────

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

// gather runs until settled or aborted; follow never settles (background);
// everything else is instant.
function makeAdapter(executed, running, aborted, snapshotOpts) {
  const ACTIONS = ['gather', 'dig', 'give', 'goTo', 'follow', 'unfollow', 'explore', 'look', 'attackEntity']
  return {
    listActions: () => ACTIONS,
    getActionSchema: () => z.object({ name: z.string().optional(), item: z.string().optional(), player: z.string().optional() }),
    getActionDescription: (n) => `do ${n}`,
    capabilityParagraph: () => 'caps',
    worldPrimer: () => 'world',
    actionRules: () => 'rules',
    eventAddendum: () => '',
    createSnapshotComposer: () => ({ next: (opts) => { snapshotOpts?.push(opts); return opts?.hideNext ? 'SNAPSHOT' : 'SNAPSHOT\nnext: make a furnace' } }),
    chat: vi.fn(),
    closeAnySessions: async () => {},
    executeAction: (name, _args, opts = {}) => {
      executed.push(name)
      if (name === 'follow') return new Promise(() => {})
      if (name !== 'gather' && name !== 'dig') return Promise.resolve(`${name} ok`)
      return new Promise((resolve) => {
        running[name] = resolve
        opts.signal?.addEventListener?.('abort', () => { aborted.push(name); resolve(`aborted ${name}`) }, { once: true })
      })
    },
  }
}

let seq = 0
const config = () => {
  const tag = `${process.pid}-${Date.now()}-${seq++}`
  return {
    player_username: 'Steve',
    preferred_name: 'Steve',
    persona: { name: 'Sei', expanded: 'You are a sharp little companion.' },
    anthropic: { model: 'claude-haiku-4-5', timeout_ms: 20_000, max_retries: 1 },
    llm: { provider: 'anthropic', rate_limit_per_min: 60, debounce_ms: 0, max_hops: 5 },
    memory: {
      memory_md_path: path.join(os.tmpdir(), `sei-p14-mem-${tag}.md`),
      heartbeat_md_path: path.join(os.tmpdir(), `sei-p14-hb-${tag}.md`),
      iteration_cap: 30,
    },
  }
}

const say = (id, text) => ({ id, name: 'say', input: { text } })
const act = (id, name, input = {}) => ({ id, name, input })
const turn = (...toolUses) => ({ text: '', toolUses })
const lastUserText = (call) => JSON.stringify((call.messages ?? []).slice(-1))
const line = (text) => ({ text, username: 'Steve', playerSpoke: true, ts: Date.now() })
const DRAINED = new Set(['sei:action_complete', 'sei:chat_received', 'sei:action_tick'])
const flush = () => new Promise((r) => setTimeout(r, 5))

function setup(script) {
  _setTickIntervalForTests(10_000_000)
  const executed = []
  const running = {}
  const aborted = []
  const snapshotOpts = []
  const queue = []
  const provider = makeProvider(script)
  const orch = createOrchestrator({
    adapter: makeAdapter(executed, running, aborted, snapshotOpts), config: config(),
    reenqueue: (event, data) => queue.push({ event, data }),
    _anthropicOverride: provider,
  })
  const drain = async () => {
    for (let guard = 0; queue.length && guard < 20; guard++) {
      const next = queue.shift()
      if (DRAINED.has(next.event)) await orch.handleDispatch(next.event, next.data)
    }
  }
  return { orch, provider, executed, running, aborted, snapshotOpts, queue, drain }
}

describe('a movement order cuts the running action', () => {
  it('"follow me" during a gather aborts it and her turn starts with nothing running', async () => {
    const { orch, provider, executed, aborted, drain } = setup([
      turn(say('s1', 'on it'), act('a1', 'gather', { name: 'stone' })),
      turn(say('s2', 'coming'), act('f1', 'follow', { player: 'Steve' })),
    ])
    await orch.handleDispatch('sei:chat_received', line('get some stone'))
    expect(orch.currentLoop?.inFlight?.name).toBe('gather')
    await orch.handleDispatch('sei:chat_received', line('follow me'))
    await flush()
    expect(aborted).toEqual(['gather'])
    await drain()
    expect(provider.calls.length).toBe(2)
    const text = lastUserText(provider.calls[1])
    expect(text).toContain('follow me')
    expect(text).not.toContain('KEEP GOING')
    expect(executed).toEqual(['gather', 'follow'])
  })

  it('a line that is not a movement order still rides the running action', async () => {
    const { orch, aborted } = setup([
      turn(say('s1', 'on it'), act('a1', 'gather', { name: 'stone' })),
      turn(say('s2', 'np')),
    ])
    await orch.handleDispatch('sei:chat_received', line('get some stone'))
    await orch.handleDispatch('sei:chat_received', line('thanks for the help'))
    await flush()
    expect(aborted).toEqual([])
    expect(orch.currentLoop?.inFlight?.name).toBe('gather')
  })

  it('leaves a follow alone', async () => {
    const { orch, aborted } = setup([
      turn(say('s1', 'ok'), act('f1', 'follow', { player: 'Steve' })),
      turn(say('s2', 'right behind you')),
    ])
    await orch.handleDispatch('sei:chat_received', line('lets go'))
    expect(orch.currentLoop?.inFlight?.name).toBe('follow')
    await orch.handleDispatch('sei:chat_received', line('come with me'))
    await flush()
    expect(aborted).toEqual([])
  })
})

describe('a stop holds her', () => {
  it('"stop moving" answered with unfollow ends the loop once the unfollow settles', async () => {
    const { orch, provider, executed, drain } = setup([
      turn(say('s1', 'ok'), act('f1', 'follow', { player: 'Steve' })),
      turn(say('s2', 'ok holding still'), act('u1', 'unfollow')),
      turn(say('s3', 'gonna grab some stone'), act('a2', 'gather', { name: 'stone' })),
    ])
    await orch.handleDispatch('sei:chat_received', line('follow me'))
    await orch.handleDispatch('sei:chat_received', line('stop moving'))
    await flush()
    await drain()
    await flush()
    await drain()
    expect(provider.calls.length).toBe(2)
    expect(executed).not.toContain('gather')
    expect(orch.currentLoop).toBeNull()
    // and the next idle tick does not start anything either
    await orch.handleDispatch('sei:idle', {})
    await flush()
    expect(provider.calls.length).toBe(2)
  })

  it('a later turn the player did not start cannot walk her off while the hold is on', async () => {
    const { orch, provider, executed, drain } = setup([
      turn(say('s1', 'ok'), act('f1', 'follow', { player: 'Steve' })),
      turn(say('s2', 'ok, staying right here'), act('u1', 'unfollow')),
      // a zombie hits her: she fights back (allowed), and the turn after the
      // swing tries to wander off to explore
      turn(act('k1', 'attackEntity', { name: 'zombie' })),
      turn(say('s4', 'gonna look around'), act('e1', 'explore')),
      turn(say('s5', 'unreachable')),
    ])
    await orch.handleDispatch('sei:chat_received', line('follow me'))
    await orch.handleDispatch('sei:chat_received', line('stay here'))
    await flush()
    await drain()
    expect(orch.currentLoop).toBeNull()
    await orch.handleDispatch('sei:attacked', { attacker: 'zombie', health: 15 })
    await flush()
    await drain()
    await flush()
    await drain()
    expect(executed).toContain('attackEntity')
    expect(executed).not.toContain('explore')
    expect(provider.calls.length).toBe(4)
    expect(orch.currentLoop).toBeNull()
  })

  it('new work from the player ends the hold', async () => {
    const { orch, provider, executed, drain } = setup([
      turn(say('s1', 'ok'), act('f1', 'follow', { player: 'Steve' })),
      turn(say('s2', 'ok'), act('u1', 'unfollow')),
      turn(say('s3', 'on it'), act('a1', 'gather', { name: 'oak_log' })),
    ])
    await orch.handleDispatch('sei:chat_received', line('follow me'))
    await orch.handleDispatch('sei:chat_received', line('stop moving'))
    await flush()
    await drain()
    await orch.handleDispatch('sei:chat_received', line('ok now get wood'))
    await flush()
    expect(executed).toContain('gather')
    expect(provider.calls.length).toBe(3)
  })

  it('the blocked-action result says why, in plain words', () => {
    const t = NUDGES.stopHoldBlocked(12)
    expect(t).toContain('12s ago')
    expect(t).not.toMatch(/—/)
  })
})

describe('deferred player lines come back together', () => {
  it('keeps an order that a later question would have replaced', async () => {
    const { orch, provider, running, snapshotOpts, drain } = setup([
      turn(say('s1', 'on it'), act('a1', 'gather', { name: 'stone' })),
      turn(say('s2', 'yep after this stone')),
      turn(say('s3', 'probably moss lol')),
      turn(say('s4', 'logs now'), act('a2', 'gather', { name: 'oak_log' })),
    ])
    await orch.handleDispatch('sei:chat_received', line('mine some stone'))
    await orch.handleDispatch('sei:chat_received', line('get me like 8 logs, i wanna build a dock'))
    await flush()
    await orch.handleDispatch('sei:chat_received', line('whats ur favorite block'))
    await flush()
    expect(orch.currentLoop?._replyDeferred).toEqual(['get me like 8 logs, i wanna build a dock', 'whats ur favorite block'])
    running.gather('gathered 8/8 stone')
    await flush()
    snapshotOpts.length = 0
    await drain()
    const text = lastUserText(provider.calls[3])
    expect(text).toContain('get me like 8 logs, i wanna build a dock')
    expect(text).toContain('whats ur favorite block')
    expect(text).toContain('before your own plan')
    // her own next milestone is left out of that turn's snapshot
    expect(snapshotOpts.some((o) => o?.hideNext === true)).toBe(true)
    expect(text).not.toContain('next: make a furnace')
  })

  it('one deferred line reads as before', () => {
    expect(NUDGES.deferredReplies(['go get more wood'])).toBe(NUDGES.deferredReply('go get more wood'))
    const two = NUDGES.deferredReplies(['a', 'b'])
    expect(two).toContain('"a"')
    expect(two).toContain('"b"')
    expect(two).not.toMatch(/—/)
  })
})

describe('a player task hides her own next milestone', () => {
  it('setGoal for the player sets hideNext until the task is cleared', async () => {
    const { orch, running, snapshotOpts, drain } = setup([
      turn(say('s1', 'on it'), { id: 'g1', name: 'setGoal', input: { text: 'get 8 logs for Steve', for_player: true } }, act('a1', 'gather', { name: 'oak_log' })),
      turn(say('s2', 'here you go'), act('v1', 'give', { item: 'oak_log' }), { id: 'c1', name: 'clearGoal', input: { text: 'get 8 logs' } }),
      turn(say('s3', 'there')),
    ])
    snapshotOpts.length = 0
    await orch.handleDispatch('sei:chat_received', line('get me 8 logs'))
    expect(orch.currentLoop?.inFlight?.name).toBe('gather')
    running.gather('gathered 8/8 oak_log')
    await flush()
    await drain()
    await flush()
    await drain()
    const flags = snapshotOpts.map((o) => o?.hideNext === true)
    // shown at the seed, hidden once the task is set, shown again after clearGoal
    expect(flags[0]).toBe(false)
    expect(flags).toContain(true)
    expect(flags.at(-1)).toBe(false)
  })
})

// ─── given drops ─────────────────────────────────────────────────────────

function vec(x, y, z) {
  return { x, y, z, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z) } }
}
function itemEntity(id, name, pos) {
  return { id, name: 'item', position: pos, getDroppedItem: () => (name ? { name, count: 6 } : null) }
}

describe('items she gave the player', () => {
  it('are recognised near the toss for a few minutes', () => {
    const bot = {}
    const now = 1_000_000
    recordGivenDrop(bot, { item: 'oak_log', count: 6, at: vec(10, 64, 10), from: vec(13, 64, 10), to: 'Steve' }, now)
    expect(givenDropFor(bot, itemEntity(1, 'oak_log', vec(11, 64, 10)), now + 1000)?.to).toBe('Steve')
    // an undecoded stack near the toss counts too
    expect(givenDropFor(bot, itemEntity(2, null, vec(11, 64, 10)), now + 1000)).not.toBeNull()
    // another item, far away, or after the window does not
    expect(givenDropFor(bot, itemEntity(3, 'cobblestone', vec(11, 64, 10)), now + 1000)).toBeNull()
    expect(givenDropFor(bot, itemEntity(4, 'oak_log', vec(40, 64, 40)), now + 1000)).toBeNull()
    expect(givenDropFor(bot, itemEntity(5, 'oak_log', vec(11, 64, 10)), now + 6 * 60_000)).toBeNull()
  })

  it('pickup leaves them and says whose they are', async () => {
    const bot = {
      entity: { position: vec(12, 64, 10) },
      entities: { 1: itemEntity(1, 'oak_log', vec(10.5, 64, 10)) },
      inventory: { items: () => [] },
    }
    recordGivenDrop(bot, { item: 'oak_log', count: 6, at: vec(10, 64, 10), from: vec(12, 64, 10), to: 'Steve' })
    const goTo = vi.fn(async () => 'reached')
    const res = await pickupAction({ item: 'oak_log' }, bot, {}, { goTo, sleep: async () => {} })
    expect(goTo).not.toHaveBeenCalled()
    expect(res).toContain('you gave Steve')
  })
})

// ─── progression: a placed station counts ────────────────────────────────

describe('a placed furnace counts as had', () => {
  function bot({ placed = [] } = {}) {
    const ids = { crafting_table: 1, furnace: 2 }
    return {
      entity: { position: vec(0, 64, 0) },
      registry: { blocksByName: { crafting_table: { id: 1 }, furnace: { id: 2 } } },
      findBlock: ({ matching }) => (placed.some((n) => ids[n] === matching) ? { position: vec(1, 64, 1) } : null),
      inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'oak_log', count: 4 }, { name: 'cobblestone', count: 2 }] },
      game: { dimension: 'overworld' },
    }
  }
  it('the next milestone moves past the furnace once one is placed nearby', () => {
    const before = nextMilestone(readProgressionState(bot({ placed: ['crafting_table'] })))
    expect(before?.node?.id).toBe('furnace')
    const after = nextMilestone(readProgressionState(bot({ placed: ['crafting_table', 'furnace'] })))
    expect(after?.node?.id).not.toBe('furnace')
  })
})
